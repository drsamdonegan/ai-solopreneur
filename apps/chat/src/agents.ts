import { readFile } from "node:fs/promises";
import type { AgentSettingFieldDefinition } from "./agent-settings.js";

export type AgentStatus = "active" | "coming-soon";
export type AgentAccent = "violet" | "teal" | "amber" | "emerald" | "rose";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  accentColour: AgentAccent;
  workflowPath: string;
  examplePrompts: string[];
  settingsFields: AgentSettingFieldDefinition[];
}

export type PublicAgentDefinition = Omit<AgentDefinition, "workflowPath">;

interface AgentRegistryFile {
  schemaVersion: number;
  agents: AgentDefinition[];
}

const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELD_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const WORKFLOW_PATH_PATTERN = /^\/webhook\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACCENTS = new Set<AgentAccent>([
  "violet",
  "teal",
  "amber",
  "emerald",
  "rose",
]);

export const DEFAULT_AGENTS: readonly AgentDefinition[] = Object.freeze([
  {
    id: "project-manager",
    name: "Project Manager",
    description:
      "Plans projects, analyses meetings, and turns decisions into safe next actions.",
    status: "active",
    accentColour: "violet",
    workflowPath: "/webhook/chat",
    examplePrompts: [
      "Turn these meeting notes into decisions and action items",
      "Build a practical project plan from this document",
      "Show me the highest-priority work in my local project",
    ],
    settingsFields: [
      {
        id: "teamMembers",
        label: "Who is usually in your meetings",
        description: "Names and roles you refer to often.",
        kind: "line",
        maxLength: 300,
      },
      {
        id: "taskConventions",
        label: "How you word and time your to-dos",
        description: "Preferred task style, timing, and ownership conventions.",
        kind: "block",
        maxLength: 800,
      },
    ],
  },
  {
    id: "sales",
    name: "Sales",
    description: "Researches prospects, drafts replies, and turns calls into proposals.",
    status: "active",
    accentColour: "teal",
    workflowPath: "/webhook/chat",
    examplePrompts: [
      "Draft a reply to this enquiry that just came in",
      "Turn these call notes into a recap and a proposal",
      "Write a cold email to this person",
    ],
    settingsFields: [
      {
        id: "idealCustomer",
        label: "Who you sell to",
        description: "Sector, job titles, and company size.",
        kind: "line",
        maxLength: 300,
      },
      {
        id: "outreachTone",
        label: "How your outreach should sound",
        description: "Tone, structure, and words to avoid.",
        kind: "block",
        maxLength: 800,
      },
    ],
  },
  {
    id: "marketing",
    name: "Marketing",
    description:
      "Plans campaigns and creates grounded content from supplied or researched evidence.",
    status: "active",
    accentColour: "amber",
    workflowPath: "/webhook/chat",
    examplePrompts: [
      "Turn these customer notes into three grounded content themes",
      "Build a practical campaign plan from this brief",
      "Review this draft and identify unsupported claims",
    ],
    settingsFields: [
      {
        id: "websiteDomain",
        label: "Your website address",
        description: "The main public domain for your business.",
        kind: "line",
        maxLength: 300,
      },
      {
        id: "contentVoice",
        label: "How your content should sound, and words to avoid",
        description: "Content-specific voice and language boundaries.",
        kind: "block",
        maxLength: 800,
      },
    ],
  },
  {
    id: "investment",
    name: "Investment",
    description:
      "Reviews grants, funding evidence, and business updates without making financial decisions.",
    status: "active",
    accentColour: "emerald",
    workflowPath: "/webhook/chat",
    examplePrompts: [
      "Compare these two funding opportunities from the supplied documents",
      "Turn this grant brief into eligibility questions and deadlines",
      "Draft a factual investor update from these notes",
    ],
    settingsFields: [
      {
        id: "eligibilityFacts",
        label: "Where your business is registered and what stage it is at",
        description: "Location, structure, stage, and other eligibility facts.",
        kind: "line",
        maxLength: 300,
      },
      {
        id: "updateAudience",
        label: "Who reads your monthly update and what they want to hear",
        description: "Audience, detail level, and sensitive topics to leave out.",
        kind: "block",
        maxLength: 800,
      },
    ],
  },
  {
    id: "bookkeeping",
    name: "Bookkeeping",
    description:
      "Prepares coding-review suggestions and questions for the user to complete in their accounting system.",
    status: "active",
    accentColour: "rose",
    workflowPath: "/webhook/chat",
    examplePrompts: [
      "Review these transactions and suggest coding categories with confidence",
      "List the questions I should take to my bookkeeper from this statement",
      "Summarise the unpaid invoices in this document",
    ],
    settingsFields: [
      {
        id: "commonSuppliers",
        label: "Your regular suppliers and what each spend is for",
        description: "One supplier and its usual purpose per line.",
        kind: "block",
        maxLength: 800,
      },
      {
        id: "accountRules",
        label: "Accounts or categories you use, and how you split personal from business",
        description: "Your own coding rules; suggestions still require human review.",
        kind: "block",
        maxLength: 800,
      },
    ],
  },
]);

