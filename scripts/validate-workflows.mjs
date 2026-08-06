import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSkills } from "./compile-skills.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const workflowDirectory = join(projectRoot, "n8n", "workflows");
const expectedFiles = [
  "00-start-here-project-partner.json",
  "01-start-here-learner-checklist.json",
  "10-setup-local-task-data.json",
  "11-setup-sync-enabled-skills.json",
  "20-tool-list-tasks.json",
  "21-tool-create-task.json",
  "22-tool-update-task-status.json",
  "30-tool-propose-create-task.json",
  "31-tool-propose-update-task-status.json",
  "40-confirm-task-write.json",
  "50-tool-start-domain-research.json",
  "51-tool-complete-domain-research.json",
  "52-tool-get-business-memory.json",
  "90-debug-agent-health.json",
];
const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  check(Boolean(node), `${workflow.name}: missing node "${name}"`);
  return node;
}

function connectionTargets(workflow, sourceName, outputType, outputIndex) {
  return (
    workflow.connections[sourceName]?.[outputType]?.[outputIndex]?.map(
      (connection) => connection.node,
    ) ?? []
  );
}

const actualFiles = (await readdir(workflowDirectory))
  .filter((file) => file.endsWith(".json"))
  .sort();
check(
  JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
  `Expected only ${expectedFiles.join(", ")} in n8n/workflows`,
);

const workflows = new Map();
for (const file of expectedFiles) {
  const raw = await readFile(join(workflowDirectory, file), "utf8");
  let workflow;
  try {
    workflow = JSON.parse(raw);
  } catch (error) {
    failures.push(`${file}: invalid JSON (${error.message})`);
    continue;
  }

  workflows.set(file, workflow);
  check(workflow.active === false, `${file}: committed workflows must be inactive`);
  check(
    workflow.meta?.testedWithN8n === "2.30.5",
    `${file}: testedWithN8n must remain pinned to 2.30.5`,
  );
  check(
    new Set(workflow.nodes.map((node) => node.id)).size === workflow.nodes.length,
    `${file}: node IDs must be unique`,
  );
  check(
    !/sk-ant-|ANTHROPIC_API_KEY|"apiKey"\s*:/i.test(raw),
    `${file}: workflow exports must not contain an Anthropic secret`,
  );
  for (const node of workflow.nodes) {
    for (const credential of Object.values(node.credentials ?? {})) {
      check(
        credential &&
          typeof credential.id === "string" &&
          typeof credential.name === "string" &&
          Object.keys(credential).every((key) => key === "id" || key === "name"),
        `${file}: credential references may contain only id and name`,
      );
    }
  }
}

const checklistWorkflow = workflows.get("01-start-here-learner-checklist.json");
if (checklistWorkflow) {
  check(
    checklistWorkflow.name === "01 - START HERE - Learner Checklist",
    "Learner checklist must retain its numbered START HERE name",
  );
  check(
    checklistWorkflow.nodes.filter(
      (node) => node.type !== "n8n-nodes-base.stickyNote",
    ).length === 2,
    "Learner checklist must contain only one manual trigger and one result node",
  );
  check(
    checklistWorkflow.nodes.every((node) =>
      [
        "n8n-nodes-base.stickyNote",
        "n8n-nodes-base.manualTrigger",
        "n8n-nodes-base.code",
      ].includes(node.type),
    ),
    "Learner checklist may not contain credentialed, network, AI, or data nodes",
  );
  check(
    checklistWorkflow.nodes.every(
      (node) => Object.keys(node.credentials ?? {}).length === 0,
    ),
    "Learner checklist must not contain credential references",
  );
  const checklistText = checklistWorkflow.nodes
    .map(
      (node) =>
        `${node.parameters?.content ?? ""}\n${node.parameters?.jsCode ?? ""}`,
    )
    .join("\n");
  for (const requiredText of [
    "Anthropic account",
    "00 - START HERE - Project Partner",
    "90 - DEBUG - Agent Health",
    "CONFIRM XXXXXXXX",
    "apps/chat/public/agent.config.js",
    "skills/project-assistant/SKILL.md",
    "diagnostics helper",
  ]) {
    check(
      checklistText.includes(requiredText),
      `Learner checklist must mention "${requiredText}"`,
    );
  }
  check(
    connectionTargets(checklistWorkflow, "Run Checklist", "main", 0).includes(
      "Show Next Actions",
    ),
    "Learner checklist manual trigger must return the structured next actions",
  );
}

