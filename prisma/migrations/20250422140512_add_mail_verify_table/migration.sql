-- CreateTable
CREATE TABLE "mail_verifications" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "email" TEXT,
    "token" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "mail_verifications_pkey" PRIMARY KEY ("id")
);
