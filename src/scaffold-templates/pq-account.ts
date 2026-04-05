/**
 * Post-quantum ERC-4337 smart account utility templates.
 *
 * Based on the ZKNOX pq-account architecture:
 *   - Pre-quantum leg: ECDSA secp256k1 (standard Ethereum private key)
 *   - Post-quantum leg: ML-DSA-44 (NIST FIPS 204 / formerly CRYSTALS-Dilithium)
 *
 * Each UserOperation is signed by BOTH keys. The on-chain verifier requires
 * both signatures to pass before executing the transaction.
 *
 * See: https://github.com/zknox/pq-account
 */

export type PQAppFramework = "nextjs" | "vite";

/** hexToU8 byte-conversion utility. */
export function pqHexSource(): string {
  return `export const hexToU8 = (
  hex: string,
  expectedBytes: number = 32
): Uint8Array => {
  if (hex.startsWith("0x")) hex = hex.slice(2);

  if (hex.length !== expectedBytes * 2) {
    throw new Error(
      \`Seed must be \${expectedBytes} bytes (\${expectedBytes * 2} hex chars)\`
    );
  }

  return Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
};
`;
}

/**
 * ML-DSA-44 public-key expansion utility.
 * Expands the 1,312-byte raw public key into the NTT-domain form that the
 * on-chain ZKNOX verifier expects. Heavy math done once at account-creation time.
 */
export function pqUtilsMldsaSource(): string {
  return `import { ethers } from "ethers";
import { shake128, shake256 } from "@noble/hashes/sha3";
// @ts-ignore — internal noble module, no public types
import { genCrystals } from "@noble/post-quantum/_crystals";

const N = 256;
const Q = 8380417;
const D = 13;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { NTT } = (genCrystals as any)({
  N, Q, F: 8347681, ROOT_OF_UNITY: 1753,
  newPoly: (n: number) => new Int32Array(n),
  isKyber: false, brvBits: 8,
});

const polyShiftl = (p: Int32Array): Int32Array => {
  for (let i = 0; i < N; i++) p[i] <<= D;
  return p;
};

const RejectionSamplePoly = (
  rho: Uint8Array,
  i: number,
  j: number,
  N = 256,
  q = 8380417
): Int32Array => {
  const seed = new Uint8Array(rho.length + 2);
  seed.set(rho, 0);
  seed[rho.length] = j;
  seed[rho.length + 1] = i;

  const xof = shake128.create();
  xof.update(seed);

  const r = new Int32Array(N);
  let j_idx = 0;
  while (j_idx < N) {
    const buf = new Uint8Array(3 * 64);
    xof.xofInto(buf);
    for (let k = 0; j_idx < N && k <= buf.length - 3; k += 3) {
      let t = buf[k] | (buf[k + 1] << 8) | (buf[k + 2] << 16);
      t &= 0x7fffff;
      if (t < q) r[j_idx++] = t;
    }
  }
  return r;
};

export const recoverAhat = (rho: Uint8Array, K: number, L: number): Int32Array[][] => {
  const A_hat: Int32Array[][] = [];
  for (let i = 0; i < K; i++) {
    const row: Int32Array[] = [];
    for (let j = 0; j < L; j++) {
      row.push(RejectionSamplePoly(rho, i, j));
    }
    A_hat.push(row);
  }
  return A_hat;
};

const N = 256;
const newPoly = (): Int32Array => new Int32Array(N);

const polyDecode10Bits = (bytes: Uint8Array): Int32Array => {
  const poly = newPoly();
  let r = 0n;
  for (let i = 0; i < bytes.length; i++) r |= BigInt(bytes[i]) << BigInt(8 * i);
  const mask = (1 << 10) - 1;
  for (let i = 0; i < poly.length; i++) {
    poly[i] = Number((r >> BigInt(i * 10)) & BigInt(mask));
  }
  return poly;
};

export const decodePublicKey = (
  publicKey: Uint8Array
): { rho: Uint8Array; t1: Int32Array[]; tr: Uint8Array } => {
  const RHO_BYTES = 32;
  const K = 4;
  const T1_POLY_BYTES = 320;

  if (publicKey.length !== RHO_BYTES + K * T1_POLY_BYTES)
    throw new Error("Invalid publicKey length");

  const rho = publicKey.slice(0, RHO_BYTES);
  const t1: Int32Array[] = [];
  for (let i = 0; i < K; i++) {
    const offset = RHO_BYTES + i * T1_POLY_BYTES;
    t1.push(polyDecode10Bits(publicKey.slice(offset, offset + T1_POLY_BYTES)));
  }
  const tr = shake256(new Uint8Array(publicKey), { dkLen: 64 });
  return { rho, t1, tr };
};

export const compact_poly_256 = (coeffs: Int32Array, m: number): bigint[] => {
  if (m >= 256) throw new Error("m must be less than 256");
  if ((coeffs.length * m) % 256 !== 0) throw new Error("Total bits must be divisible by 256");

  const a = Array.from(coeffs, (x) => {
    if (typeof x === "bigint") return x;
    if (typeof x === "number") return BigInt(Math.floor(x));
    throw new Error("Element cannot be converted to BigInt");
  });
  for (const elt of a) {
    if (elt >= 1n << BigInt(m)) throw new Error("Element too large");
  }

  const n = (a.length * m) / 256;
  const b = new Array(n).fill(0n);
  for (let i = 0; i < a.length; i++) {
    const idx = Math.floor((i * m) / 256);
    const shift = BigInt((i % (256 / m)) * m);
    b[idx] |= a[i] << shift;
  }
  return b;
};

export const compact_module_256 = (data: Int32Array[][], m: number): bigint[][][] =>
  data.map((row) => row.map((p) => compact_poly_256(p, m)));

/**
 * Expand an ML-DSA-44 raw public key (1,312 bytes) into the NTT-domain form
 * that the ZKNOX on-chain verifier expects. Called once at account creation.
 */
export const to_expanded_encoded_bytes = (publicKey: Uint8Array): string => {
  const { rho, t1, tr } = decodePublicKey(publicKey);
  t1.forEach((poly) => NTT.encode(polyShiftl(poly)));
  const A_hat = recoverAhat(rho, 4, 4);
  const A_hat_compact = compact_module_256(A_hat, 32);
  const A_hat_stringified = A_hat_compact.map((row) =>
    row.map((col) => col.map((val) => val.toString()))
  );
  const [t1_compact] = compact_module_256([t1], 32);
  const t1_stringified = t1_compact.map((row) => row.map((val) => val.toString()));

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const aHatEncoded = abiCoder.encode(["uint256[][][]"], [A_hat_stringified]);
  const t1Encoded = abiCoder.encode(["uint256[][]"], [t1_stringified]);
  return abiCoder.encode(["bytes", "bytes", "bytes"], [aHatEncoded, tr, t1Encoded]);
};
`;
}

/**
 * ERC-4337 account deployment via ZKNOX factory.
 * Accepts pre-quantum seed (= ECDSA private key) + post-quantum seed (= ML-DSA seed).
 */
