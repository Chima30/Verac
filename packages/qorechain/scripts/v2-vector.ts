/** Prints the fixed TreasuryVault V2 digest vectors used by v2.test.ts and TreasuryVaultV2.t.sol. */
import { AdminOp, adminData, adminDigestV2, paymentDigestV2 } from "../src/v2";

const VAULT = "0x7ce4667EAB18072123AD28eD8E76aA89B70e2e6C", AGENT = "0x7615DAb4651b47f69F80305f89F39B211F829dd7", TO = "0x200caD3c9De63D3613A33fc20b1ef31CB4dbF5AF";
const p = { token: "0x0000000000000000000000000000000000000000", to: TO, amount: 1_250_000_000_000_000_000n, purposeHash: `0x${"11".repeat(32)}`, policyVersion: 1n, expiry: 1_800_000_000n, nonce: 42n } as const;
console.log("payment", paymentDigestV2(9800n, VAULT, AGENT, p));
console.log("admin  ", adminDigestV2(9800n, VAULT, AdminOp.SetRecipient, adminData.setRecipient(TO, true), 0n, 1_800_000_000n));
