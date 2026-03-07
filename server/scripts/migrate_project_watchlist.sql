USE DHAtlas;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProjectWatchers')
BEGIN
    CREATE TABLE ProjectWatchers (
        projectId INT NOT NULL,
        userOid NVARCHAR(100) NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_ProjectWatchers PRIMARY KEY (projectId, userOid),
        CONSTRAINT FK_ProjectWatchers_Project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_ProjectWatchers_UserOid'
      AND object_id = OBJECT_ID('ProjectWatchers')
)
BEGIN
    CREATE INDEX IX_ProjectWatchers_UserOid ON ProjectWatchers(userOid);
END
GO