const agentWorkflow = workflows.get("00-start-here-project-partner.json");
if (agentWorkflow) {
  check(
    agentWorkflow.name === "00 - START HERE - Project Partner",
    "Agent workflow must retain the beginner-facing START HERE name",
  );
  check(
    agentWorkflow.nodes.filter((node) => node.type !== "n8n-nodes-base.stickyNote")
      .length <= 20,
    "Agent workflow must keep confirmation routing and tool wiring explainable",
  );
  check(
    agentWorkflow.settings?.executionTimeout === 110,
    "Agent workflow timeout must remain 110 seconds",
  );

  const webhook = nodeByName(agentWorkflow, "Chat Webhook");
  check(webhook?.type === "n8n-nodes-base.webhook", "Chat Webhook: wrong type");
  check(webhook?.typeVersion === 2.1, "Chat Webhook: wrong node version");
  check(webhook?.parameters?.httpMethod === "POST", "Chat Webhook: must use POST");
  check(webhook?.parameters?.path === "chat", "Chat Webhook: path must remain chat");
  check(
    webhook?.parameters?.responseMode === "responseNode",
    "Chat Webhook: must respond through Respond to Webhook",
  );

  const validation = nodeByName(agentWorkflow, "Validate and Normalise");
  const validationCode = validation?.parameters?.jsCode ?? "";
  check(validation?.type === "n8n-nodes-base.code", "Validation: wrong node type");
  check(/\.trim\(\)/.test(validationCode), "Validation: message must be trimmed");
  check(
    /message\.length > 8000/.test(validationCode),
    "Validation: 8,000-character instruction limit is missing",
  );
  check(
    /uuidPattern\.test\(sessionId\)/.test(validationCode),
    "Validation: session UUID check is missing",
  );
  check(
    /rawDocuments\.length > 3/.test(validationCode) &&
      /combinedCharacters > 200000/.test(validationCode) &&
      /text\.length > 150000/.test(validationCode),
    "Validation: document count and text-size limits are missing",
  );
  check(
    /\[\s*'project-manager',\s*'sales'\s*\]\.includes\(agentId\)/.test(
      validationCode,
    ),
    "Validation: active agent allow-list check is missing",
  );
  check(
    /schemaVersion === 3/.test(validationCode) &&
      /rawHistory\.length > 12/.test(validationCode) &&
      /historyCharacters > 24000/.test(validationCode) &&
      /uuidPattern\.test\(requestId\)/.test(validationCode),
    "Validation: durable-history contract version, request ID, turn, or character limit is missing",
  );

  const condition = nodeByName(agentWorkflow, "Request Is Valid?");
  check(condition?.type === "n8n-nodes-base.if", "Validation branch: wrong node type");
  check(
    connectionTargets(agentWorkflow, "Request Is Valid?", "main", 0).includes(
      "Route Confirmation",
    ),
    "Validation true branch must lead to deterministic confirmation routing",
  );
  check(
    connectionTargets(agentWorkflow, "Request Is Valid?", "main", 1).includes(
      "Return Invalid Request",
    ),
    "Validation false branch must lead to the safe error response",
  );

  const agent = nodeByName(agentWorkflow, "Project Partner Agent");
  check(
    agent?.type === "@n8n/n8n-nodes-langchain.agent" &&
      agent?.typeVersion === 3.1,
    "Agent: expected AI Agent 3.1",
  );
  check(agent?.parameters?.promptType === "define", "Agent: prompt must be explicit");
  check(
    agent?.parameters?.text === "={{ $json.message }}",
    "Agent: must use only the normalised message",
  );
  check(
    agent?.parameters?.options?.systemMessage === "={{ $json.systemMessage }}",
    "Agent: system instructions must come from the validated context builder",
  );
  check(
    agent?.parameters?.options?.maxIterations === 4,
    "Agent: maxIterations must remain 4",
  );
  check(
    agent?.parameters?.options?.enableStreaming === false,
    "Agent: streaming must remain disabled for the synchronous contract",
  );
  check(
    agent?.parameters?.options?.returnIntermediateSteps === false,
    "Agent: intermediate steps must not be returned",
  );

  const model = nodeByName(agentWorkflow, "Claude - Sonnet 4.6");
  check(
    model?.type === "@n8n/n8n-nodes-langchain.lmChatAnthropic" &&
      model?.typeVersion === 1.5,
    "Claude model: expected Anthropic Chat Model 1.5",
  );
  check(
    model?.parameters?.model?.value === "claude-sonnet-4-6",
    "Claude model: expected pinned claude-sonnet-4-6",
  );
  check(
    model?.parameters?.options?.maxTokensToSample === 2200,
    "Claude model: output token ceiling must remain 2,200",
  );
  check(
    connectionTargets(agentWorkflow, "Claude - Sonnet 4.6", "ai_languageModel", 0)
      .includes("Project Partner Agent"),
    "Claude model must be connected to the agent",
  );

  const memory = agentWorkflow.nodes.find(
    (node) => node.name === "Conversation Memory",
  );
  check(
    memory === undefined,
    "Memory: process-local Simple Memory must be removed when SQLite history is authoritative",
  );
  const contextBuilder = nodeByName(agentWorkflow, "Build Agent Context");
  const durableContextCode = contextBuilder?.parameters?.jsCode ?? "";
  check(
    /BEGIN SAVED CONVERSATION HISTORY/.test(durableContextCode) &&
      /EARLIER USER/.test(durableContextCode) &&
      /CURRENT USER INSTRUCTION/.test(durableContextCode) &&
      /never replay an earlier confirmation/.test(durableContextCode),
    "Memory: validated SQLite history must be labelled and kept distinct from the current instruction",
  );

  const listTool = nodeByName(agentWorkflow, "list_tasks");
  check(
    listTool?.type === "@n8n/n8n-nodes-langchain.toolWorkflow" &&
      listTool?.typeVersion === 2.2,
    "Agent: expected Call n8n Workflow Tool 2.2 for list_tasks",
  );
  check(
    listTool?.parameters?.workflowId?.value === "phase4ListTasks",
    "Agent: list_tasks must call the reviewed list subworkflow",
  );
  check(
    connectionTargets(agentWorkflow, "list_tasks", "ai_tool", 0).includes(
      "Project Partner Agent",
    ),
    "Agent: list_tasks must be connected as an AI tool",
  );
  const connectedToolNames = Object.entries(agentWorkflow.connections)
    .filter(([, connection]) => Array.isArray(connection.ai_tool))
    .map(([name]) => name);
  check(
    JSON.stringify(connectedToolNames) ===
      JSON.stringify([
        "list_tasks",
        "create_task",
        "update_task_status",
        "start_domain_research",
        "complete_domain_research",
        "get_business_memory",
      ]),
    "Agent: only the reviewed task and domain-research tools may be connected",
  );

  const createTool = nodeByName(agentWorkflow, "create_task");
  check(
    createTool?.parameters?.workflowId?.value === "phase5ProposeCreateTask" &&
      /proposal-only/i.test(createTool?.parameters?.description ?? ""),
    "Agent: create_task must call only the proposal workflow",
  );
  const updateTool = nodeByName(agentWorkflow, "update_task_status");
  check(
    updateTool?.parameters?.workflowId?.value === "phase5ProposeTaskStatus" &&
      /proposal-only/i.test(updateTool?.parameters?.description ?? ""),
    "Agent: update_task_status must call only the proposal workflow",
  );
  const startResearchTool = nodeByName(agentWorkflow, "start_domain_research");
  check(
    startResearchTool?.parameters?.workflowId?.value ===
      "phase9StartDomainResearch" &&
      /current user explicitly asks/i.test(
        startResearchTool?.parameters?.description ?? "",
      ) &&
      /own it or are authorised/i.test(
        startResearchTool?.parameters?.description ?? "",
      ),
    "Agent: start_domain_research must require a current explicit authorised request",
  );
  const completeResearchTool = nodeByName(
    agentWorkflow,
    "complete_domain_research",
  );
  check(
    completeResearchTool?.parameters?.workflowId?.value ===
      "phase9CompleteDomainResearch" &&
      /started in this conversation/i.test(
        completeResearchTool?.parameters?.description ?? "",
      ),
    "Agent: complete_domain_research must remain conversation-bound",
  );
  const getBusinessMemoryTool = nodeByName(
    agentWorkflow,
    "get_business_memory",
  );
  check(
    getBusinessMemoryTool?.parameters?.workflowId?.value ===
      "phase9GetBusinessMemory" &&
      /read-only source of truth/i.test(
        getBusinessMemoryTool?.parameters?.description ?? "",
      ),
    "Agent: get_business_memory must read only the reviewed local memory workflow",
  );

  const routeConfirmation = nodeByName(agentWorkflow, "Route Confirmation");
  check(
    /\^CONFIRM \[A-F0-9\]\{8\}\$/.test(
      routeConfirmation?.parameters?.jsCode ?? "",
    ),
    "Agent: confirmation routing must require the exact phrase format",
  );
  const exactConfirmation = nodeByName(agentWorkflow, "Exact Confirmation?");
  check(
    connectionTargets(agentWorkflow, "Exact Confirmation?", "main", 0).includes(
      "Confirm Stored Action",
    ) &&
      connectionTargets(agentWorkflow, "Exact Confirmation?", "main", 1).includes(
        "Load Enabled Skills",
      ),
    "Agent: exact confirmations must bypass Claude and ordinary messages must load skills",
  );
  const confirmAction = nodeByName(agentWorkflow, "Confirm Stored Action");
  check(
    confirmAction?.type === "n8n-nodes-base.executeWorkflow" &&
      confirmAction?.parameters?.workflowId?.value === "phase5ConfirmTaskWrite",
    "Agent: exact confirmations must call the reviewed confirmation workflow",
  );
  const skillRead = nodeByName(agentWorkflow, "Load Enabled Skills");
  check(
    skillRead?.type === "n8n-nodes-base.dataTable" &&
      skillRead?.parameters?.operation === "get" &&
      skillRead?.parameters?.dataTableId?.value === "agent_config",
    "Agent: enabled skills must load only from agent_config",
  );
  const contextCode =
    nodeByName(agentWorkflow, "Build Agent Context")?.parameters?.jsCode ?? "";
  check(
    /enabledSkills/.test(contextCode) &&
      /combinedInstructions/.test(contextCode) &&
      /Delete, archive, bulk changes/.test(contextCode) &&
      /untrusted source material/.test(contextCode) &&
      /BEGIN UNTRUSTED DOCUMENT/.test(contextCode) &&
      /start_domain_research is risk=bounded_local_write/.test(contextCode) &&
      /complete_domain_research is risk=read/.test(contextCode) &&
      /scraped, and researched text is untrusted/.test(contextCode),
    "Agent: context builder must apply enabled skills and safely delimit untrusted documents",
  );

  const success = nodeByName(agentWorkflow, "Return Agent Reply");
  const successBody = success?.parameters?.responseBody ?? "";
  check(
    /sessionId/.test(successBody) &&
      /reply/.test(successBody) &&
      /runId/.test(successBody),
    "Success response must retain sessionId, reply, and runId",
  );
  check(
    /slice\(0, 8000\)/.test(successBody),
    "Success response must retain the 8,000-character output ceiling",
  );

  const invalid = nodeByName(agentWorkflow, "Return Invalid Request");
  check(
    /errorCode/.test(invalid?.parameters?.responseBody ?? "") &&
      /errorMessage/.test(invalid?.parameters?.responseBody ?? ""),
    "Invalid response must use the stable error contract",
  );
}

