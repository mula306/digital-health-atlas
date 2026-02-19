-- Governance Phase 0 migration
-- Adds optional governance controls, editable criteria versioning foundation,
-- and selective intake scope fields with safe defaults.

USE DHAtlas;
GO

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

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceMembership')
CREATE TABLE GovernanceMembership (
    id INT IDENTITY(1,1) PRIMARY KEY,
    boardId INT NOT NULL,
    userOid NVARCHAR(100) NOT NULL,
    role NVARCHAR(20) NOT NULL DEFAULT 'member',
    isActive BIT NOT NULL DEFAULT 1,
    effectiveFrom DATETIME2 NOT NULL DEFAULT GETDATE(),
    effectiveTo DATETIME2 NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    createdByOid NVARCHAR(100) NULL,
    CONSTRAINT FK_GovernanceMembership_Board FOREIGN KEY (boardId) REFERENCES GovernanceBoard(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceCriteriaVersion')
CREATE TABLE GovernanceCriteriaVersion (
    id INT IDENTITY(1,1) PRIMARY KEY,
    boardId INT NOT NULL,
    versionNo INT NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'draft',
    criteriaJson NVARCHAR(MAX) NOT NULL,
    publishedAt DATETIME2 NULL,
    publishedByOid NVARCHAR(100) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    createdByOid NVARCHAR(100) NULL,
    CONSTRAINT FK_GovernanceCriteriaVersion_Board FOREIGN KEY (boardId) REFERENCES GovernanceBoard(id) ON DELETE CASCADE,
    CONSTRAINT UQ_GovernanceCriteriaVersion_BoardVersion UNIQUE (boardId, versionNo)
);
GO

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
GO
