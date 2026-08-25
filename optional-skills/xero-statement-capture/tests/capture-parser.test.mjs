import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const asset = join(here, "../skill/assets/xero-statement-capture/content.js");
const fixtures = join(here, "fixtures");
const content = await readFile(asset, "utf8");
let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };

const candidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
let chrome = "";
for (const candidate of candidates) {
  try { await access(candidate, constants.X_OK); chrome = candidate; break; } catch { /* try the next reviewed path */ }
}

for (const name of ["modern-reconcile.html", "legacy-bankrec.html"]) {
  const html = await readFile(join(fixtures, name), "utf8");
  check(!/client secret|access token|refresh token|cookie/i.test(html), `${name} must stay redacted`);
  check(html.includes("data-bank-account-id"), `${name} must bind a bank account`);
}
check(!content.includes(".click("), "the parser must not click Xero controls");
check(!/\.value\s*=/.test(content), "the parser must not fill Xero fields");

if (chrome) {
  const temporary = await mkdtemp(join(tmpdir(), "xero-capture-parser-"));
  const runFixture = async (name) => {
    const source = await readFile(join(fixtures, name), "utf8");
    const runner = source.replace("</body>", `<script>
      window.chrome = { runtime: { onMessage: { addListener(listener) { window.__captureListener = listener; } } } };
    </script><script>${content.replaceAll("</script", "<\\/script")}</script><script>
      const output = document.createElement('pre');
      output.id = 'capture-result';
      window.__captureListener({ type: 'CAPTURE_XERO_PAGE' }, null, (result) => {
        output.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
      });
      document.body.appendChild(output);
    </script></body>`);
    const page = join(temporary, name);
    const profile = join(temporary, `${name}-profile`);
    await writeFile(page, runner);
    const result = spawnSync(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profile}`, "--dump-dom", pathToFileURL(page).href], {
      encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `Chrome failed for ${name}: ${result.stderr}`);
    const encoded = result.stdout.match(/<pre id="capture-result">([A-Za-z0-9+/=]+)<\/pre>/)?.[1];
    assert.ok(encoded, `Chrome did not return capture output for ${name}`);
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")).capture;
  };
  try {
    const modern = await runFixture("modern-reconcile.html");
    check(modern.bank_account_id === "bank-modern-redacted", "modern parser should retain bank account identity");
    check(modern.lines.length === 5 && modern.expected_count === 5, "modern parser should capture complete visible coverage");
    check(modern.lines.map((line) => line.ui_mode).join(",") === "blank_create,create_prefilled,discuss,green_match,unknown", "modern parser should distinguish all UI states");
    check(modern.lines[0].contact === "", "a hidden modern contact must not become visible evidence");
    check(modern.lines[1].date === "2026-07-15" && modern.lines[2].date === "2026-07-15", "modern parser should normalize text and slash dates");
    check(modern.lines[3].matched_xero_transaction_id === "txn-modern-redacted" && modern.lines[3].has_ok_button === true, "modern green match should require visible transaction evidence");
    check(modern.lines[4].parse_warnings.length === 1, "unknown modern state should carry a parser warning");

    const legacy = await runFixture("legacy-bankrec.html");
    check(legacy.bank_account_id === "bank-legacy-redacted", "legacy parser should retain bank account identity");
    check(legacy.lines.length === 4 && legacy.expected_count === 4 && legacy.complete_dom_coverage === true, "legacy parser should prove full DOM coverage");
    check(legacy.lines.map((line) => line.ui_mode).join(",") === "blank_create,create_prefilled,discuss,green_match", "legacy parser should distinguish reconciliation panels");
    check(legacy.lines[1].contact === "Legacy Travel" && legacy.lines[1].event_name === "Event A", "legacy parser should read visible create fields and tracking blockers");
    check(legacy.lines[2].contact === "", "a hidden legacy create panel must not become visible evidence");
    check(legacy.lines[3].direction === "credit" && legacy.lines[3].matched_xero_transaction_id === "txn-legacy-redacted", "legacy parser should read received matches");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
} else {
  process.stdout.write("Xero capture parser: Chrome unavailable; fixture and no-write contract checks ran, browser execution skipped.\n");
}

process.stdout.write(`Xero capture parser: ${checks} checks passed.\n`);
