USE DHAtlas;
GO

IF COL_LENGTH('Tasks', 'assigneeOid') IS NULL
BEGIN
    ALTER TABLE Tasks ADD assigneeOid NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('Tasks', 'blockerNote') IS NULL
BEGIN
    ALTER TABLE Tasks ADD blockerNote NVARCHAR(1000) NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Tasks_Status'
)
BEGIN
    ALTER TABLE Tasks
    ADD CONSTRAINT CK_Tasks_Status
    CHECK (status IN ('todo', 'in-progress', 'blocked', 'review', 'done'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Tasks_Priority'
)
BEGIN
    ALTER TABLE Tasks
    ADD CONSTRAINT CK_Tasks_Priority
    CHECK (priority IN ('low', 'medium', 'high'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Tasks_DateOrder'
)
BEGIN
    ALTER TABLE Tasks
    ADD CONSTRAINT CK_Tasks_DateOrder
    CHECK (startDate IS NULL OR endDate IS NULL OR endDate >= startDate);
END
GO

IF OBJECT_ID('Users', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Tasks_Assignee')
BEGIN
    ALTER TABLE Tasks
    ADD CONSTRAINT FK_Tasks_Assignee
    FOREIGN KEY (assigneeOid) REFERENCES Users(oid) ON DELETE SET NULL;
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TaskChecklistItems')
BEGIN
    CREATE TABLE TaskChecklistItems (
        id INT IDENTITY(1,1) PRIMARY KEY,
        taskId INT NOT NULL,
        title NVARCHAR(255) NOT NULL,
        isDone BIT NOT NULL DEFAULT 0,
        sortOrder INT NOT NULL DEFAULT 0,
        createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_TaskChecklistItems_Task FOREIGN KEY (taskId) REFERENCES Tasks(id) ON DELETE CASCADE,
        CONSTRAINT CK_TaskChecklistItems_SortOrder CHECK (sortOrder >= 0)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Tasks_AssigneeOid')
BEGIN
    CREATE INDEX IX_Tasks_AssigneeOid ON Tasks(assigneeOid);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TaskChecklistItems_TaskId')
BEGIN
    CREATE INDEX IX_TaskChecklistItems_TaskId ON TaskChecklistItems(taskId);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TaskChecklistItems_TaskSort')
BEGIN
    CREATE INDEX IX_TaskChecklistItems_TaskSort ON TaskChecklistItems(taskId, sortOrder, id);
END
GO
