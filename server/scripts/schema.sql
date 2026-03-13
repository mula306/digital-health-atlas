-- Digital Health Atlas Canonical SQL Server Schema
-- Fresh installs should run this via `npm run setup-db` (or `npm run setup-db:full` for RBAC seed data).
-- Includes the Enterprise -> Portfolio -> Service -> Team goal cascade, org-centric ownership,
-- governance phases 0-3, multi-org sharing, watchlists, task tracking, session/SLA, and
-- benefits/capacity features.

-- Create database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'DHAtlas')
BEGIN
    CREATE DATABASE DHAtlas;
END
GO

USE DHAtlas;
GO

-- Goals table (goal cascade hierarchy only; ownership is stored separately in Goals.orgId later in this script)
-- lifecycleState controls whether a goal is active in default operational views:
--   active   -> normal goal tree visibility
--   retired  -> hidden from default views but retained as historical strategy context
--   archived -> historical only / restoreable
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Goals')
CREATE TABLE Goals (
    id INT IDENTITY(1,1) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    type NVARCHAR(20) NOT NULL,  -- 'enterprise', 'portfolio', 'service', 'team'
    parentId INT NULL,
    createdAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_Goals_Parent FOREIGN KEY (parentId) REFERENCES Goals(id),
    CONSTRAINT CK_Goals_Type CHECK (type IN ('enterprise', 'portfolio', 'service', 'team'))
);
GO

IF COL_LENGTH('Goals', 'lifecycleState') IS NULL
BEGIN
    ALTER TABLE Goals ADD lifecycleState NVARCHAR(20) NOT NULL
        CONSTRAINT DF_Goals_LifecycleState DEFAULT 'active' WITH VALUES;
END
GO

IF COL_LENGTH('Goals', 'retiredAt') IS NULL
BEGIN
    ALTER TABLE Goals ADD retiredAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('Goals', 'archivedAt') IS NULL
BEGIN
    ALTER TABLE Goals ADD archivedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('Goals', 'archivedByOid') IS NULL
BEGIN
    ALTER TABLE Goals ADD archivedByOid NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('Goals', 'archiveReason') IS NULL
BEGIN
    ALTER TABLE Goals ADD archiveReason NVARCHAR(500) NULL;
END
GO

IF COL_LENGTH('Goals', 'lastActivityAt') IS NULL
BEGIN
    ALTER TABLE Goals ADD lastActivityAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('Goals', 'retentionClass') IS NULL
BEGIN
    ALTER TABLE Goals ADD retentionClass NVARCHAR(40) NOT NULL
        CONSTRAINT DF_Goals_RetentionClass DEFAULT 'confidential' WITH VALUES;
END
GO

IF COL_LENGTH('Goals', 'description') IS NULL
BEGIN
    ALTER TABLE Goals ADD description NVARCHAR(MAX) NULL;
END
GO

IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Goals_Type'
      AND parent_object_id = OBJECT_ID('Goals')
)
BEGIN
    ALTER TABLE Goals DROP CONSTRAINT CK_Goals_Type;
END
GO

-- Convert legacy goal taxonomy values in-place for existing databases.
UPDATE Goals
SET type = CASE type
    WHEN 'org' THEN 'enterprise'
    WHEN 'div' THEN 'portfolio'
    WHEN 'dept' THEN 'service'
    WHEN 'branch' THEN 'team'
    ELSE type
END
WHERE type IN ('org', 'div', 'dept', 'branch');
GO

ALTER TABLE Goals
ADD CONSTRAINT CK_Goals_Type
CHECK (type IN ('enterprise', 'portfolio', 'service', 'team'));
GO

-- KPIs (linked to Goals)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'KPIs')
CREATE TABLE KPIs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    goalId INT NOT NULL,
    name NVARCHAR(255) NOT NULL,
    target DECIMAL(18,2) NULL,
    currentValue DECIMAL(18,2) NULL,
    unit NVARCHAR(20) NULL,
    CONSTRAINT FK_KPIs_Goal FOREIGN KEY (goalId) REFERENCES Goals(id) ON DELETE CASCADE
);
GO

-- Projects (legacy single-goal column kept for compatibility; canonical multi-goal links live in ProjectGoals.
-- Ownership is stored separately in Projects.orgId later in this script.
-- lifecycleState controls whether a project remains in active work views:
--   active    -> current delivery work
--   completed -> recently completed / still visible in active views
--   archived  -> historical only / restoreable)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Projects')
CREATE TABLE Projects (
    id INT IDENTITY(1,1) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    status NVARCHAR(20) DEFAULT 'active',
    goalId INT NULL,
    createdAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_Projects_Goal FOREIGN KEY (goalId) REFERENCES Goals(id) ON DELETE SET NULL
);
GO

IF COL_LENGTH('Projects', 'lifecycleState') IS NULL
BEGIN
    ALTER TABLE Projects ADD lifecycleState NVARCHAR(20) NOT NULL
        CONSTRAINT DF_Projects_LifecycleState DEFAULT 'active' WITH VALUES;
END
GO

IF COL_LENGTH('Projects', 'completedAt') IS NULL
BEGIN
    ALTER TABLE Projects ADD completedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('Projects', 'archivedAt') IS NULL
BEGIN
    ALTER TABLE Projects ADD archivedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('Projects', 'archivedByOid') IS NULL
BEGIN
    ALTER TABLE Projects ADD archivedByOid NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('Projects', 'archiveReason') IS NULL
BEGIN
    ALTER TABLE Projects ADD archiveReason NVARCHAR(500) NULL;
END
GO

IF COL_LENGTH('Projects', 'lastActivityAt') IS NULL
BEGIN
    ALTER TABLE Projects ADD lastActivityAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('Projects', 'retentionClass') IS NULL
BEGIN
    ALTER TABLE Projects ADD retentionClass NVARCHAR(40) NOT NULL
        CONSTRAINT DF_Projects_RetentionClass DEFAULT 'confidential' WITH VALUES;
END
GO

-- Project Watchers (personal watchlists per user/project)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProjectWatchers')
CREATE TABLE ProjectWatchers (
    projectId INT NOT NULL,
    userOid NVARCHAR(100) NOT NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_ProjectWatchers PRIMARY KEY (projectId, userOid),
    CONSTRAINT FK_ProjectWatchers_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_ProjectWatchers_UserOid'
      AND object_id = OBJECT_ID('ProjectWatchers')
)
CREATE INDEX IX_ProjectWatchers_UserOid ON ProjectWatchers(userOid);
GO

-- Tasks (linked to Projects)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Tasks')
CREATE TABLE Tasks (
    id INT IDENTITY(1,1) PRIMARY KEY,
    projectId INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    status NVARCHAR(20) DEFAULT 'todo',  -- todo, in-progress, blocked, review, done
    priority NVARCHAR(20) DEFAULT 'medium',  -- low, medium, high
    description NVARCHAR(MAX) NULL,
    startDate DATE NULL,
    endDate DATE NULL,
    assigneeOid NVARCHAR(100) NULL,
    blockerNote NVARCHAR(1000) NULL,
    createdAt DATETIME2 DEFAULT GETDATE(),
    updatedAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_Tasks_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
    CONSTRAINT CK_Tasks_Status CHECK (status IN ('todo', 'in-progress', 'blocked', 'review', 'done')),
    CONSTRAINT CK_Tasks_Priority CHECK (priority IN ('low', 'medium', 'high')),
    CONSTRAINT CK_Tasks_DateOrder CHECK (startDate IS NULL OR endDate IS NULL OR endDate >= startDate)
);
GO

IF COL_LENGTH('Tasks', 'assigneeOid') IS NULL
BEGIN
    ALTER TABLE Tasks ADD assigneeOid NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('Tasks', 'blockerNote') IS NULL
