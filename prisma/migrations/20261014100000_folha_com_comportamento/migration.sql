-- Folha com comportamento, acréscimo e desconto (ALT-18), e o colaborador
-- com forma de contratação e salário base (primeira entrega da folha "muda").
-- Tudo aditivo: type e amount continuam e ficam em sincronia com os campos
-- novos; os itens que já existem ganham os mesmos valores nos campos novos,
-- então a folha mensal sai igual.

-- CreateEnum
CREATE TYPE "PayrollBehavior" AS ENUM ('ONLY_INCREASE', 'ONLY_DISCOUNT', 'INCREASE_AND_DISCOUNT', 'PROVISION', 'ADVANCE');

-- CreateEnum
CREATE TYPE "EmploymentContract" AS ENUM ('CLT', 'PRO_LABORE', 'MEI_PJ');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "baseSalary" INTEGER,
ADD COLUMN     "contract" "EmploymentContract";

-- AlterTable
ALTER TABLE "payroll_setup" ADD COLUMN     "behavior" "PayrollBehavior",
ADD COLUMN     "discount" INTEGER,
ADD COLUMN     "increase" INTEGER,
ADD COLUMN     "manualOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payroll_template" ADD COLUMN     "behavior" "PayrollBehavior",
ADD COLUMN     "defaultDiscount" INTEGER,
ADD COLUMN     "defaultIncrease" INTEGER,
ADD COLUMN     "derivedFromSalary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fixedByLaw" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isBase" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rate" DOUBLE PRECISION,
ADD COLUMN     "systemKey" TEXT;

-- Os itens da empresa: acréscimo, desconto e adiantamento como eram; o
-- "Salário" é o salário base
UPDATE "payroll_template" SET
  "behavior" = CASE "type"
    WHEN 'INCREASE' THEN 'ONLY_INCREASE'::"PayrollBehavior"
    WHEN 'DISCOUNT' THEN 'ONLY_DISCOUNT'::"PayrollBehavior"
    ELSE 'ADVANCE'::"PayrollBehavior"
  END,
  "defaultIncrease" = CASE WHEN "type" IN ('INCREASE', 'ADVANCE') THEN ROUND("defaultAmount")::integer ELSE 0 END,
  "defaultDiscount" = CASE WHEN "type" = 'DISCOUNT' THEN ROUND("defaultAmount")::integer ELSE 0 END,
  "isBase" = ("type" = 'INCREASE' AND "name" IN ('Salário', 'Salario', 'Salário base', 'Salario base')),
  "systemKey" = CASE
    WHEN "type" = 'INCREASE' AND "name" IN ('Salário', 'Salario', 'Salário base', 'Salario base') THEN 'BASE_SALARY'
  END;

-- As linhas de cada colaborador: o valor vai para o acréscimo ou o desconto
UPDATE "payroll_setup" SET
  "behavior" = CASE "type"
    WHEN 'INCREASE' THEN 'ONLY_INCREASE'::"PayrollBehavior"
    WHEN 'DISCOUNT' THEN 'ONLY_DISCOUNT'::"PayrollBehavior"
    ELSE 'ADVANCE'::"PayrollBehavior"
  END,
  "increase" = CASE WHEN "type" IN ('INCREASE', 'ADVANCE') THEN ROUND("amount")::integer ELSE 0 END,
  "discount" = CASE WHEN "type" = 'DISCOUNT' THEN ROUND("amount")::integer ELSE 0 END;

-- O salário base do colaborador é o do cadastro (D33). A forma de
-- contratação não é presumida: fica vazia até alguém escolher, e sem ela
-- não há encargos (presumir CLT encareceria o custo de quem é PJ)
UPDATE "employees" SET
  "baseSalary" = ROUND("sallary")::integer
WHERE "sallary" IS NOT NULL AND "sallary" > 0;