export function pqCreateAccountSource(): string {
  return `import { ml_dsa44 } from "@noble/post-quantum/ml-dsa";
import { ethers, Signer } from "ethers";
import { hexToU8 } from "./hex.js";
import { to_expanded_encoded_bytes } from "./utils-mldsa.js";

const SEPARATOR = "=".repeat(60);

const ACCOUNT_FACTORY_ABI = [
  "function createAccount(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external returns (address)",
  "function getAddress(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external view returns (address payable)",
];

export type DeploymentResult = {
  success: boolean;
  address?: string;
  transactionHash?: string;
  alreadyExists?: boolean;
  error?: string;
  gasUsed?: string;
  actualCost?: string;
};

export const validateSeed = (seed: string, name: string): void => {
  if (!seed.startsWith("0x"))
    throw new Error(name + ' must start with "0x"');
  if (seed.length !== 66)
    throw new Error(name + " must be 32 bytes (66 characters including 0x, got " + seed.length + ")");
  if (!/^0x[0-9a-fA-F]{64}$/.test(seed))
    throw new Error(name + " contains invalid hex");
};

export const getPublicKeys = (preQuantumSeed: string, postQuantumSeed: string) => {
  const preQuantumPubKey = new ethers.Wallet(preQuantumSeed).address;
  const { publicKey } = ml_dsa44.keygen(hexToU8(postQuantumSeed, 32));
  const postQuantumPubKey = to_expanded_encoded_bytes(publicKey);
  return { preQuantumPubKey, postQuantumPubKey };
};

export const deployERC4337Account = async (
  factoryAddress: string,
  preQuantumPubKey: string,
  postQuantumPubKey: string,
  signer: Signer,
  log: (msg: string) => void
): Promise<DeploymentResult> => {
  try {
    const { provider } = signer;
    if (!provider) throw new Error("Signer must have a provider");

    log("Connecting to wallet...");
    const address = await signer.getAddress();
    const balance = await provider.getBalance(address);
    const network = await provider.getNetwork();
    log("Wallet: " + address);
    log("Balance: " + ethers.formatEther(balance) + " ETH");
    log("Chain: " + network.chainId);

    const factoryCode = await provider.getCode(factoryAddress);
    if (factoryCode === "0x") throw new Error("No contract at factory address!");

    const factory = new ethers.Contract(factoryAddress, ACCOUNT_FACTORY_ABI, signer);
    const iface = new ethers.Interface(ACCOUNT_FACTORY_ABI);
    const callData = iface.encodeFunctionData("getAddress", [preQuantumPubKey, postQuantumPubKey]);
    const result = await provider.call({ to: factoryAddress, data: callData });
    const [expectedAddress] = iface.decodeFunctionResult("getAddress", result);

    if (!ethers.isAddress(expectedAddress)) throw new Error("Invalid address from getAddress()");
    log("Expected account: " + expectedAddress);

    const code = await provider.getCode(expectedAddress);
    if (code !== "0x") {
      log(SEPARATOR);
      log("ACCOUNT ALREADY EXISTS: " + expectedAddress);
      log(SEPARATOR);
      return { success: true, address: expectedAddress, alreadyExists: true };
    }

    let estimatedGas;
    try {
      estimatedGas = await factory.createAccount.estimateGas(preQuantumPubKey, postQuantumPubKey);
    } catch {
      estimatedGas = 5000000n;
      log("Gas estimation failed, using fallback: " + estimatedGas);
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    log("Estimated gas: " + estimatedGas + " @ " + ethers.formatUnits(gasPrice, "gwei") + " gwei");
    log("Creating account — confirm in wallet...");

    const tx = await factory.createAccount(preQuantumPubKey, postQuantumPubKey, {
      gasLimit: (estimatedGas * 120n) / 100n,
    });
    log("Tx: " + tx.hash);

    let receipt = null;
    let attempts = 0;
    while (!receipt && attempts < 60) {
      try {
        receipt = await provider.getTransactionReceipt(tx.hash);
        if (!receipt) { attempts++; await new Promise((r) => setTimeout(r, 5000)); }
      } catch { attempts++; await new Promise((r) => setTimeout(r, 5000)); }
    }

    if (!receipt) return { success: false, error: "Transaction timeout", transactionHash: tx.hash };
    if (receipt.status === 0) return { success: false, error: "Transaction reverted", transactionHash: tx.hash };

    const actualCost = receipt.gasUsed * (receipt.gasPrice ?? 0n);
    log(SEPARATOR);
    log("DEPLOYMENT COMPLETE!");
    log("Account: " + expectedAddress);
    log("Gas used: " + receipt.gasUsed + " | Cost: " + ethers.formatEther(actualCost) + " ETH");
    log(SEPARATOR);

    return { success: true, address: expectedAddress, transactionHash: tx.hash, gasUsed: receipt.gasUsed.toString(), actualCost: ethers.formatEther(actualCost) };
  } catch (e) {
    const err = e as { message: string; code?: string | number };
    log("Error: " + err.message);
    if (err.code === "ACTION_REJECTED" || err.code === 4001) log("(User rejected)");
    return { success: false, error: err.message };
  }
};
`;
}

/**
 * UserOperation construction + hybrid signing (ECDSA secp256k1 + ML-DSA-44).
 * The EntryPoint address is the canonical ERC-4337 v0.7 address.
 */
export function pqUserOperationSource(): string {
  return `import { ml_dsa44 } from "@noble/post-quantum/ml-dsa";
import { BrowserProvider, ethers } from "ethers";

export const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const ACCOUNT_ABI = [
  "function execute(address dest, uint256 value, bytes calldata func) external",
  "function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external",
  "function getNonce() external view returns (uint256)",
];

export type UserOperation = {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
};

export type GasEstimates = {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
};

const packUint128 = (a: bigint, b: bigint): string =>
  ethers.solidityPacked(["uint128", "uint128"], [a, b]);

const unpackUint128 = (packed: string): [bigint, bigint] => {
  const bytes = ethers.getBytes(packed);
  const first = BigInt("0x" + ethers.hexlify(bytes.slice(0, 16)).slice(2));
  const second = BigInt("0x" + ethers.hexlify(bytes.slice(16, 32)).slice(2));
  return [first, second];
};

export const createBaseUserOperation = async (
  accountAddress: string,
  targetAddress: string,
  value: bigint,
  callData: string,
  provider: BrowserProvider,
  bundlerUrl: string
): Promise<UserOperation> => {
  const account = new ethers.Contract(accountAddress, ACCOUNT_ABI, provider);
  let nonce: bigint;
  try { nonce = await account.getNonce(); } catch { nonce = 0n; }

  const executeCallData = account.interface.encodeFunctionData("execute", [targetAddress, value, callData]);

  let maxPriority: bigint;
  let maxFee: bigint;
  try {
    const gasResponse = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "pimlico_getUserOperationGasPrice", params: [] }),
    });
    const gasResult = await gasResponse.json();
    if (!gasResult.result) throw new Error("No gas price returned");
    maxFee = BigInt(gasResult.result.standard.maxFeePerGas);
    maxPriority = BigInt(gasResult.result.standard.maxPriorityFeePerGas);
  } catch {
    maxPriority = ethers.parseUnits("0.1", "gwei");
    maxFee = ethers.parseUnits("0.2", "gwei");
  }

  return {
    sender: accountAddress,
    nonce,
    initCode: "0x",
    callData: executeCallData,
    accountGasLimits: packUint128(13_500_000n, 500_000n),
    preVerificationGas: 1_000_000n,
    gasFees: packUint128(maxPriority, maxFee),
    paymasterAndData: "0x",
    signature: "0x",
  };
};

export const userOpToBundlerFormat = (userOp: UserOperation) => {
  const [verificationGasLimit, callGasLimit] = unpackUint128(userOp.accountGasLimits);
  const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint128(userOp.gasFees);
  return {
    sender: userOp.sender,
    nonce: "0x" + BigInt(userOp.nonce).toString(16),
    callData: userOp.callData,
    verificationGasLimit: "0x" + verificationGasLimit.toString(16),
    callGasLimit: "0x" + callGasLimit.toString(16),
    preVerificationGas: "0x" + BigInt(userOp.preVerificationGas).toString(16),
    maxFeePerGas: "0x" + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + maxPriorityFeePerGas.toString(16),
    signature: userOp.signature,
  };
};

/**
 * Dummy signature for gas estimation — bundler simulation requires a correctly-sized
 * signature even though the values are meaningless. ML-DSA-44 signatures are 2420 bytes;
 * ECDSA secp256k1 signatures are 65 bytes. Both are zero-filled here.
 */
export const getDummySignature = (): string =>
  ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "bytes"],
    [new Uint8Array(65), new Uint8Array(2420)]
  );

export const estimateUserOperationGas = async (
  userOp: UserOperation,
  bundlerUrl: string
): Promise<GasEstimates> => {
  const MIN_VERIFICATION = 13_500_000n;
  try {
    const response = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_estimateUserOperationGas", params: [userOpToBundlerFormat(userOp), ENTRY_POINT_ADDRESS] }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error.message || "Estimation failed");
    if (!result.result) throw new Error("No estimate returned");

    let verificationGasLimit = BigInt(result.result.verificationGasLimit);
    if (verificationGasLimit < MIN_VERIFICATION) verificationGasLimit = MIN_VERIFICATION;
    // ML-DSA signatures are ~2.5 KB; multiply preVerificationGas by 4× to cover extra calldata cost.
    const preVerificationGas = BigInt(result.result.preVerificationGas || userOp.preVerificationGas) * 4n;
    return { verificationGasLimit, callGasLimit: BigInt(result.result.callGasLimit), preVerificationGas };
  } catch {
    return { verificationGasLimit: MIN_VERIFICATION, callGasLimit: 500_000n, preVerificationGas: userOp.preVerificationGas * 4n };
  }
};

export const updateUserOpWithGasEstimates = (userOp: UserOperation, gas: GasEstimates): UserOperation => ({
  ...userOp,
  accountGasLimits: packUint128(gas.verificationGasLimit, gas.callGasLimit),
  preVerificationGas: gas.preVerificationGas,
});

export const getUserOpHash = (userOp: UserOperation, entryPointAddress: string, chainId: bigint): string => {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const packed = abi.encode(
    ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
    [
      userOp.sender,
      userOp.nonce,
      ethers.keccak256(userOp.initCode),
      ethers.keccak256(userOp.callData),
      userOp.accountGasLimits,
      userOp.preVerificationGas,
      userOp.gasFees,
      ethers.keccak256(userOp.paymasterAndData),
    ]
  );
  return ethers.keccak256(abi.encode(["bytes32", "address", "uint256"], [ethers.keccak256(packed), entryPointAddress, chainId]));
};

export const signUserOpHybrid = async (
  userOp: UserOperation,
  entryPointAddress: string,
  chainId: bigint,
  preQuantumPrivateKey: string,
  postQuantumSecretKey: Uint8Array
): Promise<string> => {
  const hash = getUserOpHash(userOp, entryPointAddress, chainId);
  const preQuantumSig = new ethers.Wallet(preQuantumPrivateKey).signingKey.sign(hash).serialized;
  const postQuantumSig = ethers.hexlify(ml_dsa44.sign(postQuantumSecretKey, ethers.getBytes(hash)));
  return ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [preQuantumSig, postQuantumSig]);
};

export const submitUserOperation = async (userOp: UserOperation, bundlerUrl: string): Promise<string> => {
  const response = await fetch(bundlerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendUserOperation", params: [userOpToBundlerFormat(userOp), ENTRY_POINT_ADDRESS] }),
  });
  const result = await response.json();
  if (result.error) throw new Error("Bundler error: " + (result.error.message || "Unknown"));
  return result.result;
};
`;
}

