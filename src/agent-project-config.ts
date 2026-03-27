import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  NON_INTERACTIVE_DEFAULTS,
  parseAgentFlag,
  type CliFlagValues,
} from "./cli-argv.js";

const MAX_SWARM = 64;

/** Shape of `agent.json` / `--from-config` file (flexible: options nested or top-level). */
export type AgentProjectJson = {
  name?: string;
  project?: string;
  swarm?: number;
  agents?: Record<string, string>;
  options?: Record<string, unknown>;
  extra?: unknown;
  /** Allow arbitrary CLI-like keys at top level */
  [key: string]: unknown;
};

export type AgentFileExtras = {
  agentPresets: Record<string, string>;
  swarmFromFile?: number;
  extra: unknown;
};

const RESERVED_TOP_KEYS = new Set([
  "name",
  "project",
  "swarm",
  "agents",
  "options",
  "extra",
]);

/** Map JSON field names to CliFlagValues keys (camelCase in TS object → same as parseArgs long options). */
const OPTION_KEY_TO_CLI: Record<string, keyof CliFlagValues> = {
  secrets: "secrets",
  "oneclaw-api-key": "oneclaw-api-key",
  "defer-oneclaw-api-key": "defer-oneclaw-api-key",
  "env-password": "env-password",
  agent: "agent",
  ampersend: "ampersend",
  llm: "llm",
  "shroud-upstream": "shroud-upstream",
  "shroud-billing": "shroud-billing",
  "shroud-provider-api-key": "shroud-provider-api-key",
  "llm-api-key": "llm-api-key",
  "oneclaw-agent-id": "oneclaw-agent-id",
  "oneclaw-agent-api-key": "oneclaw-agent-api-key",
  chain: "chain",
  framework: "framework",
  "skip-npm-install": "skip-npm-install",
  "skip-auto-fund": "skip-auto-fund",
  "non-interactive": "non-interactive",
  swarm: "swarm",
  project: "project",
};

function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function pickCliValue(key: keyof CliFlagValues, v: unknown): CliFlagValues[keyof CliFlagValues] | undefined {
  if (v === undefined) return undefined;
  if (
    key === "defer-oneclaw-api-key" ||
    key === "skip-npm-install" ||
    key === "skip-auto-fund" ||
    key === "non-interactive"
  ) {
    const b = asBool(v);
    return b as CliFlagValues[typeof key] | undefined;
  }
  const s = asString(v);
  return s as CliFlagValues[typeof key] | undefined;
}

/**
 * Load agent.json and merge into CLI values. Command-line flags override file values when present.
 */
export function loadAgentProjectConfig(
  configPath: string,
  argvValues: CliFlagValues,
): { values: CliFlagValues; extras: AgentFileExtras } {
  const abs = resolve(configPath);
  if (!existsSync(abs)) {
    throw new Error(`CLI: --from-config file not found: ${abs}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`CLI: invalid JSON in --from-config: ${msg}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("CLI: --from-config root must be a JSON object");
  }
  const file = raw as AgentProjectJson;

  const fromFile: CliFlagValues = {};

  const proj = asString(file.project) ?? asString(file.name);
  if (proj) fromFile.project = proj;

  if (file.swarm !== undefined && file.swarm !== null) {
    if (typeof file.swarm === "number" && Number.isFinite(file.swarm)) {
      fromFile.swarm = String(Math.trunc(file.swarm));
    } else if (typeof file.swarm === "string" && file.swarm.trim()) {
      fromFile.swarm = file.swarm.trim();
    }
  }

  const optBlock = file.options;
  if (optBlock && typeof optBlock === "object" && !Array.isArray(optBlock)) {
    for (const [k, v] of Object.entries(optBlock)) {
      const cliKey = OPTION_KEY_TO_CLI[k];
      if (cliKey) {
        const picked = pickCliValue(cliKey, v);
        if (picked !== undefined) (fromFile as Record<string, unknown>)[cliKey] = picked;
      }
    }
  }

  for (const [k, v] of Object.entries(file)) {
    if (RESERVED_TOP_KEYS.has(k) && k !== "project" && k !== "name") continue;
    if (k === "name") continue;
    const cliKey = OPTION_KEY_TO_CLI[k];
    if (cliKey && !(cliKey in fromFile)) {
      const picked = pickCliValue(cliKey, v);
      if (picked !== undefined) (fromFile as Record<string, unknown>)[cliKey] = picked;
    }
  }

  const merged: CliFlagValues = { ...fromFile };
  for (const key of Object.keys(argvValues) as (keyof CliFlagValues)[]) {
    const v = argvValues[key];
    if (v !== undefined) (merged as Record<string, unknown>)[key] = v;
  }

  const agentPresets: Record<string, string> = {};
  if (file.agents && typeof file.agents === "object" && !Array.isArray(file.agents)) {
    for (const [id, preset] of Object.entries(file.agents)) {
      if (typeof id === "string" && id.trim()) {
        agentPresets[id.trim()] =
          typeof preset === "string" ? preset : String(preset ?? "");
      }
    }
  }

  const swarmFromFile = ((): number | undefined => {
    const x = file.swarm;
    if (typeof x === "number" && Number.isFinite(x)) return Math.trunc(x);
    if (typeof x === "string" && x.trim()) {
      const n = parseInt(x.trim(), 10);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  })();

  const extras: AgentFileExtras = {
    agentPresets,
    swarmFromFile,
    extra: file.extra,
  };

  return { values: merged, extras };
}

export type SwarmPlanEntry = { id: string; preset?: string };

export function parseSwarmCount(
  raw: string | undefined,
  label: string,
): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_SWARM) {
    throw new Error(
      `CLI: invalid ${label} "${raw}". Use an integer from 1 to ${MAX_SWARM}.`,
    );
  }
  return n;
}

