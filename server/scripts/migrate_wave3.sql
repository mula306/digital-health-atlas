-- Wave 3 Migration
-- Adds:
-- 1) Governance capacity planning fields
-- 2) Intake effort estimates for scenario modeling
-- 3) Benefits realization tracking
-- 4) Executive pack org scoping for scheduled automation

USE DHAtlas;
GO

-- ==================== GOVERNANCE CAPACITY ====================

IF COL_LENGTH('GovernanceBoard', 'weeklyCapacityHours') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD weeklyCapacityHours DECIMAL(9,2) NULL;
END
GO

IF COL_LENGTH('GovernanceBoard', 'wipLimit') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD wipLimit INT NULL;
END
GO

IF COL_LENGTH('GovernanceBoard', 'defaultSubmissionEffortHours') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD defaultSubmissionEffortHours DECIMAL(9,2) NOT NULL
        CONSTRAINT DF_GovernanceBoard_DefaultSubmissionEffortHours DEFAULT 40 WITH VALUES;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceBoard_WeeklyCapacityHours'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_WeeklyCapacityHours
    CHECK (weeklyCapacityHours IS NULL OR weeklyCapacityHours > 0);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceBoard_WipLimit'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_WipLimit
    CHECK (wipLimit IS NULL OR wipLimit >= 1);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceBoard_DefaultSubmissionEffortHours'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_DefaultSubmissionEffortHours
    CHECK (defaultSubmissionEffortHours > 0);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GovernanceBoard_Capacity')
    CREATE INDEX IX_GovernanceBoard_Capacity ON GovernanceBoard(isActive, wipLimit, weeklyCapacityHours);
GO

-- ==================== INTAKE EFFORT ESTIMATES ====================

IF COL_LENGTH('IntakeSubmissions', 'estimatedEffortHours') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD estimatedEffortHours DECIMAL(9,2) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_IntakeSubmissions_EstimatedEffortHours'
)
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD CONSTRAINT CK_IntakeSubmissions_EstimatedEffortHours
    CHECK (estimatedEffortHours IS NULL OR estimatedEffortHours > 0);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_EstimatedEffort')
    CREATE INDEX IX_IntakeSubmissions_EstimatedEffort ON IntakeSubmissions(estimatedEffortHours);
GO

-- ==================== BENEFITS REALIZATION ====================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProjectBenefitRealization')
CREATE TABLE ProjectBenefitRealization (
    id INT IDENTITY(1,1) PRIMARY KEY,
    projectId INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    linkedKpiId INT NULL,
    baselineValue DECIMAL(18,2) NULL,
    targetValue DECIMAL(18,2) NULL,
    currentValue DECIMAL(18,2) NULL,
    unit NVARCHAR(50) NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'planned', -- planned | in-progress | realized | at-risk | not-realized
    dueAt DATE NULL,
    realizedAt DATE NULL,
    governanceReviewId INT NULL,
    governanceDecision NVARCHAR(30) NULL,
    notes NVARCHAR(MAX) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    updatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    updatedByOid NVARCHAR(100) NULL,
    CONSTRAINT FK_ProjectBenefitRealization_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
    CONSTRAINT FK_ProjectBenefitRealization_KPI FOREIGN KEY (linkedKpiId) REFERENCES KPIs(id) ON DELETE SET NULL,
    CONSTRAINT CK_ProjectBenefitRealization_Status CHECK (status IN ('planned', 'in-progress', 'realized', 'at-risk', 'not-realized'))
);
GO

IF COL_LENGTH('ProjectBenefitRealization', 'governanceReviewId') IS NULL
BEGIN
    ALTER TABLE ProjectBenefitRealization
    ADD governanceReviewId INT NULL;
END
GO

IF COL_LENGTH('ProjectBenefitRealization', 'governanceDecision') IS NULL
BEGIN
    ALTER TABLE ProjectBenefitRealization
    ADD governanceDecision NVARCHAR(30) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_ProjectBenefitRealization_GovernanceDecision'
)
BEGIN
    ALTER TABLE ProjectBenefitRealization
    ADD CONSTRAINT CK_ProjectBenefitRealization_GovernanceDecision
    CHECK (governanceDecision IS NULL OR governanceDecision IN ('approved-now', 'approved-backlog', 'needs-info', 'rejected'));
END
GO

IF OBJECT_ID('GovernanceReview', 'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.foreign_keys
       WHERE name = 'FK_ProjectBenefitRealization_GovernanceReview'
   )
BEGIN
    ALTER TABLE ProjectBenefitRealization
    ADD CONSTRAINT FK_ProjectBenefitRealization_GovernanceReview
    FOREIGN KEY (governanceReviewId) REFERENCES GovernanceReview(id) ON DELETE SET NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ProjectBenefitRealization_Project')
    CREATE INDEX IX_ProjectBenefitRealization_Project ON ProjectBenefitRealization(projectId, status, dueAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ProjectBenefitRealization_Kpi')
    CREATE INDEX IX_ProjectBenefitRealization_Kpi ON ProjectBenefitRealization(linkedKpiId);
GO

-- ==================== EXECUTIVE PACK SCOPING ====================

IF COL_LENGTH('ExecutiveReportPack', 'scopeOrgId') IS NULL
BEGIN
    ALTER TABLE ExecutiveReportPack
    ADD scopeOrgId INT NULL;
END
GO

IF OBJECT_ID('Organizations', 'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM sys.foreign_keys
       WHERE name = 'FK_ExecutiveReportPack_ScopeOrg'
   )
BEGIN
    ALTER TABLE ExecutiveReportPack
    ADD CONSTRAINT FK_ExecutiveReportPack_ScopeOrg
    FOREIGN KEY (scopeOrgId) REFERENCES Organizations(id) ON DELETE SET NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ExecutiveReportPack_ScopeOrg')
    CREATE INDEX IX_ExecutiveReportPack_ScopeOrg ON ExecutiveReportPack(scopeOrgId, isActive, nextRunAt);
GO

PRINT 'Wave 3 migration completed successfully.';
GO
