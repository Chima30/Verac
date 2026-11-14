// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TreasuryVault, IPolicyManager} from "../src/TreasuryVault.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {MilestoneEscrow} from "../src/MilestoneEscrow.sol";
import {MockToken, ReentrantReceiver} from "./Mocks.sol";

contract TreasuryVaultTest is Test {
    TreasuryVault vault;
    PolicyManager pm;
    MockToken usdt;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address agent2 = makeAddr("agent2");
    address vendor = makeAddr("vendor");
    address stranger = makeAddr("stranger");
    address admin1 = makeAddr("admin1");
    address admin2 = makeAddr("admin2");
    address guardian = makeAddr("guardian");

    uint64 policyV;

    function setUp() public {
        vm.warp(1_800_000_000);
        pm = new PolicyManager(owner);
        vault = new TreasuryVault(owner, IPolicyManager(address(pm)));
        usdt = new MockToken(6);

        vm.startPrank(owner);
        policyV = pm.activate(keccak256("policy-v1"));
        vault.setApprover(admin1, true);
        vault.setApprover(admin2, true);
        vault.setApprovalThreshold(2);
        vault.setGuardian(guardian, true);
        vault.setApprovedRecipient(vendor, true);
        vault.setAllowedToken(address(usdt), true);
        // native: per-tx 50, daily 200, auto-approve up to 20 (18 decimals)
        vault.setAgentLimits(agent, address(0), 50 ether, 200 ether, 20 ether, uint64(block.timestamp + 30 days));
        vault.setAgentLimits(agent, address(usdt), 500e6, 1000e6, 100e6, uint64(block.timestamp + 30 days));
        vm.stopPrank();

        vm.deal(address(vault), 1000 ether);
        usdt.mint(address(vault), 10_000e6);
    }

    function _pay(address token, address to, uint256 amount, uint256 nonce) internal view returns (TreasuryVault.Payment memory) {
        return TreasuryVault.Payment({
            token: token,
            to: to,
            amount: amount,
            purposeHash: keccak256("invoice-1"),
            policyVersion: policyV,
            expiry: uint64(block.timestamp + 1 days),
            nonce: nonce
        });
    }

    function _approveBoth(address who, TreasuryVault.Payment memory p) internal {
        vm.prank(admin1);
        vault.approvePayment(who, p);
        vm.prank(admin2);
        vault.approvePayment(who, p);
    }

    // ---------------------------------------------------------------- happy paths
    function test_deposit_native() public {
        uint256 before = address(vault).balance;
        vm.deal(stranger, 5 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 5 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, before + 5 ether);
    }

    function test_deposit_token_requires_allowlist() public {
        MockToken other = new MockToken(18);
        other.mint(stranger, 1e18);
        vm.startPrank(stranger);
        other.approve(address(vault), 1e18);
        vm.expectRevert(TreasuryVault.TokenNotAllowed.selector);
        vault.depositToken(address(other), 1e18);
        vm.stopPrank();
    }

    function test_auto_payment_to_approved_recipient_within_ceiling() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 15 ether, 1);
        vm.prank(agent);
        vault.executePayment(p);
        assertEq(vendor.balance, 15 ether);
        assertEq(vault.remainingDaily(agent, address(0)), 185 ether);
    }

    function test_token_payment_uses_token_decimals_and_limits() public {
        TreasuryVault.Payment memory p = _pay(address(usdt), vendor, 100e6, 1);
        vm.prank(agent);
        vault.executePayment(p);
        assertEq(usdt.balanceOf(vendor), 100e6);
        // 101 USDT is above the 100 auto-approve ceiling -> needs approvals
        TreasuryVault.Payment memory big = _pay(address(usdt), vendor, 101e6, 2);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.InsufficientApprovals.selector, 0, 2));
        vault.executePayment(big);
        _approveBoth(agent, big);
        vm.prank(agent);
        vault.executePayment(big);
        assertEq(usdt.balanceOf(vendor), 201e6);
    }

    function test_above_ceiling_needs_threshold_approvals() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 40 ether, 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.InsufficientApprovals.selector, 0, 2));
        vault.executePayment(p);

        vm.prank(admin1);
        vault.approvePayment(agent, p);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.InsufficientApprovals.selector, 1, 2));
        vault.executePayment(p);

        vm.prank(admin2);
        vault.approvePayment(agent, p);
        vm.prank(agent);
        vault.executePayment(p);
        assertEq(vendor.balance, 40 ether);
    }

    function test_new_recipient_needs_approvals_even_for_small_amount() public {
        address fresh = makeAddr("fresh");
        TreasuryVault.Payment memory p = _pay(address(0), fresh, 1 ether, 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.InsufficientApprovals.selector, 0, 2));
        vault.executePayment(p);
        _approveBoth(agent, p);
        vm.prank(agent);
        vault.executePayment(p);
        assertEq(fresh.balance, 1 ether);
    }

    // ---------------------------------------------------------------- denied paths
    function test_unauthorised_caller_cannot_withdraw() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 1 ether, 1);
        vm.prank(stranger);
        vm.expectRevert(TreasuryVault.AgentNotActive.selector);
        vault.executePayment(p);
    }

    function test_owner_has_no_direct_withdrawal_path() public {
        // Owner is not an agent either: configuration is separate from spending.
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 1 ether, 1);
        vm.prank(owner);
        vm.expectRevert(TreasuryVault.AgentNotActive.selector);
        vault.executePayment(p);
    }

    function test_per_tx_cap() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 51 ether, 1);
        _approveBoth(agent, p);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.ExceedsPerTxCap.selector);
        vault.executePayment(p);
    }

    function test_daily_cap_and_rollover() public {
        for (uint256 i = 0; i < 4; ++i) {
            TreasuryVault.Payment memory p = _pay(address(0), vendor, 50 ether, i + 1);
            _approveBoth(agent, p);
            vm.prank(agent);
            vault.executePayment(p);
        }
        TreasuryVault.Payment memory over = _pay(address(0), vendor, 1 ether, 99);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.ExceedsDailyCap.selector);
        vault.executePayment(over);

        // next UTC day the allowance resets
        vm.warp(block.timestamp + 1 days);
        TreasuryVault.Payment memory next = _pay(address(0), vendor, 1 ether, 100);
        next.policyVersion = policyV;
        vm.prank(agent);
        vault.executePayment(next);
    }

    function test_expired_payment() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 1 ether, 1);
        vm.warp(block.timestamp + 2 days);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.Expired.selector);
        vault.executePayment(p);
    }

    function test_expiry_too_far_in_future_rejected() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 1 ether, 1);
        p.expiry = uint64(block.timestamp + 8 days);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.InvalidPayment.selector);
        vault.executePayment(p);
    }

    function test_replay_same_payment_twice() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 5 ether, 1);
        vm.startPrank(agent);
        vault.executePayment(p);
        vm.expectRevert(TreasuryVault.AlreadyExecuted.selector);
        vault.executePayment(p);
        vm.stopPrank();
    }

    function test_approval_bound_to_exact_parameters() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 40 ether, 1);
        _approveBoth(agent, p);

        // changed recipient: needs fresh approval
        address attacker = makeAddr("attacker");
        TreasuryVault.Payment memory q = _pay(address(0), attacker, 40 ether, 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.InsufficientApprovals.selector, 0, 2));
        vault.executePayment(q);

        // changed amount
        q = _pay(address(0), vendor, 41 ether, 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.InsufficientApprovals.selector, 0, 2));
        vault.executePayment(q);

        // another agent cannot reuse approval granted for `agent`
        vm.prank(owner);
        vault.setAgentLimits(agent2, address(0), 50 ether, 200 ether, 20 ether, uint64(block.timestamp + 1 days));
        vm.prank(agent2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.InsufficientApprovals.selector, 0, 2));
        vault.executePayment(p);

        // the exact approved payment still works
        vm.prank(agent);
        vault.executePayment(p);
        assertEq(vendor.balance, 40 ether);
    }

    function test_same_approver_cannot_approve_twice() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 40 ether, 1);
        vm.startPrank(admin1);
        vault.approvePayment(agent, p);
        vm.expectRevert(TreasuryVault.AlreadyApproved.selector);
        vault.approvePayment(agent, p);
        vm.stopPrank();
    }

    function test_non_approver_cannot_approve() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 40 ether, 1);
        vm.prank(stranger);
        vm.expectRevert(TreasuryVault.NotApprover.selector);
        vault.approvePayment(agent, p);
    }

    function test_policy_version_change_invalidates_prior_approvals() public {
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 40 ether, 1);
        _approveBoth(agent, p);
        vm.prank(owner);
        pm.activate(keccak256("policy-v2"));
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.PolicyMismatch.selector);
        vault.executePayment(p);
    }

    function test_policy_revocation_blocks_everything() public {
        vm.prank(guardian);
        vm.expectRevert(PolicyManager.NotOwnerOrGuardian.selector);
        pm.revokeActive();

        vm.prank(owner);
        pm.setGuardian(guardian, true);
        vm.prank(guardian);
        pm.revokeActive();

        TreasuryVault.Payment memory p = _pay(address(0), vendor, 1 ether, 1);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.PolicyMismatch.selector);
        vault.executePayment(p);
    }

    function test_agent_expiry() public {
        vm.warp(block.timestamp + 31 days);
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 1 ether, 1);
        p.expiry = uint64(block.timestamp + 1 hours);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AgentNotActive.selector);
        vault.executePayment(p);
    }

    function test_agent_revocation_by_guardian() public {
        vm.prank(guardian);
        vault.revokeAgent(agent, address(0));
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 1 ether, 1);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AgentNotActive.selector);
        vault.executePayment(p);
    }

    function test_guardian_pause_and_only_owner_unpause() public {
        vm.prank(guardian);
        vault.pause();
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 1 ether, 1);
        vm.prank(agent);
        vm.expectRevert();
        vault.executePayment(p);

        vm.prank(guardian);
        vm.expectRevert();
        vault.unpause();

        vm.prank(owner);
        vault.unpause();
        vm.prank(agent);
        vault.executePayment(p);
    }

    function test_unlisted_token_rejected() public {
        MockToken other = new MockToken(18);
        other.mint(address(vault), 1e18);
        TreasuryVault.Payment memory p = _pay(address(other), vendor, 1, 1);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.TokenNotAllowed.selector);
        vault.executePayment(p);
    }

    function test_config_functions_are_owner_only() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        vault.setAgentLimits(stranger, address(0), 1, 1, 1, uint64(block.timestamp + 1));
        vm.expectRevert();
        vault.setApprovedRecipient(stranger, true);
        vm.expectRevert();
        vault.setApprover(stranger, true);
        vm.expectRevert();
        vault.setApprovalThreshold(1);
        vm.expectRevert(TreasuryVault.NotGuardianOrOwner.selector);
        vault.pause();
        vm.stopPrank();
    }

    function test_cannot_remove_approver_below_threshold() public {
        vm.prank(owner);
        vm.expectRevert(TreasuryVault.InvalidThreshold.selector);
        vault.setApprover(admin1, false);
    }

    function test_cap_config_sanity() public {
        vm.prank(owner);
        vm.expectRevert(TreasuryVault.CapTooLarge.selector);
        vault.setAgentLimits(agent, address(0), 10, 5, 1, uint64(block.timestamp + 1));
        vm.prank(owner);
        vm.expectRevert(TreasuryVault.CapTooLarge.selector);
        vault.setAgentLimits(agent, address(0), 10, 50, 11, uint64(block.timestamp + 1));
    }

    // ---------------------------------------------------------------- reentrancy
    function test_reentrancy_into_vault_via_recipient_is_blocked() public {
        ReentrantReceiver evil = new ReentrantReceiver();
        vm.prank(owner);
        vault.setApprovedRecipient(address(evil), true);

        TreasuryVault.Payment memory p = _pay(address(0), address(evil), 5 ether, 1);
        TreasuryVault.Payment memory again = _pay(address(0), address(evil), 5 ether, 2);
        // the recipient will try to have the *vault* run a second payment during the transfer callback;
        // msg.sender there is `evil`, but even an agent-initiated nested call must hit the guard.
        evil.arm(address(vault), abi.encodeCall(TreasuryVault.executePayment, (again)));

        // make the evil receiver itself an agent so only the reentrancy guard can stop it
        vm.prank(owner);
        vault.setAgentLimits(address(evil), address(0), 50 ether, 200 ether, 20 ether, uint64(block.timestamp + 1 days));
        TreasuryVault.Payment memory pe = _pay(address(0), address(evil), 5 ether, 1);
        // payment hash is per-agent, so build the call as `evil`
        vm.prank(address(evil));
        vault.executePayment(pe);
        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded());
        assertEq(address(evil).balance, 5 ether);
        p; // silence unused
    }

    // ---------------------------------------------------------------- fuzz
    function testFuzz_never_exceeds_caps(uint96 a1, uint96 a2, uint96 a3) public {
        uint256[3] memory amounts = [uint256(a1) % (60 ether), uint256(a2) % (60 ether), uint256(a3) % (60 ether)];
        uint256 spent;
        for (uint256 i = 0; i < 3; ++i) {
            if (amounts[i] == 0) continue;
            TreasuryVault.Payment memory p = _pay(address(0), vendor, amounts[i], i + 1);
            _approveBoth(agent, p);
            vm.prank(agent);
            try vault.executePayment(p) {
                spent += amounts[i];
                assertLe(amounts[i], 50 ether);
            } catch {}
        }
        assertLe(spent, 200 ether);
        assertEq(vendor.balance, spent);
    }

    function testFuzz_modified_fields_never_reuse_approval(uint256 newAmount, address newTo) public {
        vm.assume(newTo != address(0) && newTo != vendor);
        newAmount = bound(newAmount, 1, 50 ether);
        TreasuryVault.Payment memory p = _pay(address(0), vendor, 40 ether, 1);
        _approveBoth(agent, p);
        TreasuryVault.Payment memory q = _pay(address(0), newTo, newAmount, 1);
        vm.prank(agent);
        vm.expectRevert();
        vault.executePayment(q);
    }
}
