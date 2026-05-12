-- CreateTable
CREATE TABLE "user_activity_events" (
    "id" TEXT NOT NULL,
    "activityId" TEXT,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "employeeId" TEXT,
    "sessionId" TEXT NOT NULL,
    "endpoint" TEXT,
    "method" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_activity_events_activityId_idx" ON "user_activity_events"("activityId");

-- CreateIndex
CREATE INDEX "user_activity_events_userId_idx" ON "user_activity_events"("userId");

-- CreateIndex
CREATE INDEX "user_activity_events_sessionId_idx" ON "user_activity_events"("sessionId");

-- CreateIndex
CREATE INDEX "user_activity_events_companyId_idx" ON "user_activity_events"("companyId");

-- CreateIndex
CREATE INDEX "user_activity_events_createdAt_idx" ON "user_activity_events"("createdAt");

-- CreateIndex
CREATE INDEX "user_activity_events_method_idx" ON "user_activity_events"("method");

-- AddForeignKey
ALTER TABLE "user_activity_events" ADD CONSTRAINT "user_activity_events_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "user_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_activity_events" ADD CONSTRAINT "user_activity_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
