import type { OneClawResult } from "../types.js";

const BASE_URL = "https://api.1claw.xyz";

async function getToken(apiKey: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/auth/api-key-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`1Claw auth failed (${res.status}): ${body || res.statusText}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function createVault(
  token: string,
  name: string,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/vaults`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name,
      description: `Vault for ${name} agent project`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to create vault (${res.status}): ${body || res.statusText}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function storeSecret(
  token: string,
  vaultId: string,
  path: string,
  value: string,
) {
  const res = await fetch(
    `${BASE_URL}/v1/vaults/${vaultId}/secrets/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ value, type: "private_key" }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to store secret at ${path} (${res.status}): ${body || res.statusText}`,
    );
  }
}

async function registerAgent(
  token: string,
  name: string,
): Promise<{ id: string; apiKey: string }> {
  const res = await fetch(`${BASE_URL}/v1/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to register agent (${res.status}): ${body || res.statusText}`);
  }
  const data = (await res.json()) as { id: string; api_key: string };
  return { id: data.id, apiKey: data.api_key };
}

export async function setupOneClaw(
  apiKey: string,
  projectName: string,
  deployerPrivateKey: string,
  agentPrivateKey?: string,
): Promise<OneClawResult> {
  const token = await getToken(apiKey);
  const vaultId = await createVault(token, projectName);

  await storeSecret(token, vaultId, "private-keys/deployer", deployerPrivateKey);

  let agentInfo: { id: string; apiKey: string } | undefined;

  if (agentPrivateKey) {
    await storeSecret(token, vaultId, "private-keys/agent", agentPrivateKey);
    agentInfo = await registerAgent(token, `${projectName}-agent`);
  }

  return { vaultId, agentInfo };
}
