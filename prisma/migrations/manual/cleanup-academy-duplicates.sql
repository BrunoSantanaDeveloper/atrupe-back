-- T-039: Clean up duplicate AcademyProgress records before applying unique constraint
-- Keep only the most recent record per (companyId, academySystemId)

DELETE FROM academy_progress
WHERE id NOT IN (
  SELECT DISTINCT ON ("companyId", "academySystemId") id
  FROM academy_progress
  ORDER BY "companyId", "academySystemId", "completedAt" DESC NULLS LAST
);
