/**
 * Local testnet accounts in the split layout used for the Q-Day drill:
 *   <dir>/ecdsa-private-key.txt   classical secp256k1 key (one line of hex)
 *   <dir>/pqc-recovery-code.txt   QRC1 code the ML-DSA-87 key is derived from (kept apart from the classical key)
 *   <dir>/account.json            public data only
 * Secrets are read from disk only when a signature is needed and are never printed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner, buildRegisterPqcKeyMsg, evmToQor, generatePqcRecoveryCode, pqcKeyFromRecoveryCode, signProofOfPossession,
  unifiedAccountFromSeed, type UnifiedAccount,
} from "@qorechain/sdk";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { QORE_NETWORK } from "@qoreops/shared-types";

export const CHAIN_ID = "qorechain-diana";
export interface PublicAccount { role: string; evmAddress: Hex; qorAddress: string; mlDsa87PublicKey: string }

export class LocalAccount {
  constructor(readonly dir: string, readonly pub: PublicAccount) {}

  static create(dir: string, role: string): LocalAccount {
    if (existsSync(resolve(dir, "ecdsa-private-key.txt"))) throw new Error(`Refusing to overwrite the account in ${dir}`);
    const key = generatePrivateKey();
    const evm = privateKeyToAccount(key).address;
    const qor = evmToQor(evm);
    const code = generatePqcRecoveryCode();
    const pq = pqcKeyFromRecoveryCode(code, qor);
    mkdirSync(dir, { recursive: true });
    const o = { mode: 0o600, flag: "wx" } as const;
    writeFileSync(resolve(dir, "ecdsa-private-key.txt"), `${key}\n`, o);
    writeFileSync(resolve(dir, "pqc-recovery-code.txt"), `${code}\n`, o);
    const pub: PublicAccount = { role, evmAddress: evm, qorAddress: qor, mlDsa87PublicKey: Buffer.from(pq.publicKey).toString("hex") };
    writeFileSync(resolve(dir, "account.json"), JSON.stringify({ ...pub, network: CHAIN_ID, note: "Testnet only. Secrets are in the two .txt files next to this one." }, null, 2), o);
    return new LocalAccount(dir, pub);
  }

  static load(dir: string): LocalAccount {
    return new LocalAccount(dir, JSON.parse(readFileSync(resolve(dir, "account.json"), "utf8")) as PublicAccount);
  }

  static loadOrCreate(dir: string, role: string): LocalAccount {
    return existsSync(resolve(dir, "account.json")) ? LocalAccount.load(dir) : LocalAccount.create(dir, role);
  }

  /** viem account for EVM transactions. */
  evm(): PrivateKeyAccount {
    const a = privateKeyToAccount(readFileSync(resolve(this.dir, "ecdsa-private-key.txt"), "utf8").trim() as Hex);
    if (a.address !== this.pub.evmAddress) throw new Error(`${this.dir}: classical key does not match the recorded address`);
    return a;
  }

  /** The ML-DSA-87 keypair, checked against the recorded public key. */
  pqc() {
    const pq = pqcKeyFromRecoveryCode(readFileSync(resolve(this.dir, "pqc-recovery-code.txt"), "utf8").trim(), this.pub.qorAddress);
    if (Buffer.from(pq.publicKey).toString("hex") !== this.pub.mlDsa87PublicKey) throw new Error(`${this.dir}: recovery code does not give the recorded key`);
    return pq;
  }

  unified(): UnifiedAccount {
    const key = readFileSync(resolve(this.dir, "ecdsa-private-key.txt"), "utf8").trim();
    const base = unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.replace(/^0x/, ""), "hex")), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) });
    if (base.cosmos !== this.pub.qorAddress) throw new Error(`${this.dir}: key does not match the recorded qor address`);
    return { ...base, pqc: this.pqc() };
  }
}

const rest = QORE_NETWORK.rest;
export const getJson = async <T>(path: string): Promise<T> => (await (await fetch(`${rest}${path}`)).json()) as T;

export async function assertDiana() {
  const info = await getJson<{ default_node_info?: { network?: string } }>("/cosmos/base/tendermint/v1beta1/node_info");
  if (info.default_node_info?.network !== CHAIN_ID) throw new Error(`Node reports "${info.default_node_info?.network}", expected ${CHAIN_ID}. Refusing.`);
}

export async function uqorBalance(qor: string): Promise<bigint> {
  const b = await getJson<{ balance?: { amount?: string } }>(`/cosmos/bank/v1beta1/balances/${qor}/by_denom?denom=uqor`);
  return BigInt(b.balance?.amount ?? "0");
}

export async function pqcRegistered(qor: string): Promise<{ found: boolean; proven: boolean; pub?: string }> {
  const j = await getJson<{ found?: boolean; account?: { possession_proven?: boolean; public_key?: string } }>(`/qorechain/pqc/v1/account/${qor}`);
  return { found: !!j.found, proven: !!j.account?.possession_proven, pub: j.account?.public_key ? Buffer.from(j.account.public_key, "base64").toString("hex") : undefined };
}

export interface NativeResult { code: number; hash: string; height: number; rawLog: string }

/** Signs and broadcasts native messages. Never throws on a chain refusal: the code and log are returned. */
export async function broadcastNative(ua: UnifiedAccount, mode: "hybrid" | "classical", messages: Parameters<EthNativeSigner["sign"]>[0]["messages"], gas: number): Promise<NativeResult> {
  const acc = await getJson<{ account?: { account_number?: string; sequence?: string } }>(`/cosmos/auth/v1beta1/accounts/${ua.cosmos}`);
  const client = await StargateClient.connect(QORE_NETWORK.rpc);
  try {
    const res = await new EthNativeSigner(ua, { signMode: mode, rest }).signAndBroadcast(client, {
      chainId: CHAIN_ID, messages, fee: { amount: [{ denom: "uqor", amount: String(Math.ceil(gas * 0.15)) }], gas: String(gas) },
      accountNumber: BigInt(acc.account?.account_number ?? "0"), sequence: BigInt(acc.account?.sequence ?? "0"),
    });
    return { code: res.code, hash: res.transactionHash, height: Number(res.height ?? 0), rawLog: res.rawLog ?? "" };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { code: Number(/code (\d+)/.exec(m)?.[1] ?? -1), hash: /\(tx ([0-9A-Fa-f]{64})\)/.exec(m)?.[1] ?? "", height: 0, rawLog: m };
  } finally { client.disconnect(); }
}

/** Registers the account's ML-DSA-87 key with a proof of possession (classical-signed, the one message allowed so). */
export async function registerPqc(a: LocalAccount): Promise<NativeResult> {
  const ua = a.unified();
  const proof = signProofOfPossession({ chainId: CHAIN_ID, account: ua.cosmos, keypair: ua.pqc });
  return broadcastNative(ua, "classical", [buildRegisterPqcKeyMsg(ua.cosmos, { pqcKeypair: ua.pqc, ecdsaPubkey: Uint8Array.from(Buffer.from(ua.publicKey, "hex")), proofOfPossession: proof })], 1_500_000);
}