/** High-level ERC-4337 transaction sender with hybrid PQ signing. */
export function pqSendTransactionSource(): string {
  return `import { ml_dsa44 } from "@noble/post-quantum/ml-dsa";
import { BrowserProvider, ethers, isAddress } from "ethers";
import { hexToU8 } from "./hex.js";
import {
  createBaseUserOperation,
  ENTRY_POINT_ADDRESS,
  estimateUserOperationGas,
  getDummySignature,
  signUserOpHybrid,
  submitUserOperation,
  updateUserOpWithGasEstimates,
  UserOperation,
} from "./user-operation.js";

export type SendTransactionResult = {
  success: boolean;
  userOpHash?: string;
  userOp?: UserOperation;
  message?: string;
  error?: string;
};

export const sendERC4337Transaction = async (
  accountAddress: string,
  targetAddress: string,
  valueEth: string,
  callData: string,
  preQuantumSeed: string,
  postQuantumSeed: string,
  provider: BrowserProvider,
  bundlerUrl: string,
  log: (msg: string) => void
): Promise<SendTransactionResult> => {
  try {
    if (!isAddress(accountAddress)) throw new Error("Invalid account address: " + accountAddress);
    if (!isAddress(targetAddress)) throw new Error("Invalid recipient address: " + targetAddress);

    const network = await provider.getNetwork();
    const value = ethers.parseEther(valueEth);
    const accountBalance = await provider.getBalance(accountAddress);

    log("From: " + accountAddress);
    log("To: " + targetAddress);
    log("Value: " + valueEth + " ETH | Balance: " + ethers.formatEther(accountBalance) + " ETH");
    if (accountBalance === 0n) log("WARNING: Account has no balance!");

    const { secretKey } = ml_dsa44.keygen(hexToU8(postQuantumSeed, 32));

    let userOp = await createBaseUserOperation(accountAddress, targetAddress, value, callData, provider, bundlerUrl);

    if (!bundlerUrl || bundlerUrl.trim() === "") {
      userOp.signature = await signUserOpHybrid(userOp, ENTRY_POINT_ADDRESS, network.chainId, preQuantumSeed, secretKey);
      return { success: true, userOp, message: "UserOperation created and signed (no bundler URL — cannot submit)" };
    }

    // Use a dummy signature for gas estimation — bundler simulates the tx and needs a full-size sig.
    userOp.signature = getDummySignature();
    const gasEstimates = await estimateUserOperationGas(userOp, bundlerUrl);
    userOp = updateUserOpWithGasEstimates(userOp, gasEstimates);
    // Re-sign with the correct gas limits before submission.
    userOp.signature = await signUserOpHybrid(userOp, ENTRY_POINT_ADDRESS, network.chainId, preQuantumSeed, secretKey);

    try {
      log("Submitting to bundler...");
      const userOpHash = await submitUserOperation(userOp, bundlerUrl);
      log("Submitted! userOpHash: " + userOpHash);
      return { success: true, userOpHash };
    } catch (error) {
      log("Bundler submission failed: " + (error as Error).message);
      return { success: false, error: (error as Error).message, userOp };
    }
  } catch (e) {
    const error = e as { message: string };
    log("Error: " + error.message);
    return { success: false, error: error.message };
  }
};
`;
}

/**
 * Node.js deploy script (scripts/deploy-pq-account.mjs).
 * - Loads seeds + factory address from .env
 * - Computes pre/post-quantum public keys
 * - Calls factory.getAddress() to get the counterfactual smart account address
 * - Deploys via factory.createAccount() using the deployer wallet
 * - Writes PQ_ACCOUNT_ADDRESS back to .env
 */
