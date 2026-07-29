import { createServer } from "node:http";
import {
  DocumentError,
  MAX_FILE_BYTES,
  extractDocument,
} from "./extractors.mjs";

const port = Number(process.env.PORT ?? 3100);
const listenAddress = process.env.DOCUMENT_LISTEN_ADDRESS ?? "127.0.0.1";

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(payload);
}

async function readBody(request) {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > MAX_FILE_BYTES) {
    throw new DocumentError(
      413,
      "FILE_TOO_LARGE",
      "Files must be 20 MB or smaller.",
    );
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.length;
    if (totalBytes > MAX_FILE_BYTES) {
      throw new DocumentError(
        413,
        "FILE_TOO_LARGE",
        "Files must be 20 MB or smaller.",
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (url.pathname !== "/extract" || request.method !== "POST") {
      sendJson(response, 404, {
        error: { code: "NOT_FOUND", message: "Not found." },
      });
      return;
    }

    try {
      const encodedName = request.headers["x-document-name"];
      const fileName =
        typeof encodedName === "string"
          ? decodeURIComponent(encodedName)
          : "document";
      const mimeType =
        typeof request.headers["x-document-type"] === "string"
          ? request.headers["x-document-type"]
          : "application/octet-stream";
      const result = await extractDocument({
        buffer: await readBody(request),
        fileName,
        mimeType,
      });
      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof DocumentError) {
        sendJson(response, error.status, {
          error: { code: error.code, message: error.publicMessage },
        });
        return;
      }
      console.error("Unexpected document extraction error", error);
      sendJson(response, 500, {
        error: {
          code: "DOCUMENT_EXTRACTION_FAILED",
          message: "The document could not be read.",
        },
      });
    }
  })();
});

server.listen(port, listenAddress, () => {
  console.log(`Document worker listening on http://${listenAddress}:${port}`);
});

function shutdown() {
  server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
