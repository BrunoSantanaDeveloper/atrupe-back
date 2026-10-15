-- Somente enviar ao caixa (FC-12.1): o perfil do vendedor que só envia a
-- venda rápida à frente de caixa.

-- AlterTable
ALTER TABLE "seller_profile" ADD COLUMN     "onlySendToCash" BOOLEAN NOT NULL DEFAULT false;
