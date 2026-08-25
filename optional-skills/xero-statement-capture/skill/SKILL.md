---
name: xero-statement-capture
description: Use when a Xero coding review needs a fresh view of the bank-reconciliation queue, when queue status is missing, incomplete, or stale, or when the user wants the optional descriptions displayed beside Xero statement lines.
---

# Xero Statement Capture

The public Xero Accounting API does not expose the unreconciled bank-statement lines shown in the reconciliation screen. This skill supplies those lines from a deliberate, read-only browser capture. It never clicks a Xero control and never carries a Xero credential.

Before starting a reconciliation review, call `get_xero_queue_status`. A usable capture is complete and no more than 30 minutes old. If it is missing, incomplete, stale, or blocked, explain that the user must run the capture helper while the relevant Xero reconciliation page is open. Do not fall back to a Xero report or transactions already entered in Xero.

Setup and exact commands are in `references/capture-setup.md`. Read that reference when guiding installation, capture, recapture, or annotation refresh.

The helper prints a loopback endpoint and a one-use token. Ask the user to paste those into the extension popup and choose either capture or annotation refresh. Never ask them to paste the n8n ingest secret into Chrome; it stays in the companion process.

An incomplete scan is saved as a blocker and does not deactivate any lines from the last complete scan. A later complete scan is the only evidence that a line disappeared from the queue.

Descriptions displayed by the optional overlay are suggestions only. They must not obscure Xero fields, fill a form, click Match, or imply reconciliation.
