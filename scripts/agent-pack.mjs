/**
 * The agent pack: one encrypted file that carries a learner's agent from their
 * own computer to the cloud.
 *
 * Why a file rather than environment variables or repository secrets: the
 * things worth moving are an encrypted SQLite database and the key that opens
 * it. Retyping four API credentials into a cloud n8n is the kind of task that
 * loses half a classroom, and pasting keys into a hosting dashboard teaches
 * exactly the wrong habit. Download one file, upload one file.
 *
 * The pack contains the n8n encryption key in the clear, which is the key to
 * every credential the learner has saved. It is therefore always encrypted
 * with a passphrase they choose, and it is never written anywhere a deploy
 * could pick it up.
 *
 * Shared by scripts/pack-agent.mjs (writes) and scripts/cloud.mjs (reads), so
 * there is one definition of the format rather than two that drift.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = Buffer.from("AGENTPK", "latin1");
const FORMAT_VERSION = 1;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * scrypt cost. N=65536 needs roughly 64 MB and about a second, which is
 * unremarkable when saving a file and expensive enough to make guessing a
 * passphrase from a stolen pack impractical. maxmem must be raised explicitly
 * because Node's default ceiling is below what this costs.
 */
const SCRYPT = { N: 65_536, r: 8, p: 1, maxmem: 128 * 1_024 * 1_024 };

export const PACK_EXTENSION = ".agentpack";
export const MIN_PASSPHRASE_LENGTH = 10;

export class PackError extends Error {
  constructor(message) {
    super(message);
    this.name = "PackError";
  }
}

// ---------------------------------------------------------------------------
// A minimal archive, so the format depends on no external tar and no packages
// ---------------------------------------------------------------------------

/**
 * @param {Array<{path: string, mode: number, data: Buffer}>} entries
 */
function packArchive(entries) {
  const index = entries.map((entry) => ({
    path: entry.path,
    mode: entry.mode,
    size: entry.data.length,
  }));
  const indexJson = Buffer.from(JSON.stringify(index), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(indexJson.length, 0);
  return Buffer.concat([
    header,
    indexJson,
    ...entries.map((entry) => entry.data),
  ]);
}

function unpackArchive(buffer) {
  if (buffer.length < 4) {
    throw new PackError("The pack is damaged.");
  }
  const indexLength = buffer.readUInt32BE(0);
  if (indexLength <= 0 || 4 + indexLength > buffer.length) {
    throw new PackError("The pack is damaged.");
  }

  let index;
  try {
    index = JSON.parse(buffer.subarray(4, 4 + indexLength).toString("utf8"));
  } catch {
    throw new PackError("The pack is damaged.");
  }
  if (!Array.isArray(index)) {
    throw new PackError("The pack is damaged.");
  }

  const entries = [];
  let offset = 4 + indexLength;
  for (const item of index) {
    if (
      typeof item?.path !== "string" ||
      !Number.isSafeInteger(item?.size) ||
      item.size < 0 ||
      offset + item.size > buffer.length
    ) {
      throw new PackError("The pack is damaged.");
    }
    entries.push({
      path: item.path,
      mode: Number.isSafeInteger(item.mode) ? item.mode : 0o600,
      data: buffer.subarray(offset, offset + item.size),
    });
    offset += item.size;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

function deriveKey(passphrase, salt) {
  return scryptSync(
    Buffer.from(passphrase.normalize("NFKC"), "utf8"),
    salt,
    KEY_BYTES,
    SCRYPT,
  );
}

/**
 * Header layout, all before the ciphertext:
 *
 *   magic      8 bytes
 *   version    1 byte
 *   salt      16 bytes
 *   nonce     12 bytes
 *   metaLen    4 bytes, big endian
 *   metadata   metaLen bytes of JSON, readable without the passphrase
 *   tag       16 bytes
 *   ciphertext rest
 *
 * The metadata is deliberately readable so a learner can be told what a pack
 * contains and when it was made before being asked for a passphrase. It is
 * fed to the cipher as additional authenticated data, so editing it breaks
 * decryption rather than passing silently.
 */
function headerOf(salt, nonce, metadataJson) {
  const fixed = Buffer.alloc(MAGIC.length + 1 + SALT_BYTES + NONCE_BYTES + 4);
  let at = MAGIC.copy(fixed, 0);
  fixed.writeUInt8(FORMAT_VERSION, at);
  at += 1;
  at += salt.copy(fixed, at);
  at += nonce.copy(fixed, at);
  fixed.writeUInt32BE(metadataJson.length, at);
  return Buffer.concat([fixed, metadataJson]);
}

/**
 * @param {{entries: Array<{path: string, mode: number, data: Buffer}>,
 *          passphrase: string, metadata: object}} options
 * @returns {Buffer}
 */
export function createPack({ entries, passphrase, metadata }) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new PackError(
      `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`,
    );
  }

  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const metadataJson = Buffer.from(
    JSON.stringify({ ...metadata, formatVersion: FORMAT_VERSION }),
    "utf8",
  );
  const header = headerOf(salt, nonce, metadataJson);

  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(passphrase, salt),
    nonce,
  );
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([
    cipher.update(gzipSync(packArchive(entries), { level: 9 })),
    cipher.final(),
  ]);

  return Buffer.concat([header, cipher.getAuthTag(), ciphertext]);
}

