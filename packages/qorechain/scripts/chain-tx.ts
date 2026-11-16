/**
 * Native-lane transactions for the throwaway testnet account in .secrets/testnet-account.json.
 *
 *   tsx chain-tx.ts register-pqc            register the account's ML-DSA-87 key (classical-signed, once)
 *   tsx chain-tx.ts open-window [flags]     open an UNSCOPED EVM window (needed for contract creation)
 *   tsx chain-tx.ts close-window            close it again
 *
 * DRY RUN BY DEFAULT: builds and signs locally, prints what would be sent, broadcasts nothing.
 * Add --broadcast to actually send. Secrets are read from the file and never printed.
 * Refuses to run unless the node reports chain id qorechain-diana.
 *
 * open-window flags: --blocks N (default 300) --max-txs N (default 10) --max-qor N (default 10; value + max fees)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner, msg, buildRegisterPqcKeyMsg, closeEvmWindowMsg, openEvmWindowMsg, signProofOfPossession,
  pqcKeyFromRecoveryCode, unifiedAccountFromSeed, type UnifiedAccount,
} from "@qorechain/sdk";
import { QORE_NETWORK } from "@qoreops/shared-types";

const CHAIN_ID = "qorechain-diana";
const [cmd, ...rest] = process.argv.slice(2);
const broadcast = rest.includes("--broadcast");
const flag = (name: string, d: number) => { const i = rest.indexOf(name); return i >= 0 ? Number(rest[i + 1]) : d; };
const unhex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

// Two layouts: ACCOUNT_DIR (the split Q-Day drill layout from qday-account.ts) or ACCOUNT_FILE (one JSON file).
const loadAccount = () => {
  if (process.env.ACCOUNT_DIR) {
    const dir = resolve(process.cwd(), process.env.ACCOUNT_DIR);
    const pub = JSON.parse(readFileSync(resolve(dir, "account.json"), "utf8")) as { qorAddress: string; mlDsa87PublicKey: string };
    const key = readFileSync(resolve(dir, "ecdsa-private-key.txt"), "utf8").trim();
    const pq = pqcKeyFromRecoveryCode(readFileSync(resolve(dir, "pqc-recovery-code.txt"), "utf8").trim(), pub.qorAddress);
    if (Buffer.from(pq.publicKey).toString("hex") !== pub.mlDsa87PublicKey) throw new Error("Recovery code does not give the recorded ML-DSA-87 key; refusing.");
    return { qorAddress: pub.qorAddress, secp256k1PrivateKey: key, pqc: pq };
  }
  const j = JSON.parse(readFileSync(resolve(process.cwd(), process.env.ACCOUNT_FILE ?? ".secrets/testnet-account.json"), "utf8")) as {
    qorAddress: string; secp256k1PrivateKey: string; mlDsa87PublicKey: string; mlDsa87SecretKey: string;
  };
  return { qorAddress: j.qorAddress, secp256k1PrivateKey: j.secp256k1PrivateKey, pqc: { publicKey: unhex(j.mlDsa87PublicKey), secretKey: unhex(j.mlDsa87SecretKey) } };
};
const f = loadAccount();
const pqc = f.pqc;
// The SDK needs a UnifiedAccount; build it from the stored spend key, then use the stored PQC keypair.
const base = unifiedAccountFromSeed(unhex(f.secp256k1PrivateKey), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) });
const account: UnifiedAccount = { ...base, pqc };
if (account.cosmos !== f.qorAddress) throw new Error("Stored key does not match the stored address; refusing.");

const rest_ = QORE_NETWORK.rest;
const status = await (await fetch(`${rest_}/cosmos/base/tendermint/v1beta1/node_info`)).json() as { default_node_info?: { network?: string } };
if (status.default_node_info?.network !== CHAIN_ID) throw new Error(`Node reports "${status.default_node_info?.network}", expected ${CHAIN_ID}. Refusing.`);

const acc = (await (await fetch(`${rest_}/cosmos/auth/v1beta1/accounts/${account.cosmos}`)).json()) as { account?: { account_number?: string; sequence?: string } };
const accountNumber = BigInt(acc.account?.account_number ?? "0");
const sequence = BigInt(acc.account?.sequence ?? "0");

// Minimum gas price on this node is 0.1 uqor; use 0.15 for headroom. Gas limits are generous fixed values.
const fee = (gas: number) => ({ amount: [{ denom: "uqor", amount: String(Math.ceil(gas * 0.15)) }], gas: String(gas) });

let messages, gas: number, mode: "classical" | "hybrid", label: string;
if (cmd === "register-pqc") {
  const proof = signProofOfPossession({ chainId: CHAIN_ID, account: account.cosmos, keypair: pqc });
  messages = [buildRegisterPqcKeyMsg(account.cosmos, { pqcKeypair: pqc, ecdsaPubkey: unhex(account.publicKey), proofOfPossession: proof })];
  gas = 1_500_000; mode = "classical"; label = "MsgRegisterPQCKeyV2 (registers this account's ML-DSA-87 key)";
} else if (cmd === "open-window") {
  const blocks = flag("--blocks", 300), maxTxs = flag("--max-txs", 10), maxQor = flag("--max-qor", 10);
  messages = [openEvmWindowMsg({ sender: account.cosmos, blocks, maxTxs, maxValue: String(Math.round(maxQor * 1_000_000)) })];
  gas = 500_000; mode = "hybrid"; label = `MsgOpenEVMWindow UNSCOPED: ${blocks} blocks, ${maxTxs} txs, max ${maxQor} QOR (value + fees)`;
} else if (cmd === "send") {
  const to = rest[0], qor = Number(rest[1]);
  if (!to?.startsWith("qor1") || !(qor > 0 && qor <= 50)) throw new Error("usage: send <qor1... address> <amount QOR, max 50>");
  messages = [msg.bank.send({ fromAddress: account.cosmos, toAddress: to, amount: [{ denom: "uqor", amount: String(Math.round(qor * 1_000_000)) }] })];
  gas = 300_000; mode = "hybrid"; label = `MsgSend ${qor} QOR to ${to}`;
} else if (cmd === "close-window") {
  messages = [closeEvmWindowMsg(account.cosmos)];
  gas = 300_000; mode = "hybrid"; label = "MsgCloseEVMWindow";
} else {
  console.error("usage: chain-tx.ts register-pqc | send <qor1..> <QOR> | open-window [--blocks N --max-txs N --max-qor N] | close-window   [--broadcast]");
  process.exit(2);
}

const signer = new EthNativeSigner(account, { signMode: mode, rest: rest_ });
const params = { chainId: CHAIN_ID, messages, fee: fee(gas), accountNumber, sequence };
console.log(`${broadcast ? "BROADCAST" : "DRY RUN"}  ${label}`);
console.log(`signer ${account.cosmos}  mode ${mode}  fee ${params.fee.amount[0]!.amount} uqor  gas ${gas}  sequence ${sequence}`);

if (!broadcast) {
  const signed = signer.sign({ ...params, signBytesVersion: await signer.resolveSignBytesVersion(CHAIN_ID) });
  console.log(`Signed locally OK (${(signed as { txBytes?: Uint8Array }).txBytes?.length ?? "?"} bytes). Nothing was sent. Re-run with --broadcast to send.`);
} else {
  const client = await StargateClient.connect(QORE_NETWORK.rpc);
  const res = await signer.signAndBroadcast(client, params);
  console.log(`code ${res.code}  height ${res.height ?? "?"}  tx ${res.transactionHash}`);
  console.log(`explorer: ${QORE_NETWORK.explorer.replace(/\/$/, "")}/tx/${res.transactionHash}`);
  if (res.code !== 0) { console.error("FAILED:", res.rawLog); process.exit(1); }
}