function isSettingsField(value: unknown): value is AgentSettingFieldDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const field = value as Record<string, unknown>;
  return (
    typeof field.id === "string" &&
    FIELD_ID_PATTERN.test(field.id) &&
    typeof field.label === "string" &&
    field.label.trim().length >= 1 &&
    field.label.length <= 80 &&
    (field.description === undefined ||
      (typeof field.description === "string" && field.description.length <= 160)) &&
    (field.kind === "line" || field.kind === "block") &&
    Number.isSafeInteger(field.maxLength) &&
    Number(field.maxLength) >= 1 &&
    Number(field.maxLength) <= (field.kind === "line" ? 300 : 800)
  );
}

function isAgentDefinition(value: unknown): value is AgentDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    AGENT_ID_PATTERN.test(candidate.id) &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    candidate.name.length <= 80 &&
    typeof candidate.description === "string" &&
    candidate.description.trim().length > 0 &&
    candidate.description.length <= 240 &&
    (candidate.status === "active" || candidate.status === "coming-soon") &&
    typeof candidate.accentColour === "string" &&
    ACCENTS.has(candidate.accentColour as AgentAccent) &&
    typeof candidate.workflowPath === "string" &&
    Array.isArray(candidate.examplePrompts) &&
    candidate.examplePrompts.every(
      (prompt) => typeof prompt === "string" && prompt.trim().length > 0,
    ) &&
    Array.isArray(candidate.settingsFields) &&
    candidate.settingsFields.length <= 2 &&
    candidate.settingsFields.every(isSettingsField) &&
    new Set(
      candidate.settingsFields.map(
        (field) => (field as AgentSettingFieldDefinition).id,
      ),
    ).size === candidate.settingsFields.length
  );
}

export async function loadAgentRegistry(
  registryPath: string,
): Promise<readonly AgentDefinition[]> {
  const parsed = JSON.parse(
    await readFile(registryPath, "utf8"),
  ) as AgentRegistryFile;

  if (
    parsed.schemaVersion !== 2 ||
    !Array.isArray(parsed.agents) ||
    parsed.agents.length === 0 ||
    !parsed.agents.every(isAgentDefinition)
  ) {
    throw new Error("apps/chat/config/agents.json is invalid for schema version 2.");
  }

  const ids = parsed.agents.map((agent) => agent.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Agent registry contains duplicate agent IDs.");
  }
  if (!parsed.agents.some((agent) => agent.status === "active")) {
    throw new Error("Agent registry must contain at least one active agent.");
  }
  const accents = parsed.agents.map((agent) => agent.accentColour);
  if (new Set(accents).size !== accents.length) {
    throw new Error("Agent registry accent colours must be unique.");
  }
  for (const agent of parsed.agents) {
    if (
      agent.status === "active" &&
      !WORKFLOW_PATH_PATTERN.test(agent.workflowPath)
    ) {
      throw new Error(
        `Active agent "${agent.id}" needs an internal webhook path.`,
      );
    }
    if (agent.status === "coming-soon" && agent.workflowPath !== "") {
      throw new Error(
        `Coming-soon agent "${agent.id}" must not expose a workflow path.`,
      );
    }
  }

  return parsed.agents.map((agent) => ({
    ...agent,
    name: agent.name.trim(),
    description: agent.description.trim(),
    examplePrompts: agent.examplePrompts.map((prompt) => prompt.trim()),
    settingsFields: agent.settingsFields.map((field) => ({
      ...field,
      label: field.label.trim(),
      ...(field.description === undefined
        ? {}
        : { description: field.description.trim() }),
    })),
  }));
}

export function publicAgentDefinitions(
  agents: readonly AgentDefinition[],
): PublicAgentDefinition[] {
  return agents.map(
    ({
      id,
      name,
      description,
      status,
      accentColour,
      examplePrompts,
      settingsFields,
    }) => ({
      id,
      name,
      description,
      status,
      accentColour,
      examplePrompts,
      settingsFields,
    }),
  );
}