export function deployPQAccountScriptSource(): string {
  return `#!/usr/bin/env node
/**
 * Deploy ZKNOX PQ ERC-4337 smart account.
 *
 * Supports both base accounts and agent accounts (with spending limits).
 * Set PQ_ACCOUNT_TYPE=agent in .env to deploy an agent account.
 *
 * Prerequisites:
 *   - Fund DEPLOYER_ADDRESS on the target network (PQ_NETWORK / PQ_CHAIN_ID)
 *   - .env must contain: DEPLOYER_PRIVATE_KEY, AGENT_PRIVATE_KEY, POST_QUANTUM_SEED,
 *     PQ_FACTORY_ADDRESS, PQ_NETWORK, PQ_CHAIN_ID, RPC_URL (or uses default RPC)
 *
 * Agent account extra vars (PQ_ACCOUNT_TYPE=agent):
 *   MAX_ETH_PER_TX   — max ETH per tx in wei (0 = unlimited, default 0)
 *   MAX_USDC_PER_TX  — max USDC per tx in 6-decimal units (0 = unlimited, default 0)
 *   USDC_ADDRESS     — USDC token contract address (default address(0))
 *
 * Run: node scripts/deploy-pq-account.mjs
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa";
import { shake128, shake256 } from "@noble/hashes/sha3";
import { genCrystals } from "@noble/post-quantum/_crystals";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_PATH = join(ROOT, ".env");

// ── NTT setup (for ML-DSA-44 public key expansion) ───────────────────────────
const _N = 256, _Q = 8380417, _D = 13;
const { NTT } = genCrystals({
  N: _N, Q: _Q, F: 8347681, ROOT_OF_UNITY: 1753,
  newPoly: (n) => new Int32Array(n),
  isKyber: false, brvBits: 8,
});

// ── Load env ─────────────────────────────────────────────────────────────────
const deployerPrivKey  = process.env.DEPLOYER_PRIVATE_KEY;
const agentPrivKey     = process.env.AGENT_PRIVATE_KEY;
const postQuantumSeed  = process.env.POST_QUANTUM_SEED;
const factoryAddress   = process.env.PQ_FACTORY_ADDRESS;
const bundlerUrl       = process.env.BUNDLER_URL ?? "";
const pqNetwork        = process.env.PQ_NETWORK ?? "sepolia";
const chainId          = Number(process.env.PQ_CHAIN_ID ?? "11155111");
const rpcUrl           = process.env.RPC_URL ?? getRpcDefault(pqNetwork);
const accountType      = (process.env.PQ_ACCOUNT_TYPE ?? "base").toLowerCase();
const isAgent          = accountType === "agent";
const maxEthPerTx      = BigInt(process.env.MAX_ETH_PER_TX  ?? "0");
const maxUsdcPerTx     = BigInt(process.env.MAX_USDC_PER_TX ?? "0");
const usdcAddress      = process.env.USDC_ADDRESS ?? "0x0000000000000000000000000000000000000000";

function getRpcDefault(network) {
  const defaults = {
    sepolia:         "https://rpc.sepolia.org",
    arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc",
    baseSepolia:     "https://sepolia.base.org",
    base:            "https://mainnet.base.org",
    arcTestnet:      "https://rpc.testnet.arc.network",
  };
  return defaults[network] ?? "https://rpc.sepolia.org";
}

if (!deployerPrivKey) { console.error("Missing DEPLOYER_PRIVATE_KEY in .env"); process.exit(1); }
if (!agentPrivKey)    { console.error("Missing AGENT_PRIVATE_KEY in .env");    process.exit(1); }
if (!postQuantumSeed) { console.error("Missing POST_QUANTUM_SEED in .env");    process.exit(1); }
if (!factoryAddress)  { console.error("Missing PQ_FACTORY_ADDRESS in .env");   process.exit(1); }

// ── Key derivation ────────────────────────────────────────────────────────────
function hexToU8(hex, expectedBytes = 32) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length !== expectedBytes * 2) throw new Error("Invalid hex length");
  return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

function expandPQPublicKey(publicKey) {
  const RHO_BYTES = 32, K = 4, L = 4, T1_POLY_BYTES = 320, q = 8380417, N = 256;
  const rho = publicKey.slice(0, RHO_BYTES);
  const t1 = [];
  for (let i = 0; i < K; i++) {
    const offset = RHO_BYTES + i * T1_POLY_BYTES;
    const bytes = publicKey.slice(offset, offset + T1_POLY_BYTES);
    const poly = new Int32Array(N);
    let r = 0n;
    for (let j = 0; j < bytes.length; j++) r |= BigInt(bytes[j]) << BigInt(8 * j);
    const mask = (1 << 10) - 1;
    for (let j = 0; j < N; j++) poly[j] = Number((r >> BigInt(j * 10)) & BigInt(mask));
    t1.push(poly);
  }
  const tr = shake256(new Uint8Array(publicKey), { dkLen: 64 });
  t1.forEach(poly => { for (let i = 0; i < _N; i++) poly[i] <<= _D; NTT.encode(poly); });

  const A_hat = [];
  for (let i = 0; i < K; i++) {
    const row = [];
    for (let j = 0; j < L; j++) {
      const seed = new Uint8Array(rho.length + 2);
      seed.set(rho); seed[rho.length] = j; seed[rho.length + 1] = i;
      const xof = shake128.create(); xof.update(seed);
      const poly = new Int32Array(N); let idx = 0;
      while (idx < N) {
        const buf = new Uint8Array(3 * 64); xof.xofInto(buf);
        for (let k = 0; idx < N && k <= buf.length - 3; k += 3) {
          let t = buf[k] | (buf[k+1] << 8) | (buf[k+2] << 16);
          t &= 0x7fffff; if (t < q) poly[idx++] = t;
        }
      }
      row.push(poly);
    }
    A_hat.push(row);
  }

  function compactPoly(coeffs, m) {
    const a = Array.from(coeffs, x => BigInt(Math.floor(x)));
    const n = (a.length * m) / 256, b = new Array(n).fill(0n);
    for (let i = 0; i < a.length; i++) {
      b[Math.floor(i * m / 256)] |= a[i] << BigInt((i % (256 / m)) * m);
    }
    return b;
  }

  const A_str = A_hat.map(row => row.map(p => compactPoly(p, 32).map(v => v.toString())));
  const t1_str = [t1.map(p => compactPoly(p, 32).map(v => v.toString()))][0];

  const abi = ethers.AbiCoder.defaultAbiCoder();
  return abi.encode(
    ["bytes", "bytes", "bytes"],
    [abi.encode(["uint256[][][]"], [A_str]), tr, abi.encode(["uint256[][]"], [t1_str])]
  );
}

const preQuantumPubKey  = new ethers.Wallet(agentPrivKey).address;
const { publicKey } = ml_dsa44.keygen(hexToU8(postQuantumSeed, 32));
console.log("Expanding post-quantum public key (this takes a few seconds)...");
const postQuantumPubKey = expandPQPublicKey(publicKey);

// ── Connect ───────────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(rpcUrl, { chainId, name: pqNetwork });
const deployer = new ethers.Wallet(deployerPrivKey, provider);
const balance  = await provider.getBalance(deployer.address);

console.log("\\nNetwork:  " + pqNetwork + " (chainId " + chainId + ")");
console.log("RPC:      " + rpcUrl);
console.log("Deployer: " + deployer.address);
console.log("Balance:  " + ethers.formatEther(balance) + " ETH");

if (balance === 0n) {
  console.error("\\nDeployer has no balance. Fund " + deployer.address + " with testnet ETH first.");
  process.exit(1);
}

// ── Factory ABI (covers both base and agent accounts) ─────────────────────────
const FACTORY_ABI = [
  "function createAccount(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external returns (address)",
  "function getAddress(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external view returns (address payable)",
  "function createAgentAccount(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey, uint256 maxETHPerTransaction, uint256 maxUSDCPerTransaction, address usdc) external returns (address)",
  "function getAgentAddress(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey, uint256 maxETHPerTransaction, uint256 maxUSDCPerTransaction, address usdc) external view returns (address payable)",
];

const factoryCode = await provider.getCode(factoryAddress);
if (factoryCode === "0x") {
  console.error("No contract at factory address " + factoryAddress + " on " + pqNetwork);
  process.exit(1);
}

console.log("\\nAccount type: " + (isAgent ? "agent" : "base"));
if (isAgent) {
  console.log("  Max ETH/tx  : " + (maxEthPerTx === 0n ? "unlimited" : ethers.formatEther(maxEthPerTx) + " ETH"));
  console.log("  Max USDC/tx : " + (maxUsdcPerTx === 0n ? "unlimited" : (Number(maxUsdcPerTx) / 1e6).toFixed(6) + " USDC"));
  console.log("  USDC addr   : " + usdcAddress);
}

const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer);
const iface   = new ethers.Interface(FACTORY_ABI);

// Predict counterfactual address
let smartAccountAddress;
if (isAgent) {
  const callData = iface.encodeFunctionData("getAgentAddress", [preQuantumPubKey, postQuantumPubKey, maxEthPerTx, maxUsdcPerTx, usdcAddress]);
  const result   = await provider.call({ to: factoryAddress, data: callData });
  [smartAccountAddress] = iface.decodeFunctionResult("getAgentAddress", result);
} else {
  const callData = iface.encodeFunctionData("getAddress", [preQuantumPubKey, postQuantumPubKey]);
  const result   = await provider.call({ to: factoryAddress, data: callData });
  [smartAccountAddress] = iface.decodeFunctionResult("getAddress", result);
}

console.log("\\nSmart account address: " + smartAccountAddress);

const existing = await provider.getCode(smartAccountAddress);
if (existing !== "0x") {
  console.log("Account already deployed.");
  writeEnvVar("PQ_ACCOUNT_ADDRESS", smartAccountAddress);
  process.exit(0);
}

// ── Confirm ───────────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("\\nDeploy now? [y/N] ");
rl.close();
if (answer.trim().toLowerCase() !== "y") {
  console.log("Aborted.");
  process.exit(0);
}

// ── Deploy ────────────────────────────────────────────────────────────────────
let gas;
try {
  gas = isAgent
    ? await factory.createAgentAccount.estimateGas(preQuantumPubKey, postQuantumPubKey, maxEthPerTx, maxUsdcPerTx, usdcAddress)
    : await factory.createAccount.estimateGas(preQuantumPubKey, postQuantumPubKey);
} catch {
  gas = 5_000_000n;
}
const feeData = await provider.getFeeData();
const gasPrice = feeData.gasPrice ?? 0n;
console.log("Estimated gas: " + gas + " @ " + ethers.formatUnits(gasPrice, "gwei") + " gwei");

const tx = isAgent
  ? await factory.createAgentAccount(preQuantumPubKey, postQuantumPubKey, maxEthPerTx, maxUsdcPerTx, usdcAddress, { gasLimit: (gas * 120n) / 100n })
  : await factory.createAccount(preQuantumPubKey, postQuantumPubKey, { gasLimit: (gas * 120n) / 100n });
console.log("Tx: " + tx.hash);
console.log("Waiting for confirmation...");
const receipt = await tx.wait();

if (receipt.status === 0) {
  console.error("Transaction reverted.");
  process.exit(1);
}

console.log("\\nDeployed! Smart account: " + smartAccountAddress);
console.log("Gas used: " + receipt.gasUsed);
writeEnvVar("PQ_ACCOUNT_ADDRESS", smartAccountAddress);
console.log("Written PQ_ACCOUNT_ADDRESS to .env");

// ── Helpers ───────────────────────────────────────────────────────────────────
function writeEnvVar(key, value) {
  let content = "";
  try { content = readFileSync(ENV_PATH, "utf8"); } catch { /* new file */ }
  const re = new RegExp("^" + key + "=.*$", "m");
  if (re.test(content)) {
    content = content.replace(re, key + "=" + value);
  } else {
    content += (content.endsWith("\\n") ? "" : "\\n") + key + "=" + value + "\\n";
  }
  writeFileSync(ENV_PATH, content);
}
`;
}

/**
 * Deploy script variant for ARC testnet and Base Sepolia.
 *
 * Identical to deployPQAccountScriptSource() EXCEPT t1 is stored RAW (no pre-shift,
 * no NTT). The on-chain ZKNOX_dilithium verifier deployed on ARC / Base Sepolia
 * (V0_0_10 bytecode) applies the D-shift and NTT itself inside verifyInternal.
 *
 * The original Sepolia factory was deployed against an OLDER verifier bytecode that
 * expected t1 to be pre-shifted+NTT'd in the PKContract. Use the original
 * deploy-pq-account.mjs for Sepolia and this file for ARC / Base Sepolia.
 */
