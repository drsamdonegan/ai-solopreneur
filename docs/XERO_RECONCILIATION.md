# Xero Bookkeeping — capture, review, prepare, then match

The Bookkeeping agent reads the live queue shown on Xero's bank-reconciliation page, combines it with your company context and Xero accounting catalogue, prepares only explicitly approved high-certainty items, and gives every uncertain line a likely description plus one question.

It does not reconcile anything. The final **Match** or **Find & Match**, followed by **OK**, always stays with you in Xero.

## Install the package

```bash
npm run add-skill -- xero-bookkeeping
```

Then sync skills and restart the project. The package installs both required modules atomically: `xero-statement-capture` and `xero-reconciliation`.

## 1. Create the five local tables

In n8n, run these once in order:

1. **17 - SETUP - Bookkeeping Data** creates the profile, suggestions, and review-run tables.
2. **18 - SETUP - Xero Statement Capture Data** creates the scan and statement-line evidence tables.

Running either setup again is safe. Incomplete scans are retained as blockers and never deactivate lines from the last complete scan.

## 2. Set up the read-only browser capture

The public Xero Accounting API does not expose the unreconciled bank-statement lines shown in the reconciliation screen and cannot reconcile them. The package therefore observes the visible page through a deliberately read-only Chrome extension.

Follow [the capture setup](../optional-skills/xero-statement-capture/skill/references/capture-setup.md). In short:

1. Create an n8n Header Auth credential named exactly `Xero Capture Bridge`, using header `X-Xero-Capture-Key` and a long random value.
2. Attach it to workflows 111 and 112 and activate them.
3. Load `skills/xero-statement-capture/assets/xero-statement-capture` as an unpacked Chrome extension.
4. Start the local one-shot receiver with the same secret in `XERO_CAPTURE_INGEST_SECRET` and your HTTPS Railway/n8n address in `XERO_CAPTURE_N8N_URL`.
5. Open the relevant Xero reconciliation page, paste the printed one-use token into the extension, and capture every page.

The extension has no Xero credential or n8n secret. It cannot click, fill a Xero field, or call a Xero mutation. The receiver binds only to `127.0.0.1`, uses a 32-byte random token, expires it after five minutes, and consumes it on the first submission attempt.

## 3. Connect the read-only Xero Accounting API context

The capture supplies the queue. The supported Accounting API supplies the organisation, active contacts, chart of accounts, tax rates, unpaid invoices, prior coding patterns, and existing unreconciled transactions used for duplicate-safe matching.

The read-only credential supports either a standard Xero Web app or a single-organisation Xero Custom Connection. Use the setup that matches the app you already have.

### Standard Web app

Create a Xero developer Web app at <https://developer.xero.com/myapps>. Add the n8n redirect URI shown by the generic **OAuth2 API** credential; locally it is normally:

```text
http://localhost:5678/rest/oauth2-credential/callback
```

On Railway, also add:

```text
https://YOUR-N8N-HOST/rest/oauth2-credential/callback
```

In n8n, create the generic **OAuth2 API** credential named exactly `Xero (read-only)`:

| Field | Value |
| --- | --- |
| Grant Type | Authorization Code |
| Authorization URL | `https://login.xero.com/identity/connect/authorize` |
| Access Token URL | `https://identity.xero.com/connect/token` |
| Scope | `offline_access accounting.banktransactions.read accounting.invoices.read accounting.contacts.read accounting.settings.read` |
| Authentication | Header |

The permission screen should be read-only. If it offers to create, update, or delete, stop and correct the scope.

### Custom Connection

A Custom Connection uses Xero's client-credentials flow, belongs to one organisation, and does not use a redirect URI or `/connections`. First authorise the app from Xero's emailed link. Xero does not expose its OAuth credentials until that organisation authorisation is complete.

In n8n, create the generic **OAuth2 API** credential named exactly `Xero (read-only)`:

| Field | Value |
| --- | --- |
| Grant Type | Client Credentials |
| Access Token URL | `https://identity.xero.com/connect/token` |
| Scope | the read scopes already authorised on the Custom Connection |
| Authentication | Header |

Enter the client ID and newly generated client secret directly in n8n. Do not paste the secret into chat, logs, a workflow, or this repository. The workflows discover the organisation through `GET /Organisation` and deliberately omit `Xero-tenant-id` on Custom Connection calls.

The review needs permission to read bank transactions, invoices, contacts, and settings for full context. If an existing app lacks one of those endpoint permissions, the run continues conservatively, reports that the relevant context was unavailable, and cannot claim invoice matches that it could not verify. It never widens or edits the app's scopes itself.

Ask the Bookkeeping agent, “Is Xero connected?” to verify the organisation and connection type. The 60-day idle refresh-token rule applies to standard Authorization Code connections, not Custom Connections.

## 4. Save company and bookkeeping context