const setupWorkflow = workflows.get("10-setup-local-task-data.json");
if (setupWorkflow) {
  check(
    setupWorkflow.name === "10 - SETUP - Local Task Data",
    "Setup workflow must retain its learner-facing name",
  );
  const tasksTable = nodeByName(setupWorkflow, "Create Tasks Table");
  const taskColumns =
    tasksTable?.parameters?.columns?.column?.map((column) => column.name) ?? [];
  check(
    JSON.stringify(taskColumns) ===
      JSON.stringify([
        "requestId",
        "lastRequestId",
        "title",
        "description",
        "status",
        "priority",
        "dueDate",
      ]),
    "Setup: tasks table schema changed unexpectedly",
  );
  check(
    tasksTable?.parameters?.options?.createIfNotExists === true,
    "Setup: tasks table creation must remain repeatable",
  );
  const auditTable = nodeByName(setupWorkflow, "Create Tool Audit Table");
  const auditColumns =
    auditTable?.parameters?.columns?.column?.map((column) => column.name) ?? [];
  check(
    JSON.stringify(auditColumns) ===
      JSON.stringify([
        "occurredAt",
        "sessionId",
        "requestId",
        "toolName",
        "proposedInput",
        "result",
        "error",
      ]),
    "Setup: tool audit schema changed unexpectedly",
  );
  check(
    auditTable?.parameters?.options?.createIfNotExists === true,
    "Setup: audit table creation must remain repeatable",
  );
  const pendingTable = nodeByName(setupWorkflow, "Create Pending Actions Table");
  const pendingColumns =
    pendingTable?.parameters?.columns?.column?.map((column) => column.name) ?? [];
  check(
    JSON.stringify(pendingColumns) ===
      JSON.stringify([
        "actionId",
        "sessionId",
        "actionType",
        "proposedInput",
        "confirmationText",
        "status",
        "expiresAt",
        "consumedAt",
      ]),
    "Setup: pending action schema changed unexpectedly",
  );
  check(
    pendingTable?.parameters?.options?.createIfNotExists === true,
    "Setup: pending action table creation must remain repeatable",
  );
  const setupWebhook = nodeByName(setupWorkflow, "Temporary Setup Webhook");
  check(
    setupWebhook?.parameters?.httpMethod === "POST" &&
      setupWebhook?.parameters?.path === "setup-task-data" &&
      setupWebhook?.parameters?.responseMode === "lastNode",
    "Setup: temporary webhook must remain a synchronous local POST",
  );
  const sampleCode =
    nodeByName(setupWorkflow, "Define Sample Tasks")?.parameters?.jsCode ?? "";
  check(
    (sampleCode.match(/00000000-0000-4000-8000-00000000010[1-3]/g) ?? [])
      .length === 3,
    "Setup: expected exactly three stable sample task request IDs",
  );
  check(
    nodeByName(setupWorkflow, "Keep Missing Samples")?.parameters?.operation ===
      "rowNotExists",
    "Setup: sample tasks must be inserted only when missing",
  );
}