/**
 * Reads the plaintext header. Used to tell a learner what they have uploaded
 * before asking for a passphrase, and to reject an unrelated file early.
 */
export function readPackMetadata(buffer) {
  const fixedLength = MAGIC.length + 1 + SALT_BYTES + NONCE_BYTES + 4;
  if (buffer.length < fixedLength + TAG_BYTES) {
    throw new PackError("That file is not an agent pack.");
  }
  if (!timingSafeEqual(buffer.subarray(0, MAGIC.length), MAGIC)) {
    throw new PackError("That file is not an agent pack.");
  }
  const version = buffer.readUInt8(MAGIC.length);
  if (version !== FORMAT_VERSION) {
    throw new PackError(
      `That pack was made by a different version of the agent (format ${version}).`,
    );
  }

  const metaLengthAt = MAGIC.length + 1 + SALT_BYTES + NONCE_BYTES;
  const metadataLength = buffer.readUInt32BE(metaLengthAt);
  const metadataAt = metaLengthAt + 4;
  if (metadataAt + metadataLength + TAG_BYTES > buffer.length) {
    throw new PackError("The pack is damaged.");
  }

  try {
    return {
      metadata: JSON.parse(
        buffer.subarray(metadataAt, metadataAt + metadataLength).toString("utf8"),
      ),
      headerLength: metadataAt + metadataLength,
    };
  } catch {
    throw new PackError("The pack is damaged.");
  }
}

/**
 * @returns {{metadata: object, entries: Array<{path: string, mode: number, data: Buffer}>}}
 */
export function openPack(buffer, passphrase) {
  const { metadata, headerLength } = readPackMetadata(buffer);
  const header = buffer.subarray(0, headerLength);
  const salt = buffer.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT_BYTES);
  const nonce = buffer.subarray(
    MAGIC.length + 1 + SALT_BYTES,
    MAGIC.length + 1 + SALT_BYTES + NONCE_BYTES,
  );
  const tag = buffer.subarray(headerLength, headerLength + TAG_BYTES);
  const ciphertext = buffer.subarray(headerLength + TAG_BYTES);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(passphrase, salt),
    nonce,
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  let archive;
  try {
    archive = gunzipSync(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]),
    );
  } catch {
    // GCM cannot tell a wrong passphrase from a corrupted file, and the
    // honest answer covers both.
    throw new PackError(
      "That passphrase did not open the pack. Check it and try again.",
    );
  }

  return { metadata, entries: unpackArchive(archive) };
}
