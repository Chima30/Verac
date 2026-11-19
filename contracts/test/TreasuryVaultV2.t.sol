// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {TreasuryVaultV2} from "../src/TreasuryVaultV2.sol";
import {MockToken} from "./Mocks.sol";

/// @dev Stand-in for QoreChain's PQC precompiles, placed at their real addresses with vm.etch.
///      A "signature" here is keccak256(pubkey ‖ message) as 32 bytes: it binds the signer's key and the exact message,
///      which is what the vault's logic relies on. The real ML-DSA-87 verification is proven on Diana testnet
///      (packages/qorechain/scripts/probe-pqc-precompile.ts and the live V2 run), not here.
contract MockPQC {
    struct KeyStatus { bool registered; uint8 alg; bytes pubkey; bool proven; }
    mapping(address => KeyStatus) internal keys;

    function setKey(address account, bool registered, uint8 alg, bytes calldata pubkey, bool proven) external {
        keys[account] = KeyStatus(registered, alg, pubkey, proven);
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool) {
        KeyStatus storage k = keys[account];
        return (k.registered, k.alg, k.pubkey, k.proven);
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message) external pure returns (bool) {
        return signature.length == 32 && bytes32(signature) == keccak256(abi.encodePacked(pubkey, message));
    }
}

abstract contract V2Base is Test {
    address constant VERIFY = 0x0000000000000000000000000000000000000a01;
    address constant STATUS = 0x0000000000000000000000000000000000000a02;

    TreasuryVaultV2 vault;
    MockToken token;

    address agent = makeAddr("agent");
    address relayer = makeAddr("relayer");
    address vendor = makeAddr("vendor");
    address attacker = makeAddr("attacker");
    address guardian = makeAddr("guardian");
    address a1;
    address a2;
    address a3;
    address outsider = makeAddr("outsider-with-a-key");

    function _pub(address a) internal pure returns (bytes memory pk) {
        pk = new bytes(2592);
        bytes32 seed = keccak256(abi.encode("pk", a));
        for (uint256 i = 0; i < 32; i++) pk[i] = seed[i];
    }

    function _register(address a, bool proven) internal {
        MockPQC(STATUS).setKey(a, true, 1, _pub(a), proven);
    }

    /// The mock signature of `a` over the vault's signing bytes for `digest`.
    function _sign(address a, bytes32 digest) internal view returns (bytes memory) {
        return abi.encodePacked(keccak256(abi.encodePacked(_pub(a), vault.signingBytes(digest))));
    }

    function _sorted(address x, address y) internal pure returns (address, address) {
        return x < y ? (x, y) : (y, x);
    }

    function _sigs2(bytes32 digest, address x, address y) internal view returns (TreasuryVaultV2.AdminSig[] memory s) {
        (address lo, address hi) = _sorted(x, y);
        s = new TreasuryVaultV2.AdminSig[](2);
        s[0] = TreasuryVaultV2.AdminSig(lo, _sign(lo, digest));
        s[1] = TreasuryVaultV2.AdminSig(hi, _sign(hi, digest));
    }

    function _pay(address to, uint256 amount, uint256 nonce) internal view returns (TreasuryVaultV2.Payment memory) {
        return TreasuryVaultV2.Payment({token: address(0), to: to, amount: amount, purposeHash: keccak256("invoice-A"), policyVersion: vault.policyVersion(), expiry: uint64(block.timestamp + 1 days), nonce: nonce});
    }

    function _admin(TreasuryVaultV2.AdminOp op, bytes memory data, address x, address y) internal {
        uint256 n = vault.adminNonce();
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes32 d = vault.adminDigest(op, data, n, exp);
        vault.executeAdminAction(op, data, n, exp, _sigs2(d, x, y));
    }

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.etch(VERIFY, address(new MockPQC()).code);
        vm.etch(STATUS, address(new MockPQC()).code);
        a1 = makeAddr("admin-1");
        a2 = makeAddr("admin-2");
        a3 = makeAddr("admin-3");
        _register(a1, true);
        _register(a2, true);
        _register(a3, true);
        _register(outsider, true);
        _register(agent, true);

        address[] memory admins = new address[](3);
        admins[0] = a1; admins[1] = a2; admins[2] = a3;
        vault = new TreasuryVaultV2(admins, 2, keccak256("policy-v1"));
        token = new MockToken(6);

        _admin(TreasuryVaultV2.AdminOp.SetRecipient, abi.encode(vendor, true), a1, a2);
        _admin(TreasuryVaultV2.AdminOp.SetAgentLimits, abi.encode(agent, address(0), uint128(5 ether), uint128(8 ether), uint64(block.timestamp + 7 days)), a1, a2);
        _admin(TreasuryVaultV2.AdminOp.SetGuardian, abi.encode(guardian, true), a2, a3);
        vm.deal(address(vault), 100 ether);
    }

}

