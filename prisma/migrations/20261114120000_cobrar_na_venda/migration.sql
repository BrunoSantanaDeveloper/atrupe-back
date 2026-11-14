-- Cobrar na venda (VR-10, 14/11/2026): o vendedor recebe à vista na hora.
-- Separado de "Faturar na frente de caixa" (ON_CHECKOUT), que só envia ao caixa.
ALTER TYPE "BiilingKind" ADD VALUE 'ON_SALE';
