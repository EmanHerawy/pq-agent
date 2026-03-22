import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { WalletInfo } from "../types.js";

export function generateWallet(): WalletInfo {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
  };
}
