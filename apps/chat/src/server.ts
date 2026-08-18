import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  createAccessGate,
  MIN_PASSCODE_LENGTH,
  type AccessGate,
} from "./access.js";
import { loadAgentRegistry } from "./agents.js";
import { createChatServer } from "./app.js";
import { ChatStore } from "./chat-store.js";
import { DocumentStore } from "./documents.js";
import { ProfileStore } from "./profile.js";
import { AgentSettingsStore } from "./agent-settings.js";

const DEFAULT_PORT = 3_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_UPSTREAM_URL = "http://127.0.0.1:5678/webhook/chat";
const DEFAULT_DOCUMENT_WORKER_URL = "http://127.0.0.1:3100";

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const port = positiveInteger(process.env.PORT, DEFAULT_PORT);
const timeoutMs = positiveInteger(
  process.env.CHAT_REQUEST_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
);
const upstreamUrl = process.env.N8N_CHAT_WEBHOOK_URL ?? DEFAULT_UPSTREAM_URL;
const listenAddress = process.env.CHAT_LISTEN_ADDRESS ?? "127.0.0.1";
const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const agentRegistryPath =
  process.env.AGENT_REGISTRY_PATH ??
  fileURLToPath(new URL("../config/agents.json", import.meta.url));
const documentDirectory =
  process.env.DOCUMENT_DATA_DIRECTORY ??
  fileURLToPath(new URL("../../../data/documents", import.meta.url));
const documentWorkerUrl =
  process.env.DOCUMENT_WORKER_URL ?? DEFAULT_DOCUMENT_WORKER_URL;
const chatDataDirectory =
  process.env.CHAT_DATA_DIRECTORY ??
  fileURLToPath(new URL("../../../data/chat", import.meta.url));
const profileDataDirectory =
  process.env.PROFILE_DATA_DIRECTORY ??
  fileURLToPath(new URL("../../../data/profile", import.meta.url));
const skillsDirectory =
  process.env.SKILLS_DIRECTORY ??
  fileURLToPath(new URL("../../../skills", import.meta.url));

try {
  new URL(upstreamUrl);
} catch {
  console.error("N8N_CHAT_WEBHOOK_URL must be a valid URL.");
  process.exit(1);
}

// The gate exists only when a passcode is configured. On a learner's own
// computer nothing sets one, so the local experience is unchanged; the cloud
// runner refuses to start without one.
const passcode = process.env.AGENT_PASSCODE ?? "";
let accessGate: AccessGate | undefined;
if (passcode !== "") {
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    console.error(
      `AGENT_PASSCODE must be at least ${MIN_PASSCODE_LENGTH} characters.`,
    );
    process.exit(1);
  }
  accessGate = createAccessGate({
    passcode,
    // Supplied by the cloud runner from the persistent volume, so a redeploy
    // does not sign the learner out. A random one here would work but would
    // not survive a restart.
    sessionSecret: process.env.AGENT_SESSION_SECRET ?? "",
    secureCookie: process.env.AGENT_COOKIE_SECURE !== "false",
    proxyHops: positiveInteger(process.env.AGENT_PROXY_HOPS, 1),
  });
}

const agents = await loadAgentRegistry(agentRegistryPath);
const documentStore = new DocumentStore(
  documentDirectory,
  documentWorkerUrl,
);
await documentStore.cleanupExpired();
const chatStore = new ChatStore(join(chatDataDirectory, "chat.sqlite"));
const profileStore = new ProfileStore(profileDataDirectory);
const agentSettingsStore = new AgentSettingsStore(
  profileDataDirectory,
  agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    fields: agent.settingsFields,
  })),
);

const server = createChatServer({
  accessGate,
  agents,
  chatStore,
  documentStore,
  profileStore,
  agentSettingsStore,
  skillsDirectory,
  profileDirectory: profileDataDirectory,
  publicDirectory,
  upstreamUrl,
  timeoutMs,
  logError: (message, error) => console.error(message, error),
});

server.listen(port, listenAddress, () => {
  console.log(`Chat gateway listening on http://${listenAddress}:${port}`);
  console.log(
    `Loaded ${agents.length} agent definitions; ${agents.filter((agent) => agent.status === "active").length} active.`,
  );
  console.log(
    `Chat history ready with schema ${chatStore.health().schemaVersion}.`,
  );
  console.log(
    accessGate === undefined
      ? "Passcode: not set (correct for a local install; never for a public address)."
      : "Passcode: on. Visitors must sign in before reaching your agent.",
  );
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signal} received; closing the chat gateway.`);
  server.close((error) => {
    try {
      chatStore.close();
    } catch (closeError) {
      console.error("Could not close chat history cleanly.", closeError);
      process.exitCode = 1;
    }
    if (error) {
      console.error("Could not close the chat gateway cleanly.", error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
