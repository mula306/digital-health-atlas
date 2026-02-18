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
