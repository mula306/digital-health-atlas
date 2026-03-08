-- Wave 2 Migration
-- Adds:
-- 1) Workflow SLA policy baseline
-- 2) Governance session mode
-- 3) Automated executive report packs
-- 4) Sharing request workflow with expiry

USE DHAtlas;
GO

-- ==================== SLA POLICY ====================

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

-- Nudge audit fields for SLA escalation nudges on intake submissions
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

-- ==================== GOVERNANCE SESSION MODE ====================

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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GovernanceSession_BoardStatus')
    CREATE INDEX IX_GovernanceSession_BoardStatus ON GovernanceSession(boardId, status, createdAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GovernanceSession_Status')
    CREATE INDEX IX_GovernanceSession_Status ON GovernanceSession(status, scheduledAt, startedAt);
GO

-- ==================== EXECUTIVE PACK AUTOMATION ====================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ExecutiveReportPack')
CREATE TABLE ExecutiveReportPack (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(160) NOT NULL,
    description NVARCHAR(500) NULL,
    ownerOid NVARCHAR(100) NULL,
    isActive BIT NOT NULL DEFAULT 1,
    scheduleType NVARCHAR(20) NOT NULL DEFAULT 'weekly', -- weekly | manual
    scheduleDayOfWeek TINYINT NULL, -- 0 (Sun) - 6 (Sat)
    scheduleHour TINYINT NOT NULL DEFAULT 9, -- 0-23
    scheduleMinute TINYINT NOT NULL DEFAULT 0, -- 0-59
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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ExecutiveReportPack_Active')
    CREATE INDEX IX_ExecutiveReportPack_Active ON ExecutiveReportPack(isActive, nextRunAt, updatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ExecutiveReportPackRun_Pack')
    CREATE INDEX IX_ExecutiveReportPackRun_Pack ON ExecutiveReportPackRun(packId, startedAt DESC);
GO

-- ==================== SHARING REQUEST WORKFLOW + EXPIRY ====================

IF COL_LENGTH('ProjectOrgAccess', 'expiresAt') IS NULL
BEGIN
    ALTER TABLE ProjectOrgAccess
    ADD expiresAt DATETIME2 NULL;
END
GO

IF COL_LENGTH('GoalOrgAccess', 'expiresAt') IS NULL
BEGIN
    ALTER TABLE GoalOrgAccess
    ADD expiresAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ProjectOrgAccess_Expiry')
    CREATE INDEX IX_ProjectOrgAccess_Expiry ON ProjectOrgAccess(orgId, expiresAt, projectId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GoalOrgAccess_Expiry')
    CREATE INDEX IX_GoalOrgAccess_Expiry ON GoalOrgAccess(orgId, expiresAt, goalId);
GO

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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrgSharingRequest_Status')
    CREATE INDEX IX_OrgSharingRequest_Status ON OrgSharingRequest(status, targetOrgId, requestedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrgSharingRequest_Entity')
    CREATE INDEX IX_OrgSharingRequest_Entity ON OrgSharingRequest(entityType, entityId, status);
GO

PRINT 'Wave 2 migration completed successfully.';
GO
