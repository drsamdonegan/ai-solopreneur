# Xero capture setup

## One-time setup

1. Run `18 - SETUP - Xero Statement Capture Data` once in n8n.
2. In n8n, create a **Header Auth** credential named exactly `Xero Capture Bridge`. Use header `X-Xero-Capture-Key` and generate a long random value.
3. Attach that credential to workflows 111 and 112, then activate both workflows.
4. Set the same random value as `XERO_CAPTURE_INGEST_SECRET` only in the local companion process. Never put it in the extension.
5. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `skills/xero-statement-capture/assets/xero-statement-capture` from the installed project.

The extension requests only `activeTab`, `storage`, the Xero reconciliation origin, and `127.0.0.1:8461`. It does not request cookies, browsing history, `webRequest`, downloads, or access to arbitrary sites.

## Capture a queue

Run this from the installed project:

```bash
XERO_CAPTURE_N8N_URL="https://YOUR-RAILWAY-HOST" \
XERO_CAPTURE_INGEST_SECRET="YOUR-HEADER-AUTH-VALUE" \
node skills/xero-statement-capture/scripts/capture-server.mjs
```

The remote n8n URL must use HTTPS. A plain HTTP URL is accepted only for a loopback n8n instance. The helper binds to `127.0.0.1:8461`, prints a cryptographically random token, and expires it after five minutes.

Open the bank account's reconciliation page at `https://go.xero.com/`, open the extension, paste the endpoint and one-use token, then select **Capture and submit**. The helper observes each page twice and blocks the scan if the rows change between observations. For a paginated queue, capture each visible page before submitting. Xero remains unchanged.

A good response says the scan is complete and shows identical expected and observed counts. Anything else is a blocker. Fix the visible-page or pagination issue, start a new helper for a new token, and capture again.

## Refresh optional descriptions

After a review finishes, start the helper again, paste its new token into the popup, and choose **Refresh descriptions**. The extension sends only each visible statement-line ID and its current SHA-256 source hash through the loopback receiver. Returned labels distinguish ready, existing-match, likely, and blocked rows; likely rows include the review question. A label is omitted when the source hash changed. Nothing is written into Xero.

## Security invariants

- The browser never receives the n8n secret or a Xero OAuth credential.
- The loopback token is at least 32 random bytes, expires after five minutes, and is consumed before the first submission attempt.
- Only `chrome-extension://` origins may POST to the loopback receiver.
- Incomplete scans preserve the previous active queue.
- Capture, annotation refresh, and the extension contain no click automation and no Xero mutation endpoint.
