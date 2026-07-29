import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  evaluatePilot,
  validatePilot,
} from "../../scripts/evaluate-pilot.mjs";

async function fixture(name) {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
}

test("a complete five-person pilot that meets every criterion is GO", async () => {
  const result = evaluatePilot(await fixture("pilot-go.json"));

  assert.equal(result.decision, "GO");
  assert.equal(result.metrics.participantCount, 5);
  assert.equal(result.metrics.responseWithinThirtyPercent, 80);
  assert.deepEqual(result.metrics.operatingSystems, ["macos", "windows"]);
  assert.equal(result.criteria.every((criterion) => criterion.passed), true);
});

test("a completed pilot cannot pass with missing evidence", async () => {
  const result = evaluatePilot(await fixture("pilot-no-go.json"));

  assert.equal(result.decision, "NO_GO");
  assert.equal(
    result.criteria.find(
      (criterion) => criterion.id === "response-within-30-minutes",
    ).passed,
    false,
  );
  assert.equal(
    result.criteria.find(
      (criterion) => criterion.id === "cross-team-handoff",
    ).passed,
    false,
  );
});

test("the committed empty evidence file remains an explicit NO_GO", async () => {
  const data = JSON.parse(
    await readFile(new URL("../../pilot/results.json", import.meta.url), "utf8"),
  );
  const result = evaluatePilot(data);

  assert.equal(result.decision, "NO_GO");
  assert.equal(result.pilotStatus, "not_run");
  assert.equal(result.metrics.participantCount, 0);
});

test("personal data fields make pilot evidence invalid", async () => {
  const data = await fixture("pilot-go.json");
  data.sessions[0].email = "do-not-store@example.test";

  const validation = validatePilot(data);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /personal data is not allowed/);
});

test("the command line exits fail-closed unless pending evidence is explicitly allowed", () => {
  const script = fileURLToPath(
    new URL("../../scripts/evaluate-pilot.mjs", import.meta.url),
  );
  const passing = fileURLToPath(
    new URL("./fixtures/pilot-go.json", import.meta.url),
  );
  const failing = fileURLToPath(
    new URL("./fixtures/pilot-no-go.json", import.meta.url),
  );
  const pending = fileURLToPath(
    new URL("../../pilot/results.json", import.meta.url),
  );

  assert.equal(spawnSync(process.execPath, [script, passing]).status, 0);
  assert.equal(spawnSync(process.execPath, [script, failing]).status, 1);
  assert.equal(spawnSync(process.execPath, [script, pending]).status, 1);
  assert.equal(
    spawnSync(process.execPath, [script, "--allow-pending", pending]).status,
    0,
  );
});