export function deployPQAccountArcScriptSource(): string {
  return deployPQAccountScriptSource().replace(
    "t1.forEach(poly => { for (let i = 0; i < _N; i++) poly[i] <<= _D; NTT.encode(poly); });",
    "// t1 stored RAW — the on-chain verifier (ARC/Base Sepolia) applies shift+NTT itself.\n" +
    "  // Do NOT pre-apply here; the older Sepolia verifier expected pre-transformed t1."
  );
}

/**
 * Node.js send-transaction script (scripts/send-pq-transaction.mjs).
 * Sends ETH from a deployed PQ smart account via ERC-4337 bundler.
 *
 * Usage:
 *   node scripts/send-pq-transaction.mjs <to> <amountEth> [calldata]
 *   node scripts/send-pq-transaction.mjs 0xRecipient 0.0001
 */
export function sendPQTransactionScriptSource(): string {
  return `#!/usr/bin/env node
/**
 * Send a transaction from a ZKNOX PQ ERC-4337 smart account.
 *
 * Prerequisites:
 *   - Account already deployed (run scripts/deploy-pq-account.mjs first)
 *   - .env must contain: AGENT_PRIVATE_KEY, POST_QUANTUM_SEED, PQ_ACCOUNT_ADDRESS,
 *     BUNDLER_URL, PQ_NETWORK, PQ_CHAIN_ID, RPC_URL (optional, defaults per network)
 *
 * Usage:
 *   node scripts/send-pq-transaction.mjs <to> <amountEth> [calldata]
 *   node scripts/with-secrets.mjs -- node scripts/send-pq-transaction.mjs 0xAbc... 0.0001
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa";
import { shake128, shake256 } from "@noble/hashes/sha3";
import { genCrystals } from "@noble/post-quantum/_crystals";

// ── NTT setup ────────────────────────────────────────────────────────────────
const _N = 256, _Q = 8380417, _D = 13;
const { NTT } = genCrystals({
  N: _N, Q: _Q, F: 8347681, ROOT_OF_UNITY: 1753,
  newPoly: (n) => new Int32Array(n),
  isKyber: false, brvBits: 8,
});

// ── Args ──────────────────────────────────────────────────────────────────────
const [,, toArg, amountArg, calldataArg] = process.argv;
if (!toArg || !amountArg) {
  console.error("Usage: node scripts/send-pq-transaction.mjs <to> <amountEth> [calldata]");
  console.error("  e.g. node scripts/send-pq-transaction.mjs 0xRecipient 0.0001");
  process.exit(1);
}
if (!ethers.isAddress(toArg)) { console.error("Invalid <to> address: " + toArg); process.exit(1); }

// ── Load env ──────────────────────────────────────────────────────────────────
const agentPrivKey    = process.env.AGENT_PRIVATE_KEY;
const postQuantumSeed = process.env.POST_QUANTUM_SEED;
const accountAddress  = process.env.PQ_ACCOUNT_ADDRESS;
const bundlerUrl      = process.env.BUNDLER_URL ?? "";
const pqNetwork       = process.env.PQ_NETWORK ?? "sepolia";
const chainId         = Number(process.env.PQ_CHAIN_ID ?? "11155111");
const rpcUrl          = process.env.RPC_URL ?? getRpcDefault(pqNetwork);

function getRpcDefault(network) {
  const m = { sepolia: "https://rpc.sepolia.org", arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc", baseSepolia: "https://sepolia.base.org", base: "https://mainnet.base.org", arcTestnet: "https://rpc.testnet.arc.network" };
  return m[network] ?? "https://rpc.sepolia.org";
}

if (!agentPrivKey)    { console.error("Missing AGENT_PRIVATE_KEY in .env");    process.exit(1); }
if (!postQuantumSeed) { console.error("Missing POST_QUANTUM_SEED in .env");    process.exit(1); }
if (!accountAddress)  { console.error("Missing PQ_ACCOUNT_ADDRESS in .env — deploy the account first"); process.exit(1); }
if (!bundlerUrl)      { console.error("Missing BUNDLER_URL in .env");           process.exit(1); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function hexToU8(hex, expectedBytes = 32) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length !== expectedBytes * 2) throw new Error("Invalid hex length for " + hex.slice(0, 10) + "...");
  return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

function packUint128(a, b) {
  return ethers.solidityPacked(["uint128", "uint128"], [a, b]);
}

function unpackUint128(packed) {
  const bytes = ethers.getBytes(packed);
  const first  = BigInt("0x" + ethers.hexlify(bytes.slice(0, 16)).slice(2));
  const second = BigInt("0x" + ethers.hexlify(bytes.slice(16, 32)).slice(2));
  return [first, second];
}

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const ACCOUNT_ABI = [
  "function execute(address dest, uint256 value, bytes calldata func) external",
  "function getNonce() external view returns (uint256)",
];

function getUserOpHash(userOp, entryPoint, cid) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const packed = abi.encode(
    ["address","uint256","bytes32","bytes32","bytes32","uint256","bytes32","bytes32"],
    [userOp.sender, userOp.nonce, ethers.keccak256(userOp.initCode), ethers.keccak256(userOp.callData),
     userOp.accountGasLimits, userOp.preVerificationGas, userOp.gasFees, ethers.keccak256(userOp.paymasterAndData)]
  );
  return ethers.keccak256(abi.encode(["bytes32","address","uint256"], [ethers.keccak256(packed), entryPoint, cid]));
}

function userOpToBundlerFormat(userOp) {
  const [verificationGasLimit, callGasLimit] = unpackUint128(userOp.accountGasLimits);
  const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint128(userOp.gasFees);
  return {
    sender: userOp.sender,
    nonce:  "0x" + BigInt(userOp.nonce).toString(16),
    callData: userOp.callData,
    verificationGasLimit: "0x" + verificationGasLimit.toString(16),
    callGasLimit:         "0x" + callGasLimit.toString(16),
    preVerificationGas:   "0x" + BigInt(userOp.preVerificationGas).toString(16),
    maxFeePerGas:         "0x" + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + maxPriorityFeePerGas.toString(16),
    signature: userOp.signature,
  };
}

async function bundlerRpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(method + " error: " + (json.error.message ?? JSON.stringify(json.error)));
  return json.result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(rpcUrl, { chainId, name: pqNetwork });
const network  = await provider.getNetwork();
const value    = ethers.parseEther(amountArg);
const calldata = calldataArg ?? "0x";

console.log("\\nNetwork:  " + pqNetwork + " (chainId " + chainId + ")");
console.log("Account:  " + accountAddress);
console.log("To:       " + toArg);
console.log("Value:    " + amountArg + " ETH");
console.log("Bundler:  " + bundlerUrl);

const accountBalance = await provider.getBalance(accountAddress);
console.log("Balance:  " + ethers.formatEther(accountBalance) + " ETH");

if (accountBalance < value) {
  console.error("\\nInsufficient balance. Fund " + accountAddress + " first.");
  process.exit(1);
}

// ── Build UserOp ──────────────────────────────────────────────────────────────
const account = new ethers.Contract(accountAddress, ACCOUNT_ABI, provider);
let nonce;
try { nonce = await account.getNonce(); } catch { nonce = 0n; }

const executeCallData = account.interface.encodeFunctionData("execute", [toArg, value, calldata]);

let maxPriority, maxFee;
try {
  const gp = await bundlerRpc(bundlerUrl, "pimlico_getUserOperationGasPrice", []);
  maxFee      = BigInt(gp.standard.maxFeePerGas);
  maxPriority = BigInt(gp.standard.maxPriorityFeePerGas);
} catch {
  maxPriority = ethers.parseUnits("0.1", "gwei");
  maxFee      = ethers.parseUnits("0.2", "gwei");
}

let userOp = {
  sender: accountAddress,
  nonce,
  initCode: "0x",
  callData: executeCallData,
  accountGasLimits: packUint128(13_500_000n, 500_000n),
  preVerificationGas: 1_000_000n,
  gasFees: packUint128(maxPriority, maxFee),
  paymasterAndData: "0x",
  signature: "0x",
};

// ── Dummy sig for gas estimation ──────────────────────────────────────────────
const dummySig = ethers.AbiCoder.defaultAbiCoder().encode(
  ["bytes", "bytes"], [new Uint8Array(65).fill(0xff), new Uint8Array(2420).fill(0xff)]
);
userOp.signature = dummySig;

console.log("\\nEstimating gas...");
const est = await bundlerRpc(bundlerUrl, "eth_estimateUserOperationGas", [userOpToBundlerFormat(userOp), ENTRY_POINT]);
const MIN_VERIFICATION = 13_500_000n;
let verificationGasLimit = BigInt(est.verificationGasLimit);
if (verificationGasLimit < MIN_VERIFICATION) verificationGasLimit = MIN_VERIFICATION;
const callGasLimit       = BigInt(est.callGasLimit);
const preVerificationGas = BigInt(est.preVerificationGas || userOp.preVerificationGas) * 4n;

userOp.accountGasLimits  = packUint128(verificationGasLimit, callGasLimit);
userOp.preVerificationGas = preVerificationGas;
console.log("- verificationGasLimit: " + verificationGasLimit);
console.log("- callGasLimit:         " + callGasLimit);
console.log("- preVerificationGas:   " + preVerificationGas);

// ── Sign ──────────────────────────────────────────────────────────────────────
const hash = getUserOpHash(userOp, ENTRY_POINT, network.chainId);
const hashBytes = ethers.getBytes(hash);

const ecdsaSig = new ethers.Wallet(agentPrivKey).signingKey.sign(hash).serialized;
const { secretKey } = ml_dsa44.keygen(hexToU8(postQuantumSeed, 32));
const mldsaSig = ethers.hexlify(ml_dsa44.sign(secretKey, hashBytes));

userOp.signature = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [ecdsaSig, mldsaSig]);
console.log("\\nHybrid signature generated (ECDSA + ML-DSA-44)");

// ── Submit ────────────────────────────────────────────────────────────────────
console.log("Submitting UserOp to bundler...");
const userOpHash = await bundlerRpc(bundlerUrl, "eth_sendUserOperation", [userOpToBundlerFormat(userOp), ENTRY_POINT]);
console.log("\\nSubmitted! userOpHash: " + userOpHash);
console.log("Waiting for receipt...");

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  try {
    const receipt = await bundlerRpc(bundlerUrl, "eth_getUserOperationReceipt", [userOpHash]);
    if (receipt) {
      console.log("\\nMined!");
      if (receipt.receipt?.transactionHash) console.log("Tx: " + receipt.receipt.transactionHash);
      if (receipt.success === false)        console.log("WARNING: UserOp execution reverted on-chain");
      process.exit(0);
    }
  } catch { /* keep polling */ }
  await new Promise(r => setTimeout(r, 3000));
}
console.log("Timed out waiting for receipt. The UserOp may still be pending.");
`;
}

