// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MilestoneEscrow
/// @notice Shared escrow for procurement agreements and grants (same logic, different `kind`).
///         Funds come only from the project's `payer` (normally the TreasuryVault), are released per
///         milestone after the reviewer approves, can be frozen by a dispute, and are returned only
///         under explicit conditions.
contract MilestoneEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        Procurement,
        Grant
    }
    enum ProjectState {
        None,
        Active,
        Disputed,
        Completed,
        Cancelled
    }
    enum MilestoneState {
        Pending,
        Approved,
        Released
    }

    struct Project {
        address payer;
        address payee;
        address reviewer;
        address token; // address(0) = native QOR
        Kind kind;
        ProjectState state;
        uint64 deadline;
        uint32 milestoneCount;
        uint32 approvedUnreleased;
        bool payeeConsentsCancel;
        uint256 total;
        uint256 funded;
        uint256 released;
        uint256 refunded;
        bytes32 metadataHash;
    }

    struct CreateParams {
        address payer;
        address payee;
        address reviewer;
        address token;
        Kind kind;
        uint64 deadline;
        bytes32 metadataHash;
        uint256[] milestoneAmounts;
    }

    uint256 public constant MAX_MILESTONES = 32;
    /// @notice After the deadline the payer must wait this long before reclaiming unreleased funds.
    uint64 public constant REFUND_GRACE = 14 days;

    uint256 public nextProjectId = 1;
    mapping(uint256 => Project) private _projects;
    mapping(uint256 => mapping(uint256 => uint256)) private _amounts;
    mapping(uint256 => mapping(uint256 => MilestoneState)) private _mState;
    mapping(address => bool) public creators;
    mapping(address => bool) public resolvers;

    event ProjectCreated(uint256 indexed projectId, address indexed payer, address indexed payee, address token, Kind kind, uint256 total);
    event ProjectFunded(uint256 indexed projectId, uint256 amount, uint256 fundedTotal);
    event MilestoneApproved(uint256 indexed projectId, uint256 indexed index, address indexed reviewer);
    event MilestoneReleased(uint256 indexed projectId, uint256 indexed index, address indexed payee, uint256 amount);
    event DisputeOpened(uint256 indexed projectId, address indexed by, bytes32 evidenceHash);
    event DisputeResolved(uint256 indexed projectId, address indexed resolver, uint256 toPayee, uint256 toPayer, bytes32 decisionHash);
    event CancelConsentSet(uint256 indexed projectId, bool consent);
    event ProjectRefunded(uint256 indexed projectId, address indexed payer, uint256 amount);
    event ProjectCompleted(uint256 indexed projectId);
    event CreatorSet(address indexed account, bool enabled);
    event ResolverSet(address indexed account, bool enabled);

    error NotAuthorized();
    error InvalidParams();
    error InvalidState();
    error AmountMismatch();
    error Overfunded();
    error NotApproved();
    error InsufficientFunded();
    error RefundNotAllowed();
    error TransferFailed();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ---------------------------------------------------------------- admin
    function setCreator(address account, bool enabled) external onlyOwner {
        creators[account] = enabled;
        emit CreatorSet(account, enabled);
    }

    function setResolver(address account, bool enabled) external onlyOwner {
        resolvers[account] = enabled;
        emit ResolverSet(account, enabled);
    }

    // ---------------------------------------------------------------- lifecycle
    /// @dev Only the payer itself or an owner-approved creator may register a project. This stops a stranger
    ///      from naming a treasury as `payer` with a hostile payee/reviewer.
    function createProject(CreateParams calldata p) external returns (uint256 projectId) {
        if (msg.sender != p.payer && !creators[msg.sender]) revert NotAuthorized();
        if (p.payer == address(0) || p.payee == address(0) || p.reviewer == address(0)) revert InvalidParams();
        if (p.payee == p.payer || p.reviewer == p.payee) revert InvalidParams();
        uint256 n = p.milestoneAmounts.length;
        if (n == 0 || n > MAX_MILESTONES) revert InvalidParams();
        if (p.deadline <= block.timestamp) revert InvalidParams();

        projectId = nextProjectId++;
        uint256 total;
        for (uint256 i = 0; i < n; ++i) {
            uint256 a = p.milestoneAmounts[i];
            if (a == 0) revert InvalidParams();
            _amounts[projectId][i] = a;
            total += a;
        }
        Project storage pr = _projects[projectId];
        pr.payer = p.payer;
        pr.payee = p.payee;
        pr.reviewer = p.reviewer;
        pr.token = p.token;
        pr.kind = p.kind;
        pr.state = ProjectState.Active;
        pr.deadline = p.deadline;
        pr.milestoneCount = uint32(n);
        pr.total = total;
        pr.metadataHash = p.metadataHash;
        emit ProjectCreated(projectId, p.payer, p.payee, p.token, p.kind, total);
    }

    /// @notice Fund a project. Only the project's payer may fund. Native: send `amount` as value.
    ///         ERC-20: the payer must have approved this contract; `msg.value` must be zero.
    function fundProject(uint256 projectId, uint256 amount) external payable nonReentrant {
        Project storage pr = _projects[projectId];
        if (pr.state != ProjectState.Active) revert InvalidState();
        if (msg.sender != pr.payer) revert NotAuthorized();
        if (amount == 0) revert InvalidParams();
        if (pr.funded + amount > pr.total) revert Overfunded();

        pr.funded += amount;
        if (pr.token == address(0)) {
            if (msg.value != amount) revert AmountMismatch();
        } else {
            if (msg.value != 0) revert AmountMismatch();
            IERC20(pr.token).safeTransferFrom(msg.sender, address(this), amount);
        }
        emit ProjectFunded(projectId, amount, pr.funded);
    }

    function approveMilestone(uint256 projectId, uint256 index) external {
        Project storage pr = _projects[projectId];
        if (pr.state != ProjectState.Active) revert InvalidState();
        if (msg.sender != pr.reviewer) revert NotAuthorized();
        if (index >= pr.milestoneCount) revert InvalidParams();
        if (_mState[projectId][index] != MilestoneState.Pending) revert InvalidState();
        _mState[projectId][index] = MilestoneState.Approved;
        pr.approvedUnreleased += 1;
        emit MilestoneApproved(projectId, index, msg.sender);
    }

    /// @notice Release an approved milestone to the payee. Anyone may trigger it; funds only go to the payee.
    function releaseMilestone(uint256 projectId, uint256 index) external nonReentrant {
        Project storage pr = _projects[projectId];
        if (pr.state != ProjectState.Active) revert InvalidState(); // frozen while disputed
        if (index >= pr.milestoneCount) revert InvalidParams();
        if (_mState[projectId][index] != MilestoneState.Approved) revert NotApproved();

        uint256 amount = _amounts[projectId][index];
        if (pr.funded - pr.released - pr.refunded < amount) revert InsufficientFunded();

        // effects before interaction; the state flip makes a double release impossible
        _mState[projectId][index] = MilestoneState.Released;
        pr.approvedUnreleased -= 1;
        pr.released += amount;
        if (pr.released == pr.total) {
            pr.state = ProjectState.Completed;
            emit ProjectCompleted(projectId);
        }
        _pay(pr.token, pr.payee, amount);
        emit MilestoneReleased(projectId, index, pr.payee, amount);
    }

    // ---------------------------------------------------------------- disputes
    function openDispute(uint256 projectId, bytes32 evidenceHash) external {
        Project storage pr = _projects[projectId];
        if (pr.state != ProjectState.Active) revert InvalidState();
        if (msg.sender != pr.payer && msg.sender != pr.payee) revert NotAuthorized();
        pr.state = ProjectState.Disputed;
        emit DisputeOpened(projectId, msg.sender, evidenceHash);
    }

    /// @notice An authorised resolver disposes of the entire remaining balance between payee and payer.
    function resolveDispute(uint256 projectId, uint256 toPayee, uint256 toPayer, bytes32 decisionHash)
        external
        nonReentrant
    {
        Project storage pr = _projects[projectId];
        if (!resolvers[msg.sender]) revert NotAuthorized();
        if (pr.state != ProjectState.Disputed) revert InvalidState();
        uint256 remaining = pr.funded - pr.released - pr.refunded;
        if (toPayee + toPayer != remaining) revert AmountMismatch();

        pr.state = ProjectState.Completed;
        pr.released += toPayee;
        pr.refunded += toPayer;
        if (toPayee > 0) _pay(pr.token, pr.payee, toPayee);
        if (toPayer > 0) _pay(pr.token, pr.payer, toPayer);
        emit DisputeResolved(projectId, msg.sender, toPayee, toPayer, decisionHash);
    }

    // ---------------------------------------------------------------- refunds
    function setCancelConsent(uint256 projectId, bool consent) external {
        Project storage pr = _projects[projectId];
        if (msg.sender != pr.payee) revert NotAuthorized();
        pr.payeeConsentsCancel = consent;
        emit CancelConsentSet(projectId, consent);
    }

    /// @notice Payer reclaims unreleased funds when (a) the payee consented, or (b) the deadline plus a grace
    ///         period has passed and no approved milestone is waiting to be released. Never while disputed.
    function refundUnused(uint256 projectId) external nonReentrant {
        Project storage pr = _projects[projectId];
        if (pr.state != ProjectState.Active) revert InvalidState();
        if (msg.sender != pr.payer) revert NotAuthorized();
        bool consent = pr.payeeConsentsCancel;
        bool lapsed = block.timestamp > uint256(pr.deadline) + REFUND_GRACE && pr.approvedUnreleased == 0;
        if (!consent && !lapsed) revert RefundNotAllowed();

        uint256 remaining = pr.funded - pr.released - pr.refunded;
        pr.refunded += remaining;
        pr.state = ProjectState.Cancelled;
        if (remaining > 0) _pay(pr.token, pr.payer, remaining);
        emit ProjectRefunded(projectId, pr.payer, remaining);
    }

    // ---------------------------------------------------------------- views
    function getProject(uint256 projectId) external view returns (Project memory) {
        return _projects[projectId];
    }

    function projectPayer(uint256 projectId) external view returns (address) {
        return _projects[projectId].payer;
    }

    function projectToken(uint256 projectId) external view returns (address) {
        return _projects[projectId].token;
    }

    function milestoneAmount(uint256 projectId, uint256 index) external view returns (uint256) {
        return _amounts[projectId][index];
    }

    function milestoneState(uint256 projectId, uint256 index) external view returns (MilestoneState) {
        return _mState[projectId][index];
    }

    function remaining(uint256 projectId) external view returns (uint256) {
        Project storage pr = _projects[projectId];
        return pr.funded - pr.released - pr.refunded;
    }

    // ---------------------------------------------------------------- internal
    function _pay(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
