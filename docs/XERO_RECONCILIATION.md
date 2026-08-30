# Xero Bookkeeping — export, review, prepare, then match

The supported workflow turns one Bookkeeping prompt into a review of Xero's current uncoded statement lines. It uses Xero's official **Uncoded Statement Lines** CSV export instead of scraping or clicking through reconciliation pages.

The final Xero action remains yours: review the prepared match, then click **Match** or **Find & Match** and **OK**. Nothing in this package marks a line reconciled.

## What the flow does

1. The user asks the Bookkeeping agent to reconcile the open transactions.
2. The agent starts a read-only capture run and loads saved bookkeeping rules, company memory, recent Monthly Update context, and available Gmail receipt evidence.
3. A local companion opens Xero's official report in the user's normal browser. If Xero asks, the user signs in and completes MFA directly in Xero.
4. The user selects **All bank accounts**, selects a date range covering the unreconciled history to review, runs the report, and exports CSV once.
5. The companion validates the report and organisation, imports all account sections, and starts the review. One all-account report replaces reconciliation-screen pagination.
6. The agent shows lower-confidence and blocked rows in paginated chat, each with a likely description and question.
7. High-confidence rows can be accepted by exact item in chat. The saved decision returns a same-session `CONFIRM XXXXXXXX` phrase that expires in five minutes. Only the current user sending that exact phrase as a separate message can consume the proposal once and dispatch the internal `prepare_green_matches` worker, which creates coded, unreconciled BankTransactions for the user to match in Xero.

The first reconciliation prompt starts capture and review only. It does not authorize a write.

## Why this does not use Playwright