/**
 * Script that registers the agent wallet with World AgentBook so it can be
 * identified as human-backed by the @worldcoin/agentkit verification flow.
 *
 * Usage: just register-world   (or: node scripts/register-world-agent.mjs)
 * Requires World App on your phone to complete the human verification QR flow.
 */
export function registerWorldAgentScriptSource(): string {
  return `#!/usr/bin/env node
/**
 * Register agent wallet with World AgentBook.
 *
 * This links your agent's on-chain address to a verified human identity
 * via World App. Once registered, any service using @worldcoin/agentkit
 * can confirm your agent is human-backed.
 *
 * Prerequisites:
 *   - World App installed on your phone
 *   - AGENT_ADDRESS set in .env (the wallet your agent signs with)
 *
 * Run:
 *   node scripts/register-world-agent.mjs
 *   # or via justfile:
 *   just register-world
 */
import "dotenv/config";
import { execSync } from "node:child_process";

const agentAddress = process.env.AGENT_ADDRESS;

if (!agentAddress) {
  console.error("Error: AGENT_ADDRESS is not set in .env");
  process.exit(1);
}

console.log("\\n╔═══════════════════════════════════════════════════╗");
console.log("║   World AgentBook Registration                    ║");
console.log("╚═══════════════════════════════════════════════════╝");
console.log("\\nAgent address : " + agentAddress);
console.log("\\nThis will open a QR code. Scan it with World App to");
console.log("prove you are human. Your identity is NOT revealed.");
console.log("\\nRegistration is on World Chain (mainnet).");
console.log("\\nStarting registration...\\n");

try {
  execSync(
    "npx --yes @worldcoin/agentkit-cli register " + agentAddress,
    { stdio: "inherit" }
  );
  console.log("\\n✓ Agent registered in World AgentBook!");
  console.log("  Your agent is now verifiable as human-backed across");
  console.log("  World Chain, Base, and Base Sepolia AgentBook deployments.");
} catch (err) {
  console.error("\\nRegistration failed. Make sure you have internet access");
  console.error("and World App is installed on your phone.");
  process.exit(1);
}
`;
}

/**
 * Ledger APDU transport for ECDSA + ML-DSA hybrid signing.
 * Node.js CLI version — uses hw-transport-node-hid instead of WebHID.
 */
export function ledgerTransportSource(): string {
  return `/**
 * Ledger APDU transport — Node.js CLI version.
 *
 * Firmware commands used:
 *   GET_PUBLIC_KEY      (0x05) — ECDSA public key
 *   ECDSA_SIGN_HASH     (0x15) — blind ECDSA hash sign
 *   GET_MLDSA_SEED      (0x14) — derive ML-DSA seed on secure element
 *   KEYGEN_DILITHIUM    (0x0c) — generate keypair from seed
 *   SIGN_DILITHIUM      (0x0f) — init / absorb / finalize signing
 *   GET_SIG_CHUNK       (0x12) — retrieve signature chunks
 *   GET_PK_CHUNK        (0x13) — retrieve public key chunks
 *   HYBRID_SIGN_USEROP  (0x17) — clear-sign ERC-4337 UserOp
 *
 * Requires the ZKNOX PQ Ledger app on the device.
 */
import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";
import { ethers } from "ethers";

const CLA = 0xe0;
const INS = {
  GET_PUBLIC_KEY:     0x05,
  ECDSA_SIGN_HASH:    0x15,
  GET_MLDSA_SEED:     0x14,
  KEYGEN_DILITHIUM:   0x0c,
  SIGN_DILITHIUM:     0x0f,
  GET_SIG_CHUNK:      0x12,
  GET_PK_CHUNK:       0x13,
  HYBRID_SIGN_USEROP: 0x17,
};

export const MLDSA44_SIG_BYTES = 2420;
export const MLDSA44_PK_BYTES  = 1312;
const CHUNK_SIZE = 255;

function encodeBip32Path(path) {
  const components = path.replace("m/", "").split("/").map(c => {
    const hardened = c.endsWith("'");
    const val = parseInt(hardened ? c.slice(0, -1) : c, 10);
    return hardened ? (val + 0x80000000) >>> 0 : val;
  });
  const buf = Buffer.alloc(1 + components.length * 4);
  buf[0] = components.length;
  components.forEach((c, i) => buf.writeUInt32BE(c, 1 + i * 4));
  return buf;
}

async function sendApdu(transport, ins, p1, p2, data) {
  const payload  = data ? Buffer.from(data) : Buffer.alloc(0);
  const response = await transport.send(CLA, ins, p1, p2, payload);
  return response.subarray(0, response.length - 2);
}

async function readChunked(transport, ins, totalBytes) {
  const buf = Buffer.alloc(totalBytes);
  for (let p1 = 0; p1 * CHUNK_SIZE < totalBytes; p1++) {
    const offset    = p1 * CHUNK_SIZE;
    const remaining = totalBytes - offset;
    const p2        = Math.min(remaining, CHUNK_SIZE);
    const chunk     = await sendApdu(transport, ins, p1, p2, null);
    chunk.copy(buf, offset, 0, p2);
  }
  return new Uint8Array(buf);
}

function bigintTo32BE(val) {
  const hex = BigInt(val).toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function addressToBytes(addr) {
  return Buffer.from(addr.replace(/^0x/, ""), "hex");
}

function parseEcdsaResponse(resp) {
  const derLen = resp[0];
  const der    = resp.subarray(1, 1 + derLen);
  const v      = resp[1 + derLen];
  let offset = 2;
  offset++;
  const rLen = der[offset++];
  const rRaw = der.subarray(offset, offset + rLen); offset += rLen;
  offset++;
  const sLen = der[offset++];
  const sRaw = der.subarray(offset, offset + sLen);
  const r = new Uint8Array(32);
  const s = new Uint8Array(32);
  r.set(rRaw.subarray(rRaw.length - 32));
  s.set(sRaw.subarray(sRaw.length - 32));
  return { v, r, s };
}

export async function openTransport() {
  return TransportNodeHid.default
    ? TransportNodeHid.default.open()
    : TransportNodeHid.open();
}

export async function getEcdsaPublicKey(transport, bip32Path) {
  const pathData = encodeBip32Path(bip32Path);
  return new Uint8Array(await sendApdu(transport, INS.GET_PUBLIC_KEY, 0x00, 0x00, pathData));
}

export async function signEcdsaHash(transport, bip32Path, hash) {
  if (hash.length !== 32) throw new Error("Hash must be 32 bytes");
  const pathData = encodeBip32Path(bip32Path);
  const payload  = Buffer.concat([pathData, Buffer.from(hash)]);
  const resp     = await sendApdu(transport, INS.ECDSA_SIGN_HASH, 0x00, 0x00, payload);
  return parseEcdsaResponse(resp);
}

export async function deriveMldsaSeed(transport, bip32Path) {
  const pathData = encodeBip32Path(bip32Path);
  const seed = await sendApdu(transport, INS.GET_MLDSA_SEED, 0x00, 0x00, pathData);
  return new Uint8Array(seed);
}

export async function getMldsaPublicKey(transport) {
  await sendApdu(transport, INS.KEYGEN_DILITHIUM, 0x00, 0x00, null);
  return readChunked(transport, INS.GET_PK_CHUNK, MLDSA44_PK_BYTES);
}

export async function signMldsa(transport, messageBytes) {
  await sendApdu(transport, INS.SIGN_DILITHIUM, 0x00, 0x00, null);
  const MAX_APDU_DATA = 250;
  for (let offset = 0; offset < messageBytes.length; offset += MAX_APDU_DATA) {
    const chunk = messageBytes.slice(offset, Math.min(offset + MAX_APDU_DATA, messageBytes.length));
    await sendApdu(transport, INS.SIGN_DILITHIUM, 0x01, 0x00, chunk);
  }
  const msgLenBuf = Buffer.alloc(2);
  msgLenBuf.writeUInt16BE(messageBytes.length, 0);
  await sendApdu(transport, INS.SIGN_DILITHIUM, 0x80, 0x00, msgLenBuf);
  return readChunked(transport, INS.GET_SIG_CHUNK, MLDSA44_SIG_BYTES);
}

/**
 * Clear-sign a full ERC-4337 v0.7 UserOp.
 * The device recomputes the UserOpHash on-chip and shows human-readable
 * fields on its screen before asking the user to confirm.
 */
export async function signHybridUserOp(transport, bip32Path, userOp, entryPoint, chainId) {
  const I = INS.HYBRID_SIGN_USEROP;
  await sendApdu(transport, I, 0x00, 0x00, encodeBip32Path(bip32Path));
  await sendApdu(transport, I, 0x01, 0x00, Buffer.concat([
    bigintTo32BE(chainId),
    addressToBytes(entryPoint),
    addressToBytes(userOp.sender),
    bigintTo32BE(userOp.nonce),
  ]));
  await sendApdu(transport, I, 0x02, 0x00, Buffer.concat([
    ethers.getBytes(ethers.keccak256(userOp.initCode)),
    ethers.getBytes(ethers.keccak256(userOp.callData)),
    ethers.getBytes(userOp.accountGasLimits),
    bigintTo32BE(userOp.preVerificationGas),
    ethers.getBytes(userOp.gasFees),
    ethers.getBytes(ethers.keccak256(userOp.paymasterAndData)),
  ]));
  const rawCallData = ethers.getBytes(userOp.callData);
  const callDataPayload = rawCallData.length <= CHUNK_SIZE
    ? Buffer.from(rawCallData)
    : Buffer.alloc(0);
  const resp = await sendApdu(transport, I, 0x03, 0x00, callDataPayload);
  const { v, r, s }   = parseEcdsaResponse(resp);
  const mldsaSignature = await readChunked(transport, INS.GET_SIG_CHUNK, MLDSA44_SIG_BYTES);
  return { ecdsaV: v, ecdsaR: r, ecdsaS: s, mldsaSignature };
}
`;
}

