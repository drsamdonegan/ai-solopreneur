#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_STATUSES = new Set(["not_run", "in_progress", "complete"]);
const ALLOWED_OPERATING_SYSTEMS = new Set(["macos", "windows"]);
const ALLOWED_OUTCOMES = new Set(["completed", "stopped", "not_started"]);
const ALLOWED_INTERVENTION_CATEGORIES = new Set([
  "anthropic-account",
  "claude-credential",
  "runtime-download",
  "github-desktop",
  "n8n",
  "ports",
  "repository",
  "skills",
  "other",
]);
const PERSONAL_DATA_KEYS = new Set([
  "address",
  "email",
  "fullName",
  "name",
  "participantName",
  "phone",
]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function findPersonalDataKeys(value, path = "$", matches = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      findPersonalDataKeys(entry, `${path}[${index}]`, matches),
    );
    return matches;
  }
  if (!isPlainObject(value)) {
    return matches;
  }
  for (const [key, child] of Object.entries(value)) {
    if (PERSONAL_DATA_KEYS.has(key)) {
      matches.push(`${path}.${key}`);
    }
    findPersonalDataKeys(child, `${path}.${key}`, matches);
  }
  return matches;
}

function validateIntervention(value, path, errors) {
  if (!isPlainObject(value)) {
    addError(errors, path, "must be an object");
    return;
  }
  if (!ALLOWED_INTERVENTION_CATEGORIES.has(value.category)) {
    addError(
      errors,
      `${path}.category`,
      `must be one of ${[...ALLOWED_INTERVENTION_CATEGORIES].join(", ")}`,
    );
  }
  if (!isNonEmptyString(value.description)) {
    addError(errors, `${path}.description`, "must be a non-empty string");
  }
  if (!isNonEmptyString(value.resolution)) {
    addError(errors, `${path}.resolution`, "must be a non-empty string");
  }
  if (
    !Number.isInteger(value.minutes) ||
    value.minutes < 0 ||
    value.minutes > 240
  ) {
    addError(errors, `${path}.minutes`, "must be an integer from 0 to 240");
  }
}

function validateHandoff(value, path, teamId, errors) {
  if (value === null) {
    return;
  }
  if (!isPlainObject(value)) {
    addError(errors, path, "must be null or an object");
    return;
  }
  if (!isNonEmptyString(value.sourceTeamId)) {
    addError(errors, `${path}.sourceTeamId`, "must be a non-empty string");
  } else if (value.sourceTeamId === teamId) {
    addError(errors, `${path}.sourceTeamId`, "must identify another team");
  }
  for (const key of ["startedSuccessfully", "noVerbalHelp"]) {
    if (typeof value[key] !== "boolean") {
      addError(errors, `${path}.${key}`, "must be a boolean");
    }
  }
}

