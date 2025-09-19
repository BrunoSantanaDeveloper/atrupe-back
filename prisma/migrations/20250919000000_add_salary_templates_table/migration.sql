-- CreateTable
CREATE TABLE "salary_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ItemType" NOT NULL DEFAULT 'INCREASE',
    "defaultAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "salary_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_templates_name_type_companyId_key" ON "salary_templates"("name", "type", "companyId");

-- AddForeignKey
ALTER TABLE "salary_templates" ADD CONSTRAINT "salary_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_controls" ADD CONSTRAINT "salary_controls_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "salary_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;