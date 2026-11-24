-- A agenda viva passa a valer para a cadeia inteira (Maicol, 24/11/2026):
-- a opção sai do gerenciador e vai para o expediente da empresa. A empresa
-- que tinha algum gerenciador em "reagenda e avisa" continua com ela.
ALTER TABLE "production_calendars" ADD COLUMN "liveSchedule" "ProductionLiveSchedule" NOT NULL DEFAULT 'WARN';

INSERT INTO "production_calendars" ("id", "companyId", "liveSchedule", "updatedAt")
SELECT gen_random_uuid()::text, m."companyId", 'RESCHEDULE', NOW()
FROM "production_managers" m
WHERE m."liveSchedule" = 'RESCHEDULE'
GROUP BY m."companyId"
ON CONFLICT ("companyId") DO UPDATE SET "liveSchedule" = 'RESCHEDULE';

-- O cadeado: o trabalho travado na agenda não anda
ALTER TABLE "production_tasks" ADD COLUMN "scheduleLocked" BOOLEAN NOT NULL DEFAULT false;