/**
 * CLI script: send a UserOp via Ledger hardware wallet.
 * Shows human-friendly tx details in terminal, then clear-signs on device.
 */
export function sendPQTransactionLedgerScriptSource(): string {
  return `#!/usr/bin/env node
/**
 * Send a PQ ERC-4337 transaction signed by a Ledger hardware wallet.
 *
 * Flow:
 *   1. Decode and display transaction details in human-friendly format
 *   2. Estimate gas (dummy signature)
 *   3. Connect Ledger (ZKNOX PQ app must be open on device)
 *   4. Clear-sign on device — both ECDSA + ML-DSA-44 in one confirmation
 *   5. Submit UserOp to bundler
 *
 * Prerequisites:
 *   - ZKNOX PQ Ledger app installed and open on your device
 *   - PQ_ACCOUNT_ADDRESS and BUNDLER_URL set in .env
 *
 * Usage:
 *   node scripts/send-pq-transaction-ledger.mjs <to> <amountEth> [calldata]
 *   just send-tx-ledger TO=0xRecipient VALUE=0.01
 */
import "dotenv/config";
import { ethers } from "ethers";
import {
  openTransport,
  signHybridUserOp,
  signEcdsaHash,
  deriveMldsaSeed,
  signMldsa,
  MLDSA44_SIG_BYTES,
} from "./ledger-transport.mjs";

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const BIP32_PATH  = "m/44'/60'/0'/0/0";

// ── Args ──────────────────────────────────────────────────────────────────────
const [,, toArg, amountArg, calldataArg] = process.argv;
if (!toArg || !amountArg) {
  console.error("Usage: node scripts/send-pq-transaction-ledger.mjs <to> <amountEth> [calldata]");
  process.exit(1);
}
if (!ethers.isAddress(toArg)) { console.error("Invalid <to> address: " + toArg); process.exit(1); }

// ── Env ───────────────────────────────────────────────────────────────────────
const accountAddress = process.env.PQ_ACCOUNT_ADDRESS;
const bundlerUrl     = process.env.BUNDLER_URL ?? "";
const pqNetwork      = process.env.PQ_NETWORK ?? "sepolia";
const chainId        = Number(process.env.PQ_CHAIN_ID ?? "11155111");
const rpcUrl         = process.env.RPC_URL ?? getRpcDefault(pqNetwork);

function getRpcDefault(network) {
  const m = {
    sepolia:         "https://rpc.sepolia.org",
    arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc",
    baseSepolia:     "https://sepolia.base.org",
    base:            "https://mainnet.base.org",
    arcTestnet:      "https://rpc.testnet.arc.network",
  };
  return m[network] ?? "https://rpc.sepolia.org";
}

if (!accountAddress) { console.error("Missing PQ_ACCOUNT_ADDRESS in .env"); process.exit(1); }
if (!bundlerUrl)     { console.error("Missing BUNDLER_URL in .env");          process.exit(1); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function packUint128(a, b) {
  return ethers.solidityPacked(["uint128", "uint128"], [a, b]);
}

function unpackUint128(packed) {
  const bytes = ethers.getBytes(packed);
  const first  = BigInt("0x" + ethers.hexlify(bytes.slice(0, 16)).slice(2));
  const second = BigInt("0x" + ethers.hexlify(bytes.slice(16, 32)).slice(2));
  return [first, second];
}

function getUserOpHash(userOp, entryPoint, cid) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const packed = abi.encode(
    ["address","uint256","bytes32","bytes32","bytes32","uint256","bytes32","bytes32"],
    [userOp.sender, userOp.nonce,
     ethers.keccak256(userOp.initCode), ethers.keccak256(userOp.callData),
     userOp.accountGasLimits, userOp.preVerificationGas,
     userOp.gasFees, ethers.keccak256(userOp.paymasterAndData)]
  );
  return ethers.keccak256(abi.encode(
    ["bytes32","address","uint256"],
    [ethers.keccak256(packed), entryPoint, cid]
  ));
}

function userOpToBundlerFormat(userOp) {
  const [verificationGasLimit, callGasLimit] = unpackUint128(userOp.accountGasLimits);
  const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint128(userOp.gasFees);
  return {
    sender: userOp.sender,
    nonce:  "0x" + BigInt(userOp.nonce).toString(16),
    callData: userOp.callData,
    verificationGasLimit: "0x" + verificationGasLimit.toString(16),
    callGasLimit:         "0x" + callGasLimit.toString(16),
    preVerificationGas:   "0x" + BigInt(userOp.preVerificationGas).toString(16),
    maxFeePerGas:         "0x" + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: "0x" + maxPriorityFeePerGas.toString(16),
    signature: userOp.signature,
  };
}

async function bundlerRpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(method + " failed: " + (json.error.message ?? JSON.stringify(json.error)));
  return json.result;
}

/** Decode calldata to a human-readable summary. */
function decodeCalldata(data, toAddress) {
  if (!data || data === "0x" || data === "") return "  (no calldata — plain ETH transfer)";
  const selector = data.slice(0, 10).toLowerCase();
  const knownSelectors = {
    "0xa9059cbb": "ERC-20 transfer(address to, uint256 amount)",
    "0x095ea7b3": "ERC-20 approve(address spender, uint256 amount)",
    "0x23b872dd": "ERC-20 transferFrom(address from, address to, uint256 amount)",
    "0x40c10f19": "ERC-20 mint(address to, uint256 amount)",
    "0x70a08231": "ERC-20 balanceOf(address account)",
    "0x18160ddd": "ERC-20 totalSupply()",
    "0xd0e30db0": "WETH deposit()",
    "0x2e1a7d4d": "WETH withdraw(uint256 wad)",
  };
  const name = knownSelectors[selector] ?? ("Unknown function selector: " + selector);
  return "  Function : " + name + "\\n  Raw data : " + data.slice(0, 66) + (data.length > 66 ? "..." : "");
}

// ── Main ──────────────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(rpcUrl, { chainId, name: pqNetwork });
const network  = await provider.getNetwork();
const value    = ethers.parseEther(amountArg);
const calldata = calldataArg ?? "0x";

const accountBalance = await provider.getBalance(accountAddress);
const [maxPriority, maxFee] = await (async () => {
  try {
    const gp = await bundlerRpc(bundlerUrl, "pimlico_getUserOperationGasPrice", []);
    return [BigInt(gp.standard.maxPriorityFeePerGas), BigInt(gp.standard.maxFeePerGas)];
  } catch {
    return [ethers.parseUnits("0.1", "gwei"), ethers.parseUnits("0.2", "gwei")];
  }
})();

const ACCOUNT_ABI = [
  "function execute(address dest, uint256 value, bytes calldata func) external",
  "function getNonce() external view returns (uint256)",
];
const account = new ethers.Contract(accountAddress, ACCOUNT_ABI, provider);
let nonce;
try { nonce = await account.getNonce(); } catch { nonce = 0n; }
const executeCallData = account.interface.encodeFunctionData("execute", [toArg, value, calldata]);

// ── Display transaction details ───────────────────────────────────────────────
const estimatedGasCost = maxFee * 14_000_000n;
console.log("\\n╔══════════════════════════════════════════════════════════════╗");
console.log("║           PQ Transaction — Ledger Signing                   ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log("\\n  Network  : " + pqNetwork + " (chainId " + chainId + ")");
console.log("  From     : " + accountAddress + " (smart account)");
console.log("  To       : " + toArg);
console.log("  Value    : " + amountArg + " ETH");
console.log("  Balance  : " + ethers.formatEther(accountBalance) + " ETH");
console.log("  Nonce    : " + nonce.toString());
console.log("  Est. fee : ~" + ethers.formatEther(estimatedGasCost) + " ETH (gas)");
console.log("\\n  Call data:");
console.log(decodeCalldata(calldata, toArg));
console.log("\\n  Signature: ECDSA + ML-DSA-44 (hybrid PQ)");
console.log("  Bundler  : " + bundlerUrl.replace(/apikey=[^&]+/, "apikey=***"));

if (accountBalance < value) {
  console.error("\\n✗ Insufficient balance.");
  process.exit(1);
}

// ── Build UserOp for gas estimation ──────────────────────────────────────────
let userOp = {
  sender: accountAddress,
  nonce,
  initCode: "0x",
  callData: executeCallData,
  accountGasLimits: packUint128(13_500_000n, 500_000n),
  preVerificationGas: 1_000_000n,
  gasFees: packUint128(maxPriority, maxFee),
  paymasterAndData: "0x",
  signature: ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "bytes"],
    [new Uint8Array(65).fill(0xff), new Uint8Array(MLDSA44_SIG_BYTES).fill(0xff)]
  ),
};

console.log("\\n  Estimating gas...");
const est = await bundlerRpc(bundlerUrl, "eth_estimateUserOperationGas", [userOpToBundlerFormat(userOp), ENTRY_POINT]);
const MIN_VGL = 13_500_000n;
const verificationGasLimit = BigInt(est.verificationGasLimit) < MIN_VGL ? MIN_VGL : BigInt(est.verificationGasLimit);
const callGasLimit         = BigInt(est.callGasLimit);
const preVerificationGas   = BigInt(est.preVerificationGas || userOp.preVerificationGas) * 4n;
userOp.accountGasLimits  = packUint128(verificationGasLimit, callGasLimit);
userOp.preVerificationGas = preVerificationGas;
console.log("  Gas OK   : verif=" + verificationGasLimit + " call=" + callGasLimit);

// ── Connect Ledger ────────────────────────────────────────────────────────────
console.log("\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Connect your Ledger, unlock it, and open the ZKNOX PQ app.");
console.log("  The device will display transaction details for confirmation.");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("\\n  Waiting for Ledger...");

let transport;
try {
  transport = await openTransport();
  console.log("  ✓ Ledger connected");
} catch (err) {
  console.error("\\n✗ Could not connect to Ledger: " + err.message);
  console.error("  Make sure the device is plugged in, unlocked, and the ZKNOX PQ app is open.");
  process.exit(1);
}

// ── Sign on device ────────────────────────────────────────────────────────────
let ecdsaSig, mldsaSig;
try {
  console.log("  Sending to device for review and signing...");
  const result = await signHybridUserOp(
    transport,
    BIP32_PATH,
    userOp,
    ENTRY_POINT,
    network.chainId
  );
  ecdsaSig = ethers.hexlify(ethers.concat([result.ecdsaR, result.ecdsaS, ethers.toBeHex(result.ecdsaV + 27, 1)]));
  mldsaSig = ethers.hexlify(result.mldsaSignature);
  console.log("  ✓ Signed on Ledger (ECDSA + ML-DSA-44)");
} catch (err) {
  console.error("\\n✗ Ledger signing failed: " + err.message);
  if (err.message.includes("0x6e00") || err.message.includes("INS_NOT_SUPPORTED")) {
    console.error("  The ZKNOX PQ app may not be installed. Make sure you have the correct app open.");
  }
  if (err.message.includes("0x6985") || err.message.includes("Conditions")) {
    console.error("  User rejected the transaction on device.");
  }
  try { await transport.close(); } catch (_) {}
  process.exit(1);
} finally {
  try { await transport.close(); } catch (_) {}
}

userOp.signature = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [ecdsaSig, mldsaSig]);

// ── Submit ────────────────────────────────────────────────────────────────────
console.log("\\n  Submitting UserOp to bundler...");
const userOpHash = await bundlerRpc(bundlerUrl, "eth_sendUserOperation", [userOpToBundlerFormat(userOp), ENTRY_POINT]);
console.log("  ✓ Submitted — userOpHash: " + userOpHash);
console.log("  Waiting for receipt...");

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  try {
    const receipt = await bundlerRpc(bundlerUrl, "eth_getUserOperationReceipt", [userOpHash]);
    if (receipt) {
      console.log("\\n✓ Transaction mined!");
      if (receipt.receipt?.transactionHash) console.log("  Tx: " + receipt.receipt.transactionHash);
      if (receipt.success === false) console.log("  WARNING: UserOp execution reverted on-chain");
      process.exit(0);
    }
  } catch { /* keep polling */ }
  await new Promise(r => setTimeout(r, 3000));
}
console.log("  Timed out — the UserOp may still be pending.");
`;
}

