import { getPool, sql } from '../../db.js';
import { TEST_PERSONAS } from '../../utils/testAuthPersonas.js';

const FIXTURE_IDS = Object.freeze({
    ORG_1: 1,
    ORG_2: 2,
    GOAL_1: 9101,
    GOAL_2: 9201,
    PROJECT_1: 9301,
    PROJECT_2: 9302,
    FORM_1: 9401,
    SUBMISSION_1: 9501,
    SUBMISSION_2: 9502,
    SUBMISSION_3: 9503,
    BOARD_1: 9601,
    CRITERIA_1: 9701,
    REVIEW_1: 9801
});

const isoInSevenDays = () => {
    const now = new Date();
    now.setDate(now.getDate() + 7);
    return now.toISOString();
};

export const TEST_FIXTURE_IDS = FIXTURE_IDS;

export const seedTestDataset = async () => {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        const request = new sql.Request(tx);

        await request.query(`
            DELETE FROM GovernanceVote WHERE reviewId = ${FIXTURE_IDS.REVIEW_1};
            DELETE FROM GovernanceReviewParticipant WHERE reviewId = ${FIXTURE_IDS.REVIEW_1};
            DELETE FROM GovernanceReview WHERE id = ${FIXTURE_IDS.REVIEW_1};
            DELETE FROM GovernanceMembership WHERE boardId = ${FIXTURE_IDS.BOARD_1};
            DELETE FROM GovernanceCriteriaVersion WHERE id = ${FIXTURE_IDS.CRITERIA_1} OR boardId = ${FIXTURE_IDS.BOARD_1};
            DELETE FROM GovernanceBoard WHERE id = ${FIXTURE_IDS.BOARD_1};
            DELETE FROM ProjectOrgAccess WHERE projectId IN (${FIXTURE_IDS.PROJECT_1}, ${FIXTURE_IDS.PROJECT_2});
            DELETE FROM GoalOrgAccess WHERE goalId IN (${FIXTURE_IDS.GOAL_1}, ${FIXTURE_IDS.GOAL_2});
            DELETE FROM ProjectGoals WHERE projectId IN (${FIXTURE_IDS.PROJECT_1}, ${FIXTURE_IDS.PROJECT_2});
            DELETE FROM IntakeSubmissions WHERE id IN (${FIXTURE_IDS.SUBMISSION_1}, ${FIXTURE_IDS.SUBMISSION_2}, ${FIXTURE_IDS.SUBMISSION_3});
            DELETE FROM IntakeForms WHERE id = ${FIXTURE_IDS.FORM_1};
            DELETE FROM Tasks WHERE projectId IN (${FIXTURE_IDS.PROJECT_1}, ${FIXTURE_IDS.PROJECT_2});
            DELETE FROM ProjectWatchers WHERE projectId IN (${FIXTURE_IDS.PROJECT_1}, ${FIXTURE_IDS.PROJECT_2});
            DELETE FROM Projects WHERE id IN (${FIXTURE_IDS.PROJECT_1}, ${FIXTURE_IDS.PROJECT_2});
            DELETE FROM KPIs WHERE goalId IN (${FIXTURE_IDS.GOAL_1}, ${FIXTURE_IDS.GOAL_2});
            DELETE FROM Goals WHERE id IN (${FIXTURE_IDS.GOAL_1}, ${FIXTURE_IDS.GOAL_2});
        `);

        await request.query(`
            IF NOT EXISTS (SELECT 1 FROM Organizations WHERE id = ${FIXTURE_IDS.ORG_1})
            BEGIN
                SET IDENTITY_INSERT Organizations ON;
                INSERT INTO Organizations (id, name, slug, isActive)
                VALUES (${FIXTURE_IDS.ORG_1}, 'Test Org One', 'test-org-one', 1);
                SET IDENTITY_INSERT Organizations OFF;
            END
            ELSE
            BEGIN
                UPDATE Organizations
                SET name = 'Test Org One', slug = 'test-org-one', isActive = 1
                WHERE id = ${FIXTURE_IDS.ORG_1};
            END

            IF NOT EXISTS (SELECT 1 FROM Organizations WHERE id = ${FIXTURE_IDS.ORG_2})
            BEGIN
                SET IDENTITY_INSERT Organizations ON;
                INSERT INTO Organizations (id, name, slug, isActive)
                VALUES (${FIXTURE_IDS.ORG_2}, 'Test Org Two', 'test-org-two', 1);
                SET IDENTITY_INSERT Organizations OFF;
            END
            ELSE
            BEGIN
                UPDATE Organizations
                SET name = 'Test Org Two', slug = 'test-org-two', isActive = 1
                WHERE id = ${FIXTURE_IDS.ORG_2};
            END
        `);

        for (const persona of Object.values(TEST_PERSONAS)) {
            const rolesJson = JSON.stringify(persona.roles);
            await new sql.Request(tx)
                .input('oid', sql.NVarChar(100), persona.oid)
                .input('tid', sql.NVarChar(100), persona.tid)
                .input('name', sql.NVarChar(255), persona.name)
                .input('email', sql.NVarChar(255), persona.email)
                .input('roles', sql.NVarChar(sql.MAX), rolesJson)
                .input('orgId', sql.Int, persona.orgId || null)
                .query(`
                    MERGE Users AS target
                    USING (SELECT @oid AS oid) AS source
                    ON target.oid = source.oid
                    WHEN MATCHED THEN
                        UPDATE SET
                            tid = @tid,
                            name = @name,
                            email = @email,
                            roles = @roles,
                            orgId = @orgId
                    WHEN NOT MATCHED THEN
                        INSERT (oid, tid, name, email, roles, orgId)
                        VALUES (@oid, @tid, @name, @email, @roles, @orgId);
                `);
        }

        await request.query(`
            SET IDENTITY_INSERT Goals ON;
            INSERT INTO Goals (id, title, description, type, parentId, orgId)
            VALUES
                (${FIXTURE_IDS.GOAL_1}, 'Test Goal Org1', 'Deterministic fixture goal for org1', 'org', NULL, ${FIXTURE_IDS.ORG_1}),
                (${FIXTURE_IDS.GOAL_2}, 'Test Goal Org2', 'Deterministic fixture goal for org2', 'org', NULL, ${FIXTURE_IDS.ORG_2});
            SET IDENTITY_INSERT Goals OFF;

            SET IDENTITY_INSERT Projects ON;
            INSERT INTO Projects (id, title, description, status, goalId, orgId)
            VALUES
                (${FIXTURE_IDS.PROJECT_1}, 'Test Project Org1', 'Deterministic fixture project for org1', 'active', ${FIXTURE_IDS.GOAL_1}, ${FIXTURE_IDS.ORG_1}),
                (${FIXTURE_IDS.PROJECT_2}, 'Test Project Org2', 'Deterministic fixture project for org2', 'active', ${FIXTURE_IDS.GOAL_2}, ${FIXTURE_IDS.ORG_2});
            SET IDENTITY_INSERT Projects OFF;

            INSERT INTO ProjectGoals (projectId, goalId)
            VALUES
                (${FIXTURE_IDS.PROJECT_1}, ${FIXTURE_IDS.GOAL_1}),
                (${FIXTURE_IDS.PROJECT_2}, ${FIXTURE_IDS.GOAL_2});

            INSERT INTO ProjectOrgAccess (projectId, orgId, accessLevel, expiresAt, grantedByOid)
            VALUES
                (${FIXTURE_IDS.PROJECT_1}, ${FIXTURE_IDS.ORG_2}, 'read', '${isoInSevenDays()}', '${TEST_PERSONAS.admin.oid}');

            SET IDENTITY_INSERT IntakeForms ON;
            INSERT INTO IntakeForms (id, name, description, fields, defaultGoalId, orgId, governanceMode, governanceBoardId)
            VALUES
                (
                    ${FIXTURE_IDS.FORM_1},
                    'Test Intake Form',
                    'Deterministic intake form for integration tests',
                    '[{"id":"requesterName","type":"text","label":"Your Name","required":true,"systemKey":"requester_name","locked":true},{"id":"projectName","type":"text","label":"Project Name","required":true,"systemKey":"project_name","locked":true},{"id":"projectDescription","type":"textarea","label":"Description","required":true,"systemKey":"project_description","locked":true}]',
                    ${FIXTURE_IDS.GOAL_1},
                    ${FIXTURE_IDS.ORG_1},
                    'required',
                    NULL
                );
            SET IDENTITY_INSERT IntakeForms OFF;

            SET IDENTITY_INSERT IntakeSubmissions ON;
            INSERT INTO IntakeSubmissions (
                id, formId, formData, status, submittedAt, submitterId, submitterName, submitterEmail,
                governanceRequired, governanceStatus, governanceDecision, governanceReason, orgId, estimatedEffortHours
            )
            VALUES
                (
                    ${FIXTURE_IDS.SUBMISSION_1},
                    ${FIXTURE_IDS.FORM_1},
                    '{"requesterName":"Editor User","projectName":"Governance review request","projectDescription":"Deterministic governance-backed project request"}',
                    'pending',
                    GETDATE(),
                    '${TEST_PERSONAS.editor.oid}',
                    '${TEST_PERSONAS.editor.name}',
                    '${TEST_PERSONAS.editor.email}',
                    1,
                    'in-review',
                    NULL,
                    'Requires governance review',
                    ${FIXTURE_IDS.ORG_1},
                    24
                ),
                (
                    ${FIXTURE_IDS.SUBMISSION_2},
                    ${FIXTURE_IDS.FORM_1},
                    '{"requesterName":"Intake Manager","projectName":"Direct intake request","projectDescription":"Deterministic direct intake request"}',
                    'pending',
                    GETDATE(),
                    '${TEST_PERSONAS.intake_manager.oid}',
                    '${TEST_PERSONAS.intake_manager.name}',
                    '${TEST_PERSONAS.intake_manager.email}',
                    0,
                    'not-started',
                    NULL,
                    NULL,
                    ${FIXTURE_IDS.ORG_1},
                    8
                ),
                (
                    ${FIXTURE_IDS.SUBMISSION_3},
                    ${FIXTURE_IDS.FORM_1},
                    '{"requesterName":"Admin User","projectName":"Admin self-submitted request","projectDescription":"Deterministic admin intake request"}',
                    'pending',
                    GETDATE(),
                    '${TEST_PERSONAS.admin.oid}',
                    '${TEST_PERSONAS.admin.name}',
                    '${TEST_PERSONAS.admin.email}',
                    0,
                    'not-started',
                    NULL,
                    NULL,
                    ${FIXTURE_IDS.ORG_1},
                    4
                );
            SET IDENTITY_INSERT IntakeSubmissions OFF;

            SET IDENTITY_INSERT GovernanceBoard ON;
            INSERT INTO GovernanceBoard (
                id, name, isActive, createdByOid, orgId,
                quorumPercentOverride, quorumMinCountOverride, decisionRequiresQuorumOverride,
                voteWindowDaysOverride, weeklyCapacityHours, wipLimit, defaultSubmissionEffortHours
            )
            VALUES
                (
                    ${FIXTURE_IDS.BOARD_1},
                    'Test Governance Board',
                    1,
                    '${TEST_PERSONAS.admin.oid}',
                    ${FIXTURE_IDS.ORG_1},
                    60,
                    1,
                    1,
                    7,
                    40,
                    10,
                    8
                );
            SET IDENTITY_INSERT GovernanceBoard OFF;

            UPDATE IntakeForms
            SET governanceBoardId = ${FIXTURE_IDS.BOARD_1}
            WHERE id = ${FIXTURE_IDS.FORM_1};

            SET IDENTITY_INSERT GovernanceCriteriaVersion ON;
            INSERT INTO GovernanceCriteriaVersion (
                id, boardId, versionNo, status, criteriaJson, publishedAt, publishedByOid, createdByOid
            )
            VALUES
                (
                    ${FIXTURE_IDS.CRITERIA_1},
                    ${FIXTURE_IDS.BOARD_1},
                    1,
                    'published',
                    '[{"id":"alignment","name":"Strategic Alignment","weight":100,"enabled":true,"sortOrder":1}]',
                    GETDATE(),
                    '${TEST_PERSONAS.admin.oid}',
                    '${TEST_PERSONAS.admin.oid}'
                );
            SET IDENTITY_INSERT GovernanceCriteriaVersion OFF;

            SET IDENTITY_INSERT GovernanceReview ON;
            INSERT INTO GovernanceReview (
                id, submissionId, boardId, reviewRound, status, decision, decisionReason, criteriaVersionId,
                criteriaSnapshotJson, policySnapshotJson, startedAt, startedByOid, voteDeadlineAt
            )
            VALUES
                (
                    ${FIXTURE_IDS.REVIEW_1},
                    ${FIXTURE_IDS.SUBMISSION_1},
                    ${FIXTURE_IDS.BOARD_1},
                    1,
                    'in-review',
                    NULL,
                    NULL,
                    ${FIXTURE_IDS.CRITERIA_1},
                    '[{"id":"alignment","name":"Strategic Alignment","weight":100,"enabled":true}]',
                    '{"quorumPercent":60,"quorumMinCount":1,"decisionRequiresQuorum":false}',
                    GETDATE(),
                    '${TEST_PERSONAS.intake_manager.oid}',
                    DATEADD(day, 3, GETDATE())
                );
            SET IDENTITY_INSERT GovernanceReview OFF;

            INSERT INTO GovernanceMembership (boardId, userOid, role, isActive, createdByOid)
            VALUES
                (${FIXTURE_IDS.BOARD_1}, '${TEST_PERSONAS.governance_member.oid}', 'member', 1, '${TEST_PERSONAS.admin.oid}'),
                (${FIXTURE_IDS.BOARD_1}, '${TEST_PERSONAS.governance_chair.oid}', 'chair', 1, '${TEST_PERSONAS.admin.oid}');

            INSERT INTO GovernanceReviewParticipant (reviewId, userOid, participantRole, isEligibleVoter)
            VALUES
                (${FIXTURE_IDS.REVIEW_1}, '${TEST_PERSONAS.governance_member.oid}', 'member', 1),
                (${FIXTURE_IDS.REVIEW_1}, '${TEST_PERSONAS.governance_chair.oid}', 'chair', 1);
        `);

        await tx.commit();
    } catch (err) {
        await tx.rollback();
        throw err;
    }
};
