/**
 * Read-only probe: does Diana's PQC Verify precompile (0x…0A01) accept an ML-DSA-87 signature made with the SDK's pqcSign,
 * and does PQC Key Status (0x…0A02) return the account's registered key? Uses eth_call only; sends nothing.
 *   ACCOUNT_FILE=.secrets/category-proof-account.json tsx probe-pqc-precompile.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pqcSign } from "@qorechain/sdk";
import { keccak256, toBytes, toHex, parseAbi, type Hex } from "viem";
import { QoreReader } from "../src/index";

const f = JSON.parse(readFileSync(resolve(process.cwd(), process.env.ACCOUNT_FILE ?? ".secrets/category-proof-account.json"), "utf8")) as { evmAddress: Hex; mlDsa87PublicKey: string; mlDsa87SecretKey: string };
const unhex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const abi = parseAbi([
  "function pqcVerify(bytes pubkey, bytes signature, bytes message) view returns (bool)",
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);
const evm = new QoreReader().evm;
const VERIFY = "0x0000000000000000000000000000000000000a01", STATUS = "0x0000000000000000000000000000000000000a02";

const status = await evm.readContract({ address: STATUS, abi, functionName: "pqcKeyStatus", args: [f.evmAddress] });
console.log("pqcKeyStatus:", { registered: status[0], algorithmId: status[1], pubkeyBytes: (status[2].length - 2) / 2, possessionProven: status[3], matchesOurKey: status[2].slice(2).toLowerCase() === f.mlDsa87PublicKey.toLowerCase() });

const message = toBytes(keccak256(toBytes("verac-probe|" + Date.now())));
const sig = pqcSign(unhex(f.mlDsa87SecretKey), message);
console.log("signature bytes:", sig.length);
const call = (m: Uint8Array, s: Uint8Array, p: Hex) => evm.readContract({ address: VERIFY, abi, functionName: "pqcVerify", args: [p, toHex(s), toHex(m)] });
const pub = `0x${f.mlDsa87PublicKey}` as Hex;
console.log("valid signature        ->", await call(message, sig, pub));
const tampered = Uint8Array.from(message); tampered[0] = (tampered[0] ?? 0) ^ 1;
console.log("tampered message       ->", await call(tampered, sig, pub));
const otherSig = Uint8Array.from(sig); otherSig[100] = (otherSig[100] ?? 0) ^ 1;
console.log("tampered signature     ->", await call(message, otherSig, pub).catch((e) => `revert: ${String(e).slice(0, 80)}`));
const gas = await evm.estimateGas({ to: VERIFY, data: (await import("viem")).encodeFunctionData({ abi, functionName: "pqcVerify", args: [pub, toHex(sig), toHex(message)] }) });
console.log("gas for one verification:", gas.toString());