/** Reads PQ config from environment variables — framework-specific. */
export function pqConfigSource(framework: PQAppFramework): string {
  const factoryVar =
    framework === "nextjs"
      ? 'process.env.NEXT_PUBLIC_PQ_FACTORY_ADDRESS ?? ""'
      : 'import.meta.env.VITE_PQ_FACTORY_ADDRESS ?? ""';
  const bundlerVar =
    framework === "nextjs"
      ? 'process.env.NEXT_PUBLIC_BUNDLER_URL ?? ""'
      : 'import.meta.env.VITE_BUNDLER_URL ?? ""';

  return `/**
 * Post-quantum account configuration read from environment variables.
 *
 * Set in .env (repo root):
 *   ${framework === "nextjs" ? "NEXT_PUBLIC_PQ_FACTORY_ADDRESS" : "VITE_PQ_FACTORY_ADDRESS"} = 0x...   (ZKNOX factory)
 *   ${framework === "nextjs" ? "NEXT_PUBLIC_BUNDLER_URL" : "VITE_BUNDLER_URL"} = https://...            (ERC-4337 bundler)
 *
 * POST_QUANTUM_SEED and AGENT_PRIVATE_KEY (PRE_QUANTUM_SEED) are secrets —
 * never expose them to the browser. Pass them only from server-side code or scripts.
 */
export const PQ_FACTORY_ADDRESS: string = ${factoryVar};
export const BUNDLER_URL: string = ${bundlerVar};

/** Standard ERC-4337 EntryPoint v0.7 (all networks). */
export const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
`;
}