const skillSyncWorkflow = workflows.get("11-setup-sync-enabled-skills.json");
if (skillSyncWorkflow) {
  check(
    skillSyncWorkflow.name === "11 - SETUP - Sync Enabled Skills",
    "Skill sync workflow must retain its learner-facing name",
  );
  const syncWebhook = nodeByName(
    skillSyncWorkflow,
    "Temporary Skill Sync Webhook",
  );
  check(
    syncWebhook?.parameters?.httpMethod === "POST" &&
      syncWebhook?.parameters?.path === "sync-enabled-skills" &&
      syncWebhook?.parameters?.responseMode === "lastNode",
    "Skill sync: temporary endpoint must remain a synchronous local POST",
  );
  const bundleValidation =
    nodeByName(skillSyncWorkflow, "Validate Skill Bundle")?.parameters?.jsCode ??
    "";
  check(
    /schemaVersion/.test(bundleValidation) &&
      /enabledSkills/.test(bundleValidation) &&
      /combinedInstructions\.length > 24000/.test(bundleValidation) &&
      /\[a-f0-9\]\{64\}/.test(bundleValidation),
    "Skill sync: bundle metadata, size, and source hash must be validated",
  );
  const configTable = nodeByName(skillSyncWorkflow, "Create Agent Config Table");
  check(
    configTable?.parameters?.tableName === "agent_config" &&
      JSON.stringify(
        configTable?.parameters?.columns?.column?.map((column) => column.name),
      ) === JSON.stringify(["configKey", "value", "sourceHash"]),
    "Skill sync: agent_config schema changed unexpectedly",
  );
  const upsert = nodeByName(skillSyncWorkflow, "Upsert Enabled Skills");
  check(
    upsert?.parameters?.operation === "upsert" &&
      upsert?.parameters?.dataTableId?.value === "agent_config" &&
      upsert?.parameters?.filters?.conditions?.some(
        (condition) =>
          condition.keyName === "configKey" &&
          condition.keyValue === "enabledSkills",
      ),
    "Skill sync: enabled skill bundle must replace one stable config row",
  );
}

const toolFiles = [
  "20-tool-list-tasks.json",
  "21-tool-create-task.json",
  "22-tool-update-task-status.json",
];
const expectedToolInputs = {
  "20-tool-list-tasks.json": ["sessionId", "status", "priority"],
  "21-tool-create-task.json": [
    "sessionId",
    "requestId",
    "title",
    "description",
    "status",
    "priority",
    "dueDate",
  ],
  "22-tool-update-task-status.json": [
    "sessionId",
    "requestId",
    "taskId",
    "status",
  ],
};
const expectedRisk = {
  "20-tool-list-tasks.json": "read",
  "21-tool-create-task.json": "write",
  "22-tool-update-task-status.json": "write",
};
const allowedToolNodeTypes = new Set([
  "n8n-nodes-base.stickyNote",
  "n8n-nodes-base.executeWorkflowTrigger",
  "n8n-nodes-base.code",
  "n8n-nodes-base.if",
  "n8n-nodes-base.dataTable",
]);

for (const file of toolFiles) {
  const workflow = workflows.get(file);
  if (!workflow) {
    continue;
  }
  const trigger = nodeByName(workflow, "Tool Input");
  const inputNames =
    trigger?.parameters?.workflowInputs?.values?.map((input) => input.name) ?? [];
  check(
    trigger?.type === "n8n-nodes-base.executeWorkflowTrigger" &&
      trigger?.typeVersion === 1.2,
    `${workflow.name}: expected typed Execute Workflow Trigger 1.2`,
  );
  check(
    JSON.stringify(inputNames) === JSON.stringify(expectedToolInputs[file]),
    `${workflow.name}: visible input schema changed unexpectedly`,
  );
  check(
    workflow.meta?.toolRisk === expectedRisk[file],
    `${workflow.name}: tool risk metadata is missing or incorrect`,
  );
  check(
    workflow.nodes.every((node) => allowedToolNodeTypes.has(node.type)),
    `${workflow.name}: tool contains a node outside the narrow allowlist`,
  );
  check(
    workflow.nodes
      .filter((node) => node.type === "n8n-nodes-base.dataTable")
      .every((node) =>
        ["tasks", "tool_audit"].includes(node.parameters?.dataTableId?.value),
      ),
    `${workflow.name}: tool may access only tasks and tool_audit`,
  );
  const auditNode = nodeByName(workflow, "Write Tool Audit");
  check(
    auditNode?.parameters?.operation === "insert" &&
      auditNode?.parameters?.dataTableId?.value === "tool_audit",
    `${workflow.name}: every result must be written to tool_audit`,
  );
  const auditFields = Object.keys(
    auditNode?.parameters?.columns?.value ?? {},
  ).sort();
  check(
    JSON.stringify(auditFields) ===
      JSON.stringify(
        [
          "error",
          "occurredAt",
          "proposedInput",
          "requestId",
          "result",
          "sessionId",
          "toolName",
        ].sort(),
      ),
    `${workflow.name}: audit mapping must retain all required fields`,
  );
}

