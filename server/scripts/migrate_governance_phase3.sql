-- Governance Phase 3 migration
-- Adds board-level policy override support for quorum and voting windows.

USE DHAtlas;
GO

IF COL_LENGTH('GovernanceBoard', 'quorumPercentOverride') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD quorumPercentOverride INT NULL;
END
GO

IF COL_LENGTH('GovernanceBoard', 'quorumMinCountOverride') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD quorumMinCountOverride INT NULL;
END
GO

IF COL_LENGTH('GovernanceBoard', 'decisionRequiresQuorumOverride') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD decisionRequiresQuorumOverride BIT NULL;
END
GO

IF COL_LENGTH('GovernanceBoard', 'voteWindowDaysOverride') IS NULL
BEGIN
    ALTER TABLE GovernanceBoard
    ADD voteWindowDaysOverride INT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceBoard_QuorumPercentOverride'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_QuorumPercentOverride
    CHECK (quorumPercentOverride IS NULL OR quorumPercentOverride BETWEEN 1 AND 100);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceBoard_QuorumMinCountOverride'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_QuorumMinCountOverride
    CHECK (quorumMinCountOverride IS NULL OR quorumMinCountOverride >= 1);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceBoard_VoteWindowDaysOverride'
)
BEGIN
    ALTER TABLE GovernanceBoard
    ADD CONSTRAINT CK_GovernanceBoard_VoteWindowDaysOverride
    CHECK (voteWindowDaysOverride IS NULL OR voteWindowDaysOverride BETWEEN 1 AND 90);
END
GO
