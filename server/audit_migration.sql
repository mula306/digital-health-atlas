-- ============================================================
-- Activity Audit Log Migration
-- Run this script against your MSSQL database (ProjectKanban)
-- ============================================================

USE ProjectKanban;
GO

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

-- Indexes for common query patterns
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

PRINT 'AuditLog table and indexes created successfully!';
GO
