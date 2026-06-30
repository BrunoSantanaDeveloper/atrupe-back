-- CreateTable: Junction table for SaleSeries <-> SellerProfile many-to-many
CREATE TABLE "_SeriesAllowedProfiles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_SeriesAllowedProfiles_AB_unique" ON "_SeriesAllowedProfiles"("A", "B");
CREATE INDEX "_SeriesAllowedProfiles_B_index" ON "_SeriesAllowedProfiles"("B");

-- AddForeignKey
ALTER TABLE "_SeriesAllowedProfiles" ADD CONSTRAINT "_SeriesAllowedProfiles_A_fkey" FOREIGN KEY ("A") REFERENCES "sale_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SeriesAllowedProfiles" ADD CONSTRAINT "_SeriesAllowedProfiles_B_fkey" FOREIGN KEY ("B") REFERENCES "seller_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
