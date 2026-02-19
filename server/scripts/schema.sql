-- Project Kanban Database Schema
-- Run this against SQL Server 2022 Docker container

-- Create database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'ProjectKanban')
BEGIN
    CREATE DATABASE DHAtlas;
END
GO

USE DHAtlas;
GO

-- Goals table (hierarchical with Org→Div→Dept→Branch)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Goals')
CREATE TABLE Goals (
    id INT IDENTITY(1,1) PRIMARY KEY,
    title NVARCHAR(255) NOT NULL,
    type NVARCHAR(20) NOT NULL,  -- 'org', 'div', 'dept', 'branch'
    parentId INT NULL,
    createdAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_Goals_Parent FOREIGN KEY (parentId) REFERENCES Goals(id)
);
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

-- Projects (linked to Goals)
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

-- Tasks (linked to Projects)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Tasks')
CREATE TABLE Tasks (
    id INT IDENTITY(1,1) PRIMARY KEY,
    projectId INT NOT NULL,
    title NVARCHAR(255) NOT NULL,
    status NVARCHAR(20) DEFAULT 'todo',  -- todo, in-progress, review, done
    priority NVARCHAR(20) DEFAULT 'medium',  -- low, medium, high
    description NVARCHAR(MAX) NULL,
    startDate DATE NULL,
    endDate DATE NULL,
    createdAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_Tasks_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
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

-- Intake Forms
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'IntakeForms')
CREATE TABLE IntakeForms (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    fields NVARCHAR(MAX) NULL,  -- JSON array of field definitions
    defaultGoalId INT NULL,
    createdAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_IntakeForms_Goal FOREIGN KEY (defaultGoalId) REFERENCES Goals(id) ON DELETE SET NULL
);
GO

-- Intake Submissions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'IntakeSubmissions')
CREATE TABLE IntakeSubmissions (
    id INT IDENTITY(1,1) PRIMARY KEY,
    formId INT NOT NULL,
    formData NVARCHAR(MAX) NULL,  -- JSON of submitted values
    status NVARCHAR(20) DEFAULT 'pending',  -- pending, info-requested, approved, rejected
    infoRequests NVARCHAR(MAX) NULL,  -- JSON array
    convertedProjectId INT NULL,
    submittedAt DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT FK_IntakeSubmissions_Form FOREIGN KEY (formId) REFERENCES IntakeForms(id) ON DELETE CASCADE,
    CONSTRAINT FK_IntakeSubmissions_Project FOREIGN KEY (convertedProjectId) REFERENCES Projects(id) ON DELETE SET NULL
);
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

-- Create indexes for common queries
CREATE INDEX IX_Goals_ParentId ON Goals(parentId);
CREATE INDEX IX_KPIs_GoalId ON KPIs(goalId);
CREATE INDEX IX_Projects_GoalId ON Projects(goalId);
CREATE INDEX IX_Tasks_ProjectId ON Tasks(projectId);
CREATE INDEX IX_Tasks_Status ON Tasks(status);
CREATE INDEX IX_StatusReports_ProjectId ON StatusReports(projectId);
CREATE INDEX IX_IntakeSubmissions_FormId ON IntakeSubmissions(formId);
CREATE INDEX IX_IntakeSubmissions_Status ON IntakeSubmissions(status);
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

-- Project ↔ Tag junction
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

-- Tag Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_GroupId')
    CREATE INDEX IX_Tags_GroupId ON Tags(groupId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_Status')
    CREATE INDEX IX_Tags_Status ON Tags(status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectTags_TagId')
    CREATE INDEX IX_ProjectTags_TagId ON ProjectTags(tagId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TagAliases_TagId')
    CREATE INDEX IX_TagAliases_TagId ON TagAliases(tagId);
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
