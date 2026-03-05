-- ============================================================
-- Migration: ProjectGoals join table (multi-goal associations)
-- ============================================================

-- 1. Create the join table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProjectGoals')
BEGIN
    CREATE TABLE ProjectGoals (
        projectId INT NOT NULL,
        goalId    INT NOT NULL,
        createdAt DATETIME2 DEFAULT GETDATE(),
        CONSTRAINT PK_ProjectGoals PRIMARY KEY (projectId, goalId),
        CONSTRAINT FK_ProjectGoals_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
        CONSTRAINT FK_ProjectGoals_Goal FOREIGN KEY (goalId) REFERENCES Goals(id) ON DELETE CASCADE
    );

    CREATE INDEX IX_ProjectGoals_GoalId ON ProjectGoals(goalId);
    PRINT 'Created ProjectGoals table';
END
ELSE
    PRINT 'ProjectGoals table already exists';
GO

-- 2. Migrate existing goalId data from Projects into ProjectGoals
INSERT INTO ProjectGoals (projectId, goalId)
SELECT id, goalId
FROM Projects
WHERE goalId IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM ProjectGoals pg
      WHERE pg.projectId = Projects.id AND pg.goalId = Projects.goalId
  );

DECLARE @migratedCount INT = @@ROWCOUNT;
PRINT 'Migrated ' + CAST(@migratedCount AS VARCHAR(10)) + ' existing project-goal associations';
GO

PRINT 'ProjectGoals migration complete!';
GO
