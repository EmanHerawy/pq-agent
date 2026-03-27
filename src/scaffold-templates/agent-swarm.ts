/**
 * Client context: load `public/agents.json`, persist selected agent in localStorage.
 * Works for single-agent (one row) or swarm (header selector when length > 1).
 */

export type AgentSwarmTemplateFramework = "next" | "vite";

export function agentSwarmContextSource(
  framework: AgentSwarmTemplateFramework,
): string {
  const envPrimary =
    framework === "next"
      ? `(process.env.NEXT_PUBLIC_AGENT_ADDRESS || "").trim()`
      : `(import.meta.env.VITE_AGENT_ADDRESS || "").trim()`;

  return `"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AgentRosterEntry = {
  id: string;
  address: string;
  preset?: string;
};

type Ctx = {
  roster: AgentRosterEntry[];
  loading: boolean;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  selected: AgentRosterEntry | null;
  /** Primary env address when roster is empty (no agents.json yet). */
  fallbackAddress: string;
};

const AgentSwarmContext = createContext<Ctx | null>(null);

const LS_KEY = "scaffold_selected_agent_id";

async function loadRoster(): Promise<AgentRosterEntry[]> {
  try {
    const res = await fetch("/agents.json", { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as unknown;
    const arr = Array.isArray(j) ? j : (j as { agents?: unknown }).agents;
    if (!Array.isArray(arr)) return [];
    const out: AgentRosterEntry[] = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const address = typeof o.address === "string" ? o.address.trim() : "";
      if (!id || !/^0x[a-fA-F0-9]{40}$/i.test(address)) continue;
      const preset = typeof o.preset === "string" ? o.preset : undefined;
      out.push({ id, address, preset });
    }
    return out;
  } catch {
    return [];
  }
}

export function AgentSwarmProvider({ children }: { children: ReactNode }) {
  const fallbackAddress = ${envPrimary};
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await loadRoster();
      if (cancelled) return;
      setRoster(r);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (roster.length === 0) {
      if (selectedId !== null) setSelectedIdState(null);
      return;
    }
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    const pick =
      roster.find((x) => x.id === saved) ??
      roster.find((x) => x.address.toLowerCase() === fallbackAddress.toLowerCase()) ??
      roster[0];
    if (pick && pick.id !== selectedId) {
      setSelectedIdState(pick.id);
    }
  }, [loading, roster, fallbackAddress, selectedId]);

  const setSelectedId = useCallback((id: string) => {
    setSelectedIdState(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const selected = useMemo(
    () => roster.find((x) => x.id === selectedId) ?? null,
    [roster, selectedId],
  );

  const value = useMemo<Ctx>(
    () => ({
      roster,
      loading,
      selectedId,
      setSelectedId,
      selected,
      fallbackAddress,
    }),
    [roster, loading, selectedId, setSelectedId, selected, fallbackAddress],
  );

  return (
    <AgentSwarmContext.Provider value={value}>{children}</AgentSwarmContext.Provider>
  );
}

export function useAgentSwarm(): Ctx {
  const v = useContext(AgentSwarmContext);
  if (!v) {
    throw new Error("AgentSwarmProvider is required");
  }
  return v;
}

/** Address for balances / identity when a swarm row is selected or env fallback. */
export function useEffectiveAgentAddress(): string {
  const { roster, selected, fallbackAddress } = useAgentSwarm();
  if (selected?.address) return selected.address;
  if (roster.length === 1) return roster[0].address;
  return fallbackAddress;
}

export function SwarmAgentPicker({ className }: { className?: string }) {
  const { roster, loading, selectedId, setSelectedId } = useAgentSwarm();
  if (loading || roster.length <= 1) return null;
  return (
    <label className={"flex items-center gap-2 text-xs " + (className ?? "")}>
      <span className="text-muted-foreground shrink-0">Agent</span>
      <select
        className="h-8 max-w-[11rem] truncate rounded-md border border-input bg-background px-2 text-xs font-mono"
        value={selectedId ?? ""}
        onChange={(e) => setSelectedId(e.target.value)}
        aria-label="Select swarm agent wallet"
      >
        {roster.map((a) => (
          <option key={a.id} value={a.id}>
            {a.id}
            {a.preset ? " (" + a.preset + ")" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
`;
}

export function swarmPageSource(framework: AgentSwarmTemplateFramework): string {
  const useClient = framework === "next" ? `"use client";\n\n` : "";
  const linkImport =
    framework === "next"
      ? `import Link from "next/link";`
      : `import { Link } from "react-router-dom";`;
  const lp = (path: string) =>
    framework === "next" ? `href="${path}"` : `to="${path}"`;

  return `${useClient}import { useCallback, useMemo, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentSwarm } from "@/lib/agent-swarm";
${linkImport}

export default function SwarmPage() {
  const { roster } = useAgentSwarm();
  const [pk, setPk] = useState<string | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const genLocal = useCallback(() => {
    const hex = generatePrivateKey();
    const acct = privateKeyToAccount(hex);
    setPk(hex);
    setAddr(acct.address);
    setCopied(false);
  }, []);

  const snippet = useMemo(() => {
    if (!pk || !addr) return "";
    return JSON.stringify([{ id: "new-local", privateKey: pk }], null, 0);
  }, [pk, addr]);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border px-6 py-4 flex items-center gap-4 flex-wrap">
        <Link
          ${lp("/")}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Swarm</h1>
          <p className="text-xs text-muted-foreground">
            On-chain agent wallets — add more with{" "}
            <code className="rounded bg-muted px-1">just swarm agents=N</code>
          </p>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-lg mx-auto w-full space-y-6">
        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-medium">Configured agents</h2>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents.json entries yet.</p>
          ) : (
            <ul className="space-y-2 text-sm font-mono text-xs">
              {roster.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
                  <span className="text-foreground">{a.id}</span>
                  <span className="text-muted-foreground break-all">{a.address}</span>
                  {a.preset ? (
                    <span className="text-muted-foreground">preset: {a.preset}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-medium">Generate locally (browser)</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Creates a key in memory only. To persist, merge the private key into encrypted secrets and
            update <code className="rounded bg-muted px-1">public/agents.json</code> — use{" "}
            <code className="rounded bg-muted px-1">just swarm agents=1</code> for a guided flow, or
            append the JSON below to <code className="rounded bg-muted px-1">SWARM_AGENT_KEYS_JSON</code>.
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={genLocal}>
            Generate wallet
          </Button>
          {addr && pk ? (
            <div className="space-y-2 text-xs">
              <p className="font-mono break-all text-muted-foreground">{addr}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted p-2 text-[10px] leading-snug">
                  {snippet}
                </code>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
                  title="Copy JSON snippet"
                  onClick={() => {
                    void navigator.clipboard.writeText(snippet).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
`;
}