BEGIN
    ALTER TABLE Tasks ADD blockerNote NVARCHAR(1000) NULL;
END
GO

IF COL_LENGTH('Tasks', 'updatedAt') IS NULL
BEGIN
    ALTER TABLE Tasks ADD updatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_Tasks_UpdatedAt DEFAULT GETDATE() WITH VALUES;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Tasks_Status'
)
BEGIN
    ALTER TABLE Tasks
    ADD CONSTRAINT CK_Tasks_Status
    CHECK (status IN ('todo', 'in-progress', 'blocked', 'review', 'done'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Tasks_Priority'
)
BEGIN
    ALTER TABLE Tasks
    ADD CONSTRAINT CK_Tasks_Priority
    CHECK (priority IN ('low', 'medium', 'high'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Tasks_DateOrder'
)
BEGIN
    ALTER TABLE Tasks
    ADD CONSTRAINT CK_Tasks_DateOrder
    CHECK (startDate IS NULL OR endDate IS NULL OR endDate >= startDate);
END
GO

-- Task checklist items (lightweight subtasks)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TaskChecklistItems')
CREATE TABLE TaskChecklistItems (
    id INT IDENTITY(1,1) PRIMARY KEY,
    taskId INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    isDone BIT NOT NULL DEFAULT 0,
    sortOrder INT NOT NULL DEFAULT 0,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_TaskChecklistItems_Task FOREIGN KEY (taskId) REFERENCES Tasks(id) ON DELETE CASCADE,
    CONSTRAINT CK_TaskChecklistItems_SortOrder CHECK (sortOrder >= 0)
);
GO

-- Status Reports (linked to Projects) - JSON blob for flexible structure
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StatusReports')
CREATE TABLE StatusReports (
    id INT IDENTITY(1,1) PRIMARY KEY,
    projectId INT NOT NULL,
    version INT NOT NULL,
    reportData NVARCHAR(MAX) NULL,  -- JSON blob
    createdBy NVARCHAR(100) NULL,
    restoredFrom INT NULL,
    createdAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_StatusReports_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
);
GO

-- Benefits realization tracking (post go-live outcomes)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProjectBenefitRealization')
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

-- Intake Forms
-- `fields` stores a JSON array of field definitions.
-- Current intake contract requires three system fields on all forms:
--   1. Your Name        -> { systemKey: 'requester_name', type: 'text', required: true }
--   2. Project Name     -> { systemKey: 'project_name', type: 'text', required: true }
--   3. Description      -> { systemKey: 'project_description', type: 'textarea', required: true }
-- Additional custom fields may follow after these locked system fields.
-- Intake forms are org-owned via IntakeForms.orgId later in this script.
-- lifecycleState controls whether a form is available for new submissions:
--   draft    -> builder only
--   active   -> visible for submission
--   retired  -> hidden from default submission UX but retained for history
--   archived -> historical only / restoreable
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'IntakeForms')
CREATE TABLE IntakeForms (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    fields NVARCHAR(MAX) NULL,  -- JSON field definitions including optional `systemKey` / `locked` metadata
    defaultGoalId INT NULL,
    createdAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_IntakeForms_Goal FOREIGN KEY (defaultGoalId) REFERENCES Goals(id) ON DELETE SET NULL
);
GO

IF COL_LENGTH('IntakeForms', 'lifecycleState') IS NULL
BEGIN
    ALTER TABLE IntakeForms ADD lifecycleState NVARCHAR(20) NOT NULL
        CONSTRAINT DF_IntakeForms_LifecycleState DEFAULT 'active' WITH VALUES;
END
GO

IF COL_LENGTH('IntakeForms', 'retiredAt') IS NULL
BEGIN
    ALTER TABLE IntakeForms ADD retiredAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('IntakeForms', 'archivedAt') IS NULL
BEGIN
    ALTER TABLE IntakeForms ADD archivedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('IntakeForms', 'archivedByOid') IS NULL
BEGIN
    ALTER TABLE IntakeForms ADD archivedByOid NVARCHAR(100) NULL;
END
GO

-- Intake Submissions
-- orgId stores the submission home organization (normally the submitter's org).
-- submitterId / submitterName / submitterEmail preserve requester identity for audit and conversion.
-- Server-side conversion writes convertedProjectId and keeps the converted project's owner aligned to submission org.
-- resolvedAt tracks when a submission exits active workflow for retention and archive eligibility.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'IntakeSubmissions')
CREATE TABLE IntakeSubmissions (
    id INT IDENTITY(1,1) PRIMARY KEY,
    formId INT NOT NULL,
    formData NVARCHAR(MAX) NULL,  -- JSON of submitted values
    status NVARCHAR(20) DEFAULT 'pending',  -- pending, info-requested, approved, rejected
    infoRequests NVARCHAR(MAX) NULL,  -- JSON array
    convertedProjectId INT NULL,
    submittedAt DATETIME2 DEFAULT GETDATE(),
    submitterId NVARCHAR(100) NULL,
    submitterName NVARCHAR(255) NULL,
    submitterEmail NVARCHAR(255) NULL,
    resolvedAt DATETIME2 NULL,
    CONSTRAINT FK_IntakeSubmissions_Form FOREIGN KEY (formId) REFERENCES IntakeForms(id) ON DELETE CASCADE,
    CONSTRAINT FK_IntakeSubmissions_Project FOREIGN KEY (convertedProjectId) REFERENCES Projects(id) ON DELETE SET NULL
);
GO

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

IF COL_LENGTH('IntakeSubmissions', 'submitterId') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD submitterId NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'submitterName') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD submitterName NVARCHAR(255) NULL;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'submitterEmail') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD submitterEmail NVARCHAR(255) NULL;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'resolvedAt') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD resolvedAt DATETIME2 NULL;
END
GO

-- Role Permissions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RolePermissions')
CREATE TABLE RolePermissions (
    id INT IDENTITY(1,1) PRIMARY KEY,
    role NVARCHAR(50) NOT NULL,
    permission NVARCHAR(100) NOT NULL,
    isAllowed BIT DEFAULT 0,
    CONSTRAINT UQ_Role_Permission UNIQUE(role, permission)
);
GO

-- ==================== GOVERNANCE (PHASE 0) ====================

-- Governance settings (single-row table, default governance disabled)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceSettings')
CREATE TABLE GovernanceSettings (
    id INT IDENTITY(1,1) PRIMARY KEY,
    governanceEnabled BIT NOT NULL DEFAULT 0,
    updatedAt DATETIME2 DEFAULT GETDATE(),
    updatedByOid NVARCHAR(100) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM GovernanceSettings)
INSERT INTO GovernanceSettings (governanceEnabled) VALUES (0);
GO

IF COL_LENGTH('GovernanceSettings', 'quorumPercent') IS NULL
BEGIN
    ALTER TABLE GovernanceSettings
    ADD quorumPercent INT NOT NULL
        CONSTRAINT DF_GovernanceSettings_QuorumPercent DEFAULT 60 WITH VALUES;
END
GO

IF COL_LENGTH('GovernanceSettings', 'quorumMinCount') IS NULL
BEGIN
    ALTER TABLE GovernanceSettings
    ADD quorumMinCount INT NOT NULL
        CONSTRAINT DF_GovernanceSettings_QuorumMinCount DEFAULT 1 WITH VALUES;
END
GO

IF COL_LENGTH('GovernanceSettings', 'decisionRequiresQuorum') IS NULL
BEGIN
    ALTER TABLE GovernanceSettings
    ADD decisionRequiresQuorum BIT NOT NULL
        CONSTRAINT DF_GovernanceSettings_DecisionRequiresQuorum DEFAULT 1 WITH VALUES;
