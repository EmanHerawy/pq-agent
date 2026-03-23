/**
 * RainbowKit + wagmi + viem: `lib/wagmi-config.ts`, web3 providers, `ConnectWalletButton`,
 * Burner Wallet (Scaffold-ETH 2 style) when `targetNetwork === "localhost"`.
 */

export type WalletTemplateFramework = "next" | "vite";

/** Default Reown / WalletConnect Cloud project id when the user does not set one in `.env`. */
const DEFAULT_REOWN_PROJECT_ID = "ef4aa705a4612c41fc51003cc1f6d387";

export function wagmiConfigSource(
  projectName: string,
  framework: WalletTemplateFramework,
): string {
  const projectIdExpr =
    framework === "next"
      ? `(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim()`
      : `(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "").trim()`;

  const useClient = `"use client";\n\n`;

  return `${useClient}import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  baseAccount,
  metaMaskWallet,
  rainbowWallet,
  safeWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { rainbowkitBurnerWallet } from "burner-connector";
import { getActiveNetwork, targetNetwork } from "./networks";
import {
  bsc,
  base,
  baseSepolia,
  hardhat,
  mainnet,
  polygon,
  sepolia,
} from "wagmi/chains";

const DEFAULT_REOWN_PROJECT_ID = ${JSON.stringify(DEFAULT_REOWN_PROJECT_ID)} as const;

const projectId = ${projectIdExpr};

/**
 * Burner wallet only when targetNetwork is localhost (scaffold.config.ts).
 * @see https://github.com/scaffold-eth/scaffold-eth-2
 * @see https://github.com/scaffold-eth/burner-connector
 */
const showBurnerWallet = targetNetwork === "localhost";

if (showBurnerWallet) {
  const local = getActiveNetwork();
  rainbowkitBurnerWallet.rpcUrls = {
    [hardhat.id]: local.rpcUrl,
  };
}

const popularWallets = [
  safeWallet,
  rainbowWallet,
  baseAccount,
  metaMaskWallet,
  walletConnectWallet,
];

/**
 * Reown / WalletConnect Cloud project id.
 * If unset in .env, uses the scaffold default; override with
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (Next) or VITE_WALLETCONNECT_PROJECT_ID (Vite).
 * @see https://cloud.walletconnect.com
 */
export const wagmiConfig = getDefaultConfig({
  appName: ${JSON.stringify(projectName)},
  projectId: projectId || DEFAULT_REOWN_PROJECT_ID,
  chains: [hardhat, sepolia, baseSepolia, base, mainnet, polygon, bsc],
  ssr: ${framework === "next" ? "true" : "false"},
  wallets: [
    {
      groupName: "Popular",
      wallets: showBurnerWallet
        ? [rainbowkitBurnerWallet, ...popularWallets]
        : popularWallets,
    },
  ],
});
`;
}

export function burnerAutoConnectSource(): string {
  return `"use client";

/** When targetNetwork is localhost, connect Burner Wallet once on load (SE-2 dev UX). */
import { useEffect, useRef } from "react";
import { hardhat } from "wagmi/chains";
import { useAccount, useConnect } from "wagmi";
import { targetNetwork } from "./networks";

export function BurnerAutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const attempted = useRef(false);

  useEffect(() => {
    if (targetNetwork !== "localhost") return;
    if (attempted.current || isConnected) return;
    const burner = connectors.find((c) => c.id === "burnerWallet");
    if (!burner) return;
    attempted.current = true;
    connect({ connector: burner, chainId: hardhat.id });
  }, [isConnected, connect, connectors]);

  return null;
}
`;
}

export function web3ProvidersSource(framework: WalletTemplateFramework): string {
  const useClient = `"use client";\n\n`;
  const wagmiImport =
    framework === "next"
      ? `import { wagmiConfig } from "@/lib/wagmi-config";
import { BurnerAutoConnect } from "@/lib/burner-auto-connect";`
      : `import { wagmiConfig } from "./wagmi-config";
import { BurnerAutoConnect } from "./burner-auto-connect";`;

  return `${useClient}import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
${wagmiImport}
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

export function Web3Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()} modalSize="compact">
          <BurnerAutoConnect />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
`;
}

export function nextAppProvidersSource(): string {
  return `"use client";

import type { ReactNode } from "react";
import { Web3Providers } from "@/lib/web3-providers";

export function Providers({ children }: { children: ReactNode }) {
  return <Web3Providers>{children}</Web3Providers>;
}
`;
}

export function connectWalletButtonSource(): string {
  return `"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";

export function ConnectWalletButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openConnectModal,
        mounted,
        authenticationStatus,
      }) => {
        const readyToShow = mounted;
        const connected =
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        if (!readyToShow) {
          return (
            <div
              className="h-9 w-28 shrink-0 animate-pulse rounded-md bg-muted"
              aria-hidden
            />
          );
        }

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className={cn(
                "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-input",
                "bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground",
              )}
            >
              Connect wallet
            </button>
          );
        }

        return (
          <button
            type="button"
            onClick={openAccountModal}
            className={cn(
              "inline-flex h-9 max-w-[10rem] shrink-0 items-center truncate rounded-md border border-input",
              "bg-background px-2 font-mono text-xs hover:bg-accent hover:text-accent-foreground",
            )}
            title={account.address}
          >
            {account.displayName ??
              (account.address.length > 10
                ? account.address.slice(0, 6) + "…" + account.address.slice(-4)
                : account.address)}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
`;
}
