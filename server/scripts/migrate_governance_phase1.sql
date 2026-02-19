-- Governance Phase 1 migration
-- Adds review rounds, participant snapshots, and voting records.

USE DHAtlas;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceReview')
CREATE TABLE GovernanceReview (
    id INT IDENTITY(1,1) PRIMARY KEY,
    submissionId INT NOT NULL,
    boardId INT NOT NULL,
    reviewRound INT NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'in-review',
    decision NVARCHAR(30) NULL,
    decisionReason NVARCHAR(MAX) NULL,
    criteriaVersionId INT NULL,
    criteriaSnapshotJson NVARCHAR(MAX) NOT NULL,
    startedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    startedByOid NVARCHAR(100) NULL,
    decidedAt DATETIME2 NULL,
    decidedByOid NVARCHAR(100) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_GovernanceReview_Submission FOREIGN KEY (submissionId) REFERENCES IntakeSubmissions(id) ON DELETE CASCADE,
    CONSTRAINT FK_GovernanceReview_Board FOREIGN KEY (boardId) REFERENCES GovernanceBoard(id) ON DELETE NO ACTION,
    CONSTRAINT FK_GovernanceReview_CriteriaVersion FOREIGN KEY (criteriaVersionId) REFERENCES GovernanceCriteriaVersion(id) ON DELETE NO ACTION,
    CONSTRAINT UQ_GovernanceReview_SubmissionRound UNIQUE (submissionId, reviewRound)
);
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceReview_Status'
)
BEGIN
    ALTER TABLE GovernanceReview
    ADD CONSTRAINT CK_GovernanceReview_Status
    CHECK (status IN ('in-review', 'decided', 'cancelled'));
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_GovernanceReview_Decision'
)
BEGIN
    ALTER TABLE GovernanceReview
    ADD CONSTRAINT CK_GovernanceReview_Decision
    CHECK (decision IS NULL OR decision IN ('approved-now', 'approved-backlog', 'needs-info', 'rejected'));
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceReviewParticipant')
CREATE TABLE GovernanceReviewParticipant (
    id INT IDENTITY(1,1) PRIMARY KEY,
    reviewId INT NOT NULL,
    userOid NVARCHAR(100) NOT NULL,
    participantRole NVARCHAR(20) NOT NULL DEFAULT 'member',
    isEligibleVoter BIT NOT NULL DEFAULT 1,
    createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_GovernanceReviewParticipant_Review FOREIGN KEY (reviewId) REFERENCES GovernanceReview(id) ON DELETE CASCADE,
    CONSTRAINT UQ_GovernanceReviewParticipant_ReviewUser UNIQUE (reviewId, userOid)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GovernanceVote')
CREATE TABLE GovernanceVote (
    id INT IDENTITY(1,1) PRIMARY KEY,
    reviewId INT NOT NULL,
    voterUserOid NVARCHAR(100) NOT NULL,
    scoresJson NVARCHAR(MAX) NOT NULL,
    comment NVARCHAR(MAX) NULL,
    conflictDeclared BIT NOT NULL DEFAULT 0,
    submittedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
    updatedAt DATETIME2 NULL,
    CONSTRAINT FK_GovernanceVote_Review FOREIGN KEY (reviewId) REFERENCES GovernanceReview(id) ON DELETE CASCADE,
    CONSTRAINT UQ_GovernanceVote_ReviewVoter UNIQUE (reviewId, voterUserOid)
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReview_Submission_Status')
    CREATE INDEX IX_GovernanceReview_Submission_Status ON GovernanceReview(submissionId, status, reviewRound DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReview_Board_Status')
    CREATE INDEX IX_GovernanceReview_Board_Status ON GovernanceReview(boardId, status, startedAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReview_OpenPerSubmission')
    CREATE UNIQUE INDEX IX_GovernanceReview_OpenPerSubmission ON GovernanceReview(submissionId) WHERE status = 'in-review';

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReviewParticipant_Review')
    CREATE INDEX IX_GovernanceReviewParticipant_Review ON GovernanceReviewParticipant(reviewId, isEligibleVoter);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceReviewParticipant_UserOid')
    CREATE INDEX IX_GovernanceReviewParticipant_UserOid ON GovernanceReviewParticipant(userOid);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceVote_Review')
    CREATE INDEX IX_GovernanceVote_Review ON GovernanceVote(reviewId, submittedAt DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GovernanceVote_Voter')
    CREATE INDEX IX_GovernanceVote_Voter ON GovernanceVote(voterUserOid);
GO