END
GO

IF COL_LENGTH('GovernanceSettings', 'voteWindowDays') IS NULL
BEGIN
    ALTER TABLE GovernanceSettings
    ADD voteWindowDays INT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceSettings_QuorumPercent'
)
BEGIN
    ALTER TABLE GovernanceSettings
    ADD CONSTRAINT CK_GovernanceSettings_QuorumPercent
    CHECK (quorumPercent BETWEEN 1 AND 100);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceSettings_QuorumMinCount'
)
BEGIN
    ALTER TABLE GovernanceSettings
    ADD CONSTRAINT CK_GovernanceSettings_QuorumMinCount
    CHECK (quorumMinCount >= 1);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceSettings_VoteWindowDays'
)
BEGIN
    ALTER TABLE GovernanceSettings
    ADD CONSTRAINT CK_GovernanceSettings_VoteWindowDays
    CHECK (voteWindowDays IS NULL OR voteWindowDays BETWEEN 1 AND 90);
END
GO

-- Governance boards
-- orgId is added later in this script to store the board home org used for board administration and capacity analytics.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceBoard')
CREATE TABLE GovernanceBoard (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    isActive BIT NOT NULL DEFAULT 1,
    createdAt DATETIME2 DEFAULT GETDATE(),
    createdByOid NVARCHAR(100) NULL,
    CONSTRAINT UQ_GovernanceBoard_Name UNIQUE(name)
);
GO

IF COL_LENGTH('GovernanceBoard', 'quorumPercentOverride') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD quorumPercentOverride INT NULL;
END
GO

IF COL_LENGTH('GovernanceBoard', 'quorumMinCountOverride') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD quorumMinCountOverride INT NULL;
END
GO

IF COL_LENGTH('GovernanceBoard', 'decisionRequiresQuorumOverride') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD decisionRequiresQuorumOverride BIT NULL;
END
GO

IF COL_LENGTH('GovernanceBoard', 'voteWindowDaysOverride') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD voteWindowDaysOverride INT NULL;
END
GO

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
    WHERE name = 'CK_GovernanceBoard_QuorumPercentOverride'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_QuorumPercentOverride
    CHECK (quorumPercentOverride IS NULL OR quorumPercentOverride BETWEEN 1 AND 100);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceBoard_QuorumMinCountOverride'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_QuorumMinCountOverride
    CHECK (quorumMinCountOverride IS NULL OR quorumMinCountOverride >= 1);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceBoard_VoteWindowDaysOverride'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_VoteWindowDaysOverride
    CHECK (voteWindowDaysOverride IS NULL OR voteWindowDaysOverride BETWEEN 1 AND 90);
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

-- Governance board membership
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceMembership')
CREATE TABLE GovernanceMembership (
    id INT IDENTITY(1,1) PRIMARY KEY,
    boardId INT NOT NULL,
    userOid NVARCHAR(100) NOT NULL,
    role NVARCHAR(20) NOT NULL DEFAULT 'member', -- member | chair
    isActive BIT NOT NULL DEFAULT 1,
    effectiveFrom DATETIME2 NOT NULL DEFAULT GETDATE(),
    effectiveTo DATETIME2 NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    createdByOid NVARCHAR(100) NULL,
    CONSTRAINT FK_GovernanceMembership_Board FOREIGN KEY (boardId) REFERENCES GovernanceBoard(id) ON DELETE CASCADE
);
GO

-- Versioned, editable criteria configuration per board
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceCriteriaVersion')
CREATE TABLE GovernanceCriteriaVersion (
    id INT IDENTITY(1,1) PRIMARY KEY,
    boardId INT NOT NULL,
    versionNo INT NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | published | retired
    criteriaJson NVARCHAR(MAX) NOT NULL, -- [{ id, name, weight, enabled, sortOrder }]
    publishedAt DATETIME2 NULL,
    publishedByOid NVARCHAR(100) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    createdByOid NVARCHAR(100) NULL,
    CONSTRAINT FK_GovernanceCriteriaVersion_Board FOREIGN KEY (boardId) REFERENCES GovernanceBoard(id) ON DELETE CASCADE,
    CONSTRAINT UQ_GovernanceCriteriaVersion_BoardVersion UNIQUE (boardId, versionNo)
);
GO

-- IntakeForms governance scope controls
IF COL_LENGTH('IntakeForms', 'governanceMode') IS NULL
BEGIN
    ALTER TABLE IntakeForms
    ADD governanceMode NVARCHAR(20) NOT NULL
        CONSTRAINT DF_IntakeForms_GovernanceMode DEFAULT 'off' WITH VALUES;
END
GO

IF COL_LENGTH('IntakeForms', 'governanceBoardId') IS NULL
BEGIN
    ALTER TABLE IntakeForms
    ADD governanceBoardId INT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_IntakeForms_GovernanceBoard'
)
BEGIN
    ALTER TABLE IntakeForms
    ADD CONSTRAINT FK_IntakeForms_GovernanceBoard
    FOREIGN KEY (governanceBoardId) REFERENCES GovernanceBoard(id) ON DELETE SET NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_IntakeForms_GovernanceMode'
)
BEGIN
    ALTER TABLE IntakeForms
    ADD CONSTRAINT CK_IntakeForms_GovernanceMode
    CHECK (governanceMode IN ('off', 'optional', 'required'));
END
GO

-- IntakeSubmissions governance tracking
IF COL_LENGTH('IntakeSubmissions', 'governanceRequired') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD governanceRequired BIT NOT NULL
        CONSTRAINT DF_IntakeSubmissions_GovernanceRequired DEFAULT 0 WITH VALUES;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'governanceStatus') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD governanceStatus NVARCHAR(20) NOT NULL
        CONSTRAINT DF_IntakeSubmissions_GovernanceStatus DEFAULT 'not-started' WITH VALUES;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'governanceDecision') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD governanceDecision NVARCHAR(30) NULL;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'governanceReason') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD governanceReason NVARCHAR(MAX) NULL;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'priorityScore') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD priorityScore DECIMAL(9,2) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_IntakeSubmissions_GovernanceStatus'
)
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD CONSTRAINT CK_IntakeSubmissions_GovernanceStatus
    CHECK (governanceStatus IN ('not-started', 'in-review', 'decided', 'skipped'));
END
GO

-- Governance review rounds (Phase 1)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceReview')
CREATE TABLE GovernanceReview (
    id INT IDENTITY(1,1) PRIMARY KEY,
    submissionId INT NOT NULL,
    boardId INT NOT NULL,
    reviewRound INT NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'in-review', -- in-review | decided | cancelled
    decision NVARCHAR(30) NULL, -- approved-now | approved-backlog | needs-info | rejected
    decisionReason NVARCHAR(MAX) NULL,
    criteriaVersionId INT NULL,
    criteriaSnapshotJson NVARCHAR(MAX) NOT NULL,
    startedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    startedByOid NVARCHAR(100) NULL,
    decidedAt DATETIME2 NULL,
    decidedByOid NVARCHAR(100) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_GovernanceReview_Submission FOREIGN KEY (submissionId) REFERENCES IntakeSubmissions(id) ON DELETE CASCADE,
    CONSTRAINT FK_GovernanceReview_Board FOREIGN KEY (boardId) REFERENCES GovernanceBoard(id) ON DELETE NO ACTION,
    CONSTRAINT FK_GovernanceReview_CriteriaVersion FOREIGN KEY (criteriaVersionId) REFERENCES GovernanceCriteriaVersion(id) ON DELETE NO ACTION,
    CONSTRAINT UQ_GovernanceReview_SubmissionRound UNIQUE (submissionId, reviewRound)
);
GO

