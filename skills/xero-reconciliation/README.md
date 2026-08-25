# Xero Coding Review

This module consumes only a fresh, complete queue supplied by `xero-statement-capture`. It then combines each statement line with the organisation's active Xero contacts, chart of accounts, tax rates, invoices, coding history, receipts when available, and saved company context.

Its `Xero (read-only)` credential supports both standard Authorization Code Web apps and single-organisation Custom Connections using Client Credentials. Custom Connection API calls omit `Xero-tenant-id`; the optional write credential remains a separate standard connection.

An explicitly requested degraded `coding-review` mode can inspect already-entered unreconciled `BankTransactions` through the Accounting API when no browser capture is available. It is always labelled as not being the bank-feed queue, all of its rows are non-executable, and it cannot substitute for the reconciliation workflow.

The review returns four exclusive lanes:

- ready for explicit approval and preparation;
- already a Find & Match job in Xero;
- needs you, with a likely description, evidence summary, and direct question;
- blocked because the screen state or bookkeeping structure is unsafe.

An item reaches preparation only with an existing ContactID, an exact account code/name/tax tuple, identity confidence ≥0.80, accounting confidence ≥0.90, overall confidence ≥0.92, a fresh stable capture, and explicit approval. Preparation creates only a new unreconciled BankTransaction. You still complete Match or Find & Match and click OK in Xero.

Install the public package with:

```bash
npm run add-skill -- xero-bookkeeping
```

Full setup, scopes, safety boundaries, and acceptance checks are in `docs/XERO_RECONCILIATION.md`.
