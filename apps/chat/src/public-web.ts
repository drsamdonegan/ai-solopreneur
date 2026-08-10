import { lookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

const MAX_PAGE_BYTES = 512 * 1_024;
const MAX_EXTRACTED_CHARACTERS = 40_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

export interface PublicWebPage {
  requestedUrl: string;
  url: string;
  statusCode: number;
  title: string;
  text: string;
  truncated: boolean;
}

export interface PublicWebPageResult extends Partial<PublicWebPage> {
  requestedUrl: string;
  ok: boolean;
  error?: string;
}

function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    const c = octets[2] ?? -1;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family === 6) {
    const normalised = address.toLowerCase();
    return /^[23]/.test(normalised) && !normalised.startsWith("2001:db8:");
  }
  return false;
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const requestedFamily = Number(options.family ?? 0);
    // Reject mixed public/private answers to block DNS-rebinding and split-horizon tricks.
    if (addresses.length === 0 || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
      const lookupError = new Error("Host resolved to a non-public address") as NodeJS.ErrnoException;
      lookupError.code = "ENETUNREACH";
      callback(lookupError, "", 0);
      return;
    }
    const compatible = addresses.filter(
      (entry) => requestedFamily === 0 || entry.family === requestedFamily,
    );
    if (compatible.length === 0) {
      callback(new Error("Host has no usable public address"), "", 0);
      return;
    }
    if (options.all) {
      callback(null, compatible);
      return;
    }
    const selected = compatible[0];
    if (selected === undefined) {
      callback(new Error("Host has no usable public address"), "", 0);
      return;
    }
    callback(null, selected.address, selected.family);
  });
};

function validatePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Use a complete HTTPS URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    isIP(hostname) !== 0 ||
    hostname.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    ["local", "internal", "localhost", "home", "lan"].includes(labels.at(-1) ?? "")
  ) {
    throw new Error("Only ordinary public HTTPS pages are supported");
  }
  url.hash = "";
  return url;
}

function decodeEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal, hex, name) => {
    if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    return named[String(name).toLowerCase()] ?? match;
  });
}

function readablePage(html: string, contentType: string): { title: string; text: string } {
  if (/^text\/plain/i.test(contentType)) {
    return { title: "", text: html.replace(/\s+/g, " ").trim() };
  }
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities((titleMatch?.[1] ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|p|div|li|h[1-6]|section|article|header|footer|tr|td|th)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title, text };
}

async function readOnce(url: URL): Promise<{
  statusCode: number;
  location?: string;
  contentType: string;
  body: string;
  truncated: boolean;
}> {
  return await new Promise((resolvePage, rejectPage) => {
    let settled = false;
    const finish = (result: {
      statusCode: number;
      location?: string;
      contentType: string;
      body: string;
      truncated: boolean;
    }) => {
      if (!settled) {
        settled = true;
        resolvePage(result);
      }
    };
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
          "User-Agent": "AI-Solopreneur-Research/1.0",
        },
        lookup: safeLookup,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (upstream) => {
        const statusCode = upstream.statusCode ?? 0;
        const location = upstream.headers.location;
        const contentType = String(upstream.headers["content-type"] ?? "");
        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          upstream.resume();
          finish({ statusCode, location, contentType, body: "", truncated: false });
          return;
        }
        if (!/^(?:text\/|application\/xhtml\+xml)/i.test(contentType)) {
          upstream.resume();
          finish({ statusCode, contentType, body: "", truncated: false });
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        upstream.on("data", (rawChunk: Buffer | string) => {
          if (settled) return;
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          const remaining = MAX_PAGE_BYTES - bytes;
          if (chunk.length > remaining) {
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            finish({
              statusCode,
              contentType,
              body: Buffer.concat(chunks).toString("utf8"),
              truncated: true,
            });
            upstream.destroy();
            return;
          }
          chunks.push(chunk);
          bytes += chunk.length;
        });
        upstream.on("end", () => finish({
          statusCode,
          contentType,
          body: Buffer.concat(chunks).toString("utf8"),
          truncated: false,
        }));
        upstream.on("error", (error) => {
          if (!settled) rejectPage(error);
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("Public page request timed out")));
    request.on("error", rejectPage);
    request.end();
  });
}

export async function fetchPublicWebPage(value: string): Promise<PublicWebPage> {
  const requestedUrl = validatePublicUrl(value).toString();
  let current = new URL(requestedUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    // readOnce resolves and validates DNS for every destination, including redirects.
    const page = await readOnce(current);
    if (page.location !== undefined) {
      if (redirects === MAX_REDIRECTS) throw new Error("Public page redirected too many times");
      current = validatePublicUrl(new URL(page.location, current).toString());
      continue;
    }
    if (page.statusCode < 200 || page.statusCode >= 400) {
      throw new Error(`Public page returned HTTP ${page.statusCode}`);
    }
    const readable = readablePage(page.body, page.contentType);
    const textWasTruncated = readable.text.length > MAX_EXTRACTED_CHARACTERS;
    return {
      requestedUrl,
      url: current.toString(),
      statusCode: page.statusCode,
      title: readable.title,
      text: readable.text.slice(0, MAX_EXTRACTED_CHARACTERS),
      truncated: page.truncated || textWasTruncated,
    };
  }
  throw new Error("Public page could not be read");
}

export async function fetchPublicDomainPage(domain: string): Promise<PublicWebPage> {
  return await fetchPublicWebPage(`https://${domain}/`);
}

export async function fetchPublicWebPages(urls: readonly string[]): Promise<PublicWebPageResult[]> {
  const results: PublicWebPageResult[] = new Array(urls.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < urls.length) {
      const index = nextIndex;
      nextIndex += 1;
      const requestedUrl = urls[index] ?? "";
      try {
        results[index] = { ok: true, ...(await fetchPublicWebPage(requestedUrl)) };
      } catch (error) {
        results[index] = {
          ok: false,
          requestedUrl,
          error: error instanceof Error ? error.message.slice(0, 300) : "Public page could not be read",
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
  return results;
}