const listWorkflow = workflows.get("20-tool-list-tasks.json");
if (listWorkflow) {
  const taskNodes = listWorkflow.nodes.filter(
    (node) =>
      node.type === "n8n-nodes-base.dataTable" &&
      node.parameters?.dataTableId?.value === "tasks",
  );
  check(
    taskNodes.length === 1 && taskNodes[0].parameters?.operation === "get",
    "list_tasks must have exactly one read-only task-table operation",
  );
  const validation =
    nodeByName(listWorkflow, "Validate List Input")?.parameters?.jsCode ?? "";
  check(
    /INVALID_STATUS/.test(validation) && /INVALID_PRIORITY/.test(validation),
    "list_tasks must validate status and priority filters",
  );
}

const createWorkflow = workflows.get("21-tool-create-task.json");
if (createWorkflow) {
  check(
    createWorkflow.meta?.agentConnection === "confirmation-executor-only",
    "create_task worker must be reachable only through confirmation",
  );
  const taskOperations = createWorkflow.nodes
    .filter(
      (node) =>
        node.type === "n8n-nodes-base.dataTable" &&
        node.parameters?.dataTableId?.value === "tasks",
    )
    .map((node) => node.parameters.operation);
  check(
    JSON.stringify(taskOperations) === JSON.stringify(["get", "insert"]),
    "create_task must only look up an idempotency key and insert one task",
  );
  const validation =
    nodeByName(createWorkflow, "Validate Create Input")?.parameters?.jsCode ?? "";
  check(
    /title\.length === 0/.test(validation) &&
      /title\.length > 120/.test(validation) &&
      /description\.length > 2000/.test(validation) &&
      /INVALID_STATUS/.test(validation),
    "create_task must retain title, description, and status validation",
  );
  check(
    /IDEMPOTENCY_CONFLICT/.test(
      nodeByName(createWorkflow, "Decide Create Action")?.parameters?.jsCode ?? "",
    ),
    "create_task must reject reuse of a request ID with different input",
  );
}

const updateWorkflow = workflows.get("22-tool-update-task-status.json");
if (updateWorkflow) {
  check(
    updateWorkflow.meta?.agentConnection === "confirmation-executor-only",
    "update_task_status worker must be reachable only through confirmation",
  );
  const taskOperations = updateWorkflow.nodes
    .filter(
      (node) =>
        node.type === "n8n-nodes-base.dataTable" &&
        node.parameters?.dataTableId?.value === "tasks",
    )
    .map((node) => node.parameters.operation);
  check(
    JSON.stringify(taskOperations) === JSON.stringify(["get", "update"]),
    "update_task_status must only read a task and update it",
  );
  const updateFields = Object.keys(
    nodeByName(updateWorkflow, "Update Task Status")?.parameters?.columns?.value ??
      {},
  ).sort();
  check(
    JSON.stringify(updateFields) ===
      JSON.stringify(["lastRequestId", "status"]),
    "update_task_status may change only status and its idempotency marker",
  );
  const validation =
    nodeByName(updateWorkflow, "Validate Update Input")?.parameters?.jsCode ?? "";
  check(
    /INVALID_TASK_ID/.test(validation) && /INVALID_STATUS/.test(validation),
    "update_task_status must validate task ID and status",
  );
}

const researchToolFiles = [
  "50-tool-start-domain-research.json",
  "51-tool-complete-domain-research.json",
  "52-tool-get-business-memory.json",
];
const researchToolInputs = {
  "50-tool-start-domain-research.json": [
    "sessionId",
    "requestId",
    "domain",
    "companyName",
    "researchDepth",
    "authorizationConfirmed",
  ],
  "51-tool-complete-domain-research.json": [
    "sessionId",
    "requestId",
    "jobId",
  ],
  "52-tool-get-business-memory.json": ["sessionId", "requestId", "domain"],
};
const researchToolRisks = {
  // 50 reads the domain and then saves; 51 only reports what 50 saved.
  "50-tool-start-domain-research.json": "bounded_local_write",
  "51-tool-complete-domain-research.json": "read",
  "52-tool-get-business-memory.json": "read",
};
const allowedResearchNodeTypes = new Set([
  "n8n-nodes-base.stickyNote",
  "n8n-nodes-base.executeWorkflowTrigger",
  "n8n-nodes-base.code",
  "n8n-nodes-base.if",
  "n8n-nodes-base.httpRequest",
  "n8n-nodes-base.dataTable",
]);

