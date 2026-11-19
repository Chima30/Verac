// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev QoreChain's PQC precompiles (active on Diana testnet; see docs.qorechain.io/developer-guide/evm-precompiles).
interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message) external view returns (bool valid);
    function pqcKeyStatus(address account) external view returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

/// @title TreasuryVaultV2
/// @notice A vault with NO owner. Every payment and every administrative change needs a threshold of distinct
///         administrators' ML-DSA-87 (post-quantum) signatures over the exact operation. The vault verifies each
///         signature on chain with QoreChain's PQC Verify precompile, against the key the chain itself has registered
///         for that administrator's account (PQC Key Status precompile, possession proven). Whoever submits the
///         transaction (an agent, a relayer, the application server) cannot create those signatures.
/// @dev    Differences from TreasuryVault (V1), which stays deployed and unchanged:
///         - no owner and no single key that can change anything; administration is threshold-signed (minimum 2);
///         - there is no auto-approval: every payment carries administrator signatures;
///         - agent caps, approved recipients, expiry, exact payment binding and one-time execution are kept.
///         Escrow funding is not supported here; it stays on V1.
contract TreasuryVaultV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IQorePQC public constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC public constant PQC_STATUS = IQorePQC(0x0000000000000000000000000000000000000a02);
    uint8 public constant ML_DSA_87 = 1;
    uint256 public constant ML_DSA_87_PUBKEY_BYTES = 2592;
    uint256 public constant MAX_ADMINS = 10;
    uint8 public constant MIN_THRESHOLD = 2;
    uint64 public constant MAX_LIFETIME = 7 days;

    bytes32 public constant PAYMENT_TAG = keccak256("Verac.TreasuryVaultV2.Payment.v1");
    bytes32 public constant ADMIN_TAG = keccak256("Verac.TreasuryVaultV2.Admin.v1");
    /// @dev Prefix of the bytes an administrator signs, so an approval can never be read as any other kind of message.
    bytes public constant SIGNING_PREFIX = "verac-v2-approval|";

    struct Payment {
        address token; // address(0) = native QOR
        address to;
        uint256 amount;
        bytes32 purposeHash;
        uint64 policyVersion;
        uint64 expiry;
        uint256 nonce;
    }

    struct AdminSig {
        address signer; // an administrator's 0x address; its ML-DSA-87 key is read from the chain
        bytes signature; // ML-DSA-87 signature (4627 bytes) over SIGNING_PREFIX ‖ digest
    }

    struct AgentLimits {
        bool active;
        uint64 validUntil;
        uint128 perTxCap;
        uint128 dailyCap;
    }

    enum AdminOp {
        SetAgentLimits, // (address agent, address token, uint128 perTxCap, uint128 dailyCap, uint64 validUntil)
        RevokeAgent, //    (address agent, address token)
        SetRecipient, //   (address recipient, bool approved)
        SetToken, //       (address token, bool allowed)
        AddAdmin, //       (address admin)
        RemoveAdmin, //    (address admin)
        SetThreshold, //   (uint8 threshold)
        SetPolicy, //      (bytes32 policyHash)  -> policyVersion + 1
        SetGuardian, //    (address guardian, bool enabled)
        Unpause //         ()
    }

    // ---------------------------------------------------------------- state
    mapping(address => bool) public isAdmin;
    uint8 public adminCount;
    uint8 public threshold;
    uint256 public adminNonce; // next admin action nonce; each action uses it once, in order

    uint64 public policyVersion;
    bytes32 public policyHash;
    bool public paused;

    mapping(address => bool) public isGuardian;
    mapping(address => bool) public approvedRecipient;
    mapping(address => bool) public allowedToken;
    mapping(address agent => mapping(address token => AgentLimits)) public limits;
    mapping(address agent => mapping(address token => mapping(uint256 day => uint256))) public spentOnDay;
    mapping(bytes32 => bool) public executed;

    // ---------------------------------------------------------------- events
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event PaymentExecuted(bytes32 indexed paymentDigest, address indexed agent, address indexed to, address token, uint256 amount, bytes32 purposeHash, uint64 policyVersion, address[] signers);
    event AdminActionExecuted(uint256 indexed nonce, AdminOp indexed op, bytes32 dataHash, address[] signers);
    event AdminSet(address indexed admin, bool enabled);
    event ThresholdSet(uint8 threshold);
    event AgentLimitsSet(address indexed agent, address indexed token, uint128 perTxCap, uint128 dailyCap, uint64 validUntil);
    event AgentRevoked(address indexed agent, address indexed token, address by);
    event RecipientSet(address indexed recipient, bool approved);
    event TokenSet(address indexed token, bool allowed);
    event PolicySet(uint64 version, bytes32 policyHash);
    event GuardianSet(address indexed guardian, bool enabled);
    event Paused(address by);
    event Unpaused();

    // ---------------------------------------------------------------- errors
    error BadConfig();
    error NotAdmin(address signer);
    error SignersNotSorted();
    error AdminKeyNotProven(address signer);
    error BadSignature(address signer);
    error NotEnoughSignatures(uint256 have, uint256 need);
    error Expired();
    error LifetimeTooLong();
    error AlreadyExecuted();
    error BadNonce(uint256 expected);
    error PolicyMismatch();
    error AgentNotActive();
    error ExceedsPerTxCap();
    error ExceedsDailyCap();
    error RecipientNotApproved();
    error TokenNotAllowed();
    error InvalidPayment();
    error IsPaused();
    error NotGuardian();
    error AgentCannotBeAdmin();
    error TransferFailed();

    constructor(address[] memory admins, uint8 threshold_, bytes32 policyHash_) {
        if (admins.length < MIN_THRESHOLD || admins.length > MAX_ADMINS) revert BadConfig();
        if (threshold_ < MIN_THRESHOLD || threshold_ > admins.length) revert BadConfig();
        for (uint256 i = 0; i < admins.length; i++) {
            address a = admins[i];
            if (a == address(0) || isAdmin[a]) revert BadConfig();
            _requireProvenKey(a);
            isAdmin[a] = true;
            emit AdminSet(a, true);
        }
        adminCount = uint8(admins.length);
        threshold = threshold_;
        emit ThresholdSet(threshold_);
        policyVersion = 1;
        policyHash = policyHash_;
        emit PolicySet(1, policyHash_);
    }

    receive() external payable {
        emit Deposited(address(0), msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- digests (also used off chain)
    /// @notice The exact digest administrators sign for a payment made by `agent` on this vault and chain.
    function paymentDigest(address agent, Payment calldata p) public view returns (bytes32) {
        return computePaymentDigest(block.chainid, address(this), agent, p);
    }

    function computePaymentDigest(uint256 chainId, address vault, address agent, Payment calldata p) public pure returns (bytes32) {
        return keccak256(abi.encode(PAYMENT_TAG, chainId, vault, agent, p.token, p.to, p.amount, p.purposeHash, p.policyVersion, p.expiry, p.nonce));
    }

    function adminDigest(AdminOp op, bytes calldata data, uint256 nonce, uint64 expiry) public view returns (bytes32) {
        return computeAdminDigest(block.chainid, address(this), op, data, nonce, expiry);
    }

    function computeAdminDigest(uint256 chainId, address vault, AdminOp op, bytes calldata data, uint256 nonce, uint64 expiry) public pure returns (bytes32) {
        return keccak256(abi.encode(ADMIN_TAG, chainId, vault, uint8(op), keccak256(data), nonce, expiry));
    }

    /// @notice The bytes an administrator's ML-DSA-87 key signs for a digest.
    function signingBytes(bytes32 digest) public pure returns (bytes memory) {
        return abi.encodePacked(SIGNING_PREFIX, digest);
    }

    // ---------------------------------------------------------------- payments
    /// @notice Pays `p.to` from the vault. The caller is the agent whose limits apply; `sigs` are the administrators'
    ///         approvals of exactly this payment by exactly this agent, sorted by signer address.
    function executePayment(Payment calldata p, AdminSig[] calldata sigs) external nonReentrant returns (bytes32 digest) {
        if (paused) revert IsPaused();
        if (p.amount == 0 || p.to == address(0)) revert InvalidPayment();
        if (p.token != address(0) && !allowedToken[p.token]) revert TokenNotAllowed();
        if (!approvedRecipient[p.to]) revert RecipientNotApproved();
        if (p.policyVersion != policyVersion) revert PolicyMismatch();
        if (block.timestamp > p.expiry) revert Expired();
        if (p.expiry > block.timestamp + MAX_LIFETIME) revert LifetimeTooLong();

        AgentLimits memory l = limits[msg.sender][p.token];
        if (!l.active || block.timestamp > l.validUntil) revert AgentNotActive();
        if (p.amount > l.perTxCap) revert ExceedsPerTxCap();
        uint256 day = block.timestamp / 1 days;
        uint256 newSpent = spentOnDay[msg.sender][p.token][day] + p.amount;
        if (newSpent > l.dailyCap) revert ExceedsDailyCap();

        digest = paymentDigest(msg.sender, p);
        if (executed[digest]) revert AlreadyExecuted();
        address[] memory signers = _verifyThreshold(digest, sigs);

        executed[digest] = true;
        spentOnDay[msg.sender][p.token][day] = newSpent;

        if (p.token == address(0)) {
            (bool ok,) = p.to.call{value: p.amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(p.token).safeTransfer(p.to, p.amount);
        }
        emit PaymentExecuted(digest, msg.sender, p.to, p.token, p.amount, p.purposeHash, p.policyVersion, signers);
    }

    // ---------------------------------------------------------------- administration (threshold-signed, anyone may relay)
    function executeAdminAction(AdminOp op, bytes calldata data, uint256 nonce, uint64 expiry, AdminSig[] calldata sigs) external nonReentrant {
        if (nonce != adminNonce) revert BadNonce(adminNonce);
        if (block.timestamp > expiry) revert Expired();
        if (expiry > block.timestamp + MAX_LIFETIME) revert LifetimeTooLong();
        bytes32 digest = adminDigest(op, data, nonce, expiry);
        address[] memory signers = _verifyThreshold(digest, sigs);
        adminNonce = nonce + 1;
        _apply(op, data);
        emit AdminActionExecuted(nonce, op, keccak256(data), signers);
    }

    function _apply(AdminOp op, bytes calldata data) private {
        if (op == AdminOp.SetAgentLimits) {
            (address agent, address token, uint128 perTx, uint128 daily, uint64 validUntil) = abi.decode(data, (address, address, uint128, uint128, uint64));
            if (agent == address(0) || perTx == 0 || daily < perTx) revert BadConfig();
            if (isAdmin[agent]) revert AgentCannotBeAdmin();
            limits[agent][token] = AgentLimits(true, validUntil, perTx, daily);
            emit AgentLimitsSet(agent, token, perTx, daily, validUntil);
        } else if (op == AdminOp.RevokeAgent) {
            (address agent, address token) = abi.decode(data, (address, address));
            limits[agent][token].active = false;
            emit AgentRevoked(agent, token, address(this));
        } else if (op == AdminOp.SetRecipient) {
            (address r, bool ok) = abi.decode(data, (address, bool));
            if (r == address(0)) revert BadConfig();
            approvedRecipient[r] = ok;
            emit RecipientSet(r, ok);
        } else if (op == AdminOp.SetToken) {
            (address t, bool ok) = abi.decode(data, (address, bool));
            if (t == address(0)) revert BadConfig();
            allowedToken[t] = ok;
            emit TokenSet(t, ok);
        } else if (op == AdminOp.AddAdmin) {
            address a = abi.decode(data, (address));
            if (a == address(0) || isAdmin[a] || adminCount >= MAX_ADMINS) revert BadConfig();
            _requireProvenKey(a);
            isAdmin[a] = true;
            adminCount += 1;
            emit AdminSet(a, true);
        } else if (op == AdminOp.RemoveAdmin) {
            address a = abi.decode(data, (address));
            if (!isAdmin[a] || adminCount - 1 < threshold) revert BadConfig();
            isAdmin[a] = false;
            adminCount -= 1;
            emit AdminSet(a, false);
        } else if (op == AdminOp.SetThreshold) {
            uint8 t = abi.decode(data, (uint8));
            if (t < MIN_THRESHOLD || t > adminCount) revert BadConfig();
            threshold = t;
            emit ThresholdSet(t);
        } else if (op == AdminOp.SetPolicy) {
            bytes32 h = abi.decode(data, (bytes32));
            policyVersion += 1;
            policyHash = h;
            emit PolicySet(policyVersion, h);
        } else if (op == AdminOp.SetGuardian) {
            (address g, bool ok) = abi.decode(data, (address, bool));
            isGuardian[g] = ok;
            emit GuardianSet(g, ok);
        } else if (op == AdminOp.Unpause) {
            paused = false;
            emit Unpaused();
        }
    }

    // ---------------------------------------------------------------- emergency (risk-reducing only)
    /// @notice A guardian can stop all payments at once. Only a threshold admin action can resume.
    function pause() external {
        if (!isGuardian[msg.sender]) revert NotGuardian();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice A guardian can switch off an agent at once. Re-enabling needs a threshold admin action.
    function guardianRevokeAgent(address agent, address token) external {
        if (!isGuardian[msg.sender]) revert NotGuardian();
        limits[agent][token].active = false;
        emit AgentRevoked(agent, token, msg.sender);
    }

    function remainingDaily(address agent, address token) external view returns (uint256) {
        AgentLimits memory l = limits[agent][token];
        uint256 spent = spentOnDay[agent][token][block.timestamp / 1 days];
        return spent >= l.dailyCap ? 0 : l.dailyCap - spent;
    }

    // ---------------------------------------------------------------- signature checks
    /// @dev Signers must be administrators, strictly increasing (so each counts once), each with a registered ML-DSA-87
    ///      key whose possession was proven, and each signature must verify over SIGNING_PREFIX ‖ digest.
    function _verifyThreshold(bytes32 digest, AdminSig[] calldata sigs) private view returns (address[] memory signers) {
        if (sigs.length < threshold) revert NotEnoughSignatures(sigs.length, threshold);
        bytes memory message = signingBytes(digest);
        signers = new address[](sigs.length);
        address prev = address(0);
        for (uint256 i = 0; i < sigs.length; i++) {
            address s = sigs[i].signer;
            if (s <= prev) revert SignersNotSorted();
            prev = s;
            if (!isAdmin[s]) revert NotAdmin(s);
            bytes memory pubkey = _requireProvenKey(s);
            if (!PQC_VERIFY.pqcVerify(pubkey, sigs[i].signature, message)) revert BadSignature(s);
            signers[i] = s;
        }
    }

    function _requireProvenKey(address account) private view returns (bytes memory pubkey) {
        (bool registered, uint8 alg, bytes memory pk, bool proven) = PQC_STATUS.pqcKeyStatus(account);
        if (!registered || alg != ML_DSA_87 || !proven || pk.length != ML_DSA_87_PUBKEY_BYTES) revert AdminKeyNotProven(account);
        return pk;
    }
}