contract TreasuryVaultV2PaymentsTest is V2Base {
    // ------------------------------------------------------------ construction
    function test_constructor_requires_two_admins_threshold_two_and_proven_keys() public {
        address[] memory one = new address[](1);
        one[0] = a1;
        vm.expectRevert(TreasuryVaultV2.BadConfig.selector);
        new TreasuryVaultV2(one, 2, bytes32(0));

        address[] memory two = new address[](2);
        two[0] = a1; two[1] = a2;
        vm.expectRevert(TreasuryVaultV2.BadConfig.selector);
        new TreasuryVaultV2(two, 1, bytes32(0));

        address unproven = makeAddr("unproven");
        _register(unproven, false);
        two[1] = unproven;
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.AdminKeyNotProven.selector, unproven));
        new TreasuryVaultV2(two, 2, bytes32(0));
    }

    // ------------------------------------------------------------ the happy path
    function test_payment_with_two_admin_signatures_succeeds() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 1);
        bytes32 d = vault.paymentDigest(agent, p);
        uint256 before = vendor.balance;
        vm.prank(agent);
        bytes32 got = vault.executePayment(p, _sigs2(d, a1, a3));
        assertEq(got, d);
        assertEq(vendor.balance - before, 1 ether);
        assertTrue(vault.executed(d));
    }

    // ------------------------------------------------------------ server compromise: agent key + relayer, no admin keys
    function test_compromised_server_cannot_pay_without_admin_signatures() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 2);
        TreasuryVaultV2.AdminSig[] memory none = new TreasuryVaultV2.AdminSig[](0);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.NotEnoughSignatures.selector, 0, 2));
        vault.executePayment(p, none);
    }

    function test_server_signing_with_its_own_keys_is_rejected() public {
        // The server holds the agent's key (registered, proven) and can make perfectly valid ML-DSA signatures with it.
        // They do not count: the agent is not an administrator.
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 3);
        bytes32 d = vault.paymentDigest(agent, p);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(d, agent, a1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.NotAdmin.selector, agent));
        vault.executePayment(p, s);
    }

    function test_one_admin_signature_is_not_enough() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 4);
        bytes32 d = vault.paymentDigest(agent, p);
        TreasuryVaultV2.AdminSig[] memory s = new TreasuryVaultV2.AdminSig[](1);
        s[0] = TreasuryVaultV2.AdminSig(a1, _sign(a1, d));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.NotEnoughSignatures.selector, 1, 2));
        vault.executePayment(p, s);
    }

    function test_the_same_admin_twice_does_not_count_twice() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 5);
        bytes32 d = vault.paymentDigest(agent, p);
        TreasuryVaultV2.AdminSig[] memory s = new TreasuryVaultV2.AdminSig[](2);
        s[0] = TreasuryVaultV2.AdminSig(a1, _sign(a1, d));
        s[1] = TreasuryVaultV2.AdminSig(a1, _sign(a1, d));
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.SignersNotSorted.selector);
        vault.executePayment(p, s);
    }

    function test_forged_signature_is_rejected() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 6);
        bytes32 d = vault.paymentDigest(agent, p);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(d, a1, a2);
        s[1].signature = abi.encodePacked(keccak256("made up by the server"));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.BadSignature.selector, s[1].signer));
        vault.executePayment(p, s);
    }

    function test_signature_from_a_key_owner_who_is_not_admin_is_rejected() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 7);
        bytes32 d = vault.paymentDigest(agent, p);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(d, a1, outsider);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.NotAdmin.selector, outsider));
        vault.executePayment(p, s);
    }

    // ------------------------------------------------------------ binding of the approval to the exact payment
    function test_approval_for_one_payment_cannot_pay_another() public {
        TreasuryVaultV2.Payment memory approved = _pay(vendor, 1 ether, 8);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, approved), a1, a2);

        TreasuryVaultV2.Payment memory bigger = approved;
        bigger.amount = 4 ether;
        vm.prank(agent);
        vm.expectRevert();
        vault.executePayment(bigger, s);

        _admin(TreasuryVaultV2.AdminOp.SetRecipient, abi.encode(attacker, true), a1, a2); // even an approved attacker address
        TreasuryVaultV2.Payment memory redirected = approved;
        redirected.to = attacker;
        vm.prank(agent);
        vm.expectRevert();
        vault.executePayment(redirected, s);
    }

    function test_approval_is_bound_to_the_agent() public {
        address agent2 = makeAddr("agent2");
        _admin(TreasuryVaultV2.AdminOp.SetAgentLimits, abi.encode(agent2, address(0), uint128(5 ether), uint128(8 ether), uint64(block.timestamp + 7 days)), a1, a2);
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 9);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        vm.prank(agent2);
        vm.expectRevert();
        vault.executePayment(p, s);
    }

    function test_replayed_approval_is_rejected() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 10);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        vm.prank(agent);
        vault.executePayment(p, s);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.AlreadyExecuted.selector);
        vault.executePayment(p, s);
    }

    function test_approval_does_not_work_on_another_chain() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 11);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        vm.chainId(9801); // mainnet's EVM chain id
        vm.prank(agent);
        vm.expectRevert();
        vault.executePayment(p, s);
    }

    function test_approval_does_not_work_on_another_vault() public {
        address[] memory admins = new address[](2);
        admins[0] = a1; admins[1] = a2;
        TreasuryVaultV2 other = new TreasuryVaultV2(admins, 2, keccak256("policy-v1"));
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 12);
        bytes32 d = vault.paymentDigest(agent, p);
        assertTrue(d != other.paymentDigest(agent, p));
    }

    // ------------------------------------------------------------ limits still apply with valid signatures
    function test_caps_apply_even_with_admin_signatures() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 6 ether, 13);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.ExceedsPerTxCap.selector);
        vault.executePayment(p, s);

        TreasuryVaultV2.Payment memory p1 = _pay(vendor, 5 ether, 14);
        vm.prank(agent);
        vault.executePayment(p1, _sigs2(vault.paymentDigest(agent, p1), a1, a2));
        TreasuryVaultV2.Payment memory p2 = _pay(vendor, 4 ether, 15);
        TreasuryVaultV2.AdminSig[] memory s2 = _sigs2(vault.paymentDigest(agent, p2), a1, a2);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.ExceedsDailyCap.selector);
        vault.executePayment(p2, s2);
    }

    function test_unapproved_recipient_is_rejected() public {
        TreasuryVaultV2.Payment memory p = _pay(attacker, 1 ether, 16);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.RecipientNotApproved.selector);
        vault.executePayment(p, s);
    }

    function test_expired_payment_and_too_long_lifetime_are_rejected() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 17);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        vm.warp(block.timestamp + 2 days);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.Expired.selector);
        vault.executePayment(p, s);

        TreasuryVaultV2.Payment memory far = _pay(vendor, 1 ether, 18);
        far.expiry = uint64(block.timestamp + 30 days);
        TreasuryVaultV2.AdminSig[] memory s2 = _sigs2(vault.paymentDigest(agent, far), a1, a2);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.LifetimeTooLong.selector);
        vault.executePayment(far, s2);
    }

    function test_policy_version_mismatch_is_rejected() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 19);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        _admin(TreasuryVaultV2.AdminOp.SetPolicy, abi.encode(keccak256("policy-v2")), a2, a3);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.PolicyMismatch.selector);
        vault.executePayment(p, s);
    }

    function test_revoked_and_expired_agents_cannot_pay() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 20);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        vm.prank(guardian);
        vault.guardianRevokeAgent(agent, address(0));
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.AgentNotActive.selector);
        vault.executePayment(p, s);

        _admin(TreasuryVaultV2.AdminOp.SetAgentLimits, abi.encode(agent, address(0), uint128(5 ether), uint128(8 ether), uint64(block.timestamp + 1 hours)), a1, a2);
        vm.warp(block.timestamp + 2 hours);
        TreasuryVaultV2.Payment memory late = _pay(vendor, 1 ether, 21);
        TreasuryVaultV2.AdminSig[] memory s2 = _sigs2(vault.paymentDigest(agent, late), a1, a2);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.AgentNotActive.selector);
        vault.executePayment(late, s2);
    }

}

