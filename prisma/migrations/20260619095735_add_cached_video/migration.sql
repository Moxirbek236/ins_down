-- CreateTable
CREATE TABLE "CachedVideo" (
    "id" SERIAL NOT NULL,
    "instagramUrl" TEXT NOT NULL,
    "telegramFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CachedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CachedVideo_instagramUrl_key" ON "CachedVideo"("instagramUrl");
