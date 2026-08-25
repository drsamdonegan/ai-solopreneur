import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [frontend, gateway, manifest, folders] = await Promise.all([
  readFile(new URL("../apps/chat/public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../apps/chat/src/app.ts", import.meta.url), "utf8"),
  readFile(new URL("../optional-skills/monthly-update/manifest.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../n8n/folders.manifest.json", import.meta.url), "utf8").then(JSON.parse),
]);

assert.match(gateway, /url\.pathname === "\/api\/monthly-update-progress"/);
assert.match(gateway, /"\/webhook\/monthly-update-progress"/);
assert.match(frontend, /fetch\("\/api\/monthly-update-progress"/);
assert.match(frontend, /const MONTHLY_UPDATE_RESULT_PROMPT = "What does the monthly update say\?"/);
assert.match(frontend, /function renderMonthlyUpdateProgress\(update\)/);
assert.match(frontend, /monthlyUpdateDeliveryId\(update\)/);
assert.match(frontend, /deliverViaAgent\([\s\S]*MONTHLY_UPDATE_RESULT_PROMPT/);
assert.match(frontend, /card\.id = "monthly-update-progress"/);
assert.match(frontend, /card\.setAttribute\("aria-live", "polite"\)/);
assert.match(frontend, /fill\.style\.width = `\$\{percent\}%`/);
assert.match(frontend, /window\.setInterval\(\(\) => \{\s*void refreshMonthlyUpdateProgress\(\);/);
assert.match(frontend, /visibilitychange[\s\S]*refreshMonthlyUpdateProgress\(\)/);

const optionalWorkflows = manifest.folders.flatMap((folder) => folder.workflows);
assert(optionalWorkflows.includes("68-internal-monthly-update-progress.json"));
const installedWorkflows = folders.folders.flatMap((folder) => folder.workflows);
assert(installedWorkflows.includes("68-internal-monthly-update-progress.json"));

console.log("Monthly update progress and automatic chat delivery checks passed.");
