import { AGENT_IDS } from "./compile-skills.mjs";

export const AGENT_NODE_BY_ID = Object.freeze({
  "project-manager": "Project Manager Agent",
  sales: "Sales Agent",
  marketing: "Marketing Agent",
  investment: "Investment Agent",
  bookkeeping: "Bookkeeping Agent",
});

export const AGENT_NODE_NAMES = Object.freeze(
  AGENT_IDS.map((agentId) => AGENT_NODE_BY_ID[agentId]),
);

function targets(workflow, sourceName, outputType) {
  const outputs = workflow.connections?.[sourceName]?.[outputType] ?? [];
  return outputs.flatMap((output) =>
    (output ?? []).map((connection) => connection.node),
  );
}

/**
 * Return human-readable structural-scope failures. Tool ownership is a map or
 * object from tool-node name to one of the five agent IDs.
 */
export function validateAgentToolScopes(workflow, ownership) {
  const entries = ownership instanceof Map
    ? [...ownership.entries()]
    : Object.entries(ownership);
  const expectedTools = new Set(entries.map(([toolName]) => toolName));
  const failures = [];

  for (const [toolName, agentId] of entries) {
    const expectedNode = AGENT_NODE_BY_ID[agentId];
    if (!expectedNode) {
      failures.push(`${toolName} declares unknown agent ${agentId}`);
      continue;
    }
    if (!workflow.nodes.some((node) => node.name === toolName)) {
      failures.push(`${toolName} is missing from the agent workflow`);
      continue;
    }
    const actual = targets(workflow, toolName, "ai_tool");
    if (actual.length !== 1 || actual[0] !== expectedNode) {
      failures.push(
        `${toolName} must connect only to ${expectedNode} (found ${actual.join(", ") || "none"})`,
      );
    }
  }

  for (const [sourceName, connection] of Object.entries(
    workflow.connections ?? {},
  )) {
    if (Array.isArray(connection.ai_tool) && !expectedTools.has(sourceName)) {
      failures.push(`${sourceName} is a connected tool with no declared owner`);
    }
  }

  return failures;
}

export function validateAgentRouting(workflow) {
  const failures = [];
  const route = workflow.nodes.find(
    (node) => node.name === "Route Selected Agent",
  );
  const rules = route?.parameters?.rules?.values ?? [];
  const outputs = workflow.connections?.["Route Selected Agent"]?.main ?? [];
  if (route?.type !== "n8n-nodes-base.switch" || route.typeVersion !== 3.4) {
    failures.push("Route Selected Agent must be Switch 3.4");
  }
  if (
    JSON.stringify(rules.map((rule) => rule.outputKey)) !==
    JSON.stringify(AGENT_IDS)
  ) {
    failures.push("agent switch outputs do not match the five reviewed IDs");
  }
  for (const [index, agentId] of AGENT_IDS.entries()) {
    const targetsForOutput = (outputs[index] ?? []).map(
      (connection) => connection.node,
    );
    if (
      targetsForOutput.length !== 1 ||
      targetsForOutput[0] !== AGENT_NODE_BY_ID[agentId]
    ) {
      failures.push(`${agentId} switch output is not isolated`);
    }
  }
  return failures;
}