for (const file of researchToolFiles) {
  const workflow = workflows.get(file);
  if (!workflow) {
    continue;
  }
  const inputNames =
    nodeByName(workflow, "Tool Input")?.parameters?.workflowInputs?.values?.map(
      (input) => input.name,
    ) ?? [];
  check(
    JSON.stringify(inputNames) === JSON.stringify(researchToolInputs[file]),
    `${workflow.name}: visible input schema changed unexpectedly`,
  );
  check(
    workflow.meta?.toolRisk === researchToolRisks[file],
    `${workflow.name}: reviewed risk metadata is missing`,
  );
  check(
    workflow.nodes.every((node) => allowedResearchNodeTypes.has(node.type)),
    `${workflow.name}: contains a node outside the research-tool allowlist`,
  );
  const httpNodes = workflow.nodes.filter(
    (node) => node.type === "n8n-nodes-base.httpRequest",
  );
  // Research runs locally: the only destinations are the local chat API, the
  // Anthropic API, and the researched domain itself. The domain URL must be
  // built from the validated domain so it can never be an arbitrary address.
  const researchedDomainUrl =
    "={{ 'https://' + $('Validate Start Input').item.json.domain + '/' }}";
  check(
    httpNodes.every((node) => {
      const url = String(node.parameters?.url ?? "");
      return (
        !url.includes("$env") &&
        (/127\.0\.0\.1:3000\/api\/business-memory/.test(url) ||
          url === "https://api.anthropic.com/v1/messages" ||
          url === researchedDomainUrl)
      );
    }),
    `${workflow.name}: HTTP destinations must stay on the reviewed local API, the Anthropic API, or the validated domain`,
  );
  check(
    httpNodes.every((node) => {
      const url = String(node.parameters?.url ?? "");
      const credentialNames = Object.keys(node.credentials ?? {});
      if (url === "https://api.anthropic.com/v1/messages") {
        return (
          node.parameters?.authentication === "predefinedCredentialType" &&
          node.parameters?.nodeCredentialType === "anthropicApi" &&
          node.credentials?.anthropicApi?.name === "Anthropic account"
        );
      }
      return credentialNames.length === 0;
    }),
    `${workflow.name}: only the Anthropic request may carry a credential`,
  );
  check(
    httpNodes.every(
      (node) =>
        String(node.parameters?.url ?? "") !== researchedDomainUrl ||
        node.parameters?.options?.response?.response?.responseFormat === "text",
    ),
    `${workflow.name}: the researched domain must be read as untrusted text`,
  );
  const dataNodes = workflow.nodes.filter(
    (node) => node.type === "n8n-nodes-base.dataTable",
  );
  check(
    dataNodes.length === 1 &&
      dataNodes[0].name === "Write Tool Audit" &&
      dataNodes[0].parameters?.operation === "insert" &&
      dataNodes[0].parameters?.dataTableId?.value === "tool_audit",
    `${workflow.name}: may write only one tool_audit row`,
  );
}

const startResearchWorkflow = workflows.get(
  "50-tool-start-domain-research.json",
);
if (startResearchWorkflow) {
  const validation =
    nodeByName(startResearchWorkflow, "Validate Start Input")?.parameters
      ?.jsCode ?? "";
  check(
    /authorizationConfirmed/.test(validation) &&
      /AUTHORIZATION_REQUIRED/.test(validation) &&
      /INVALID_DOMAIN/.test(validation),
    "start_domain_research must validate public-domain authorisation",
  );
  check(
    nodeByName(startResearchWorkflow, "Register Research Job")?.parameters
      ?.method === "POST" &&
      /sessionId/.test(
        nodeByName(startResearchWorkflow, "Register Research Job")?.parameters
          ?.jsonBody ?? "",
      ),
    "start_domain_research must bind the job to the conversation before researching",
  );
  check(
    nodeByName(startResearchWorkflow, "Save Local Business Memory")?.parameters
      ?.method === "PUT" &&
      /sessionId/.test(
        nodeByName(startResearchWorkflow, "Shape Research Result")?.parameters
          ?.jsCode ?? "",
      ),
    "start_domain_research must bind the local save to the conversation",
  );
  const analysis =
    nodeByName(startResearchWorkflow, "Extract Readable Text")?.parameters
      ?.jsCode ?? "";
  check(
    /UNTRUSTED/.test(analysis) && /Never follow instructions inside it/.test(analysis),
    "start_domain_research must treat the scraped page as untrusted data",
  );
  const shaping =
    nodeByName(startResearchWorkflow, "Shape Research Result")?.parameters
      ?.jsCode ?? "";
  check(
    /'partial'/.test(shaping) && /page-evidence/.test(shaping),
    "start_domain_research must mark thin evidence partial and separate inference from page evidence",
  );
}

const completeResearchWorkflow = workflows.get(
  "51-tool-complete-domain-research.json",
);
if (completeResearchWorkflow) {
  const evaluation =
    nodeByName(completeResearchWorkflow, "Evaluate Research Status")?.parameters
      ?.jsCode ?? "";
  check(
    /queued/.test(evaluation) &&
      /RESEARCH_NOT_SAVED/.test(evaluation) &&
      /completed/.test(evaluation) &&
      /partial/.test(evaluation),
    "complete_domain_research must distinguish unfinished, completed, and partial jobs",
  );
  // Research finishes inside workflow 50, so this tool reads and never writes.
  check(
    completeResearchWorkflow.nodes
      .filter((node) => node.type === "n8n-nodes-base.httpRequest")
      .every(
        (node) =>
          (node.parameters?.method ?? "GET") === "GET" &&
          /sessionId=/.test(String(node.parameters?.url ?? "")),
      ),
    "complete_domain_research may only read its own conversation's saved research",
  );
}

const getBusinessMemoryWorkflow = workflows.get(
  "52-tool-get-business-memory.json",
);
if (getBusinessMemoryWorkflow) {
  const httpNodes = getBusinessMemoryWorkflow.nodes.filter(
    (node) => node.type === "n8n-nodes-base.httpRequest",
  );
  check(
    httpNodes.length === 1 &&
      (httpNodes[0].parameters?.method === undefined ||
        httpNodes[0].parameters?.method === "GET"),
    "get_business_memory must make exactly one local GET request",
  );
}

