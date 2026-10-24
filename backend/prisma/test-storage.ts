import { saveUpload, readStored, deleteStored } from "../src/lib/storage.js";
import { prisma } from "../src/lib/prisma.js";

const platform = await prisma.platform.findFirst({ select: { id: true } });
if (!platform) throw new Error("no platform found");

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const stored = await saveUpload({
  platformId: platform.id,
  folder: "documents",
  originalName: "../../../.env",
  data: png,
  mimeType: "image/png",
});
console.log("saved   :", stored.storageKey, stored.fileSize, "bytes");
console.log("label   :", stored.fileName);

const back = await readStored(stored.storageKey);
console.log("read    :", back.length, "bytes");
console.log("match   :", back.length === stored.fileSize ? "YES" : "NO");

await deleteStored(stored.storageKey);
try {
  await readStored(stored.storageKey);
  console.log("delete  : FAILED");
} catch {
  console.log("delete  : OK");
}

await prisma.$disconnect();
