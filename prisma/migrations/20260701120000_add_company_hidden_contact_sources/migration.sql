CREATE TABLE "company_hidden_contact_sources" (
    "companyId" TEXT NOT NULL,
    "contactSourceId" TEXT NOT NULL,

    CONSTRAINT "company_hidden_contact_sources_pkey" PRIMARY KEY ("companyId","contactSourceId")
);

ALTER TABLE "company_hidden_contact_sources" ADD CONSTRAINT "company_hidden_contact_sources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_hidden_contact_sources" ADD CONSTRAINT "company_hidden_contact_sources_contactSourceId_fkey" FOREIGN KEY ("contactSourceId") REFERENCES "contact_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