function validateSession(value, index, errors) {
  const path = `$.sessions[${index}]`;
  if (!isPlainObject(value)) {
    addError(errors, path, "must be an object");
    return;
  }

  for (const key of [
    "pilotId",
    "teamId",
    "browser",
    "startedAt",
    "finishedAt",
  ]) {
    if (!isNonEmptyString(value[key])) {
      addError(errors, `${path}.${key}`, "must be a non-empty string");
    }
  }
  if (typeof value.priorInvolvement !== "boolean") {
    addError(errors, `${path}.priorInvolvement`, "must be a boolean");
  }
  if (!ALLOWED_OPERATING_SYSTEMS.has(value.operatingSystem)) {
    addError(errors, `${path}.operatingSystem`, "must be macos or windows");
  }
  if (
    !Number.isInteger(value.browserWidthPx) ||
    value.browserWidthPx < 320 ||
    value.browserWidthPx > 10_000
  ) {
    addError(
      errors,
      `${path}.browserWidthPx`,
      "must be an integer from 320 to 10000",
    );
  }
  if (!ALLOWED_OUTCOMES.has(value.outcome)) {
    addError(
      errors,
      `${path}.outcome`,
      "must be completed, stopped, or not_started",
    );
  }
  if (
    value.minutesToFirstClaudeResponse !== null &&
    (!Number.isFinite(value.minutesToFirstClaudeResponse) ||
      value.minutesToFirstClaudeResponse < 0 ||
      value.minutesToFirstClaudeResponse > 240)
  ) {
    addError(
      errors,
      `${path}.minutesToFirstClaudeResponse`,
      "must be null or a number from 0 to 240",
    );
  }

  for (const key of [
    "preflightCompleted",
    "customisedInterface",
    "customisedSkill",
    "demonstratedReadTool",
    "demonstratedApprovedWrite",
  ]) {
    if (typeof value[key] !== "boolean") {
      addError(errors, `${path}.${key}`, "must be a boolean");
    }
  }

  if (!Array.isArray(value.instructorInterventions)) {
    addError(errors, `${path}.instructorInterventions`, "must be an array");
  } else {
    value.instructorInterventions.forEach((intervention, interventionIndex) =>
      validateIntervention(
        intervention,
        `${path}.instructorInterventions[${interventionIndex}]`,
        errors,
      ),
    );
  }

  validateHandoff(
    value.crossTeamHandoff,
    `${path}.crossTeamHandoff`,
    value.teamId,
    errors,
  );

  if (typeof value.observerNotes !== "string") {
    addError(errors, `${path}.observerNotes`, "must be a string");
  }
}

export function validatePilot(data) {
  const errors = [];
  if (!isPlainObject(data)) {
    return { valid: false, errors: ["$: must be an object"] };
  }
  if (data.schemaVersion !== 1) {
    addError(errors, "$.schemaVersion", "must equal 1");
  }
  if (!ALLOWED_STATUSES.has(data.pilotStatus)) {
    addError(
      errors,
      "$.pilotStatus",
      "must be not_run, in_progress, or complete",
    );
  }
  if (
    data.updatedAt !== null &&
    (!isNonEmptyString(data.updatedAt) ||
      Number.isNaN(Date.parse(data.updatedAt)))
  ) {
    addError(errors, "$.updatedAt", "must be null or an ISO date-time");
  }
  if (
    !Number.isInteger(data.targetParticipantCount) ||
    data.targetParticipantCount < 5
  ) {
    addError(errors, "$.targetParticipantCount", "must be an integer of at least 5");
  }
  if (!Array.isArray(data.sessions)) {
    addError(errors, "$.sessions", "must be an array");
  } else {
    data.sessions.forEach((session, index) =>
      validateSession(session, index, errors),
    );
    const ids = data.sessions
      .map((session) => session?.pilotId)
      .filter(isNonEmptyString);
    if (new Set(ids).size !== ids.length) {
      addError(errors, "$.sessions", "pilotId values must be unique");
    }
  }

  for (const path of findPersonalDataKeys(data)) {
    addError(errors, path, "personal data is not allowed in pilot evidence");
  }
  return { valid: errors.length === 0, errors };
}

function criterion(id, passed, actual, expected) {
  return { id, passed, actual, expected };
}

