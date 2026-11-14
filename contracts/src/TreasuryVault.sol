// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPolicyManager {
    function activeVersion() external view returns (uint64);
}

interface IMilestoneEscrow {
    function fundProject(uint256 projectId, uint256 amount) external payable;
    function projectPayer(uint256 projectId) external view returns (address);
    function projectToken(uint256 projectId) external view returns (address);
}

/// @title TreasuryVault
/// @notice Holds an organisation's funds. AI agents are plain EOAs/accounts with *bounded* spending rights:
///         per-token per-transaction cap, per-token daily cap, expiry, and an auto-approve ceiling. Anything
///         above the ceiling, or to a recipient that is not on the approved list, needs `approvalThreshold`
///         human approvals bound to the exact payment. There is deliberately no owner "withdraw anything"
///         function: funds leave only through this pipeline.
/// @dev Payments are identified by `paymentHash`, which commits to chain, vault, agent, token, recipient, amount,
///      purpose, policy version, expiry and nonce. Changing any field yields a different hash, so earlier
///      approvals do not carry over. A hash can execute at most once.
contract TreasuryVault is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Payment {
        address token; // address(0) = native QOR
        address to;
        uint256 amount;
        bytes32 purposeHash; // e.g. keccak256 of invoice id / milestone ref (kept off-chain in plaintext)
        uint64 policyVersion;
        uint64 expiry;
        uint256 nonce;
    }

    struct AgentLimits {
        bool active;
        uint64 validUntil;
        uint128 perTxCap;
        uint128 dailyCap;
        uint128 autoApproveCap; // payments to approved recipients at or below this need no human approval
    }

    uint64 public constant MAX_PAYMENT_LIFETIME = 7 days;

    IPolicyManager public immutable policyManager;

    uint8 public approvalThreshold = 1;
    uint32 public approverCount;
    mapping(address => bool) public isApprover;
    mapping(address => bool) public isGuardian;
    mapping(address => bool) public approvedRecipient;
    mapping(address => bool) public isEscrow;
    mapping(address => bool) public allowedToken;

    mapping(address agent => mapping(address token => AgentLimits)) public limits;
    mapping(address agent => mapping(address token => mapping(uint256 day => uint256))) public spentOnDay;

    mapping(bytes32 => uint32) public approvalsOf;
    mapping(bytes32 => mapping(address => bool)) public approvedBy;
    mapping(bytes32 => bool) public executed;

    event Deposited(address indexed token, address indexed from, uint256 amount);
    event AgentLimitsSet(address indexed agent, address indexed token, uint128 perTxCap, uint128 dailyCap, uint128 autoApproveCap, uint64 validUntil);
    event AgentRevoked(address indexed agent, address indexed token);
    event RecipientSet(address indexed recipient, bool approved);
    event EscrowSet(address indexed escrow, bool enabled);
    event TokenSet(address indexed token, bool allowed);
    event ApproverSet(address indexed approver, bool enabled);
    event ThresholdSet(uint8 threshold);
    event GuardianSet(address indexed guardian, bool enabled);
    event PaymentApproved(bytes32 indexed paymentHash, address indexed approver, uint32 approvals);
    event PaymentExecuted(bytes32 indexed paymentHash, address indexed agent, address indexed to, address token, uint256 amount, bytes32 purposeHash, uint64 policyVersion);
    event EscrowFunded(bytes32 indexed paymentHash, address indexed escrow, uint256 indexed projectId, address token, uint256 amount);

    error NotGuardianOrOwner();
    error NotApprover();
    error InvalidPayment();
    error PolicyMismatch();
    error Expired();
    error AlreadyExecuted();
    error AgentNotActive();
    error TokenNotAllowed();
    error ExceedsPerTxCap();
    error ExceedsDailyCap();
    error InsufficientApprovals(uint32 have, uint32 need);
    error AlreadyApproved();
    error InvalidThreshold();
    error NotEscrow();
    error EscrowProjectMismatch();
    error TransferFailed();
    error CapTooLarge();

    constructor(address initialOwner, IPolicyManager policyManager_) Ownable(initialOwner) {
        policyManager = policyManager_;
    }

    receive() external payable {
        emit Deposited(address(0), msg.sender, msg.value);
    }

    // ------------------------------------------------------------- configuration (owner)
    function setAgentLimits(
        address agent,
        address token,
        uint128 perTxCap,
        uint128 dailyCap,
        uint128 autoApproveCap,
        uint64 validUntil
    ) external onlyOwner {
        if (agent == address(0)) revert InvalidPayment();
        if (perTxCap == 0 || dailyCap < perTxCap || autoApproveCap > perTxCap) revert CapTooLarge();
        limits[agent][token] = AgentLimits(true, validUntil, perTxCap, dailyCap, autoApproveCap);
        emit AgentLimitsSet(agent, token, perTxCap, dailyCap, autoApproveCap, validUntil);
    }

    function revokeAgent(address agent, address token) external {
        if (msg.sender != owner() && !isGuardian[msg.sender]) revert NotGuardianOrOwner();
        limits[agent][token].active = false;
        emit AgentRevoked(agent, token);
    }

    function setApprovedRecipient(address recipient, bool approved) external onlyOwner {
        approvedRecipient[recipient] = approved;
        emit RecipientSet(recipient, approved);
    }

    function setEscrow(address escrow, bool enabled) external onlyOwner {
        isEscrow[escrow] = enabled;
        emit EscrowSet(escrow, enabled);
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        allowedToken[token] = allowed;
        emit TokenSet(token, allowed);
    }

    function setApprover(address approver, bool enabled) external onlyOwner {
        if (isApprover[approver] == enabled) return;
        isApprover[approver] = enabled;
        if (enabled) {
            approverCount += 1;
        } else {
            approverCount -= 1;
            if (approverCount < approvalThreshold) revert InvalidThreshold();
        }
        emit ApproverSet(approver, enabled);
    }

    function setApprovalThreshold(uint8 threshold) external onlyOwner {
        if (threshold == 0 || threshold > approverCount) revert InvalidThreshold();
        approvalThreshold = threshold;
        emit ThresholdSet(threshold);
    }

    function setGuardian(address guardian, bool enabled) external onlyOwner {
        isGuardian[guardian] = enabled;
        emit GuardianSet(guardian, enabled);
    }

    /// @notice Owner or guardian can freeze all payments immediately; only the owner can resume.
    function pause() external {
        if (msg.sender != owner() && !isGuardian[msg.sender]) revert NotGuardianOrOwner();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ------------------------------------------------------------- deposits
    function depositToken(address token, uint256 amount) external {
        if (!allowedToken[token]) revert TokenNotAllowed();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    // ------------------------------------------------------------- approvals
    /// @notice An approver endorses one exact payment by one exact agent. Passing the struct (not just a hash)
    ///         makes the approver commit on chain to the readable fields.
    function approvePayment(address agent, Payment calldata p) external returns (bytes32 h) {
        if (!isApprover[msg.sender]) revert NotApprover();
        h = paymentHash(agent, p);
        if (executed[h]) revert AlreadyExecuted();
        if (block.timestamp > p.expiry) revert Expired();
        if (approvedBy[h][msg.sender]) revert AlreadyApproved();
        approvedBy[h][msg.sender] = true;
        approvalsOf[h] += 1;
        emit PaymentApproved(h, msg.sender, approvalsOf[h]);
    }

    // ------------------------------------------------------------- execution (agents)
    /// @notice Pay `p.to` from the vault. Caller is the agent whose limits apply.
    function executePayment(Payment calldata p) external nonReentrant whenNotPaused returns (bytes32 h) {
        h = _authorize(msg.sender, p);
        if (p.token == address(0)) {
            (bool ok,) = p.to.call{value: p.amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(p.token).safeTransfer(p.to, p.amount);
        }
        emit PaymentExecuted(h, msg.sender, p.to, p.token, p.amount, p.purposeHash, p.policyVersion);
    }

    /// @notice Allocate funds into a MilestoneEscrow project. The escrow must be registered, the project's payer
    ///         must be this vault, and the project's token must match, so a payment cannot be redirected.
    function fundEscrow(Payment calldata p, uint256 projectId) external nonReentrant whenNotPaused returns (bytes32 h) {
        if (!isEscrow[p.to]) revert NotEscrow();
        IMilestoneEscrow esc = IMilestoneEscrow(p.to);
        if (esc.projectPayer(projectId) != address(this) || esc.projectToken(projectId) != p.token) {
            revert EscrowProjectMismatch();
        }
        h = _authorize(msg.sender, p);
        if (p.token == address(0)) {
            esc.fundProject{value: p.amount}(projectId, p.amount);
        } else {
            IERC20(p.token).forceApprove(p.to, p.amount);
            esc.fundProject(projectId, p.amount);
            IERC20(p.token).forceApprove(p.to, 0);
        }
        emit EscrowFunded(h, p.to, projectId, p.token, p.amount);
    }

    // ------------------------------------------------------------- views
    function paymentHash(address agent, Payment calldata p) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                agent,
                p.token,
                p.to,
                p.amount,
                p.purposeHash,
                p.policyVersion,
                p.expiry,
                p.nonce
            )
        );
    }

    function remainingDaily(address agent, address token) external view returns (uint256) {
        AgentLimits memory l = limits[agent][token];
        uint256 spent = spentOnDay[agent][token][block.timestamp / 1 days];
        return spent >= l.dailyCap ? 0 : l.dailyCap - spent;
    }

    /// @notice Number of approvals a payment would need right now (0 = agent may execute alone).
    function approvalsRequired(address agent, address token, address to, uint256 amount) public view returns (uint32) {
        AgentLimits memory l = limits[agent][token];
        if (approvedRecipient[to] && amount <= l.autoApproveCap) return 0;
        return approvalThreshold;
    }

    // ------------------------------------------------------------- internals
    function _authorize(address agent, Payment calldata p) private returns (bytes32 h) {
        if (p.amount == 0 || p.to == address(0)) revert InvalidPayment();
        if (p.token != address(0) && !allowedToken[p.token]) revert TokenNotAllowed();

        uint64 active = policyManager.activeVersion();
        if (active == 0 || p.policyVersion != active) revert PolicyMismatch();
        if (block.timestamp > p.expiry) revert Expired();
        if (p.expiry > block.timestamp + MAX_PAYMENT_LIFETIME) revert InvalidPayment();

        AgentLimits memory l = limits[agent][p.token];
        if (!l.active || block.timestamp > l.validUntil) revert AgentNotActive();
        if (p.amount > l.perTxCap) revert ExceedsPerTxCap();

        uint256 day = block.timestamp / 1 days;
        uint256 newSpent = spentOnDay[agent][p.token][day] + p.amount;
        if (newSpent > l.dailyCap) revert ExceedsDailyCap();

        h = paymentHash(agent, p);
        if (executed[h]) revert AlreadyExecuted();

        uint32 need = approvalsRequired(agent, p.token, p.to, p.amount);
        uint32 have = approvalsOf[h];
        if (have < need) revert InsufficientApprovals(have, need);

        // effects before any external call
        executed[h] = true;
        spentOnDay[agent][p.token][day] = newSpent;
    }
}
