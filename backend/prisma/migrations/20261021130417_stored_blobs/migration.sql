-- CreateTable
CREATE TABLE "stored_blobs" (
    "storageKey" TEXT NOT NULL,
    "platformId" UUID NOT NULL,
    "folder" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_blobs_pkey" PRIMARY KEY ("storageKey")
);

-- CreateIndex
CREATE INDEX "stored_blobs_platformId_folder_idx" ON "stored_blobs"("platformId", "folder");
