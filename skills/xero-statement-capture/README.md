# Xero Statement Capture

This module starts and tracks a user-mediated export of Xero's official **Uncoded Statement Lines** report. One all-bank-accounts CSV replaces reconciliation-screen page clicking and supplies the complete report rows to the Bookkeeping review.

The local companion opens only the allowlisted Xero report URL, waits for a new stable CSV in Downloads, validates its structure and organisation, and uploads it through authenticated n8n webhooks. It never controls the browser, scrapes Xero, or handles Xero credentials. A marked per-user macOS LaunchAgent provides the turnkey startup path; the direct Node command remains the cross-platform fallback.

Follow `references/capture-setup.md`. Capturing and reviewing do not change Xero. Creating an unreconciled matching transaction remains a later, separately approved action in `xero-reconciliation`.
