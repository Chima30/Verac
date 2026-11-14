// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {TreasuryVault, IPolicyManager} from "../src/TreasuryVault.sol";
import {PolicyManager} from "../src/PolicyManager.sol";

/// @notice Cross-language vector: services/policy-engine asserts the same hash for the same inputs.
contract HashVectorTest is Test {
    function test_paymentHash_vector() public {
        vm.chainId(9800);
        address vaultAddr = address(0x1111111111111111111111111111111111111111);
        TreasuryVault impl = new TreasuryVault(address(0xA11CE), IPolicyManager(address(0)));
        vm.etch(vaultAddr, address(impl).code);
        TreasuryVault vault = TreasuryVault(payable(vaultAddr));
        TreasuryVault.Payment memory p = TreasuryVault.Payment({
            token: address(0),
            to: 0x2222222222222222222222222222222222222222,
            amount: 12_000_000_000_000_000_000,
            purposeHash: keccak256("invoice-1"),
            policyVersion: 3,
            expiry: 1_800_086_400,
            nonce: 7
        });
        bytes32 h = vault.paymentHash(0x3333333333333333333333333333333333333333, p);
        console.logBytes32(h);
        assertEq(h, VECTOR_HASH);
    }

    bytes32 constant VECTOR_HASH = 0xbaa105045e98ce07d24489c65e81c1f4a84846d062cc7735f307a4ece9907321;
}
