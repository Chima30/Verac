// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title OrganizationRegistry
/// @notice Registers organisations, their members' roles and the contract addresses they use.
/// @dev One role per (org, account). Only the Owner can grant or revoke Admin; nobody can grant Owner
///      except through `transferOwnership`, so privilege escalation by Admins is not possible.
contract OrganizationRegistry {
    enum Role {
        None,
        Owner,
        Admin,
        Finance,
        Procurement,
        Security,
        Auditor,
        Member
    }

    struct Org {
        address owner;
        bytes32 profileHash; // hash of off-chain profile; no plaintext on chain
        bool active;
    }

    uint256 public nextOrgId = 1;
    mapping(uint256 => Org) private _orgs;
    mapping(uint256 => mapping(address => Role)) private _roles;
    mapping(uint256 => mapping(bytes32 => address)) private _contractRefs;

    event OrganizationRegistered(uint256 indexed orgId, address indexed owner, bytes32 profileHash);
    event RoleSet(uint256 indexed orgId, address indexed account, Role role, address indexed by);
    event OwnershipTransferred(uint256 indexed orgId, address indexed from, address indexed to);
    event ContractRefSet(uint256 indexed orgId, bytes32 indexed key, address ref);
    event OrganizationDeactivated(uint256 indexed orgId);

    error NotAuthorized();
    error UnknownOrganization();
    error InvalidRole();
    error ZeroAddress();

    modifier onlyOwnerOf(uint256 orgId) {
        if (_orgs[orgId].owner != msg.sender) revert NotAuthorized();
        _;
    }

    function registerOrganization(bytes32 profileHash) external returns (uint256 orgId) {
        orgId = nextOrgId++;
        _orgs[orgId] = Org({owner: msg.sender, profileHash: profileHash, active: true});
        _roles[orgId][msg.sender] = Role.Owner;
        emit OrganizationRegistered(orgId, msg.sender, profileHash);
        emit RoleSet(orgId, msg.sender, Role.Owner, msg.sender);
    }

    /// @notice Grant or revoke a role. Admins may manage non-privileged roles; only the Owner manages Admins.
    function setRole(uint256 orgId, address account, Role role) external {
        Org storage org = _orgs[orgId];
        if (org.owner == address(0)) revert UnknownOrganization();
        if (account == address(0)) revert ZeroAddress();
        if (role == Role.Owner) revert InvalidRole(); // use transferOwnership
        if (account == org.owner) revert InvalidRole(); // owner's role is immutable here

        Role callerRole = _roles[orgId][msg.sender];
        Role current = _roles[orgId][account];
        bool callerIsOwner = callerRole == Role.Owner;
        bool callerIsAdmin = callerRole == Role.Admin;
        if (!callerIsOwner && !callerIsAdmin) revert NotAuthorized();
        // Touching the Admin role (granting, revoking or demoting) is Owner-only.
        if ((role == Role.Admin || current == Role.Admin) && !callerIsOwner) revert NotAuthorized();

        _roles[orgId][account] = role;
        emit RoleSet(orgId, account, role, msg.sender);
    }

    function transferOwnership(uint256 orgId, address newOwner) external onlyOwnerOf(orgId) {
        if (newOwner == address(0)) revert ZeroAddress();
        address old = _orgs[orgId].owner;
        _orgs[orgId].owner = newOwner;
        _roles[orgId][old] = Role.Admin;
        _roles[orgId][newOwner] = Role.Owner;
        emit OwnershipTransferred(orgId, old, newOwner);
    }

    function setContractRef(uint256 orgId, bytes32 key, address ref) external {
        Role r = _roles[orgId][msg.sender];
        if (r != Role.Owner && r != Role.Admin) revert NotAuthorized();
        _contractRefs[orgId][key] = ref;
        emit ContractRefSet(orgId, key, ref);
    }

    function deactivate(uint256 orgId) external onlyOwnerOf(orgId) {
        _orgs[orgId].active = false;
        emit OrganizationDeactivated(orgId);
    }

    function roleOf(uint256 orgId, address account) external view returns (Role) {
        return _roles[orgId][account];
    }

    function isAdmin(uint256 orgId, address account) external view returns (bool) {
        Role r = _roles[orgId][account];
        return r == Role.Owner || r == Role.Admin;
    }

    function ownerOf(uint256 orgId) external view returns (address) {
        return _orgs[orgId].owner;
    }

    function getOrganization(uint256 orgId) external view returns (Org memory) {
        return _orgs[orgId];
    }

    function contractRef(uint256 orgId, bytes32 key) external view returns (address) {
        return _contractRefs[orgId][key];
    }
}
