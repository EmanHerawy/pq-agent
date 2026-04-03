import { randomBytes } from "node:crypto";
import { isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { WalletInfo } from "../types.js";

/** Ethereum address (0x + 40 hex), viem-validated. */
export function isValidEthAddress(val: string): boolean {
  return isAddress(val.trim());
}

/** 32-byte secp256k1 private key as 0x + 64 hex. */
export function isValidPrivateKey(val: string): boolean {
  const t = val.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(t)) return false;
  try {
    privateKeyToAccount(t as `0x${string}`);
    return true;
  } catch {
    return false;
  }
}

export function normalize0xHex(val: string): `0x${string}` {
  const raw = val.trim();
  const body =
    raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  return (`0x${body.toLowerCase()}`) as `0x${string}`;
}

/** Generate a 32-byte random hex seed for the post-quantum key (0x + 64 hex chars). */
export function generatePQSeed(): string {
  return "0x" + randomBytes(32).toString("hex");
}

export function generateWallet(): WalletInfo {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
  };
}
