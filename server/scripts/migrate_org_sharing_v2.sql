-- Cross-Organization Sharing V2 Migration
-- Adds GoalOrgAccess table for cross-org goal/KPI sharing
-- KPIs inherit access from their parent goal (no separate table needed)

USE DHAtlas;
GO

-- ==================== GOAL SHARING ====================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GoalOrgAccess')
CREATE TABLE GoalOrgAccess (
    goalId       INT NOT NULL,
    orgId        INT NOT NULL,
    accessLevel  NVARCHAR(20) NOT NULL DEFAULT 'read',  -- read | write
    grantedAt    DATETIME2 DEFAULT GETDATE(),
    grantedByOid NVARCHAR(100) NULL,
    CONSTRAINT PK_GoalOrgAccess PRIMARY KEY (goalId, orgId),
    CONSTRAINT FK_GoalOrgAccess_Goal FOREIGN KEY (goalId) REFERENCES Goals(id) ON DELETE CASCADE,
    CONSTRAINT FK_GoalOrgAccess_Org FOREIGN KEY (orgId) REFERENCES Organizations(id) ON DELETE CASCADE,
    CONSTRAINT CK_GoalOrgAccess_Level CHECK (accessLevel IN ('read', 'write'))
);
GO

-- ==================== INDEXES ====================

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GoalOrgAccess_OrgId')
    CREATE INDEX IX_GoalOrgAccess_OrgId ON GoalOrgAccess(orgId);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GoalOrgAccess_GoalId')
    CREATE INDEX IX_GoalOrgAccess_GoalId ON GoalOrgAccess(goalId);
GO

PRINT 'Cross-organization sharing V2 migration completed successfully!';
GO