/**
 * Resolve how many agent wallets to generate and stable ids (named agents first, then agent-N).
 */
export function resolveSwarmPlan(args: {
  generateAgent: boolean;
  swarmFlag?: string;
  swarmFromFile?: number;
  agentPresets: Record<string, string>;
}): { count: number; entries: SwarmPlanEntry[] } {
  if (!args.generateAgent) {
    return { count: 0, entries: [] };
  }

  const namedKeys = Object.keys(args.agentPresets);
  const fromFlag = args.swarmFlag ? parseSwarmCount(args.swarmFlag, "--swarm") : undefined;
  const fromFile = args.swarmFromFile;

  const nNamed = namedKeys.length;
  const nDeclared = Math.max(
    fromFlag ?? 0,
    fromFile ?? 0,
    nNamed,
    1,
  );

  const count = Math.min(MAX_SWARM, Math.max(1, nDeclared));
  const entries: SwarmPlanEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (i < namedKeys.length) {
      const id = namedKeys[i];
      const preset = args.agentPresets[id];
      entries.push({ id, preset: preset || undefined });
    } else {
      const fillerId = count === 1 ? "agent" : `agent-${i + 1}`;
      entries.push({ id: fillerId });
    }
  }

  return { count, entries };
}

/** Invert OPTION_KEY_TO_CLI: CLI flag name → agent.json field name. */
const CLI_KEY_TO_JSON: Record<string, string> = {};
for (const [jsonKey, cliKey] of Object.entries(OPTION_KEY_TO_CLI)) {
  CLI_KEY_TO_JSON[cliKey] = jsonKey;
}

const SENSITIVE_DUMP_KEYS = new Set<keyof CliFlagValues>([
  "env-password",
  "oneclaw-api-key",
  "shroud-provider-api-key",
  "llm-api-key",
  "oneclaw-agent-api-key",
]);

const SKIP_DUMP_KEYS = new Set<keyof CliFlagValues>([
  "help",
  "version",
  "dump-config",
  "dump-config-out",
  "from-config",
]);

/**
 * Fill unset scaffold flags with the same defaults as `-y` so `--dump-config` emits a complete starter file.
 */
export function withDumpTemplateDefaults(v: CliFlagValues): CliFlagValues {
  const o: CliFlagValues = { ...v };
  if (o.secrets === undefined || o.secrets === "") {
    o.secrets = NON_INTERACTIVE_DEFAULTS.secrets;
  }
  if (o.agent === undefined || o.agent === "") {
    o.agent = NON_INTERACTIVE_DEFAULTS.generateAgent ? "generate" : "none";
  }
  if (o.ampersend === undefined || o.ampersend === "") {
    o.ampersend = NON_INTERACTIVE_DEFAULTS.installAmpersendSdk ? "yes" : "no";
  }
  if (o.llm === undefined || o.llm === "") {
    o.llm = NON_INTERACTIVE_DEFAULTS.llm;
  }
  if (o.chain === undefined || o.chain === "") {
    o.chain = NON_INTERACTIVE_DEFAULTS.chain;
  }
  if (o.framework === undefined || o.framework === "") {
    o.framework = NON_INTERACTIVE_DEFAULTS.framework;
  }
  const llm = (o.llm || "").trim().toLowerCase();
  if (llm === "oneclaw") {
    if (o["shroud-upstream"] === undefined || o["shroud-upstream"] === "") {
      o["shroud-upstream"] = NON_INTERACTIVE_DEFAULTS.shroudUpstream;
    }
    if (o["shroud-billing"] === undefined || o["shroud-billing"] === "") {
      o["shroud-billing"] = NON_INTERACTIVE_DEFAULTS.shroudBilling;
    }
  }
  return o;
}

/**
 * Build an `agent.json`-shaped object for `--dump-config` (secrets redacted; swarm count resolved).
 */
export function buildAgentJsonForDump(
  v: CliFlagValues,
  extras: AgentFileExtras | null,
  projectName: string,
): AgentProjectJson {
  const out: AgentProjectJson = {};
  out.project = projectName;

  const presets = { ...(extras?.agentPresets ?? {}) };
  const generateAgent = parseAgentFlag(v.agent, true);

  if (generateAgent) {
    const plan = resolveSwarmPlan({
      generateAgent: true,
      swarmFlag: v.swarm,
      swarmFromFile: extras?.swarmFromFile,
      agentPresets: presets,
    });
    const showSwarm =
      plan.count > 1 ||
      (v.swarm !== undefined && v.swarm !== "") ||
      Object.keys(presets).length > 0;
    if (showSwarm) {
      out.swarm = plan.count;
    }
  }

  if (Object.keys(presets).length > 0) {
    out.agents = { ...presets };
  }

  if (extras?.extra !== undefined) {
    out.extra = extras.extra;
  }

  for (const cliKey of Object.keys(v) as (keyof CliFlagValues)[]) {
    if (SKIP_DUMP_KEYS.has(cliKey)) continue;
    if (cliKey === "project") continue;
    if (cliKey === "swarm" && out.swarm !== undefined) continue;

    const val = v[cliKey];
    if (val === undefined) continue;

    const jsonKey = CLI_KEY_TO_JSON[cliKey];
    if (!jsonKey) continue;

    if (SENSITIVE_DUMP_KEYS.has(cliKey)) {
      /* Never emit secrets (omit so a saved agent.json is safe to share / re-use). */
      continue;
    }

    (out as Record<string, unknown>)[jsonKey] = val;
  }

  return out;
}
