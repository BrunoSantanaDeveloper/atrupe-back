-- CX-2: a conta do PIX e a do cartão de cada frente de caixa
ALTER TABLE "cash_fronts" ADD COLUMN "cardAccountId" TEXT,
ADD COLUMN "pixAccountId" TEXT;