export function evaluatePilot(data) {
  const validation = validatePilot(data);
  if (!validation.valid) {
    return {
      decision: "INVALID",
      pilotStatus: data?.pilotStatus ?? null,
      validationErrors: validation.errors,
      metrics: null,
      criteria: [],
    };
  }

  const sessions = data.sessions;
  const successfulWithinThirty = sessions.filter(
    (session) =>
      session.minutesToFirstClaudeResponse !== null &&
      session.minutesToFirstClaudeResponse <= 30,
  ).length;
  const responseRate =
    sessions.length === 0 ? 0 : successfulWithinThirty / sessions.length;
  const operatingSystems = [...new Set(
    sessions.map((session) => session.operatingSystem),
  )].sort();
  const teams = [...new Set(sessions.map((session) => session.teamId))].sort();
  const totalInterventions = sessions.reduce(
    (total, session) => total + session.instructorInterventions.length,
    0,
  );
  const successfulHandoffs = sessions.filter(
    (session) =>
      session.crossTeamHandoff?.startedSuccessfully === true &&
      session.crossTeamHandoff?.noVerbalHelp === true,
  ).length;

  const criteria = [
    criterion(
      "pilot-marked-complete",
      data.pilotStatus === "complete",
      data.pilotStatus,
      "complete",
    ),
    criterion("five-independent-participants", sessions.length >= 5, sessions.length, ">= 5"),
    criterion(
      "no-development-participants",
      sessions.every((session) => session.priorInvolvement === false),
      sessions.filter((session) => session.priorInvolvement).length,
      "0 prior contributors",
    ),
    criterion(
      "supported-os-coverage",
      ALLOWED_OPERATING_SYSTEMS.size === operatingSystems.length &&
        [...ALLOWED_OPERATING_SYSTEMS].every((os) =>
          operatingSystems.includes(os),
        ),
      operatingSystems,
      ["macos", "windows"],
    ),
    criterion(
      "response-within-30-minutes",
      responseRate >= 0.8,
      Number((responseRate * 100).toFixed(1)),
      ">= 80%",
    ),
    criterion(
      "preflight-completed",
      sessions.length > 0 &&
        sessions.every((session) => session.preflightCompleted),
      sessions.filter((session) => session.preflightCompleted).length,
      "all participants",
    ),
    criterion(
      "interface-customised",
      sessions.length > 0 &&
        sessions.every((session) => session.customisedInterface),
      sessions.filter((session) => session.customisedInterface).length,
      "all participants",
    ),
    criterion(
      "skill-customised",
      sessions.length > 0 &&
        sessions.every((session) => session.customisedSkill),
      sessions.filter((session) => session.customisedSkill).length,
      "all participants",
    ),
    criterion(
      "read-tool-demonstrated",
      sessions.length > 0 &&
        sessions.every((session) => session.demonstratedReadTool),
      sessions.filter((session) => session.demonstratedReadTool).length,
      "all participants",
    ),
    criterion(
      "approved-write-demonstrated",
      sessions.length > 0 &&
        sessions.every((session) => session.demonstratedApprovedWrite),
      sessions.filter((session) => session.demonstratedApprovedWrite).length,
      "all participants",
    ),
    criterion(
      "cross-team-handoff",
      successfulHandoffs >= 1,
      successfulHandoffs,
      ">= 1 successful handoff without verbal help",
    ),
  ];

  return {
    decision: criteria.every((item) => item.passed) ? "GO" : "NO_GO",
    pilotStatus: data.pilotStatus,
    validationErrors: [],
    metrics: {
      participantCount: sessions.length,
      teamCount: teams.length,
      successfulWithinThirty,
      responseWithinThirtyPercent: Number((responseRate * 100).toFixed(1)),
      totalInstructorInterventions: totalInterventions,
      operatingSystems,
      browserWidthsPx: sessions.map((session) => session.browserWidthPx),
      successfulCrossTeamHandoffs: successfulHandoffs,
    },
    criteria,
  };
}

function printHuman(result, sourcePath) {
  console.log(`Pilot evidence: ${sourcePath}`);
  console.log(`Decision: ${result.decision}`);
  if (result.validationErrors.length > 0) {
    for (const error of result.validationErrors) {
      console.log(`  [invalid] ${error}`);
    }
    return;
  }
  for (const item of result.criteria) {
    console.log(
      `  [${item.passed ? "ok" : "!!"}] ${item.id}: ${JSON.stringify(item.actual)} (expected ${JSON.stringify(item.expected)})`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const allowPending = args.includes("--allow-pending");
  const pathArgument = args.find((arg) => !arg.startsWith("--"));
  const sourcePath = resolve(pathArgument ?? "pilot/results.json");
  let data;
  try {
    data = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    console.error(`Could not read pilot evidence at ${sourcePath}: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const result = evaluatePilot(data);
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result, sourcePath);
  }

  if (result.decision === "INVALID") {
    process.exitCode = 2;
  } else if (
    result.decision !== "GO" &&
    !(allowPending && ["not_run", "in_progress"].includes(data.pilotStatus))
  ) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