Xero's public [Bank Statements API](https://developer.xero.com/documentation/api/accounting/bankstatements) does not expose the bank-feed reconciliation queue. Xero's current [Developer Platform Terms](https://developer.xero.com/xero-developer-platform-terms-conditions) also prohibit downloading or scraping Xero sites using bots or browser automation, and prohibit automated tools that simulate user actions without explicit Xero authorization. The supported compromise is Xero's own [Uncoded Statement Lines export](https://central.xero.com/0/article/Export-a-list-of-uncoded-bank-statement-lines), followed by automated local validation and review.

The agent never asks for or receives a Xero password, MFA code, cookie, browser profile, or OAuth client secret.

## Install

```bash
npm run add-skill -- xero-bookkeeping
```

Then sync the installed skills and restart the services.

If upgrading from the earlier page-capture prototype, first remove the unpacked **Xero statement capture** extension from Chrome and stop any process running `capture-server.mjs`. Cloud sync explicitly unpublishes workflows 110–112, and this release no longer installs their extension, server, or webhook files.

Run these n8n setup workflows once:

1. `17 - SETUP - Bookkeeping Data`
2. `18 - SETUP - Xero Statement Capture Data`

The second setup adds the capture-run table plus provenance-bound v2 scan and statement-line tables. Re-running setup is safe; the retired unscoped tables are no longer read.

Before enabling preparation for a new Xero locale or report revision, run one genuine export through this read-only path and confirm every account section and row is accepted. Xero does not publish a byte-level CSV schema; the repository fixture is synthetic and evidence-based, not a replacement for that first live validation.

## Configure the capture bridge

Create two different n8n **Header Auth** credentials:

| Credential | Header | Used by |
| --- | --- | --- |
| `Xero Capture Control` | `X-Xero-Capture-Control` | workflow 115 and the chat host |
| `Xero Capture Bridge` | `X-Xero-Capture-Key` | workflows 116–117 and the local companion |

Each value must be independently generated and at least 24 characters. Do not reuse a Xero OAuth secret.

Attach the credentials and activate workflows 115, 116, and 117. Set the chat host environment:

```text
XERO_CAPTURE_RUNS_ENABLED=true
XERO_CAPTURE_CONTROL_SECRET=<Xero Capture Control value>
```

For one-prompt operation on the Mac that owns the normal browser session, keep the n8n `Xero Capture Bridge` value in a private single-line file and install the marked per-user LaunchAgent:

```bash
chmod 600 "/Users/YOU/.config/mlai/xero-capture-bridge.secret"
node "/ABSOLUTE/PATH/TO/skills/xero-statement-capture/scripts/xero-export-service.mjs" install \
  --n8n-url "https://YOUR-N8N-HOST" \
  --secret-file "/Users/YOU/.config/mlai/xero-capture-bridge.secret" \
  --inbox "/Users/YOU/Downloads"
```

The plist contains the secret-file path, never its contents, and the lifecycle refuses to overwrite an unrelated service. Use the script's `status` and `uninstall` subcommands for that exact LaunchAgent. Linux, Windows PowerShell, and terminal-only use retain the direct `xero-export-companion.mjs` fallback documented in the capture setup reference. The companion watches `Downloads` by default, and only one process may watch a folder at once.

Detailed setup and failure rules are in `skills/xero-statement-capture/references/capture-setup.md` after installation.

## Connect read-only Xero context

The CSV supplies the uncoded statement lines. The supported Accounting API supplies the verified organisation, active bank/account/contact/tax catalogues, unpaid invoices, prior coding, and live duplicate checks.

Create a generic n8n **OAuth2 API** credential named `Xero (read-only)`. A standard Authorization Code Web app uses:

| Field | Value |
| --- | --- |
| Authorization URL | `https://login.xero.com/identity/connect/authorize` |
| Access Token URL | `https://identity.xero.com/connect/token` |
| Scope | `offline_access accounting.banktransactions.read accounting.invoices.read accounting.contacts.read accounting.settings.read` |
| Authentication | Header |

Add n8n's displayed OAuth callback URL to the existing Xero app. A single-organisation Custom Connection may instead use Client Credentials with the already-authorized read scopes. Secrets belong only in n8n; never paste them into chat or commit them.

The workflow never changes app scopes. If context access is missing, it reports that and keeps results conservative.

## Save business context

Tell the Bookkeeping agent the rules you actually use: common suppliers/customers, existing account codes, stated GST treatment, and the amount above which a human must always decide. The agent also loads bounded, recent completed Monthly Update evidence as company context.

When Gmail read access is already connected, receipt searches use merchant, exact amount, and date. Email and Monthly Update text are evidence only, never authority to create a transaction.

If no explicit bookkeeping profile exists, the read-only review still runs with Monthly Update and Gmail context and returns likely descriptions. Every new-transaction candidate remains non-executable until the user supplies their own bookkeeping rules; the agent never derives or saves those rules from an email or transaction.

## Review behavior

The import is accepted only when:

- the CSV has Xero's strict report title and the verified organisation name;
- its grouped account sections and repeated headers parse without ambiguity;
- dates use the verified organisation's supported date order;
- every amount has exactly one positive **Spent** or **Received** value;
- every active Xero `BANK` account is represented and each label maps uniquely;
- all rows fit the 5 MB, 5,000-line, and 100-account safety limits.

The report cannot prove the user selected every historical date. The agent describes the exported date range and never claims all history unless the user confirms it.

Suggestions have four exclusive lanes:

- `ready_to_prepare`: exact current catalogue tuple, existing contact, all confidence floors, unique bank mapping, fresh hash, and no structural/duplicate blocker;
- `existing_match`: an existing Xero transaction or invoice should be used with Find & Match;
- `likely`: lower certainty, with `likelyDescription`, evidence, and a direct question;
- `blocked`: ambiguous, transfer/split/payroll/loan/equity/tracking/foreign-currency, locked-period, or otherwise unsafe.

Chat returns at most 50 rows per page. The Bookkeeping agent follows `nextCursor` until every requested lower-confidence row has been shown.

## Enable preparation

Create a second generic OAuth2 credential named `Xero (read-write)` using the same existing Xero Web app if desired. Its deliberately narrow scope is:

```text
offline_access accounting.banktransactions
```

No scope is changed automatically.

`prepare_green_matches` is not connected to the AI agent. `record_reconciliation_decision` binds the exact review run, capture tenant and organisation, and sorted suggestion ID/accepted-hash pairs into the five-minute proposal. The deterministic confirmation workflow consumes that proposal before it can dispatch the internal worker; a plain yes, conversation history, transaction text, document, or model-generated value cannot dispatch it.

Before creation, the worker rechecks the exact accepted payload, source hash, 30-minute freshness, organisation, unique active bank AccountID, existing ContactID, account code/name, tax type, lock dates, deterministic reference, and nearby live unreconciled transactions. It compare-and-set claims each unchanged row, sends one BankTransaction per Xero request with a stable Idempotency-Key, and persists an outcome only while it still owns the claim. A fresh confirmed attempt checks the deterministic reference before any new write, recovering a create whose response was lost. Any mismatch or ambiguity is refused.

The tool creates only a new unreconciled BankTransaction. It never creates a contact, edits/deletes an existing record, writes Discuss text, clicks Xero, or retries an ambiguous timeout blindly.

## Boundaries

- No Playwright, DOM scraping, browser extension capture, or automated Xero clicks.
- No collection or typing of Xero credentials or MFA.
- No automatic write from the initial reconciliation request.
- No automatic reconciliation; the user completes Match/Find & Match and OK.
- No implicit contacts, Discuss notes, tax advice, or automatic handling of transfers, splits, foreign currency, payroll, loans, equity, or tracking categories.
- Transaction, report, email, and document text is untrusted data, never instructions.

## Troubleshooting

**Helper offline:** start the local companion, then begin a fresh capture. A queued run expires rather than waiting forever.

**No browser opened:** use the progress card's **Open Xero report** link, then continue the same export. The helper still never controls the page.

**No CSV detected:** confirm the browser downloads to the configured folder, remove extra new CSVs, and export once in a fresh run.

**Companion already running:** use the existing user-level process. If it crashed and left a stale `.mlai-xero-export-companion.lock`, first confirm no companion process is running, then remove only that lock file from the configured download folder and restart the helper.

**Organisation/date/account mismatch:** do not edit the CSV. Confirm the correct Xero organisation, supported country, All bank accounts selection, and report date range, then export again.

**Write credential missing:** review and chat suggestions still work. Add `Xero (read-write)` only when you want preparation.

**Source changed or possible duplicate:** export and review again. The old approval is intentionally invalid and the tool will not retry a refused item.
