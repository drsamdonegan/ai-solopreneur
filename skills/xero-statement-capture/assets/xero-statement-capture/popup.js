"use strict";

const byId = (id) => document.getElementById(id);
const config = () => ({ endpoint: byId("endpoint").value, token: byId("token").value });

function show(message, error = false) {
  byId("status").textContent = message;
  byId("status").classList.toggle("error", error);
}

async function request(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || "Extension request failed.");
  return response.result;
}

async function run(action) {
  try {
    const result = await action();
    byId("token").value = "";
    return result;
  } catch (error) {
    show(String(error?.message || error), true);
    return null;
  }
}

byId("capture-submit").addEventListener("click", () => run(async () => {
  const result = await request("CAPTURE_AND_SUBMIT", { config: config() });
  show(result.complete
    ? `Complete scan recorded: ${result.observedCount ?? result.observed_count}/${result.expectedCount ?? result.expected_count} lines. Xero is untouched.`
    : `Incomplete scan recorded; writes remain blocked. ${(result.blockingReasons || result.blocking_reasons || []).join("; ")}`, !result.complete);
}));

byId("annotations").addEventListener("click", () => run(async () => {
  const result = await request("REFRESH_ANNOTATIONS", { config: config() });
  show(`Displayed ${result.applied || 0} suggested description${result.applied === 1 ? "" : "s"}. Xero is untouched.`);
}));

byId("capture-page").addEventListener("click", () => run(async () => {
  const result = await request("CAPTURE_PAGE");
  show(`Captured page evidence: ${result.observed_count}/${result.expected_count ?? "unknown"} visible lines.`);
}));

byId("reset").addEventListener("click", () => run(async () => {
  await request("RESET_CAPTURE");
  show("Captured pages cleared.");
}));

byId("submit").addEventListener("click", () => run(async () => {
  const result = await request("SUBMIT_CAPTURE", { config: config() });
  show(result.complete
    ? `Complete scan recorded: ${result.observedCount ?? result.observed_count}/${result.expectedCount ?? result.expected_count} lines. Xero is untouched.`
    : `Incomplete scan recorded; writes remain blocked. ${(result.blockingReasons || result.blocking_reasons || []).join("; ")}`, !result.complete);
}));

request("GET_STATUS").then((result) => {
  if (result.draft?.scan_id) show(`Draft ${result.draft.observed_count}/${result.draft.expected_count ?? "unknown"} lines.`);
}).catch(() => {});
