// Connects the Signal Research skill to your agent.
//
// The two workflow files and the skill folder arrive by copying them in, but two
// existing files also need one small addition each, and those files differ from
// one learner to the next. Overwriting them would wipe out whatever else you have
// switched on, so this makes the smallest possible edit instead.
//
// Safe to run twice. Anything already in place is left alone.

import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const done = [];
const skipped = [];
const problems = [];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const TOOL_NODE = `    {
      "parameters": {
        "description": "Search public YouTube comments for people describing a problem the user solves. Use when the user asks to find prospects, learn how their market describes a problem, discover what words real buyers use, or gather quotes for messaging. Pass a topic describing the problem rather than the product, and a comma-separated list of short phrases to look for. Reads public pages only; it never posts or contacts anyone.",
        "source": "database",
        "workflowId": {
          "__rl": true,
          "value": "phase10FindSignals",
          "mode": "list",
          "cachedResultName": "60 - TOOL - find_signals"
        },
        "workflowInputs": {
          "mappingMode": "defineBelow",
          "value": {
            "sessionId": "={{ $('Validate and Normalise').item.json.sessionId }}",
            "topic": "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('topic', 'What to search YouTube for. Describe the problem people have, not the product being sold.', 'string') }}",
            "phrases": "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('phrases', 'Comma-separated short phrases to look for in comments, such as: not technical, where to start, none of them stuck.', 'string') }}"
          },
          "matchingColumns": [],
          "schema": [
            { "id": "sessionId", "displayName": "sessionId", "required": false, "defaultMatch": false, "display": true, "canBeUsedToMatch": true, "type": "string" },
            { "id": "topic", "displayName": "topic", "required": false, "defaultMatch": false, "display": true, "canBeUsedToMatch": true, "type": "string" },
            { "id": "phrases", "displayName": "phrases", "required": false, "defaultMatch": false, "display": true, "canBeUsedToMatch": true, "type": "string" }
          ],
          "attemptToConvertTypes": true,
          "convertFieldsToString": false
        }
      },
      "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
      "typeVersion": 2.2,
      "position": [1480, 680],
      "id": "95300000-0000-4000-8000-000000000301",
      "name": "find_signals"
    }`;

const TOOL_CONNECTION = `    "find_signals": {
      "ai_tool": [
        [
          {
            "node": "Project Partner Agent",
            "type": "ai_tool",
            "index": 0
          }
        ]
      ]
    },`;

async function patchAgentWorkflow() {
  const path = join(projectRoot, "n8n", "workflows", "00-start-here-project-partner.json");
  if (!(await exists(path))) {
    problems.push("Could not find the main agent workflow. Are you in the project folder?");
    return;
  }
  let raw = await readFile(path, "utf8");

  if (raw.includes('"name": "find_signals"')) {
    skipped.push("The agent already knows about find_signals");
    return;
  }

  // The nodes array is the one immediately before "pinData" in every version of
  // this file, which makes it a reliable place to add a node without needing to
  // know which other tools a learner already has.
  const nodeAnchor = '\n  ],\n  "pinData":';
  // The tool connections are listed before the agent's own entry, and the
  // workflow checker compares that order exactly. Adding find_signals here puts
  // it last among the tools, which is where the checker expects a new one.
  const connAnchor = '\n    "Project Partner Agent": {';
  if (!raw.includes(nodeAnchor) || !raw.includes(connAnchor)) {
    problems.push("The agent workflow has an unexpected shape and was left untouched.");
    return;
  }

  raw = raw.replace(nodeAnchor, `,\n${TOOL_NODE}\n  ],\n  "pinData":`);
  raw = raw.replace(connAnchor, `\n${TOOL_CONNECTION}\n    "Project Partner Agent": {`);

  try {
    JSON.parse(raw);
  } catch (error) {
    problems.push(`Editing the agent workflow would have broken it (${error.message}). Nothing was changed.`);
    return;
  }
  await writeFile(path, raw);
  done.push("Told your agent it can use find_signals");
}

async function patchValidator() {
  const path = join(projectRoot, "scripts", "validate-workflows.mjs");
  if (!(await exists(path))) {
    skipped.push("No workflow checker found, so nothing needed changing there");
    return;
  }
  let raw = await readFile(path, "utf8");
  const before = raw;

  const additions = [
    ['"12-setup-signal-data.json"', '"11-setup-sync-enabled-skills.json",',
     '"11-setup-sync-enabled-skills.json",\n  "12-setup-signal-data.json",'],
    ['"60-tool-find-signals.json"', '"90-debug-agent-health.json",',
     '"60-tool-find-signals.json",\n  "90-debug-agent-health.json",'],
    ['"signal-research"', '"customer-support",\n];', '"customer-support",\n  "signal-research",\n];'],
  ];
  for (const [marker, anchor, replacement] of additions) {
    if (raw.includes(marker) || !raw.includes(anchor)) continue;
    raw = raw.replace(anchor, replacement);
  }

  // The list of tools allowed to reach the agent is an array literal, and it is
  // written on one line in some versions and across several in others depending
  // on how many tools are listed. Add to whichever shape is present rather than
  // replacing it, because a learner may have tools this installer knows nothing
  // about.
  raw = raw.replace(
    /(JSON\.stringify\(connectedToolNames\)\s*===\s*\n?\s*JSON\.stringify\(\[)([\s\S]*?)(\n?\s*\]\),)/,
    (whole, head, body, tail) => {
      if (/"find_signals"/.test(body)) return whole;
      const indent = (body.match(/\n(\s*)"/) ?? [null, "        "])[1];
      const addition = body.includes("\n")
        ? `${body.replace(/,?\s*$/, "")},\n${indent}"find_signals",`
        : `${body.replace(/\s*$/, "")}, "find_signals"`;
      return head + addition + tail;
    },
  );

  if (raw === before) {
    skipped.push("The workflow checker already allowed everything needed");
    return;
  }
  await writeFile(path, raw);
  done.push("Told the workflow checker about the two new workflows");
}

await patchAgentWorkflow();
await patchValidator();

console.log("");
for (const line of done) console.log(`  added    ${line}`);
for (const line of skipped) console.log(`  already  ${line}`);
for (const line of problems) console.log(`  PROBLEM  ${line}`);

if (problems.length > 0) {
  console.log("\nSomething did not fit. Nothing was half-changed — ask Claude Code for help.");
  process.exit(1);
}

console.log(`
Next, in this order:

  1. Get your free Google key and save it in n8n.
     Full instructions: docs/YOUTUBE_SIGNALS.md

  2. Restart the app so the new workflows load.
     macOS: double-click start.command   Windows: start-windows.cmd

  3. In n8n, open "12 - SETUP - Signal Data" and select Execute workflow.
     This makes the table your findings are saved into.

  4. In n8n, open "60 - TOOL - find_signals". The two blue boxes need your
     credential: open each, pick "YouTube API Key", and save.

  5. Open "00 - START HERE - Project Partner" and publish it again.

  6. Add this line to the end of skills/enabled.txt:  signal-research
     Then double-click sync-skills.command (or sync-skills-windows.cmd).

Then start a new conversation and try:
  Find people who are frustrated with their bookkeeping software.
  Look for the phrases: gave up, too expensive, hate, so confusing
`);
