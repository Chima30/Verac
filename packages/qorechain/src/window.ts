import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, closeEvmWindowMsg, openEvmWindowMsg, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";
import { QORE_NETWORK } from "@qoreops/shared-types";
import { DEPLOYED } from "./contracts";
import { QoreReader } from "./index";
import { SIGNER_LIMITS, SignerRefusal, type KillSwitch } from "./signer";

/**
 * Server-managed EVM authorisation windows for the test agent and approver accounts.
 *
 * QoreChain admits an account's EVM transactions only while a window opened with its ML-DSA-87 key covers them. This
 * class opens a SHORT window (SIGNER_LIMITS: 120 blocks, 3 transactions, 2 QOR of fees) that admits only the deployed
 * TreasuryVault (allowedTargets), and only for an operation that is already approved. It closes the window again
 * after the transaction. The post-quantum secret is a dedicated key for the test account, held only in a server-side
 * environment variable.
 *
 * The chain's own documentation says there is deliberately no automatic "open before sending" helper, because a window
 * exists so spending is authorised on purpose. Here the purpose is an operation that an authenticated administrator has
 * approved in Verac, and Verac calls ensureOpen only for such operations.
 */

const CHAIN_ID = "qorechain-diana";
const unhex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const fee = (gas: number) => ({ amount: [{ denom: "uqor", amount: String(Math.ceil(gas * 0.15)) }], gas: String(gas) });

export interface WindowKeys { secp256k1PrivateKey: string; mlDsa87PublicKey: string; mlDsa87SecretKey: string }
export interface WindowState { live: boolean; remainingTxs: bigint; remainingBlocks: bigint; allowedTargets: string[] }

/** Pure decision: is the existing window good enough, or must a new one be opened? */
export function windowIsSufficient(w: WindowState, needTxs = 1, vault: string = DEPLOYED.TreasuryVault): boolean {
  if (!w.live || w.remainingTxs < BigInt(needTxs) || w.remainingBlocks < 5n) return false;
  // A window with no target list admits any contract; only a list that is exactly the vault is acceptable.
  return w.allowedTargets.length === 1 && w.allowedTargets[0]!.toLowerCase() === vault.toLowerCase();
}

export class WindowManager {
  readonly #account: UnifiedAccount;
  readonly #reader: QoreReader;
  readonly #kill: KillSwitch;

  constructor(keys: WindowKeys, kill: KillSwitch, reader: QoreReader = new QoreReader()) {
    const pqc = { publicKey: unhex(keys.mlDsa87PublicKey), secretKey: unhex(keys.mlDsa87SecretKey) };
    const base = unifiedAccountFromSeed(unhex(keys.secp256k1PrivateKey), { pqcSecret: crypto.getRandomValues(new Uint8Array(32)) });
    this.#account = { ...base, pqc };
    this.#kill = kill;
    this.#reader = reader;
  }

  get nativeAddress(): string { return this.#account.cosmos; }

  async status(): Promise<WindowState> {
    const w = await this.#reader.evmWindow(this.#account.cosmos);
    return { live: w.live, remainingTxs: w.remainingTxs, remainingBlocks: w.remainingBlocks, allowedTargets: w.allowedTargets };
  }

  /** Opens a window only if the current one is missing or too small. Returns the open transaction hash, or null if none was needed. */
  async ensureOpen(needTxs = 1): Promise<string | null> {
    this.#guard();
    if (windowIsSufficient(await this.status(), needTxs)) return null;
    return this.#broadcast(
      [openEvmWindowMsg({ sender: this.#account.cosmos, blocks: SIGNER_LIMITS.windowBlocks, maxTxs: SIGNER_LIMITS.windowMaxTxs, maxValue: String(SIGNER_LIMITS.windowMaxUqor), allowedTargets: [DEPLOYED.TreasuryVault] })],
      500_000,
    );
  }

  /** Closes the window at once. Allowed even while the kill switch is on, because closing only reduces risk. */
  async close(): Promise<string | null> {
    if (!(await this.status()).live) return null;
    return this.#broadcast([closeEvmWindowMsg(this.#account.cosmos)], 300_000);
  }

  #guard(): void {
    if (!this.#kill.enabled()) throw new SignerRefusal("DISABLED", "Live execution is switched off; no window will be opened.");
  }

  async #broadcast(messages: Parameters<EthNativeSigner["sign"]>[0]["messages"], gas: number): Promise<string> {
    const rest = QORE_NETWORK.rest;
    const info = (await (await fetch(`${rest}/cosmos/base/tendermint/v1beta1/node_info`)).json()) as { default_node_info?: { network?: string } };
    if (info.default_node_info?.network !== CHAIN_ID) throw new SignerRefusal("BAD_CHAIN", `Node reports "${info.default_node_info?.network}", expected ${CHAIN_ID}.`);
    const acc = (await (await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${this.#account.cosmos}`)).json()) as { account?: { account_number?: string; sequence?: string } };
    const signer = new EthNativeSigner(this.#account, { signMode: "hybrid", rest });
    const client = await StargateClient.connect(QORE_NETWORK.rpc);
    try {
      const res = await signer.signAndBroadcast(client, { chainId: CHAIN_ID, messages, fee: fee(gas), accountNumber: BigInt(acc.account?.account_number ?? "0"), sequence: BigInt(acc.account?.sequence ?? "0") });
      if (res.code !== 0) throw new Error(`Window transaction failed with code ${res.code}`);
      return res.transactionHash;
    } finally { client.disconnect(); }
  }
}
