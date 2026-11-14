// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title PolicyManager
/// @notice Holds the active policy version for a treasury. Payments are bound to a policy version,
///         so activating a new version (or revoking) invalidates every approval prepared under the old one.
/// @dev The policy document itself lives off-chain; only its hash is committed. The numeric limits that
///      matter for safety (per-tx caps, daily caps, approvers) are enforced by TreasuryVault.
contract PolicyManager is Ownable2Step {
    uint64 private _activeVersion;
    uint64 public latestVersion;
    mapping(uint64 => bytes32) public policyHashOf;
    mapping(uint64 => uint64) public activatedAt;
    mapping(address => bool) public guardians;

    event PolicyActivated(uint64 indexed version, bytes32 indexed policyHash, address indexed by);
    event PolicyRevoked(uint64 indexed version, address indexed by);
    event GuardianSet(address indexed guardian, bool enabled);

    error NotOwnerOrGuardian();
    error EmptyPolicyHash();
    error NothingToRevoke();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setGuardian(address guardian, bool enabled) external onlyOwner {
        guardians[guardian] = enabled;
        emit GuardianSet(guardian, enabled);
    }

    /// @notice Activate a new policy version. Previous approvals bound to older versions become unusable.
    function activate(bytes32 policyHash) external onlyOwner returns (uint64 version) {
        if (policyHash == bytes32(0)) revert EmptyPolicyHash();
        version = ++latestVersion;
        policyHashOf[version] = policyHash;
        activatedAt[version] = uint64(block.timestamp);
        _activeVersion = version;
        emit PolicyActivated(version, policyHash, msg.sender);
    }

    /// @notice Owner or guardian can revoke the active policy. Version 0 means "no policy": vaults refuse payments.
    function revokeActive() external {
        if (msg.sender != owner() && !guardians[msg.sender]) revert NotOwnerOrGuardian();
        uint64 v = _activeVersion;
        if (v == 0) revert NothingToRevoke();
        _activeVersion = 0;
        emit PolicyRevoked(v, msg.sender);
    }

    /// @return The active version, or 0 if none/revoked.
    function activeVersion() external view returns (uint64) {
        return _activeVersion;
    }
}
