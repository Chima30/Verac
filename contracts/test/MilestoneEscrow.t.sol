// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TreasuryVault, IPolicyManager} from "../src/TreasuryVault.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {MilestoneEscrow} from "../src/MilestoneEscrow.sol";
import {MockToken, ReentrantReceiver} from "./Mocks.sol";

contract MilestoneEscrowTest is Test {
    MilestoneEscrow esc;
    TreasuryVault vault;
    PolicyManager pm;
    MockToken usdt;

    address owner = makeAddr("owner");
    address payer = makeAddr("payer");
    address payee = makeAddr("payee");
    address reviewer = makeAddr("reviewer");
    address resolver = makeAddr("resolver");
    address stranger = makeAddr("stranger");
    address agent = makeAddr("agent");
    address admin1 = makeAddr("admin1");

    uint64 policyV;

    function setUp() public {
        vm.warp(1_800_000_000);
        esc = new MilestoneEscrow(owner);
        pm = new PolicyManager(owner);
        vault = new TreasuryVault(owner, IPolicyManager(address(pm)));
        usdt = new MockToken(6);
        vm.startPrank(owner);
        esc.setResolver(resolver, true);
        esc.setCreator(owner, true);
        policyV = pm.activate(keccak256("p1"));
        vault.setApprover(admin1, true);
        vault.setApprovedRecipient(address(esc), true);
        vault.setEscrow(address(esc), true);
        vault.setAllowedToken(address(usdt), true);
        vault.setAgentLimits(agent, address(0), 300 ether, 300 ether, 300 ether, uint64(block.timestamp + 30 days));
        vm.stopPrank();
        vm.deal(payer, 1000 ether);
        vm.deal(address(vault), 1000 ether);
    }

    function _params(address payer_, address token, uint256 a, uint256 b, uint256 c) internal view returns (MilestoneEscrow.CreateParams memory p) {
        uint256[] memory ms = new uint256[](3);
        ms[0] = a;
        ms[1] = b;
        ms[2] = c;
        p = MilestoneEscrow.CreateParams({
            payer: payer_,
            payee: payee,
            reviewer: reviewer,
            token: token,
            kind: MilestoneEscrow.Kind.Procurement,
            deadline: uint64(block.timestamp + 30 days),
            metadataHash: keccak256("tender-1"),
            milestoneAmounts: ms
        });
    }

    function _native() internal returns (uint256 id) {
        vm.prank(payer);
        id = esc.createProject(_params(payer, address(0), 60 ether, 100 ether, 100 ether));
        vm.prank(payer);
        esc.fundProject{value: 260 ether}(id, 260 ether);
    }

    function test_create_requires_payer_or_creator() public {
        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotAuthorized.selector);
        esc.createProject(_params(payer, address(0), 1 ether, 1 ether, 1 ether));
    }

    function test_create_validations() public {
        vm.startPrank(payer);
        vm.expectRevert(MilestoneEscrow.InvalidParams.selector);
        esc.createProject(_params(payer, address(0), 0, 1 ether, 1 ether));
        MilestoneEscrow.CreateParams memory p = _params(payer, address(0), 1 ether, 1 ether, 1 ether);
        p.reviewer = payee;
        vm.expectRevert(MilestoneEscrow.InvalidParams.selector);
        esc.createProject(p);
        p = _params(payer, address(0), 1 ether, 1 ether, 1 ether);
        p.deadline = uint64(block.timestamp);
        vm.expectRevert(MilestoneEscrow.InvalidParams.selector);
        esc.createProject(p);
        vm.stopPrank();
    }

    function test_full_native_flow_releases_each_milestone_once() public {
        uint256 id = _native();
        assertEq(esc.remaining(id), 260 ether);

        vm.prank(reviewer);
        esc.approveMilestone(id, 0);
        esc.releaseMilestone(id, 0);
        assertEq(payee.balance, 60 ether);

        vm.expectRevert(MilestoneEscrow.NotApproved.selector); // double release
        esc.releaseMilestone(id, 0);

        vm.startPrank(reviewer);
        esc.approveMilestone(id, 1);
        esc.approveMilestone(id, 2);
        vm.stopPrank();
        esc.releaseMilestone(id, 1);
        esc.releaseMilestone(id, 2);
        assertEq(payee.balance, 260 ether);
        assertEq(uint8(esc.getProject(id).state), uint8(MilestoneEscrow.ProjectState.Completed));
        assertEq(address(esc).balance, 0);
    }

    function test_only_reviewer_can_approve() public {
        uint256 id = _native();
        vm.prank(payee);
        vm.expectRevert(MilestoneEscrow.NotAuthorized.selector);
        esc.approveMilestone(id, 0);
        vm.prank(payer);
        vm.expectRevert(MilestoneEscrow.NotAuthorized.selector);
        esc.approveMilestone(id, 0);
    }

    function test_cannot_release_unapproved() public {
        uint256 id = _native();
        vm.expectRevert(MilestoneEscrow.NotApproved.selector);
        esc.releaseMilestone(id, 0);
    }

    function test_cannot_release_more_than_funded() public {
        vm.prank(payer);
        uint256 id = esc.createProject(_params(payer, address(0), 60 ether, 100 ether, 100 ether));
        vm.prank(payer);
        esc.fundProject{value: 50 ether}(id, 50 ether);
        vm.prank(reviewer);
        esc.approveMilestone(id, 0);
        vm.expectRevert(MilestoneEscrow.InsufficientFunded.selector);
        esc.releaseMilestone(id, 0);
    }

    function test_only_payer_can_fund_and_no_overfunding() public {
        vm.prank(payer);
        uint256 id = esc.createProject(_params(payer, address(0), 1 ether, 1 ether, 1 ether));
        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotAuthorized.selector);
        esc.fundProject{value: 3 ether}(id, 3 ether);
        vm.prank(payer);
        vm.expectRevert(MilestoneEscrow.Overfunded.selector);
        esc.fundProject{value: 4 ether}(id, 4 ether);
        vm.prank(payer);
        vm.expectRevert(MilestoneEscrow.AmountMismatch.selector);
        esc.fundProject{value: 2 ether}(id, 3 ether);
    }

    function test_dispute_freezes_release_and_resolution_splits() public {
        uint256 id = _native();
        vm.prank(reviewer);
        esc.approveMilestone(id, 0);

        vm.prank(payee);
        esc.openDispute(id, keccak256("evidence"));
        vm.expectRevert(MilestoneEscrow.InvalidState.selector);
        esc.releaseMilestone(id, 0);
        vm.prank(payer);
        vm.expectRevert(MilestoneEscrow.InvalidState.selector);
        esc.refundUnused(id);

        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotAuthorized.selector);
        esc.resolveDispute(id, 100 ether, 160 ether, bytes32(0));

        vm.prank(resolver);
        vm.expectRevert(MilestoneEscrow.AmountMismatch.selector);
        esc.resolveDispute(id, 100 ether, 100 ether, bytes32(0));

        uint256 payerBefore = payer.balance;
        vm.prank(resolver);
        esc.resolveDispute(id, 100 ether, 160 ether, keccak256("ruling"));
        assertEq(payee.balance, 100 ether);
        assertEq(payer.balance, payerBefore + 160 ether);
        assertEq(address(esc).balance, 0);
        assertEq(uint8(esc.getProject(id).state), uint8(MilestoneEscrow.ProjectState.Completed));
    }

    function test_stranger_cannot_open_dispute() public {
        uint256 id = _native();
        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotAuthorized.selector);
        esc.openDispute(id, bytes32(0));
    }

    function test_refund_needs_consent_or_lapse() public {
        uint256 id = _native();
        vm.prank(payer);
        vm.expectRevert(MilestoneEscrow.RefundNotAllowed.selector);
        esc.refundUnused(id);

        vm.prank(payee);
        esc.setCancelConsent(id, true);
        uint256 before = payer.balance;
        vm.prank(payer);
        esc.refundUnused(id);
        assertEq(payer.balance, before + 260 ether);
        assertEq(uint8(esc.getProject(id).state), uint8(MilestoneEscrow.ProjectState.Cancelled));
    }

    function test_refund_after_deadline_blocked_while_approved_unreleased() public {
        uint256 id = _native();
        vm.prank(reviewer);
        esc.approveMilestone(id, 0);
        vm.warp(block.timestamp + 30 days + 15 days);
        vm.prank(payer);
        vm.expectRevert(MilestoneEscrow.RefundNotAllowed.selector);
        esc.refundUnused(id);
        esc.releaseMilestone(id, 0);
        vm.prank(payer);
        esc.refundUnused(id); // remaining 200 ether returned
        assertEq(payee.balance, 60 ether);
    }

    function test_refund_before_grace_blocked() public {
        uint256 id = _native();
        vm.warp(block.timestamp + 30 days + 1 days);
        vm.prank(payer);
        vm.expectRevert(MilestoneEscrow.RefundNotAllowed.selector);
        esc.refundUnused(id);
    }

    function test_reentrancy_on_release_blocked() public {
        ReentrantReceiver evil = new ReentrantReceiver();
        uint256[] memory ms = new uint256[](2);
        ms[0] = 10 ether;
        ms[1] = 10 ether;
        MilestoneEscrow.CreateParams memory p = MilestoneEscrow.CreateParams({
            payer: payer,
            payee: address(evil),
            reviewer: reviewer,
            token: address(0),
            kind: MilestoneEscrow.Kind.Grant,
            deadline: uint64(block.timestamp + 30 days),
            metadataHash: bytes32(0),
            milestoneAmounts: ms
        });
        vm.prank(payer);
        uint256 id = esc.createProject(p);
        vm.prank(payer);
        esc.fundProject{value: 20 ether}(id, 20 ether);
        vm.startPrank(reviewer);
        esc.approveMilestone(id, 0);
        esc.approveMilestone(id, 1);
        vm.stopPrank();
        evil.arm(address(esc), abi.encodeCall(MilestoneEscrow.releaseMilestone, (id, 1)));
        esc.releaseMilestone(id, 0);
        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded());
        assertEq(address(evil).balance, 10 ether);
        assertEq(address(esc).balance, 10 ether);
    }

    function test_erc20_escrow_flow() public {
        usdt.mint(payer, 1000e6);
        vm.startPrank(payer);
        uint256 id = esc.createProject(_params(payer, address(usdt), 100e6, 100e6, 100e6));
        usdt.approve(address(esc), 300e6);
        esc.fundProject(id, 300e6);
        vm.stopPrank();
        vm.prank(reviewer);
        esc.approveMilestone(id, 0);
        esc.releaseMilestone(id, 0);
        assertEq(usdt.balanceOf(payee), 100e6);
        assertEq(usdt.balanceOf(address(esc)), 200e6);
    }

    // ---------------------------------------------------------------- vault -> escrow
    function _vaultProject() internal returns (uint256 id) {
        vm.prank(owner);
        id = esc.createProject(_params(address(vault), address(0), 60 ether, 100 ether, 100 ether));
    }

    function _escrowPayment(uint256 amount, uint256 nonce) internal view returns (TreasuryVault.Payment memory) {
        return TreasuryVault.Payment({
            token: address(0),
            to: address(esc),
            amount: amount,
            purposeHash: keccak256("procurement-1"),
            policyVersion: policyV,
            expiry: uint64(block.timestamp + 1 days),
            nonce: nonce
        });
    }

    function test_vault_funds_escrow_then_milestone_release() public {
        uint256 id = _vaultProject();
        TreasuryVault.Payment memory p = _escrowPayment(260 ether, 1);
        // 260 > per-tx? limits are 300 so ok; recipient approved + autoApprove 300 => no human approval needed.
        vm.prank(agent);
        vault.fundEscrow(p, id);
        assertEq(address(esc).balance, 260 ether);
        assertEq(esc.remaining(id), 260 ether);

        vm.prank(reviewer);
        esc.approveMilestone(id, 0);
        esc.releaseMilestone(id, 0);
        assertEq(payee.balance, 60 ether);
    }

    function test_vault_refuses_escrow_project_not_owned_by_vault() public {
        vm.prank(payer);
        uint256 id = esc.createProject(_params(payer, address(0), 1 ether, 1 ether, 1 ether));
        TreasuryVault.Payment memory p = _escrowPayment(3 ether, 1);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.EscrowProjectMismatch.selector);
        vault.fundEscrow(p, id);
    }

    function test_vault_refuses_unregistered_escrow() public {
        MilestoneEscrow rogue = new MilestoneEscrow(owner);
        TreasuryVault.Payment memory p = _escrowPayment(1 ether, 1);
        p.to = address(rogue);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.NotEscrow.selector);
        vault.fundEscrow(p, 1);
    }

    // ---------------------------------------------------------------- fuzz / invariants
    function testFuzz_released_never_exceeds_funded(uint8 mask) public {
        uint256 id = _native();
        vm.startPrank(reviewer);
        for (uint256 i = 0; i < 3; ++i) {
            if ((mask >> i) & 1 == 1) esc.approveMilestone(id, i);
        }
        vm.stopPrank();
        for (uint256 i = 0; i < 3; ++i) {
            if ((mask >> i) & 1 == 1) {
                esc.releaseMilestone(id, i);
                vm.expectRevert(); // NotApproved, or InvalidState once the project is Completed
                esc.releaseMilestone(id, i);
            }
        }
        MilestoneEscrow.Project memory pr = esc.getProject(id);
        assertLe(pr.released + pr.refunded, pr.funded);
        assertEq(address(esc).balance, pr.funded - pr.released - pr.refunded);
    }
}