IF COL_LENGTH('GovernanceReview', 'policySnapshotJson') IS NULL
BEGIN
    ALTER TABLE GovernanceReview
    ADD policySnapshotJson NVARCHAR(MAX) NULL;
END
GO

IF COL_LENGTH('GovernanceReview', 'voteDeadlineAt') IS NULL
BEGIN
    ALTER TABLE GovernanceReview
    ADD voteDeadlineAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceReview_Status'
)
BEGIN
    ALTER TABLE GovernanceReview
    ADD CONSTRAINT CK_GovernanceReview_Status
    CHECK (status IN ('in-review', 'decided', 'cancelled'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceReview_Decision'
)
BEGIN
    ALTER TABLE GovernanceReview
    ADD CONSTRAINT CK_GovernanceReview_Decision
    CHECK (decision IS NULL OR decision IN ('approved-now', 'approved-backlog', 'needs-info', 'rejected'));
END
GO

IF COL_LENGTH('ProjectBenefitRealization', 'governanceReviewId') IS NULL
BEGIN
    ALTER TABLE ProjectBenefitRealization
    ADD governanceReviewId INT NULL;
END
GO

IF NOT EXISTS (
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

-- Snapshot of review participants at review start
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceReviewParticipant')
CREATE TABLE GovernanceReviewParticipant (
    id INT IDENTITY(1,1) PRIMARY KEY,
    reviewId INT NOT NULL,
    userOid NVARCHAR(100) NOT NULL,
    participantRole NVARCHAR(20) NOT NULL DEFAULT 'member',
    isEligibleVoter BIT NOT NULL DEFAULT 1,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_GovernanceReviewParticipant_Review FOREIGN KEY (reviewId) REFERENCES GovernanceReview(id) ON DELETE CASCADE,
    CONSTRAINT UQ_GovernanceReviewParticipant_ReviewUser UNIQUE (reviewId, userOid)
);
GO

-- Votes per review (upsert by voter)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceVote')
CREATE TABLE GovernanceVote (
    id INT IDENTITY(1,1) PRIMARY KEY,
    reviewId INT NOT NULL,
    voterUserOid NVARCHAR(100) NOT NULL,
    scoresJson NVARCHAR(MAX) NOT NULL,
    comment NVARCHAR(MAX) NULL,
    conflictDeclared BIT NOT NULL DEFAULT 0,
    submittedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    updatedAt DATETIME2 NULL,
    CONSTRAINT FK_GovernanceVote_Review FOREIGN KEY (reviewId) REFERENCES GovernanceReview(id) ON DELETE CASCADE,
    CONSTRAINT UQ_GovernanceVote_ReviewVoter UNIQUE (reviewId, voterUserOid)
);
GO

-- Workflow SLA policy baseline (triage/governance/resolution)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WorkflowSlaPolicy')
CREATE TABLE WorkflowSlaPolicy (
    id INT IDENTITY(1,1) PRIMARY KEY,
    stageKey NVARCHAR(40) NOT NULL,
    displayName NVARCHAR(100) NOT NULL,
    targetHours INT NOT NULL,
    warningHours INT NOT NULL,
    escalationHours INT NOT NULL,
    isActive BIT NOT NULL DEFAULT 1,
    updatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    updatedByOid NVARCHAR(100) NULL,
    CONSTRAINT UQ_WorkflowSlaPolicy_StageKey UNIQUE(stageKey),
    CONSTRAINT CK_WorkflowSlaPolicy_TargetHours CHECK (targetHours >= 1),
    CONSTRAINT CK_WorkflowSlaPolicy_WarningHours CHECK (warningHours >= 0 AND warningHours <= targetHours),
    CONSTRAINT CK_WorkflowSlaPolicy_EscalationHours CHECK (escalationHours >= warningHours)
);
GO

IF NOT EXISTS (SELECT 1 FROM WorkflowSlaPolicy WHERE stageKey = 'triage')
BEGIN
    INSERT INTO WorkflowSlaPolicy (stageKey, displayName, targetHours, warningHours, escalationHours)
    VALUES ('triage', 'Triage', 72, 48, 96);
END
GO

IF NOT EXISTS (SELECT 1 FROM WorkflowSlaPolicy WHERE stageKey = 'governance')
BEGIN
    INSERT INTO WorkflowSlaPolicy (stageKey, displayName, targetHours, warningHours, escalationHours)
    VALUES ('governance', 'Governance Review', 120, 96, 144);
END
GO

IF NOT EXISTS (SELECT 1 FROM WorkflowSlaPolicy WHERE stageKey = 'resolution')
BEGIN
    INSERT INTO WorkflowSlaPolicy (stageKey, displayName, targetHours, warningHours, escalationHours)
    VALUES ('resolution', 'Resolution', 48, 36, 72);
END
GO

IF COL_LENGTH('IntakeSubmissions', 'lastSlaNudgedAt') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD lastSlaNudgedAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'lastSlaNudgedByOid') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD lastSlaNudgedByOid NVARCHAR(100) NULL;
END
GO

-- Governance session mode (meeting-centric queue)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GovernanceSession')
CREATE TABLE GovernanceSession (
    id INT IDENTITY(1,1) PRIMARY KEY,
    boardId INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | live | closed
    scheduledAt DATETIME2 NULL,
    startedAt DATETIME2 NULL,
    endedAt DATETIME2 NULL,
    agendaLocked BIT NOT NULL DEFAULT 0,
    agendaJson NVARCHAR(MAX) NULL, -- [{ submissionId, sortOrder }]
    decisionTemplateJson NVARCHAR(MAX) NULL,
    createdByOid NVARCHAR(100) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    updatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_GovernanceSession_Board FOREIGN KEY (boardId) REFERENCES GovernanceBoard(id) ON DELETE CASCADE,
    CONSTRAINT CK_GovernanceSession_Status CHECK (status IN ('draft', 'live', 'closed'))
);
GO

-- Automated executive report packs
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ExecutiveReportPack')
CREATE TABLE ExecutiveReportPack (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(160) NOT NULL,
    description NVARCHAR(500) NULL,
    ownerOid NVARCHAR(100) NULL,
    scopeOrgId INT NULL,
    isActive BIT NOT NULL DEFAULT 1,
    scheduleType NVARCHAR(20) NOT NULL DEFAULT 'weekly', -- weekly | manual
    scheduleDayOfWeek TINYINT NULL, -- 0 (Sun) - 6 (Sat)
    scheduleHour TINYINT NOT NULL DEFAULT 9,
    scheduleMinute TINYINT NOT NULL DEFAULT 0,
    timezone NVARCHAR(64) NOT NULL DEFAULT 'America/Regina',
    exceptionOnly BIT NOT NULL DEFAULT 0,
    filterJson NVARCHAR(MAX) NULL,
    recipientJson NVARCHAR(MAX) NULL,
    lastRunAt DATETIME2 NULL,
    nextRunAt DATETIME2 NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    updatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT CK_ExecutiveReportPack_ScheduleType CHECK (scheduleType IN ('weekly', 'manual')),
    CONSTRAINT CK_ExecutiveReportPack_DayOfWeek CHECK (scheduleDayOfWeek IS NULL OR (scheduleDayOfWeek BETWEEN 0 AND 6)),
    CONSTRAINT CK_ExecutiveReportPack_Hour CHECK (scheduleHour BETWEEN 0 AND 23),
    CONSTRAINT CK_ExecutiveReportPack_Minute CHECK (scheduleMinute BETWEEN 0 AND 59)
);
GO

IF COL_LENGTH('ExecutiveReportPack', 'scopeOrgId') IS NULL
BEGIN
    ALTER TABLE ExecutiveReportPack
    ADD scopeOrgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ExecutiveReportPackRun')
CREATE TABLE ExecutiveReportPackRun (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    packId INT NOT NULL,
    runType NVARCHAR(20) NOT NULL DEFAULT 'manual', -- manual | scheduled
    status NVARCHAR(20) NOT NULL DEFAULT 'completed', -- running | completed | failed
    startedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    completedAt DATETIME2 NULL,
    initiatedByOid NVARCHAR(100) NULL,
    summaryJson NVARCHAR(MAX) NULL,
    errorText NVARCHAR(MAX) NULL,
    CONSTRAINT FK_ExecutiveReportPackRun_Pack FOREIGN KEY (packId) REFERENCES ExecutiveReportPack(id) ON DELETE CASCADE,
    CONSTRAINT CK_ExecutiveReportPackRun_RunType CHECK (runType IN ('manual', 'scheduled')),
    CONSTRAINT CK_ExecutiveReportPackRun_Status CHECK (status IN ('running', 'completed', 'failed'))
);
GO

-- Create indexes for common queries
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Goals_ParentId')
    CREATE INDEX IX_Goals_ParentId ON Goals(parentId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_KPIs_GoalId')
    CREATE INDEX IX_KPIs_GoalId ON KPIs(goalId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Projects_GoalId')
    CREATE INDEX IX_Projects_GoalId ON Projects(goalId);

IF COL_LENGTH('Projects', 'orgId') IS NOT NULL
   AND NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Projects_LifecycleState')
    CREATE INDEX IX_Projects_LifecycleState ON Projects(lifecycleState, orgId, archivedAt, completedAt, lastActivityAt);

IF COL_LENGTH('Projects', 'orgId') IS NOT NULL
   AND NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Projects_ActiveOrg')
    CREATE INDEX IX_Projects_ActiveOrg ON Projects(orgId, id) WHERE lifecycleState IN ('active', 'completed');

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tasks_ProjectId')
    CREATE INDEX IX_Tasks_ProjectId ON Tasks(projectId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tasks_Status')
    CREATE INDEX IX_Tasks_Status ON Tasks(status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tasks_AssigneeOid')
    CREATE INDEX IX_Tasks_AssigneeOid ON Tasks(assigneeOid);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tasks_UpdatedAt')
    CREATE INDEX IX_Tasks_UpdatedAt ON Tasks(projectId, updatedAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TaskChecklistItems_TaskId')
    CREATE INDEX IX_TaskChecklistItems_TaskId ON TaskChecklistItems(taskId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TaskChecklistItems_TaskSort')
    CREATE INDEX IX_TaskChecklistItems_TaskSort ON TaskChecklistItems(taskId, sortOrder, id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_StatusReports_ProjectId')
    CREATE INDEX IX_StatusReports_ProjectId ON StatusReports(projectId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectBenefitRealization_Project')
    CREATE INDEX IX_ProjectBenefitRealization_Project ON ProjectBenefitRealization(projectId, status, dueAt);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectBenefitRealization_Kpi')
    CREATE INDEX IX_ProjectBenefitRealization_Kpi ON ProjectBenefitRealization(linkedKpiId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_FormId')
    CREATE INDEX IX_IntakeSubmissions_FormId ON IntakeSubmissions(formId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_Status')
    CREATE INDEX IX_IntakeSubmissions_Status ON IntakeSubmissions(status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_ResolvedAt')
    CREATE INDEX IX_IntakeSubmissions_ResolvedAt ON IntakeSubmissions(resolvedAt, status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_EstimatedEffort')
    CREATE INDEX IX_IntakeSubmissions_EstimatedEffort ON IntakeSubmissions(estimatedEffortHours);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeForms_GovernanceMode')
    CREATE INDEX IX_IntakeForms_GovernanceMode ON IntakeForms(governanceMode);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeForms_GovernanceBoardId')
    CREATE INDEX IX_IntakeForms_GovernanceBoardId ON IntakeForms(governanceBoardId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_GovernanceRequired')
    CREATE INDEX IX_IntakeSubmissions_GovernanceRequired ON IntakeSubmissions(governanceRequired);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_GovernanceStatus')
    CREATE INDEX IX_IntakeSubmissions_GovernanceStatus ON IntakeSubmissions(governanceStatus);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceMembership_Board_Active')
    CREATE INDEX IX_GovernanceMembership_Board_Active ON GovernanceMembership(boardId, isActive);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceMembership_UserOid')
    CREATE INDEX IX_GovernanceMembership_UserOid ON GovernanceMembership(userOid);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceCriteriaVersion_Board_Status')
    CREATE INDEX IX_GovernanceCriteriaVersion_Board_Status ON GovernanceCriteriaVersion(boardId, status, versionNo DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReview_Submission_Status')
    CREATE INDEX IX_GovernanceReview_Submission_Status ON GovernanceReview(submissionId, status, reviewRound DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReview_Board_Status')
    CREATE INDEX IX_GovernanceReview_Board_Status ON GovernanceReview(boardId, status, startedAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReview_OpenPerSubmission')
    CREATE UNIQUE INDEX IX_GovernanceReview_OpenPerSubmission ON GovernanceReview(submissionId) WHERE status = 'in-review';

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReviewParticipant_Review')
    CREATE INDEX IX_GovernanceReviewParticipant_Review ON GovernanceReviewParticipant(reviewId, isEligibleVoter);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReviewParticipant_UserOid')
    CREATE INDEX IX_GovernanceReviewParticipant_UserOid ON GovernanceReviewParticipant(userOid);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceVote_Review')
    CREATE INDEX IX_GovernanceVote_Review ON GovernanceVote(reviewId, submittedAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceVote_Voter')
    CREATE INDEX IX_GovernanceVote_Voter ON GovernanceVote(voterUserOid);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReview_VoteDeadline')
    CREATE INDEX IX_GovernanceReview_VoteDeadline ON GovernanceReview(status, voteDeadlineAt);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceBoard_Capacity')
    CREATE INDEX IX_GovernanceBoard_Capacity ON GovernanceBoard(isActive, wipLimit, weeklyCapacityHours);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_WorkflowSlaPolicy_Stage')
    CREATE INDEX IX_WorkflowSlaPolicy_Stage ON WorkflowSlaPolicy(stageKey, isActive);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceSession_BoardStatus')
    CREATE INDEX IX_GovernanceSession_BoardStatus ON GovernanceSession(boardId, status, createdAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceSession_Status')
    CREATE INDEX IX_GovernanceSession_Status ON GovernanceSession(status, scheduledAt, startedAt);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ExecutiveReportPack_Active')
    CREATE INDEX IX_ExecutiveReportPack_Active ON ExecutiveReportPack(isActive, nextRunAt, updatedAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ExecutiveReportPack_ScopeOrg')
    CREATE INDEX IX_ExecutiveReportPack_ScopeOrg ON ExecutiveReportPack(scopeOrgId, isActive, nextRunAt);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ExecutiveReportPackRun_Pack')
    CREATE INDEX IX_ExecutiveReportPackRun_Pack ON ExecutiveReportPackRun(packId, startedAt DESC);
GO


-- Users table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
BEGIN
    CREATE TABLE Users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        oid NVARCHAR(100) NOT NULL UNIQUE, -- Azure AD Object ID
        tid NVARCHAR(100) NOT NULL, -- Azure AD Tenant ID
        name NVARCHAR(255) NOT NULL,
        email NVARCHAR(255) NULL,
        roles NVARCHAR(MAX) DEFAULT '[]', -- JSON array of roles
        lastLogin DATETIME2 DEFAULT GETDATE(),
        createdAt DATETIME2 DEFAULT GETDATE()
    );
    
    CREATE INDEX IX_Users_OID ON Users(oid);
    CREATE INDEX IX_Users_Email ON Users(email);
END
GO

IF COL_LENGTH('Tasks', 'assigneeOid') IS NOT NULL
   AND OBJECT_ID('Users', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Tasks_Assignee')
BEGIN
    ALTER TABLE Tasks
    ADD CONSTRAINT FK_Tasks_Assignee
    FOREIGN KEY (assigneeOid) REFERENCES Users(oid) ON DELETE SET NULL;
END
GO

-- Tag Groups (facets)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TagGroups')
BEGIN
    CREATE TABLE TagGroups (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        slug NVARCHAR(100) NOT NULL UNIQUE,
        requirePrimary BIT NOT NULL DEFAULT 0,
        sortOrder INT NOT NULL DEFAULT 0,
        createdAt DATETIME2 DEFAULT GETDATE()
    );
END
GO

-- Organizations
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Organizations')
CREATE TABLE Organizations (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        NVARCHAR(255) NOT NULL,
    slug        NVARCHAR(100) NOT NULL,
    isActive    BIT NOT NULL DEFAULT 1,
    createdAt   DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT UQ_Organizations_Name UNIQUE(name),
    CONSTRAINT UQ_Organizations_Slug UNIQUE(slug)
);
GO

-- Multi-org ownership columns and relationships.
-- Application behavior expects new goals, projects, intake forms, intake submissions, and governance boards
-- to carry a single home organization. Existing upgraded databases can audit/fill legacy null ownership using
-- the backfill_org_ownership.js script before enforcing org-scoped workflows everywhere.
IF COL_LENGTH('Users', 'orgId') IS NULL
BEGIN
    ALTER TABLE Users ADD orgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_Organization')
BEGIN
    ALTER TABLE Users
    ADD CONSTRAINT FK_Users_Organization
    FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE SET NULL;
END
GO

IF COL_LENGTH('Goals', 'orgId') IS NULL
BEGIN
    ALTER TABLE Goals ADD orgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Goals_Organization')
BEGIN
    ALTER TABLE Goals
    ADD CONSTRAINT FK_Goals_Organization
    FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE NO ACTION;
END
GO

IF COL_LENGTH('Projects', 'orgId') IS NULL
BEGIN
    ALTER TABLE Projects ADD orgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Projects_Organization')
BEGIN
    ALTER TABLE Projects
    ADD CONSTRAINT FK_Projects_Organization
    FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE NO ACTION;
END
GO

IF COL_LENGTH('IntakeForms', 'orgId') IS NULL
BEGIN
    ALTER TABLE IntakeForms ADD orgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_IntakeForms_Organization')
BEGIN
    ALTER TABLE IntakeForms
    ADD CONSTRAINT FK_IntakeForms_Organization
    FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE NO ACTION;
END
GO

IF COL_LENGTH('IntakeSubmissions', 'orgId') IS NULL
BEGIN
    ALTER TABLE IntakeSubmissions ADD orgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_IntakeSubmissions_Organization')
BEGIN
    ALTER TABLE IntakeSubmissions
    ADD CONSTRAINT FK_IntakeSubmissions_Organization
    FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE NO ACTION;
END
GO

IF COL_LENGTH('GovernanceBoard', 'orgId') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard ADD orgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_GovernanceBoard_Organization')
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT FK_GovernanceBoard_Organization
    FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE NO ACTION;
END
GO

IF COL_LENGTH('ExecutiveReportPack', 'scopeOrgId') IS NULL
BEGIN
    ALTER TABLE ExecutiveReportPack ADD scopeOrgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ExecutiveReportPack_ScopeOrg')
BEGIN
    ALTER TABLE ExecutiveReportPack
    ADD CONSTRAINT FK_ExecutiveReportPack_ScopeOrg
    FOREIGN KEY (scopeOrgId) REFERENCES Organizations(id) ON DELETE SET NULL;
END
GO

IF COL_LENGTH('TagGroups', 'orgId') IS NULL
BEGIN
    ALTER TABLE TagGroups ADD orgId INT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Projects_LifecycleState'
)
BEGIN
    ALTER TABLE Projects
    ADD CONSTRAINT CK_Projects_LifecycleState
    CHECK (lifecycleState IN ('active', 'completed', 'archived'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Goals_LifecycleState'
)
BEGIN
    ALTER TABLE Goals
    ADD CONSTRAINT CK_Goals_LifecycleState
    CHECK (lifecycleState IN ('active', 'retired', 'archived'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_IntakeForms_LifecycleState'
)
BEGIN
    ALTER TABLE IntakeForms
    ADD CONSTRAINT CK_IntakeForms_LifecycleState
    CHECK (lifecycleState IN ('draft', 'active', 'retired', 'archived'));
END
GO

UPDATE Projects
SET lifecycleState = CASE
    WHEN lifecycleState = 'archived' THEN 'archived'
    WHEN LOWER(ISNULL(status, '')) = 'completed' THEN 'completed'
    ELSE 'active'
END
WHERE lifecycleState IS NULL
   OR lifecycleState NOT IN ('active', 'completed', 'archived');
GO

UPDATE Projects
SET completedAt = ISNULL(completedAt, createdAt)
WHERE lifecycleState = 'completed'
  AND completedAt IS NULL;
GO

UPDATE Projects
SET lastActivityAt = ISNULL(lastActivityAt, completedAt)
WHERE lastActivityAt IS NULL
  AND completedAt IS NOT NULL;
GO

UPDATE Projects
SET lastActivityAt = ISNULL(lastActivityAt, createdAt)
WHERE lastActivityAt IS NULL;
GO

UPDATE Goals
SET lifecycleState = 'active'
WHERE lifecycleState IS NULL
   OR lifecycleState NOT IN ('active', 'retired', 'archived');
GO

UPDATE Goals
SET lastActivityAt = ISNULL(lastActivityAt, retiredAt)
WHERE lastActivityAt IS NULL
  AND retiredAt IS NOT NULL;
GO

UPDATE Goals
SET lastActivityAt = ISNULL(lastActivityAt, createdAt)
WHERE lastActivityAt IS NULL;
GO

UPDATE IntakeForms
SET lifecycleState = CASE
    WHEN lifecycleState = 'draft' THEN 'draft'
    WHEN lifecycleState = 'retired' THEN 'retired'
    WHEN lifecycleState = 'archived' THEN 'archived'
    ELSE 'active'
END
WHERE lifecycleState IS NULL
   OR lifecycleState NOT IN ('draft', 'active', 'retired', 'archived');
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TagGroups_Organization')
BEGIN
    ALTER TABLE TagGroups
    ADD CONSTRAINT FK_TagGroups_Organization
    FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE NO ACTION;
END
GO

-- Tags
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Tags')
BEGIN
    CREATE TABLE Tags (
        id INT IDENTITY(1,1) PRIMARY KEY,
        groupId INT NOT NULL FOREIGN KEY REFERENCES TagGroups(id) ON DELETE CASCADE,
        name NVARCHAR(200) NOT NULL,
        slug NVARCHAR(200) NOT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'active',  -- draft | active | deprecated
        color NVARCHAR(7) DEFAULT '#6366f1',             -- hex color
        sortOrder INT NOT NULL DEFAULT 0,
        createdAt DATETIME2 DEFAULT GETDATE(),
        CONSTRAINT UQ_Tags_GroupSlug UNIQUE (groupId, slug)
    );
END
GO

-- Tag Aliases (synonyms for search)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TagAliases')
BEGIN
    CREATE TABLE TagAliases (
        id INT IDENTITY(1,1) PRIMARY KEY,
        tagId INT NOT NULL FOREIGN KEY REFERENCES Tags(id) ON DELETE CASCADE,
        alias NVARCHAR(200) NOT NULL
    );
END
GO

-- Project <-> Tag junction
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProjectTags')
BEGIN
    CREATE TABLE ProjectTags (
        projectId INT NOT NULL FOREIGN KEY REFERENCES Projects(id) ON DELETE CASCADE,
        tagId INT NOT NULL FOREIGN KEY REFERENCES Tags(id) ON DELETE CASCADE,
        isPrimary BIT NOT NULL DEFAULT 0,
        PRIMARY KEY (projectId, tagId)
    );
END
GO

-- Cross-org sharing for projects.
-- Ownership remains on Projects.orgId; ProjectOrgAccess stores explicit recipient-org exception access only.
-- Application logic may auto-share linked goals read-only to preserve context for recipient orgs.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProjectOrgAccess')
CREATE TABLE ProjectOrgAccess (
    projectId   INT NOT NULL,
    orgId       INT NOT NULL,
    accessLevel NVARCHAR(20) NOT NULL DEFAULT 'read',
    expiresAt   DATETIME2 NULL,
    grantedAt   DATETIME2 DEFAULT GETDATE(),
    grantedByOid NVARCHAR(100) NULL,
    CONSTRAINT PK_ProjectOrgAccess PRIMARY KEY (projectId, orgId),
    CONSTRAINT FK_ProjectOrgAccess_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
    CONSTRAINT FK_ProjectOrgAccess_Org FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE CASCADE,
    CONSTRAINT CK_ProjectOrgAccess_Level CHECK (accessLevel IN ('read', 'write'))
);
GO

IF COL_LENGTH('ProjectOrgAccess', 'expiresAt') IS NULL
BEGIN
    ALTER TABLE ProjectOrgAccess
    ADD expiresAt DATETIME2 NULL;
END
GO

-- Cross-org sharing for goals.
-- Goal sharing governs goal-tree and KPI visibility only; it does not implicitly share linked projects.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GoalOrgAccess')
CREATE TABLE GoalOrgAccess (
    goalId       INT NOT NULL,
    orgId        INT NOT NULL,
    accessLevel  NVARCHAR(20) NOT NULL DEFAULT 'read',
    expiresAt    DATETIME2 NULL,
    grantedAt    DATETIME2 DEFAULT GETDATE(),
    grantedByOid NVARCHAR(100) NULL,
    CONSTRAINT PK_GoalOrgAccess PRIMARY KEY (goalId, orgId),
    CONSTRAINT FK_GoalOrgAccess_Goal FOREIGN KEY (goalId) REFERENCES Goals(id) ON DELETE CASCADE,
    CONSTRAINT FK_GoalOrgAccess_Org FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE CASCADE,
    CONSTRAINT CK_GoalOrgAccess_Level CHECK (accessLevel IN ('read', 'write'))
);
GO

IF COL_LENGTH('GoalOrgAccess', 'expiresAt') IS NULL
BEGIN
    ALTER TABLE GoalOrgAccess
    ADD expiresAt DATETIME2 NULL;
END
GO

-- Sharing request workflow (request / approve / reject / revoke)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'OrgSharingRequest')
CREATE TABLE OrgSharingRequest (
    id INT IDENTITY(1,1) PRIMARY KEY,
    entityType NVARCHAR(20) NOT NULL, -- project | goal
    entityId INT NOT NULL,
    targetOrgId INT NOT NULL,
    requestedAccessLevel NVARCHAR(20) NOT NULL DEFAULT 'read', -- read | write
    reason NVARCHAR(1000) NULL,
    requestedByOid NVARCHAR(100) NOT NULL,
    requestedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    expiresAt DATETIME2 NULL,
    ownerAttested BIT NOT NULL DEFAULT 0,
    ownerAttestedByOid NVARCHAR(100) NULL,
    ownerAttestedAt DATETIME2 NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected | revoked | expired
    decisionNote NVARCHAR(1000) NULL,
    decidedByOid NVARCHAR(100) NULL,
    decidedAt DATETIME2 NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    updatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_OrgSharingRequest_TargetOrg FOREIGN KEY (targetOrgId) REFERENCES Organizations(id) ON DELETE CASCADE,
    CONSTRAINT CK_OrgSharingRequest_EntityType CHECK (entityType IN ('project', 'goal')),
    CONSTRAINT CK_OrgSharingRequest_AccessLevel CHECK (requestedAccessLevel IN ('read', 'write')),
    CONSTRAINT CK_OrgSharingRequest_Status CHECK (status IN ('pending', 'approved', 'rejected', 'revoked', 'expired'))
);
GO

-- Canonical project-to-goal associations.
-- Projects.goalId is retained for backwards compatibility, while ProjectGoals supports multi-goal linkage
-- used by intake conversion and cross-org context sharing.
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
END
GO

INSERT INTO ProjectGoals (projectId, goalId)
SELECT p.id, p.goalId
FROM Projects p
WHERE p.goalId IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM ProjectGoals pg
      WHERE pg.projectId = p.id AND pg.goalId = p.goalId
  );
GO

-- Tag Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_GroupId')
    CREATE INDEX IX_Tags_GroupId ON Tags(groupId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_Status')
    CREATE INDEX IX_Tags_Status ON Tags(status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectTags_TagId')
    CREATE INDEX IX_ProjectTags_TagId ON ProjectTags(tagId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TagAliases_TagId')
    CREATE INDEX IX_TagAliases_TagId ON TagAliases(tagId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Users_OrgId')
    CREATE INDEX IX_Users_OrgId ON Users(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Goals_OrgId')
    CREATE INDEX IX_Goals_OrgId ON Goals(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Goals_LifecycleState')
    CREATE INDEX IX_Goals_LifecycleState ON Goals(lifecycleState, orgId, archivedAt, retiredAt, lastActivityAt);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Goals_ActiveOrg')
    CREATE INDEX IX_Goals_ActiveOrg ON Goals(orgId, id) WHERE lifecycleState = 'active';

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Projects_OrgId')
    CREATE INDEX IX_Projects_OrgId ON Projects(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Projects_LifecycleState')
    CREATE INDEX IX_Projects_LifecycleState ON Projects(lifecycleState, orgId, archivedAt, completedAt, lastActivityAt);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Projects_ActiveOrg')
    CREATE INDEX IX_Projects_ActiveOrg ON Projects(orgId, id) WHERE lifecycleState IN ('active', 'completed');

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeForms_OrgId')
    CREATE INDEX IX_IntakeForms_OrgId ON IntakeForms(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeForms_LifecycleState')
    CREATE INDEX IX_IntakeForms_LifecycleState ON IntakeForms(lifecycleState, orgId, archivedAt, retiredAt);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_OrgId')
    CREATE INDEX IX_IntakeSubmissions_OrgId ON IntakeSubmissions(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceBoard_OrgId')
    CREATE INDEX IX_GovernanceBoard_OrgId ON GovernanceBoard(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TagGroups_OrgId')
    CREATE INDEX IX_TagGroups_OrgId ON TagGroups(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectOrgAccess_OrgId')
    CREATE INDEX IX_ProjectOrgAccess_OrgId ON ProjectOrgAccess(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectOrgAccess_Expiry')
    CREATE INDEX IX_ProjectOrgAccess_Expiry ON ProjectOrgAccess(orgId, expiresAt, projectId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GoalOrgAccess_OrgId')
    CREATE INDEX IX_GoalOrgAccess_OrgId ON GoalOrgAccess(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GoalOrgAccess_Expiry')
    CREATE INDEX IX_GoalOrgAccess_Expiry ON GoalOrgAccess(orgId, expiresAt, goalId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GoalOrgAccess_GoalId')
    CREATE INDEX IX_GoalOrgAccess_GoalId ON GoalOrgAccess(goalId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectGoals_GoalId')
    CREATE INDEX IX_ProjectGoals_GoalId ON ProjectGoals(goalId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OrgSharingRequest_Status')
    CREATE INDEX IX_OrgSharingRequest_Status ON OrgSharingRequest(status, targetOrgId, requestedAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OrgSharingRequest_Entity')
    CREATE INDEX IX_OrgSharingRequest_Entity ON OrgSharingRequest(entityType, entityId, status);
GO

-- AuditLog Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditLog')
CREATE TABLE AuditLog (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    action      NVARCHAR(50)   NOT NULL,
    entityType  NVARCHAR(30)   NOT NULL,
    entityId    NVARCHAR(20)   NULL,
    entityTitle NVARCHAR(255)  NULL,
    userId      NVARCHAR(100)  NULL,
    userName    NVARCHAR(200)  NULL,
    [before]    NVARCHAR(MAX)  NULL,
    [after]     NVARCHAR(MAX)  NULL,
    metadata    NVARCHAR(MAX)  NULL,
    ipAddress   NVARCHAR(45)   NULL,
    userAgent   NVARCHAR(500)  NULL,
    createdAt   DATETIME2      DEFAULT GETDATE()
);
GO

-- AuditLog Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AuditLog_Action')
    CREATE INDEX IX_AuditLog_Action ON AuditLog(action);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AuditLog_EntityType')
    CREATE INDEX IX_AuditLog_EntityType ON AuditLog(entityType);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AuditLog_EntityId')
    CREATE INDEX IX_AuditLog_EntityId ON AuditLog(entityId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AuditLog_UserId')
    CREATE INDEX IX_AuditLog_UserId ON AuditLog(userId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AuditLog_CreatedAt')
    CREATE INDEX IX_AuditLog_CreatedAt ON AuditLog(createdAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AuditLog_Entity_Time')
    CREATE INDEX IX_AuditLog_Entity_Time ON AuditLog(entityType, entityId, createdAt DESC);
GO

-- Seed Data: Tag Groups
IF NOT EXISTS (SELECT 1 FROM TagGroups)
BEGIN
    INSERT INTO TagGroups (name, slug, requirePrimary, sortOrder) VALUES
        ('Domain / Program',        'domain',       1, 1),
        ('Capability / Platform',   'capability',   0, 2),
        ('Work Type',               'work-type',    0, 3),
        ('Outcome / Benefit Theme', 'outcome',      1, 4),
        ('Delivery / Change',       'delivery',     0, 5),
        ('Risk / Constraint',       'risk',         0, 6),
        ('Geography / Site',        'geography',    0, 7);
END
GO

-- Seed Data: Tags
IF NOT EXISTS (SELECT 1 FROM Tags)
BEGIN
    -- Domain / Program (groupId = 1)
    INSERT INTO Tags (groupId, name, slug, status, color, sortOrder) VALUES
        (1, 'Virtual Care',            'virtual-care',           'active', '#8b5cf6', 1),
        (1, 'Pharmacy',                'pharmacy',               'active', '#06b6d4', 2),
        (1, 'Lab',                     'lab',                    'active', '#10b981', 3),
        (1, 'Privacy',                 'privacy',                'active', '#f59e0b', 4),
        (1, 'Access & Navigation',     'access-navigation',      'active', '#ec4899', 5);

    -- Capability / Platform (groupId = 2)
    INSERT INTO Tags (groupId, name, slug, status, color, sortOrder) VALUES
        (2, 'EHR',                     'ehr',                    'active', '#3b82f6', 1),
        (2, 'Integration',             'integration',            'active', '#8b5cf6', 2),
        (2, 'Identity',                'identity',               'active', '#06b6d4', 3),
        (2, 'Data Platform',           'data-platform',          'active', '#10b981', 4),
        (2, 'Network',                 'network',                'active', '#f59e0b', 5),
        (2, 'ServiceNow',             'servicenow',             'active', '#ec4899', 6);

    -- Work Type (groupId = 3)
    INSERT INTO Tags (groupId, name, slug, status, color, sortOrder) VALUES
        (3, 'Implementation',          'implementation',         'active', '#3b82f6', 1),
        (3, 'Optimization',            'optimization',           'active', '#8b5cf6', 2),
        (3, 'Replacement',             'replacement',            'active', '#ef4444', 3),
        (3, 'Decommission',            'decommission',           'active', '#6b7280', 4),
        (3, 'Policy / Standard',       'policy-standard',        'active', '#f59e0b', 5);

    -- Outcome / Benefit Theme (groupId = 4)
    INSERT INTO Tags (groupId, name, slug, status, color, sortOrder) VALUES
        (4, 'Patient Experience',      'patient-experience',     'active', '#8b5cf6', 1),
        (4, 'Patient Safety',          'patient-safety',         'active', '#ef4444', 2),
        (4, 'Workforce',               'workforce',              'active', '#3b82f6', 3),
        (4, 'Cost Avoidance',          'cost-avoidance',         'active', '#10b981', 4),
        (4, 'Equity',                  'equity',                 'active', '#ec4899', 5),
        (4, 'Compliance',              'compliance',             'active', '#f59e0b', 6);

    -- Delivery / Change (groupId = 5)
    INSERT INTO Tags (groupId, name, slug, status, color, sortOrder) VALUES
        (5, 'Training',                'training',               'active', '#3b82f6', 1),
        (5, 'Workflow',                'workflow',               'active', '#8b5cf6', 2),
        (5, 'Adoption',                'adoption',               'active', '#10b981', 3),
        (5, 'Clinical Engagement',     'clinical-engagement',    'active', '#ec4899', 4);

    -- Risk / Constraint (groupId = 6)
    INSERT INTO Tags (groupId, name, slug, status, color, sortOrder) VALUES
        (6, 'Security',                'security',               'active', '#ef4444', 1),
        (6, 'Privacy',                 'privacy-risk',           'active', '#f59e0b', 2),
        (6, 'Vendor Risk',             'vendor-risk',            'active', '#6b7280', 3),
        (6, 'Technical Debt',          'technical-debt',         'active', '#3b82f6', 4),
        (6, 'Regulatory',              'regulatory',             'active', '#8b5cf6', 5);

    -- Geography / Site (groupId = 7)
    INSERT INTO Tags (groupId, name, slug, status, color, sortOrder) VALUES
        (7, 'Province-wide',           'province-wide',          'active', '#3b82f6', 1),
        (7, 'Regina',                  'regina',                 'active', '#8b5cf6', 2),
        (7, 'Rural / Remote',          'rural-remote',           'active', '#10b981', 3),
        (7, 'Facility Group',          'facility-group',         'active', '#f59e0b', 4);
END
GO

-- Seed Data: Tag Aliases
IF NOT EXISTS (SELECT 1 FROM TagAliases)
BEGIN
    -- Add useful aliases for search
    INSERT INTO TagAliases (tagId, alias)
    SELECT t.id, a.alias
    FROM (VALUES
        ('virtual-care',   'VCF9'),
        ('virtual-care',   'Telehealth'),
        ('ehr',            'Electronic Health Record'),
        ('ehr',            'Sunrise'),
        ('data-platform',  'Hybrid Cloud'),
        ('data-platform',  'Data Warehouse'),
        ('servicenow',     'ITSM'),
        ('servicenow',     'SNOW'),
        ('province-wide',  'SHA'),
        ('province-wide',  'Provincial')
    ) AS a(tagSlug, alias)
    INNER JOIN Tags t ON t.slug = a.tagSlug;
END
GO

PRINT 'DHAtlas database schema created successfully!';
GO
