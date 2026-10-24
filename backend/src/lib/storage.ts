// ===========================================================================
// STORAGE - where uploaded documents actually live.
//
// Files are kept in the database rather than on disk. Not because a database
// is the ideal place for binary data, but because the hosting disk is wiped
// on every redeploy, and losing 53 people's Aadhaar and PAN cards to a
// routine update is not a risk worth taking to save a table.
//
// Still an interface with one implementation: moving to Cloudflare R2 or S3
// means rewriting the three functions at the bottom and nothing else.
//
// SECURITY
// The storage key is built entirely by this module - a uuid plus an extension
// derived from the MIME type we validated. The user's filename is kept only
// as a label in the database and never appears in a key. That is what makes
// "../../../.env" as a filename harmless.
// ===========================================================================

import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// An allow-list, not a block-list. Anything not named here is refused -
// which is how you avoid someone uploading an .html file that later gets
// served back and runs script in your users' browsers.
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export type StoredFile = {
  storageKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

// A key looks like: <uuid>/<folder>/<uuid>.<ext>
const KEY_PATTERN = /^[0-9a-f-]{36}\/[a-z-]{1,32}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i;

function assertSafeKey(storageKey: string) {
  if (!KEY_PATTERN.test(storageKey)) throw new Error("BAD_STORAGE_KEY");
}

// Browsers send "data:application/pdf;base64,JVBERi0..." from a FileReader.
// Accept either that or a bare base64 string.
function splitDataUrl(input: string): { mimeType?: string; base64: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(input);
  if (match) return { mimeType: match[1], base64: match[2]! };
  return { base64: input };
}

// Keeps a readable label for the UI. Never used to build a key.
function cleanLabel(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "file";
}

// ---------------------------------------------------------------------------
// The three functions a different provider would replace.
// ---------------------------------------------------------------------------

export async function saveUpload(opts: {
  platformId: string;
  folder: string; // "documents", "payslips", "induction"
  originalName: string;
  data: string; // base64, with or without a data: prefix
  mimeType?: string;
}): Promise<StoredFile> {
  const { base64, mimeType: fromData } = splitDataUrl(opts.data);
  const mimeType = (opts.mimeType ?? fromData ?? "").toLowerCase();

  const extension = ALLOWED_TYPES[mimeType];
  if (!extension) throw new Error("UNSUPPORTED_FILE_TYPE");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) throw new Error("EMPTY_FILE");
  if (buffer.length > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");

  const folder = opts.folder.replace(/[^a-z-]/g, "").slice(0, 32) || "misc";
  const storageKey = `${opts.platformId}/${folder}/${randomUUID()}.${extension}`;
  assertSafeKey(storageKey);

  await prisma.storedBlob.create({
    data: {
      storageKey,
      platformId: opts.platformId,
      folder,
      mimeType,
      fileSize: buffer.length,
      data: buffer,
    },
  });

  return {
    storageKey,
    fileName: cleanLabel(opts.originalName),
    fileSize: buffer.length,
    mimeType,
  };
}

export async function readStored(storageKey: string): Promise<Buffer> {
  assertSafeKey(storageKey);

  const blob = await prisma.storedBlob.findUnique({
    where: { storageKey },
    select: { data: true },
  });
  if (!blob) throw new Error("FILE_MISSING");

  return Buffer.from(blob.data);
}

export async function deleteStored(storageKey: string): Promise<void> {
  assertSafeKey(storageKey);
  try {
    await prisma.storedBlob.delete({ where: { storageKey } });
  } catch {
    // Already gone is the desired end state, so this is not an error.
  }
}

export function contentTypeFor(storageKey: string): string {
  const ext = storageKey.split(".").pop()?.toLowerCase() ?? "";
  const found = Object.entries(ALLOWED_TYPES).find(([, e]) => e === ext);
  return found?.[0] ?? "application/octet-stream";
}
