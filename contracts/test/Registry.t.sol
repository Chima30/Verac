// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OrganizationRegistry} from "../src/OrganizationRegistry.sol";
import {AuditAnchor} from "../src/AuditAnchor.sol";
import {PolicyManager} from "../src/PolicyManager.sol";

contract RegistryTest is Test {
    OrganizationRegistry reg;
    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address fin = makeAddr("fin");
    address stranger = makeAddr("stranger");
    uint256 org;

    function setUp() public {
        reg = new OrganizationRegistry();
        vm.prank(owner);
        org = reg.registerOrganization(keccak256("Nova DAO"));
        vm.prank(owner);
        reg.setRole(org, admin, OrganizationRegistry.Role.Admin);
    }

    function test_owner_registered_and_roles() public view {
        assertEq(reg.ownerOf(org), owner);
        assertTrue(reg.isAdmin(org, owner));
        assertTrue(reg.isAdmin(org, admin));
        assertFalse(reg.isAdmin(org, stranger));
    }

    function test_admin_can_grant_non_privileged_roles() public {
        vm.prank(admin);
        reg.setRole(org, fin, OrganizationRegistry.Role.Finance);
        assertEq(uint8(reg.roleOf(org, fin)), uint8(OrganizationRegistry.Role.Finance));
    }

    function test_admin_cannot_escalate() public {
        vm.startPrank(admin);
        vm.expectRevert(OrganizationRegistry.NotAuthorized.selector);
        reg.setRole(org, stranger, OrganizationRegistry.Role.Admin);
        vm.expectRevert(OrganizationRegistry.InvalidRole.selector);
        reg.setRole(org, stranger, OrganizationRegistry.Role.Owner);
        vm.expectRevert(OrganizationRegistry.InvalidRole.selector);
        reg.setRole(org, owner, OrganizationRegistry.Role.Member);
        vm.stopPrank();
    }

    function test_admin_cannot_demote_other_admin() public {
        address admin2 = makeAddr("admin2");
        vm.prank(owner);
        reg.setRole(org, admin2, OrganizationRegistry.Role.Admin);
        vm.prank(admin);
        vm.expectRevert(OrganizationRegistry.NotAuthorized.selector);
        reg.setRole(org, admin2, OrganizationRegistry.Role.Member);
    }

    function test_stranger_cannot_set_roles_or_refs() public {
        vm.startPrank(stranger);
        vm.expectRevert(OrganizationRegistry.NotAuthorized.selector);
        reg.setRole(org, stranger, OrganizationRegistry.Role.Member);
        vm.expectRevert(OrganizationRegistry.NotAuthorized.selector);
        reg.setContractRef(org, keccak256("vault"), address(1));
        vm.stopPrank();
    }

    function test_ownership_transfer() public {
        vm.prank(owner);
        reg.transferOwnership(org, stranger);
        assertEq(reg.ownerOf(org), stranger);
        assertEq(uint8(reg.roleOf(org, owner)), uint8(OrganizationRegistry.Role.Admin));
        vm.prank(owner);
        vm.expectRevert(OrganizationRegistry.NotAuthorized.selector);
        reg.transferOwnership(org, owner);
    }

    // ---- anchor
    function test_anchor_authorised_only_and_unique() public {
        AuditAnchor a = new AuditAnchor(owner);
        vm.prank(owner);
        a.setAnchorer(admin, true);
        bytes32 h = keccak256("encrypted-bid-envelope");

        vm.prank(stranger);
        vm.expectRevert(AuditAnchor.NotAnchorer.selector);
        a.anchor(bytes32(uint256(1)), "doc", h, bytes32(0));

        vm.prank(admin);
        a.anchor(bytes32(uint256(1)), "doc", h, bytes32(0));
        assertTrue(a.isAnchored(bytes32(uint256(1)), "doc", h));
        vm.prank(admin);
        vm.expectRevert(AuditAnchor.AlreadyAnchored.selector);
        a.anchor(bytes32(uint256(1)), "doc", h, bytes32(0));
        // same hash under a different org is independent
        vm.prank(admin);
        a.anchor(bytes32(uint256(2)), "doc", h, bytes32(0));
    }

    // ---- policy manager
    function test_policy_versions_increment_and_revoke() public {
        PolicyManager pm = new PolicyManager(owner);
        vm.prank(owner);
        pm.activate(keccak256("a"));
        vm.prank(owner);
        pm.activate(keccak256("b"));
        assertEq(pm.activeVersion(), 2);
        assertEq(pm.policyHashOf(1), keccak256("a"));
        vm.prank(stranger);
        vm.expectRevert();
        pm.activate(keccak256("c"));
        vm.prank(owner);
        pm.revokeActive();
        assertEq(pm.activeVersion(), 0);
        vm.prank(owner);
        vm.expectRevert(PolicyManager.NothingToRevoke.selector);
        pm.revokeActive();
    }
}
