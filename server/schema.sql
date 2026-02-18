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

PRINT 'DHAtlas database schema created successfully!';
GO
