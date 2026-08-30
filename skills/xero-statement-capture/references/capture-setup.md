# Xero export companion setup

The supported capture path uses Xero's own **Uncoded Statement Lines** CSV export. It does not use Playwright, a browser extension, DOM scraping, saved cookies, or supplied Xero credentials.

## One-time n8n setup

1. Run `18 - SETUP - Xero Statement Capture Data` once. Upgrades create provenance-bound v2 scan and statement-line tables; retired unscoped rows are not reused.
2. Create a **Header Auth** credential named `Xero Capture Control` with header `X-Xero-Capture-Control` and a unique random value of at least 24 characters. Attach it to workflow 115.
3. Create a different **Header Auth** credential named `Xero Capture Bridge` with header `X-Xero-Capture-Key` and another unique random value of at least 24 characters. Attach it to workflows 116 and 117.
4. Activate workflows 115, 116, and 117. Repository cloud publishing includes these authenticated webhooks.
5. Set the chat host values. Do not reuse any Xero OAuth secret:

```text
XERO_CAPTURE_RUNS_ENABLED=true
XERO_CAPTURE_CONTROL_SECRET=<the Xero Capture Control value>
```

The feature is disabled unless both the flag and a sufficiently long control secret are present.

When upgrading from the retired DOM-capture prototype, remove the unpacked **Xero statement capture** extension from Chrome and stop any old `capture-server.mjs` process. Repository cloud sync unpublishes workflows 110–112; do not reactivate those legacy webhooks.

Before enabling writes for a new Xero locale or report revision, run one genuine export through the read-only flow and confirm the parser accepts every account section and row. Xero does not publish a byte-level CSV schema; the included fixtures are synthetic, evidence-based test fixtures rather than a substitute for that first live validation.

## Install the local companion on macOS

Run the companion as a per-user LaunchAgent on the same Mac and user account as the normal browser. Put the `Xero Capture Bridge` Header Auth value in a private, single-line file using a password manager or text editor, then restrict it with `chmod 600`. This is an n8n webhook secret, not a Xero password, OAuth secret, browser cookie, or MFA code.

Use explicit paths in the install command:

```bash
chmod 600 "/Users/YOU/.config/mlai/xero-capture-bridge.secret"
node "/ABSOLUTE/PATH/TO/skills/xero-statement-capture/scripts/xero-export-service.mjs" install \
  --n8n-url "https://YOUR-N8N-HOST" \
  --secret-file "/Users/YOU/.config/mlai/xero-capture-bridge.secret" \
  --inbox "/Users/YOU/Downloads"
```

The installer writes only `~/Library/LaunchAgents/com.mlai.xero-export-companion.plist`, uses fully resolved executable and file paths, and stores the secret-file path rather than its contents. It refuses symlinks, public secret-file permissions, an unrelated plist at that path, or the same service label loaded from somewhere else. Repeating the same install is a no-op; changing these options updates only the marked MLAI service.

Check it or remove it with:

```bash
node "/ABSOLUTE/PATH/TO/skills/xero-statement-capture/scripts/xero-export-service.mjs" status
node "/ABSOLUTE/PATH/TO/skills/xero-statement-capture/scripts/xero-export-service.mjs" uninstall
```

Uninstall leaves the private bridge-secret file, Downloads folder, and logs in `~/Library/Logs/MLAI` intact. Do not install this as a shared system service or under a different user's account.

## Manual cross-platform fallback

On Linux, or on a Mac where a startup service is not wanted, keep a terminal open and run:

```bash
XERO_EXPORT_CAPTURE_ENABLED="user-mediated-xero-export" \
XERO_CAPTURE_N8N_URL="https://YOUR-N8N-HOST" \
XERO_CAPTURE_INGEST_SECRET_FILE="/ABSOLUTE/PATH/xero-capture-bridge.secret" \
XERO_EXPORT_INBOX_DIR="/ABSOLUTE/PATH/TO/BROWSER-DOWNLOADS" \
XERO_EXPORT_DAEMON="true" \
node "/ABSOLUTE/PATH/TO/skills/xero-statement-capture/scripts/xero-export-companion.mjs"
```

The n8n URL must use HTTPS except for loopback development. The secret file must be owned by the current user, contain one value of at least 24 characters, and have no group or other permissions. Only one companion may watch a folder at once. Omitting `XERO_EXPORT_INBOX_DIR` keeps the existing default of the current user's `Downloads` folder.

On Windows, keep the bridge value in a file protected by a current-user-only NTFS ACL, then load it into only the current PowerShell process (the value is not a command-line argument):

```powershell
$env:XERO_EXPORT_CAPTURE_ENABLED = "user-mediated-xero-export"
$env:XERO_CAPTURE_N8N_URL = "https://YOUR-N8N-HOST"
$env:XERO_CAPTURE_INGEST_SECRET = (Get-Content -Raw "C:\ABSOLUTE\PATH\xero-capture-bridge.secret").Trim()
$env:XERO_EXPORT_INBOX_DIR = "C:\Users\YOU\Downloads"
$env:XERO_EXPORT_DAEMON = "true"
node "C:\ABSOLUTE\PATH\TO\skills\xero-statement-capture\scripts\xero-export-companion.mjs"
```

Close that PowerShell session after stopping the companion to discard its process environment. The companion still never receives Xero credentials, cookies, or MFA values.

## Run a review

1. In a Bookkeeping conversation, ask the agent to reconcile the open Xero transactions.
2. The agent starts a capture run. The companion claims it and opens Xero's official report in the normal browser.
3. If asked, the user signs in and completes MFA directly in Xero.
4. In the report, select **All bank accounts** and a date range covering the unreconciled history to review, click **Run**, then **Export → CSV** once.
5. Leave the file in Downloads. The companion validates and imports it automatically; n8n starts the read-only review.
6. When the review is ready, chat automatically requests `filter: all` for that exact review. It delivers complete lane counts and a balanced actionable page; if more detail exists it states the exact remaining count and cursor rather than claiming everything was displayed. **Show suggestions** is a retry if automatic delivery fails, not a required second step.

This replaces reconciliation-page pagination with one server-generated all-account report. If the export hits the 5,000-line safety limit, use separate non-overlapping date ranges and review them independently.

## Security and failure rules

- The companion opens only `https://go.xero.com/Banking/StatementLines/Offline` (or Xero's exact organisation-login form for that destination).
- The user enters passwords and MFA only into Xero. The agent and companion never request or store them.
- Capture webhooks use separate server and companion secrets, reject redirects, and expose no transaction data to the public browser status API.
- The helper accepts only one new stable CSV after the run was claimed, rejects symlinks and ambiguous candidates, and limits file size, rows, and accounts.
- The CSV must name the verified live Xero organisation. Bank-account labels must map uniquely to the current active Xero account catalogue before preparation is possible.
- Import acceptance starts a review; only n8n may mark that review ready. A failed or cancelled run never changes Xero.
- The legacy page-capture extension is not part of this supported flow.

If the helper reports `COMPANION_ALREADY_RUNNING`, use the existing process. After a crash, confirm no companion process remains before deleting only `.mlai-xero-export-companion.lock` from the configured download folder.
