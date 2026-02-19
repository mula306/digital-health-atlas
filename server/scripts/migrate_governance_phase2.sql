-- Governance Phase 2 migration
-- Adds governance policy controls for quorum and voting windows.

USE DHAtlas;
GO

IF COL_LENGTH('GovernanceSettings', 'quorumPercent') IS NULL
BEGIN
    ALTER TABLE GovernanceSettings
    ADD quorumPercent INT NOT NULL
        CONSTRAINT DF_GovernanceSettings_QuorumPercent DEFAULT 60 WITH VALUES;
END
GO

IF COL_LENGTH('GovernanceSettings', 'quorumMinCount') IS NULL
BEGIN
    ALTER TABLE GovernanceSettings
    ADD quorumMinCount INT NOT NULL
        CONSTRAINT DF_GovernanceSettings_QuorumMinCount DEFAULT 1 WITH VALUES;
END
GO

IF COL_LENGTH('GovernanceSettings', 'decisionRequiresQuorum') IS NULL
BEGIN
    ALTER TABLE GovernanceSettings
    ADD decisionRequiresQuorum BIT NOT NULL
        CONSTRAINT DF_GovernanceSettings_DecisionRequiresQuorum DEFAULT 1 WITH VALUES;
END
GO

IF COL_LENGTH('GovernanceSettings', 'voteWindowDays') IS NULL
BEGIN
    ALTER TABLE GovernanceSettings
    ADD voteWindowDays INT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceSettings_QuorumPercent'
)
BEGIN
    ALTER TABLE GovernanceSettings
    ADD CONSTRAINT CK_GovernanceSettings_QuorumPercent
    CHECK (quorumPercent BETWEEN 1 AND 100);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceSettings_QuorumMinCount'
)
BEGIN
    ALTER TABLE GovernanceSettings
    ADD CONSTRAINT CK_GovernanceSettings_QuorumMinCount
    CHECK (quorumMinCount >= 1);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceSettings_VoteWindowDays'
)
BEGIN
    ALTER TABLE GovernanceSettings
    ADD CONSTRAINT CK_GovernanceSettings_VoteWindowDays
    CHECK (voteWindowDays IS NULL OR voteWindowDays BETWEEN 1 AND 90);
END
GO

IF COL_LENGTH('GovernanceReview', 'policySnapshotJson') IS NULL
BEGIN
    ALTER TABLE GovernanceReview
    ADD policySnapshotJson NVARCHAR(MAX) NULL;
END
GO

IF COL_LENGTH('GovernanceReview', 'voteDeadlineAt') IS NULL
BEGIN
    ALTER TABLE GovernanceReview
    ADD voteDeadlineAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReview_VoteDeadline')
    CREATE INDEX IX_GovernanceReview_VoteDeadline ON GovernanceReview(status, voteDeadlineAt);
GO
