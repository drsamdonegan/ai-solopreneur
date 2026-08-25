# Xero Statement Capture

This module provides the source of truth for the queue currently visible in Xero's bank-reconciliation screen. It includes:

- a Manifest V3 Chrome extension that only reads visible reconciliation rows;
- a one-shot loopback receiver that keeps the n8n ingest secret out of Chrome;
- strict completeness and security checks;
- n8n workflows for scan ingestion, queue status, and optional annotation lookup.

Follow `references/capture-setup.md`. Capturing never reconciles, creates, edits, or deletes a Xero record.
