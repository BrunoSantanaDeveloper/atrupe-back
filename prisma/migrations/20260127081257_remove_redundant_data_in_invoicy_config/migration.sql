/*
  Warnings:

  - You are about to drop the column `accessKey` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `apiToken` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `certificate` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `certificatePassword` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitBairro` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitCep` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitCmun` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitCnpj` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitEndereco` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitIe` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitIm` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitNomeFantasia` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitNumero` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitPais` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitRazaoSocial` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitUf` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `emitXMun` on the `invoicy_configs` table. All the data in the column will be lost.
  - You are about to drop the column `partnerKey` on the `invoicy_configs` table. All the data in the column will be lost.
  - Made the column `environment` on table `invoicy_configs` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "invoicy_configs" DROP COLUMN "accessKey",
DROP COLUMN "apiToken",
DROP COLUMN "certificate",
DROP COLUMN "certificatePassword",
DROP COLUMN "emitBairro",
DROP COLUMN "emitCep",
DROP COLUMN "emitCmun",
DROP COLUMN "emitCnpj",
DROP COLUMN "emitEndereco",
DROP COLUMN "emitIe",
DROP COLUMN "emitIm",
DROP COLUMN "emitNomeFantasia",
DROP COLUMN "emitNumero",
DROP COLUMN "emitPais",
DROP COLUMN "emitRazaoSocial",
DROP COLUMN "emitUf",
DROP COLUMN "emitXMun",
DROP COLUMN "partnerKey",
ALTER COLUMN "emitCrt" DROP NOT NULL,
ALTER COLUMN "serieNfe" DROP NOT NULL,
ALTER COLUMN "proximoNumeroNfe" DROP NOT NULL,
ALTER COLUMN "environment" SET NOT NULL,
ALTER COLUMN "proximoNumeroNfce" DROP NOT NULL,
ALTER COLUMN "proximoRpsNfse" DROP NOT NULL,
ALTER COLUMN "serieNfce" DROP NOT NULL;