contract TreasuryVaultV2AdminTest is V2Base {
    // ------------------------------------------------------------ emergency stop
    function test_guardian_pause_stops_payments_and_only_admins_unpause() public {
        vm.prank(guardian);
        vault.pause();
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 22);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        vm.prank(agent);
        vm.expectRevert(TreasuryVaultV2.IsPaused.selector);
        vault.executePayment(p, s);

        vm.prank(attacker);
        vm.expectRevert(TreasuryVaultV2.NotGuardian.selector);
        vault.pause();

        _admin(TreasuryVaultV2.AdminOp.Unpause, "", a1, a3);
        vm.prank(agent);
        vault.executePayment(p, s);
    }

    // ------------------------------------------------------------ administration needs the threshold
    function test_admin_action_needs_threshold_and_cannot_be_replayed() public {
        bytes memory data = abi.encode(attacker, true);
        uint256 n = vault.adminNonce();
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes32 d = vault.adminDigest(TreasuryVaultV2.AdminOp.SetRecipient, data, n, exp);

        TreasuryVaultV2.AdminSig[] memory one = new TreasuryVaultV2.AdminSig[](1);
        one[0] = TreasuryVaultV2.AdminSig(a1, _sign(a1, d));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.NotEnoughSignatures.selector, 1, 2));
        vault.executeAdminAction(TreasuryVaultV2.AdminOp.SetRecipient, data, n, exp, one);

        TreasuryVaultV2.AdminSig[] memory two = _sigs2(d, a1, a2);
        vm.prank(relayer); // anyone may relay a properly signed action
        vault.executeAdminAction(TreasuryVaultV2.AdminOp.SetRecipient, data, n, exp, two);
        assertTrue(vault.approvedRecipient(attacker));

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.BadNonce.selector, n + 1));
        vault.executeAdminAction(TreasuryVaultV2.AdminOp.SetRecipient, data, n, exp, two);
    }

    function test_signatures_for_one_admin_action_cannot_authorise_another() public {
        uint256 n = vault.adminNonce();
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes32 d = vault.adminDigest(TreasuryVaultV2.AdminOp.SetRecipient, abi.encode(vendor, false), n, exp);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(d, a1, a2);
        // Same signatures, different operation: raising the agent's caps.
        bytes memory raise = abi.encode(agent, address(0), uint128(100 ether), uint128(100 ether), uint64(block.timestamp + 7 days));
        vm.expectRevert();
        vault.executeAdminAction(TreasuryVaultV2.AdminOp.SetAgentLimits, raise, n, exp, s);
    }

    function test_attacker_cannot_make_itself_admin_or_agent_admin() public {
        _register(attacker, true);
        bytes memory data = abi.encode(attacker);
        uint256 n = vault.adminNonce();
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes32 d = vault.adminDigest(TreasuryVaultV2.AdminOp.AddAdmin, data, n, exp);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(d, attacker, agent); // the keys an attacker might hold
        vm.expectRevert();
        vault.executeAdminAction(TreasuryVaultV2.AdminOp.AddAdmin, data, n, exp, s);

        // Admins cannot make an administrator an agent either (requester and approver stay separate on chain).
        vm.expectRevert();
        this.callAdmin(TreasuryVaultV2.AdminOp.SetAgentLimits, abi.encode(a3, address(0), uint128(1 ether), uint128(1 ether), uint64(block.timestamp + 1 days)));
    }

    function callAdmin(TreasuryVaultV2.AdminOp op, bytes memory data) external {
        _admin(op, data, a1, a2);
    }

    function test_threshold_and_admin_set_changes() public {
        _admin(TreasuryVaultV2.AdminOp.SetThreshold, abi.encode(uint8(3)), a1, a2);
        assertEq(vault.threshold(), 3);
        vm.expectRevert(); // removing an admin would leave fewer admins than the threshold
        this.callAdmin3(TreasuryVaultV2.AdminOp.RemoveAdmin, abi.encode(a3));
        vm.expectRevert(); // below the minimum of 2
        this.callAdmin3(TreasuryVaultV2.AdminOp.SetThreshold, abi.encode(uint8(1)));
    }

    function callAdmin3(TreasuryVaultV2.AdminOp op, bytes memory data) external {
        uint256 n = vault.adminNonce();
        uint64 exp = uint64(block.timestamp + 1 hours);
        bytes32 d = vault.adminDigest(op, data, n, exp);
        address[3] memory xs = [a1, a2, a3];
        // sort three addresses
        for (uint256 i = 0; i < 3; i++) for (uint256 j = i + 1; j < 3; j++) if (xs[j] < xs[i]) (xs[i], xs[j]) = (xs[j], xs[i]);
        TreasuryVaultV2.AdminSig[] memory s = new TreasuryVaultV2.AdminSig[](3);
        for (uint256 i = 0; i < 3; i++) s[i] = TreasuryVaultV2.AdminSig(xs[i], _sign(xs[i], d));
        vault.executeAdminAction(op, data, n, exp, s);
    }

    function test_admin_whose_key_status_becomes_unproven_no_longer_counts() public {
        TreasuryVaultV2.Payment memory p = _pay(vendor, 1 ether, 23);
        TreasuryVaultV2.AdminSig[] memory s = _sigs2(vault.paymentDigest(agent, p), a1, a2);
        _register(a2, false);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(TreasuryVaultV2.AdminKeyNotProven.selector, a2));
        vault.executePayment(p, s);
    }

    /// Fixed vector shared with packages/qorechain/src/v2.test.ts, so the off-chain digest matches the contract's.
    function test_digest_vector_matches_typescript() public view {
        TreasuryVaultV2.Payment memory p = TreasuryVaultV2.Payment({
            token: address(0), to: 0x200caD3c9De63D3613A33fc20b1ef31CB4dbF5AF, amount: 1.25 ether,
            purposeHash: 0x1111111111111111111111111111111111111111111111111111111111111111, policyVersion: 1, expiry: 1800000000, nonce: 42
        });
        bytes32 d = vault.computePaymentDigest(9800, 0x7ce4667EAB18072123AD28eD8E76aA89B70e2e6C, 0x7615DAb4651b47f69F80305f89F39B211F829dd7, p);
        assertEq(d, VECTOR_PAYMENT_DIGEST);
        bytes32 a = vault.computeAdminDigest(9800, 0x7ce4667EAB18072123AD28eD8E76aA89B70e2e6C, TreasuryVaultV2.AdminOp.SetRecipient, abi.encode(0x200caD3c9De63D3613A33fc20b1ef31CB4dbF5AF, true), 0, 1800000000);
        assertEq(a, VECTOR_ADMIN_DIGEST);
    }

    bytes32 constant VECTOR_PAYMENT_DIGEST = 0x5c664ba292698ce63dd870a6487908e7f98efe950838ef9248bd67402b7624e4;
    bytes32 constant VECTOR_ADMIN_DIGEST = 0x0471feeb0de794f323b40f537e712edb2855cc563fa2ad60d0a27a973318b3d1;
}
