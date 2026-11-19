-- As novidades do sistema (19/11/2026): o Super Admin publica cada
-- atualização; o sino, o aviso do painel e a página Novidades leem daqui.
CREATE TABLE "release_notes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "version" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "plans" "PlanType"[] DEFAULT ARRAY[]::"PlanType"[],
    "highlight" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "release_note_reads" (
    "releaseNoteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),
    "announcedAt" TIMESTAMP(3),

    CONSTRAINT "release_note_reads_pkey" PRIMARY KEY ("releaseNoteId","userId")
);

CREATE INDEX "release_notes_publishedAt_idx" ON "release_notes"("publishedAt");

CREATE INDEX "release_note_reads_userId_idx" ON "release_note_reads"("userId");

ALTER TABLE "release_note_reads" ADD CONSTRAINT "release_note_reads_releaseNoteId_fkey" FOREIGN KEY ("releaseNoteId") REFERENCES "release_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "release_note_reads" ADD CONSTRAINT "release_note_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
