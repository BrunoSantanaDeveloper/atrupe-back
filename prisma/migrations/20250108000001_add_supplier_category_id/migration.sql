-- AddColumn
ALTER TABLE "suppliers" ADD COLUMN "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "suppliers_categoryId_idx" ON "suppliers"("categoryId");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;