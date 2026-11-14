"use client";
import { envelopeFromText, envelopeToText, open, recipientOf, seal, sealKeysFromSeed, toHex, fromHex, type SealKeyPair } from "@qorechain/qoreseal";

/**
 * Browser-side QoreSeal helpers. A reviewer's private key is a 32-byte seed that stays in this browser (localStorage) and in
 * the backup file they download. It is never sent to the server. Losing both the browser data and the backup loses access to
 * every bid sealed to that key; there is no recovery.
 */
export const CHAIN_ID = "qorechain-diana";
const enc = new TextEncoder();
const dec = new TextDecoder();
const storageKey = (orgId: string, userId: string) => `verac.sealseed.${orgId}.${userId}`;

export function loadSeed(orgId: string, userId: string): string | null {
  try { return localStorage.getItem(storageKey(orgId, userId)); } catch { return null; }
}
export function saveSeed(orgId: string, userId: string, seedHex: string): boolean {
  try { localStorage.setItem(storageKey(orgId, userId), seedHex); return true; } catch { return false; }
}
export function newSeedHex(): string { return toHex(crypto.getRandomValues(new Uint8Array(32))); }
export const isSeedHex = (s: string) => /^[0-9a-f]{64}$/.test(s);
export const keysFromSeedHex = (hex: string): SealKeyPair => sealKeysFromSeed(fromHex(hex));

export function publicKeysHex(keys: SealKeyPair) { return { mlkem: toHex(keys.mlkemPublicKey), x25519: toHex(keys.x25519PublicKey) }; }

/** Short fingerprint of a public key pair so people can compare it out of band (for example read it aloud). */
export async function fingerprint(mlkemHex: string, x25519Hex: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", fromHex(mlkemHex + x25519Hex) as unknown as BufferSource));
  return toHex(d).slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");
}

export async function sealBid(tenderId: string, recipients: Array<{ mlkem: string; x25519: string }>, plaintext: string): Promise<{ text: string; sha256: string }> {
  const env = seal({
    chainId: CHAIN_ID, purpose: `bid:${tenderId}`, aad: enc.encode(tenderId),
    recipients: recipients.map((r) => recipientOf({ mlkemPublicKey: fromHex(r.mlkem), x25519PublicKey: fromHex(r.x25519) })),
    plaintext: enc.encode(plaintext),
  });
  const text = envelopeToText(env);
  const sha256 = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
  return { text, sha256 };
}

export function openBid(tenderId: string, envelopeText: string, keys: SealKeyPair): string {
  return dec.decode(open({ chainId: CHAIN_ID, purpose: `bid:${tenderId}`, aad: enc.encode(tenderId), envelope: envelopeFromText(envelopeText), keys }));
}