const proposalFiles = [
  "30-tool-propose-create-task.json",
  "31-tool-propose-update-task-status.json",
];
const proposalInputs = {
  "30-tool-propose-create-task.json": [
    "sessionId",
    "title",
    "description",
    "status",
    "priority",
    "dueDate",
  ],
  "31-tool-propose-update-task-status.json": [
    "sessionId",
    "taskId",
    "status",
  ],
};

for (const file of proposalFiles) {
  const workflow = workflows.get(file);
  if (!workflow) {
    continue;
  }

  check(
    workflow.meta?.toolRisk === "write" &&
      workflow.meta?.taskMutation === "none" &&
      workflow.meta?.confirmation === "required-before-execution",
    `${workflow.name}: proposal safety metadata is incomplete`,
  );
  check(
    workflow.nodes.every((node) => allowedToolNodeTypes.has(node.type)),
    `${workflow.name}: proposal contains a node outside the narrow allowlist`,
  );
  const inputNames =
    nodeByName(workflow, "Tool Input")?.parameters?.workflowInputs?.values?.map(
      (input) => input.name,
    ) ?? [];
  check(
    JSON.stringify(inputNames) === JSON.stringify(proposalInputs[file]),
    `${workflow.name}: proposal inputs changed unexpectedly`,
  );

  const pendingOperations = workflow.nodes
    .filter(
      (node) =>
        node.type === "n8n-nodes-base.dataTable" &&
        node.parameters?.dataTableId?.value === "pending_actions",
    )
    .map((node) => node.parameters.operation);
  check(
    JSON.stringify(pendingOperations) === JSON.stringify(["update", "insert"]),
    `${workflow.name}: proposal may only supersede and insert pending actions`,
  );
  check(
    !workflow.nodes.some(
      (node) =>
        node.type === "n8n-nodes-base.dataTable" &&
        node.parameters?.dataTableId?.value === "tasks" &&
        node.parameters?.operation !== "get",
    ),
    `${workflow.name}: proposal must not mutate the task table`,
  );
  const validationCode = workflow.nodes
    .filter((node) => node.type === "n8n-nodes-base.code")
    .map((node) => node.parameters?.jsCode ?? "")
    .join("\n");
  check(
    /5 \* 60 \* 1000/.test(validationCode) &&
      /\^CONFIRM/.test(
        nodeByName(agentWorkflow, "Route Confirmation")?.parameters?.jsCode ?? "",
      ),
    `${workflow.name}: proposals must expire after five minutes`,
  );
  check(
    /CONFIRM \$\{actionId/.test(validationCode),
    `${workflow.name}: proposal must derive an exact phrase from its action ID`,
  );
  const proposalAudit = nodeByName(workflow, "Write Tool Audit");
  check(
    proposalAudit?.parameters?.operation === "insert" &&
      proposalAudit?.parameters?.dataTableId?.value === "tool_audit",
    `${workflow.name}: proposal outcomes must be audited`,
  );
}

const confirmWorkflow = workflows.get("40-confirm-task-write.json");
if (confirmWorkflow) {
  check(
    confirmWorkflow.name === "40 - CONFIRM - Task Write",
    "Confirmation workflow must retain its learner-facing name",
  );
  check(
    confirmWorkflow.meta?.confirmation?.sessionBound === true &&
      confirmWorkflow.meta?.confirmation?.exactArguments === true &&
      confirmWorkflow.meta?.confirmation?.expiresMinutes === 5 &&
      confirmWorkflow.meta?.confirmation?.singleUse === true &&
      confirmWorkflow.meta?.confirmation?.consumeBeforeWrite === true,
    "Confirmation workflow safety metadata is incomplete",
  );
  const allowedConfirmationNodeTypes = new Set([
    "n8n-nodes-base.stickyNote",
    "n8n-nodes-base.executeWorkflowTrigger",
    "n8n-nodes-base.code",
    "n8n-nodes-base.if",
    "n8n-nodes-base.dataTable",
    "n8n-nodes-base.executeWorkflow",
  ]);
  check(
    confirmWorkflow.nodes.every((node) =>
      allowedConfirmationNodeTypes.has(node.type),
    ),
    "Confirmation workflow contains an unreviewed capability",
  );
  const confirmationInputNames =
    nodeByName(confirmWorkflow, "Confirmation Input")?.parameters?.workflowInputs
      ?.values?.map((input) => input.name) ?? [];
  check(
    JSON.stringify(confirmationInputNames) ===
      JSON.stringify(["sessionId", "confirmationText"]),
    "Confirmation workflow may accept only session and exact phrase",
  );
  const confirmationValidation =
    nodeByName(confirmWorkflow, "Validate Confirmation")?.parameters?.jsCode ?? "";
  check(
    /\^CONFIRM \[A-F0-9\]\{8\}\$/.test(confirmationValidation) &&
      /uuidPattern\.test\(sessionId\)/.test(confirmationValidation),
    "Confirmation workflow must validate exact phrase and browser session",
  );
  const findProposal = nodeByName(confirmWorkflow, "Find Exact Proposal");
  const findKeys =
    findProposal?.parameters?.filters?.conditions?.map(
      (condition) => condition.keyName,
    ) ?? [];
  check(
    findProposal?.parameters?.dataTableId?.value === "pending_actions" &&
      JSON.stringify(findKeys) ===
        JSON.stringify(["sessionId", "confirmationText"]),
    "Confirmation lookup must bind exact phrase to the same session",
  );
  const evaluation =
    nodeByName(confirmWorkflow, "Evaluate Proposal")?.parameters?.jsCode ?? "";
  check(
    /CONFIRMATION_EXPIRED/.test(evaluation) &&
      /CONFIRMATION_ALREADY_USED/.test(evaluation) &&
      /CONFIRMATION_SUPERSEDED/.test(evaluation) &&
      /Date\.parse\(row\.expiresAt\) <= Date\.now\(\)/.test(evaluation),
    "Confirmation workflow must reject expired, used, and superseded proposals",
  );
  const consume = nodeByName(confirmWorkflow, "Consume Exact Proposal");
  const consumeFilters =
    consume?.parameters?.filters?.conditions?.map((condition) => [
      condition.keyName,
      condition.keyValue,
    ]) ?? [];
  check(
    consume?.parameters?.operation === "update" &&
      consume?.parameters?.dataTableId?.value === "pending_actions" &&
      JSON.stringify(consumeFilters.map(([key]) => key)) ===
        JSON.stringify(["actionId", "sessionId", "status"]) &&
      consumeFilters.some(
        ([key, value]) => key === "status" && value === "pending",
      ),
    "Confirmation consumption must conditionally bind action, session, and pending status",
  );
  const consumeFields = Object.keys(consume?.parameters?.columns?.value ?? {}).sort();
  check(
    JSON.stringify(consumeFields) ===
      JSON.stringify(["consumedAt", "status"]),
    "Confirmation may mark only status and consumption time",
  );
  check(
    connectionTargets(confirmWorkflow, "Proposal Is Ready?", "main", 0).includes(
      "Consume Exact Proposal",
    ) &&
      connectionTargets(confirmWorkflow, "Consume Exact Proposal", "main", 0).includes(
        "Verify Single Use",
      ) &&
      connectionTargets(confirmWorkflow, "Proposal Was Consumed?", "main", 0).includes(
        "Create Task Action?",
      ),
    "Confirmation must consume and verify single use before dispatching a write",
  );
  const executionTargets = confirmWorkflow.nodes
    .filter((node) => node.type === "n8n-nodes-base.executeWorkflow")
    .map((node) => node.parameters?.workflowId?.value)
    .sort();
  check(
    JSON.stringify(executionTargets) ===
      JSON.stringify(["phase4CreateTask", "phase4UpdateTaskStatus"]),
    "Confirmation may dispatch only the two reviewed task write workers",
  );
}

const REVIEWED_SKILL_IDS = [
  "project-assistant",
  "meeting-analysis",
  "task-capture",
  "weekly-status",
];
// Skills that ship switched off. A learner may enable any of them, so the
// check below guarantees the reviewed set is still present and that nothing
// unreviewed has been enabled, rather than demanding an exact list.
const OPTIONAL_SKILL_IDS = [
  "my-business",
  "lead-conversion",
  "prospect-research",
  "deal-desk",
  "customer-support",
  "domain-research",
];

const skillBundle = await compileSkills(join(projectRoot, "skills"));
const enabledSkillIds = skillBundle.enabledSkills.map((skill) => skill.id);
check(
  REVIEWED_SKILL_IDS.every((id) => enabledSkillIds.includes(id)),
  "Enabled skill list must contain the reviewed Project Manager skills",
);
check(
  enabledSkillIds.every(
    (id) => REVIEWED_SKILL_IDS.includes(id) || OPTIONAL_SKILL_IDS.includes(id),
  ),
  "Enabled skill list must contain only reviewed or shipped optional skills",
);
check(
  skillBundle.combinedInstructions.length <= 24_000 &&
    /^[a-f0-9]{64}$/.test(skillBundle.sourceHash),
  "Compiled skill bundle must remain bounded and content-addressed",
);

const toolPolicy = JSON.parse(
  await readFile(join(projectRoot, "tools", "policy.json"), "utf8"),
);
const availableToolPolicy = toolPolicy.tools.filter((tool) => tool.available);
check(
  toolPolicy.schemaVersion === 1 &&
    JSON.stringify(
      availableToolPolicy.map((tool) => [tool.id, tool.risk, tool.mode]),
    ) ===
      JSON.stringify([
        ["list_tasks", "read", "automatic"],
        ["create_task", "write", "confirmation_required"],
        ["update_task_status", "write", "confirmation_required"],
        [
          "start_domain_research",
          "bounded_local_write",
          "explicit_request_required",
        ],
        ["complete_domain_research", "read", "explicit_request_required"],
        ["get_business_memory", "read", "automatic"],
      ]),
  "Tool policy must classify the reviewed task and domain-research tools",
);
check(
  toolPolicy.tools
    .filter((tool) => tool.risk === "destructive")
    .every((tool) => tool.available === false && tool.modelCallable === false),
  "Every destructive tool must remain unavailable to the model",
);

const healthWorkflow = workflows.get("90-debug-agent-health.json");
if (healthWorkflow) {
  check(
    healthWorkflow.name === "90 - DEBUG - Agent Health",
    "Health workflow must retain its DEBUG name",
  );
  check(
    healthWorkflow.nodes.filter((node) => node.type !== "n8n-nodes-base.stickyNote")
      .length === 2,
    "Health workflow should contain only a webhook and response node",
  );
  check(
    healthWorkflow.nodes.every((node) => !node.credentials),
    "Health workflow must not reference credentials",
  );
  const webhook = nodeByName(healthWorkflow, "Agent Health Webhook");
  check(webhook?.parameters?.httpMethod === "GET", "Health webhook must use GET");
  check(
    webhook?.parameters?.path === "agent-health",
    "Health webhook path must remain agent-health",
  );
  const response = nodeByName(healthWorkflow, "Return Safe Health");
  const body = response?.parameters?.responseBody ?? "";
  check(
    /status/.test(body) && /service/.test(body) && !/credential|secret|environment/i.test(body),
    "Health response must contain only safe status fields",
  );
}

if (failures.length > 0) {
  console.error("Workflow validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Workflow validation passed for ${expectedFiles.length} files (n8n 2.30.5).`,
);
