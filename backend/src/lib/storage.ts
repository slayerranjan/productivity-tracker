// ===========================================================================
// STORAGE — where uploaded documents actually live.
//
// This is deliberately an interface with one implementation. Today files go
// to local disk, which is fine for a single server and loses everything on a
// redeploy. Swapping in Cloudflare R2 or S3 means rewriting the three
// functions at the bottom of this file and nothing else in the codebase.
//
// SECURITY
// The storage key is built entirely by this module — a uuid plus an
// extension derived from the MIME type we validated. The user's filename is
// kept only as a label in the database and never appears in a path. That is
// what makes "../../../.env" as a filename harmless.
// ===========================================================================

import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Override with UPLOAD_DIR in .env to put files outside the project.
const ROOT = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// An allow-list, not a block-list. Anything not named here is refused —
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
// Nothing else is ever accepted, so a key from the database cannot walk out
// of the uploads directory.
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

// Keeps a readable label for the UI. Never used to build a path.
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

  const absolute = path.join(ROOT, storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);

  return {
    storageKey,
    fileName: cleanLabel(opts.originalName),
    fileSize: buffer.length,
    mimeType,
  };
}

export async function readStored(storageKey: string): Promise<Buffer> {
  assertSafeKey(storageKey);
  try {
    return await readFile(path.join(ROOT, storageKey));
  } catch {
    throw new Error("FILE_MISSING");
  }
}

export async function deleteStored(storageKey: string): Promise<void> {
  assertSafeKey(storageKey);
  try {
    await unlink(path.join(ROOT, storageKey));
  } catch {
    // Already gone is the desired end state, so this is not an error.
  }
}

export function contentTypeFor(storageKey: string): string {
  const ext = storageKey.split(".").pop()?.toLowerCase() ?? "";
  const found = Object.entries(ALLOWED_TYPES).find(([, e]) => e === ext);
  return found?.[0] ?? "application/octet-stream";
}