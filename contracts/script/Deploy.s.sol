// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {IPolicyManager} from "../src/TreasuryVault.sol";
import {MilestoneEscrow} from "../src/MilestoneEscrow.sol";
import {AuditAnchor} from "../src/AuditAnchor.sol";
import {OrganizationRegistry} from "../src/OrganizationRegistry.sol";

/// @notice Deploys the QoreOps contract set. Refuses to run on any chain other than Diana testnet (9800),
///         unless ALLOW_LOCAL_DRY_RUN=true (for an anvil dry run started with --chain-id 31337).
/// @dev    No key lives in this repo or in env. Sign with a Foundry keystore (`--account <name>`) or a hardware
///         wallet. OWNER (optional) receives ownership of every Ownable contract; default is the broadcaster.
///         Ownership of the vault should be a multisig / dedicated approver account in any real use.
contract Deploy is Script {
    uint256 internal constant DIANA_EVM_CHAIN_ID = 9800;

    function run() external {
        bool localDry = vm.envOr("ALLOW_LOCAL_DRY_RUN", false);
        if (block.chainid != DIANA_EVM_CHAIN_ID) {
            require(localDry && block.chainid == 31337, "Deploy: refusing to run outside Diana testnet (9800)");
        }

        vm.startBroadcast();
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);

        PolicyManager pm = new PolicyManager(owner);
        TreasuryVault vault = new TreasuryVault(owner, IPolicyManager(address(pm)));
        MilestoneEscrow escrow = new MilestoneEscrow(owner);
        AuditAnchor anchor = new AuditAnchor(owner);
        OrganizationRegistry registry = new OrganizationRegistry();
        vm.stopBroadcast();

        console.log("chainid            ", block.chainid);
        console.log("owner              ", owner);
        console.log("PolicyManager      ", address(pm));
        console.log("TreasuryVault      ", address(vault));
        console.log("MilestoneEscrow    ", address(escrow));
        console.log("AuditAnchor        ", address(anchor));
        console.log("OrganizationRegistry", address(registry));
    }
}
