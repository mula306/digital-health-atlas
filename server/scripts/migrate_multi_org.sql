-- Multi-Organization Migration
-- Adds Organizations table, ProjectOrgAccess cross-org sharing,
-- and orgId columns to core entity tables.

USE DHAtlas;
GO

-- ==================== ORGANIZATIONS ====================

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

-- ==================== ADD orgId TO CORE TABLES ====================

-- Users.orgId
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

-- Goals.orgId
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

-- Projects.orgId
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

-- IntakeForms.orgId
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

-- IntakeSubmissions.orgId
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

-- GovernanceBoard.orgId
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

-- TagGroups.orgId (NULL = global/shared)
IF COL_LENGTH('TagGroups', 'orgId') IS NULL
BEGIN
    ALTER TABLE TagGroups ADD orgId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TagGroups_Organization')
BEGIN
    ALTER TABLE TagGroups
    ADD CONSTRAINT FK_TagGroups_Organization
    FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE NO ACTION;
END
GO

-- ==================== CROSS-ORG PROJECT SHARING ====================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProjectOrgAccess')
CREATE TABLE ProjectOrgAccess (
    projectId   INT NOT NULL,
    orgId       INT NOT NULL,
    accessLevel NVARCHAR(20) NOT NULL DEFAULT 'read',  -- read | write
    grantedAt   DATETIME2 DEFAULT GETDATE(),
    grantedByOid NVARCHAR(100) NULL,
    CONSTRAINT PK_ProjectOrgAccess PRIMARY KEY (projectId, orgId),
    CONSTRAINT FK_ProjectOrgAccess_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
    CONSTRAINT FK_ProjectOrgAccess_Org FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE CASCADE,
    CONSTRAINT CK_ProjectOrgAccess_Level CHECK (accessLevel IN ('read', 'write'))
);
GO

-- ==================== INDEXES ====================

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Users_OrgId')
    CREATE INDEX IX_Users_OrgId ON Users(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Goals_OrgId')
    CREATE INDEX IX_Goals_OrgId ON Goals(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Projects_OrgId')
    CREATE INDEX IX_Projects_OrgId ON Projects(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeForms_OrgId')
    CREATE INDEX IX_IntakeForms_OrgId ON IntakeForms(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_IntakeSubmissions_OrgId')
    CREATE INDEX IX_IntakeSubmissions_OrgId ON IntakeSubmissions(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceBoard_OrgId')
    CREATE INDEX IX_GovernanceBoard_OrgId ON GovernanceBoard(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TagGroups_OrgId')
    CREATE INDEX IX_TagGroups_OrgId ON TagGroups(orgId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectOrgAccess_OrgId')
    CREATE INDEX IX_ProjectOrgAccess_OrgId ON ProjectOrgAccess(orgId);
GO

PRINT 'Multi-organization migration completed successfully!';
GO
