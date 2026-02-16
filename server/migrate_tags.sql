-- ============================================================
-- Tagging System Migration
-- Run this script against your MSSQL database (ProjectKanban)
-- ============================================================

-- 1. Tag Groups (facets)
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

-- 2. Tags
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

-- 3. Tag Aliases (synonyms for search)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TagAliases')
BEGIN
    CREATE TABLE TagAliases (
        id INT IDENTITY(1,1) PRIMARY KEY,
        tagId INT NOT NULL FOREIGN KEY REFERENCES Tags(id) ON DELETE CASCADE,
        alias NVARCHAR(200) NOT NULL
    );
END

-- 4. Project ↔ Tag junction
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ProjectTags')
BEGIN
    CREATE TABLE ProjectTags (
        projectId INT NOT NULL FOREIGN KEY REFERENCES Projects(id) ON DELETE CASCADE,
        tagId INT NOT NULL FOREIGN KEY REFERENCES Tags(id) ON DELETE CASCADE,
        isPrimary BIT NOT NULL DEFAULT 0,
        PRIMARY KEY (projectId, tagId)
    );
END

-- Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_GroupId')
    CREATE INDEX IX_Tags_GroupId ON Tags(groupId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tags_Status')
    CREATE INDEX IX_Tags_Status ON Tags(status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProjectTags_TagId')
    CREATE INDEX IX_ProjectTags_TagId ON ProjectTags(tagId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TagAliases_TagId')
    CREATE INDEX IX_TagAliases_TagId ON TagAliases(tagId);

-- ============================================================
-- SEED DATA: Tag Groups
-- ============================================================

-- Only seed if table is empty
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

-- ============================================================
-- SEED DATA: Tags
-- ============================================================

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

-- ============================================================
-- SEED ALIASES (examples)
-- ============================================================

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

PRINT 'Tagging system migration complete.';
