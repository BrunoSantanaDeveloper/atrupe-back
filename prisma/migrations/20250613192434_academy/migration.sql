-- CreateTable
CREATE TABLE "academy" (
    "id" TEXT NOT NULL,
    "type" TEXT[] DEFAULT ARRAY['START', 'LITE', 'PRO', 'ELITE', 'FULL']::TEXT[],
    "section" TEXT NOT NULL DEFAULT 'Apresentação',
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "videoUrl" TEXT NOT NULL DEFAULT 'https://vimeo.com/43652787',
    "page" TEXT NOT NULL DEFAULT '/',
    "modal" TEXT NOT NULL DEFAULT 'CompanyInfo',
    "buttonTitle" TEXT NOT NULL DEFAULT 'Cadastrar dados',

    CONSTRAINT "academy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_files" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "type" TEXT,
    "fileUrl" TEXT,
    "academySystemId" TEXT NOT NULL,

    CONSTRAINT "academy_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_progress" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "academySystemId" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "academy_progress_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "academy_files" ADD CONSTRAINT "academy_files_academySystemId_fkey" FOREIGN KEY ("academySystemId") REFERENCES "academy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_progress" ADD CONSTRAINT "academy_progress_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_progress" ADD CONSTRAINT "academy_progress_academySystemId_fkey" FOREIGN KEY ("academySystemId") REFERENCES "academy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
