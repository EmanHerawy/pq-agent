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
  return `import { shake128, shake256 } from "@noble/hashes/sha3.js";

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
  const A_hat = recoverAhat(rho, 4, 4);
  const A_hat_compact = compact_module_256(A_hat, 32);
  const A_hat_stringified = A_hat_compact.map((row) =>
    row.map((col) => col.map((val) => val.toString()))
  );
  const [t1_compact] = compact_module_256([t1], 32);
  const t1_stringified = t1_compact.map((row) => row.map((val) => val.toString()));

  const { AbiCoder } = await import("ethers");
  const abiCoder = AbiCoder.defaultAbiCoder();
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
  return `import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
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
  return `import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
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
    return { verificationGasLimit, callGasLimit: BigInt(result.result.callGasLimit), preVerificationGas: BigInt(result.result.preVerificationGas || userOp.preVerificationGas) };
  } catch {
    return { verificationGasLimit: MIN_VERIFICATION, callGasLimit: 500_000n, preVerificationGas: userOp.preVerificationGas };
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
  const postQuantumSig = ethers.hexlify(ml_dsa44.sign(ethers.getBytes(hash), postQuantumSecretKey));
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
  return `import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { BrowserProvider, ethers, isAddress } from "ethers";
import { hexToU8 } from "./hex.js";
import {
  createBaseUserOperation,
  ENTRY_POINT_ADDRESS,
  estimateUserOperationGas,
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

    userOp.signature = await signUserOpHybrid(userOp, ENTRY_POINT_ADDRESS, network.chainId, preQuantumSeed, secretKey);

    if (!bundlerUrl || bundlerUrl.trim() === "") {
      return { success: true, userOp, message: "UserOperation created and signed (no bundler URL — cannot submit)" };
    }

    const gasEstimates = await estimateUserOperationGas(userOp, bundlerUrl);
    userOp = updateUserOpWithGasEstimates(userOp, gasEstimates);
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
 * Prerequisites:
 *   - Fund DEPLOYER_ADDRESS on the target network (PQ_NETWORK / PQ_CHAIN_ID)
 *   - .env must contain: DEPLOYER_PRIVATE_KEY, AGENT_PRIVATE_KEY, POST_QUANTUM_SEED,
 *     PQ_FACTORY_ADDRESS, PQ_NETWORK, PQ_CHAIN_ID, RPC_URL (or uses default RPC)
 *
 * Run: node scripts/deploy-pq-account.mjs
 */
import "dotenv/config";
import { ethers } from "ethers";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { shake128, shake256 } from "@noble/hashes/sha3.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_PATH = join(ROOT, ".env");

// ── Load env ─────────────────────────────────────────────────────────────────
const deployerPrivKey = process.env.DEPLOYER_PRIVATE_KEY;
const agentPrivKey    = process.env.AGENT_PRIVATE_KEY;
const postQuantumSeed = process.env.POST_QUANTUM_SEED;
const factoryAddress  = process.env.PQ_FACTORY_ADDRESS;
const bundlerUrl      = process.env.BUNDLER_URL ?? "";
const pqNetwork       = process.env.PQ_NETWORK ?? "sepolia";
const chainId         = Number(process.env.PQ_CHAIN_ID ?? "11155111");
const rpcUrl          = process.env.RPC_URL ?? getRpcDefault(pqNetwork);

function getRpcDefault(network) {
  const defaults = {
    sepolia:         "https://rpc.sepolia.org",
    arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc",
    baseSepolia:     "https://sepolia.base.org",
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

// ── Compute counterfactual address ────────────────────────────────────────────
const FACTORY_ABI = [
  "function createAccount(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external returns (address)",
  "function getAddress(bytes calldata preQuantumPubKey, bytes calldata postQuantumPubKey) external view returns (address payable)",
];

const factoryCode = await provider.getCode(factoryAddress);
if (factoryCode === "0x") {
  console.error("No contract at factory address " + factoryAddress + " on " + pqNetwork);
  process.exit(1);
}

const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer);
const iface   = new ethers.Interface(FACTORY_ABI);
const callData = iface.encodeFunctionData("getAddress", [preQuantumPubKey, postQuantumPubKey]);
const result   = await provider.call({ to: factoryAddress, data: callData });
const [smartAccountAddress] = iface.decodeFunctionResult("getAddress", result);

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
  gas = await factory.createAccount.estimateGas(preQuantumPubKey, postQuantumPubKey);
} catch {
  gas = 5_000_000n;
}
const feeData = await provider.getFeeData();
const gasPrice = feeData.gasPrice ?? 0n;
console.log("Estimated gas: " + gas + " @ " + ethers.formatUnits(gasPrice, "gwei") + " gwei");

const tx = await factory.createAccount(preQuantumPubKey, postQuantumPubKey, {
  gasLimit: (gas * 120n) / 100n,
});
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