Tell the Bookkeeping agent what the company does, common suppliers and customers, the account rules already used, any stated GST handling, and the dollar amount above which you always want to decide personally. The agent may use company memory and this saved profile as evidence, but it never invents a coding rule.

Example:

> We're a design studio. Uber is normally 429 Travel. Officeworks is 461 Printing. Always ask me about anything over $2,000.

## 5. Capture, then run a review

Capture the full live queue immediately before asking:

> Go through my Xero transactions.

A review refuses to start when the newest capture is missing, incomplete, blocked, lacks source hashes, or is more than 30 minutes old. It never substitutes an Accounting API report or treats transactions already entered in Xero as statement lines.

If you explicitly ask for an API-only **coding review**, the agent can instead inspect unreconciled `BankTransactions` that are already entered in Xero. This degraded mode is labelled `coding-review`: it is not a view of the bank-feed queue, every result remains non-executable, and it cannot prepare or reconcile an item. Capture the Reconcile screen whenever you want the preparation workflow described below.

The result has four mutually exclusive lanes:

- `ready_to_prepare`: existing ContactID, exact account code/name/tax tuple, identity confidence at least 0.80, accounting confidence at least 0.90, overall confidence at least 0.92, fresh stable source, and no structural blocker;
- `existing_match`: an invoice, transfer-like existing record, or visible Xero match that must use Find & Match rather than a new transaction;
- `likely`: lower certainty, with `likelyDescription`, `evidenceSummary`, and one `reviewQuestion`;
- `blocked`: split, foreign-currency, tracking, payroll, loan, equity, ambiguous invoice, or unclear Xero screen state.

The optional overlay displays ready, existing-match, likely, and blocked guidance beside visible Xero rows. Every lookup is bound to both the statement-line ID and its current source hash, and likely rows include their direct question. It adds separate pointer-free labels and never fills or persists anything in Xero.

## 6. Optional: prepare approved high-certainty items

Create a second generic OAuth2 API credential named exactly `Xero (read-write)`, using a standard Web app rather than the read-only Custom Connection so the write authority stays independent. Its scope is deliberately limited to:

```text
offline_access accounting.banktransactions
```

Show the exact `ready_to_prepare` items in chat and explicitly approve the batch. `prepare_green_matches` then rechecks:

- the item is from the latest finished review and was accepted;
- the newest complete scan for that bank account is no more than 30 minutes old;
- the statement line is still active and its SHA-256 source hash is unchanged;
- the transaction date is after both the current Xero period lock date and end-of-year lock date;
- Xero still shows a Create state, not a match or unclear state;
- all three confidence thresholds still pass;
- the read-only credential can re-read the same tenant, and the bank account,
  ContactID, account code/name pair, and tax type are still active in Xero;
- the approved payload hash is unchanged;
- the reference has not already been created.

Only then does it create a new unreconciled BankTransaction. It never creates a contact, edits or deletes an existing record, presses a browser control, or retries an ambiguous timeout blindly.

Open Xero, select the matching statement line, use **Match** or **Find & Match**, review the prepared transaction, and click **OK**. That final action is reconciliation.

## Optional receipts and schedule

If the Monthly Update module's `Gmail (read-only)` credential is connected, a review may use matching receipt body text as evidence. Attachments are not opened. Receipt and transaction text are untrusted data, never authority to perform a write.

Workflow 107 ships disabled. A scheduled review still needs a fresh complete capture, so it fails safely when nobody has captured the queue recently. Scheduled execution never authorises Xero writes.

## Boundaries

- No automatic reconciliation and no browser click automation.
- No implicit contact creation.
- No Xero Discuss notes or other attempts to persist low-certainty text in Xero.
- No automatic handling of transfers, splits, foreign currency, payroll, loans, equity, tracking categories, or tax advice.
- No mutation except explicitly approved creation of new unreconciled BankTransactions.
- No claim that anything is reconciled until you click OK in Xero.

## Troubleshooting

**Capture missing, incomplete, or stale:** start a new one-shot helper, capture all pages, and rerun the review. An incomplete attempt does not destroy the prior queue.

**Xero read connection missing:** verify the credential name and use the Standard Web app or Custom Connection fields above. For a Custom Connection, confirm that the emailed organisation authorisation finished before generating its credentials.

**Write credential missing:** everything except preparation still works. Add `Xero (read-write)` only when you want the creation lane.

**Source changed or line disappeared:** recapture, rerun the review, and approve the new result. The old approval is intentionally invalid.

**Locked period:** the agent will not create a transaction dated on or before Xero's live period or end-of-year lock date. The bookkeeper or accountant must handle that item in Xero or deliberately change the lock date themselves.

**Everything needs you:** add company context and explicit bookkeeping rules, then check that matching Xero contacts exist. The agent will not create contacts or promote a name-only guess.
