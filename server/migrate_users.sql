-- Create Users table for Azure AD authentication mapping
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

PRINT 'Users table migration complete.';
GO
