/**
 * Read-only live probe of QoreChain Diana testnet. Sends nothing, signs nothing, needs no keys.
 *   pnpm chain:probe [0xYourTestnetEvmAddress]
 * The output is evidence for docs/TESTNET_PROOFS.md ("read-only checks"), not a transaction proof.
 */
import { QoreReader } from "../src/index";

const reader = new QoreReader();
const out: Record<string, unknown> = {};

try {
  out.evmChainId = await reader.assertConnectedToTestnet();
  out.latestBlock = (await reader.evm.getBlockNumber()).toString();
  out.accountAbstraction = await reader.abstractAccountConfig();
  const lim = await reader.evmLimits();
  out.evmLimits = { txMaxGas: lim.txMaxGas.toString(), precompileInputMaxBytes: lim.precompileInputMaxBytes.toString() };

  const addr = process.argv[2] as `0x${string}` | undefined;
  if (addr) {
    const qor = reader.toNativeAddress(addr);
    out.address = { evm: addr, native: qor };
    out.evmBalanceWei = (await reader.evmBalance(addr)).toString();
    out.pqcStatus = await reader.pqcStatus(qor);
    out.evmWindow = await reader.evmWindow(qor);
    out.kemKey = await reader.kemKey(qor);
    out.spendingRules = await reader.spendingRules(qor);
  } else {
    out.note = "Pass a testnet 0x address to also read its balance, PQC key, EVM window, KEM key and spending rules.";
  }
  console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
} catch (e) {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
