import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { TEST_FIXTURE_IDS } from '../fixtures/seed_test_dataset.js';
import { getPool, sql } from '../../db.js';

await ensureTestSetup();
const request = createTestRequest();
const TEMP_SCOPE_FIXTURE_IDS = {
    BOARD_2: 9602,
    FORM_2: 9502,
    SUBMISSION_4: 9404
};

const resetGovernanceReviewState = async () => {
    const pool = await getPool();
    await pool.request()
        .input('reviewId', sql.Int, TEST_FIXTURE_IDS.REVIEW_1)
        .input('submissionId', sql.Int, TEST_FIXTURE_IDS.SUBMISSION_1)
        .query(`
            DELETE FROM GovernanceVote WHERE reviewId = @reviewId;
            UPDATE GovernanceReview
            SET
                status = 'in-review',
                decision = NULL,
                decisionReason = NULL,
                decidedAt = NULL,
                decidedByOid = NULL,
                voteDeadlineAt = DATEADD(day, 3, GETDATE())
            WHERE id = @reviewId;
            UPDATE IntakeSubmissions
            SET
                governanceStatus = 'in-review',
                governanceDecision = NULL,
                priorityScore = NULL
            WHERE id = @submissionId;
        `);
};

const cleanupScopedGovernanceFixture = async () => {
    const pool = await getPool();
    await pool.request()
        .input('submissionId', sql.Int, TEMP_SCOPE_FIXTURE_IDS.SUBMISSION_4)
        .input('formId', sql.Int, TEMP_SCOPE_FIXTURE_IDS.FORM_2)
        .input('boardId', sql.Int, TEMP_SCOPE_FIXTURE_IDS.BOARD_2)
        .query(`
            DELETE FROM GovernanceVote
            WHERE reviewId IN (SELECT id FROM GovernanceReview WHERE submissionId = @submissionId);
            DELETE FROM GovernanceReviewParticipant
            WHERE reviewId IN (SELECT id FROM GovernanceReview WHERE submissionId = @submissionId);
            DELETE FROM GovernanceReview
            WHERE submissionId = @submissionId;
            DELETE FROM IntakeSubmissions WHERE id = @submissionId;
            DELETE FROM IntakeForms WHERE id = @formId;
            DELETE FROM GovernanceMembership WHERE boardId = @boardId;
            DELETE FROM GovernanceCriteriaVersion WHERE boardId = @boardId;
            DELETE FROM GovernanceBoard WHERE id = @boardId;
        `);
};

const seedScopedGovernanceFixture = async () => {
    const pool = await getPool();
    await cleanupScopedGovernanceFixture();
    await pool.request().query(`
        SET IDENTITY_INSERT GovernanceBoard ON;
        INSERT INTO GovernanceBoard (
            id, name, isActive, createdByOid, orgId,
            quorumPercentOverride, quorumMinCountOverride, decisionRequiresQuorumOverride,
            voteWindowDaysOverride, weeklyCapacityHours, wipLimit, defaultSubmissionEffortHours
        )
        VALUES (
            ${TEMP_SCOPE_FIXTURE_IDS.BOARD_2},
            'Scoped Org 2 Board',
            1,
            'test-admin-oid',
            2,
            60,
            1,
            1,
            7,
            32,
            6,
            8
        );
        SET IDENTITY_INSERT GovernanceBoard OFF;

        SET IDENTITY_INSERT IntakeForms ON;
        INSERT INTO IntakeForms (id, name, description, fields, defaultGoalId, orgId, governanceMode, governanceBoardId)
        VALUES (
            ${TEMP_SCOPE_FIXTURE_IDS.FORM_2},
            'Scoped Org 2 Intake Form',
            'Temporary scoped governance form',
            '[{"id":"requesterName","type":"text","label":"Your Name","required":true,"systemKey":"requester_name","locked":true},{"id":"projectName","type":"text","label":"Project Name","required":true,"systemKey":"project_name","locked":true},{"id":"projectDescription","type":"textarea","label":"Description","required":true,"systemKey":"project_description","locked":true}]',
            ${TEST_FIXTURE_IDS.GOAL_2},
            2,
            'required',
            ${TEMP_SCOPE_FIXTURE_IDS.BOARD_2}
        );
        SET IDENTITY_INSERT IntakeForms OFF;

        SET IDENTITY_INSERT IntakeSubmissions ON;
        INSERT INTO IntakeSubmissions (
            id, formId, formData, status, submittedAt, submitterId, submitterName, submitterEmail,
            governanceRequired, governanceStatus, governanceDecision, governanceReason, orgId, estimatedEffortHours
        )
        VALUES (
            ${TEMP_SCOPE_FIXTURE_IDS.SUBMISSION_4},
            ${TEMP_SCOPE_FIXTURE_IDS.FORM_2},
            '{"requesterName":"Org 2 Intake Manager","projectName":"Scoped org2 request","projectDescription":"Temporary scoped governance request"}',
            'pending',
            GETDATE(),
            'test-org2-intake-manager-oid',
            'Test Org2 Intake Manager',
            'org2-intake-manager@test.local',
            1,
            'not-started',
            NULL,
            'Scoped board review',
            2,
            6
        );
        SET IDENTITY_INSERT IntakeSubmissions OFF;
    `);
};

test('intake manager can apply and skip governance routing', async () => {
    const intakeManager = asPersona(request, 'intake_manager');

    let response = await intakeManager
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_2}/governance/apply`)
        .send({ reason: 'Route into governance for risk review' });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);

    response = await intakeManager
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_2}/governance/skip`)
        .send({ reason: 'No board review needed' });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);

    const viewer = asPersona(request, 'viewer');
    const denied = await viewer
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_2}/governance/apply`)
        .send({ reason: 'should fail' });
    assert.equal(denied.status, 403);
});

test('eligible governance member can vote and non-eligible users are blocked', async () => {
    await resetGovernanceReviewState();

    const member = asPersona(request, 'governance_member');
    const allowedVote = await member
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_1}/governance/votes`)
        .send({
            scores: {
                alignment: 4
            },
            comment: 'Alignment is strong'
        });

    assert.equal(allowedVote.status, 200);
    assert.equal(allowedVote.body.success, true);
    assert.equal(Number(allowedVote.body.voteCount), 1);

    const outsider = asPersona(request, 'org2_editor');
    const deniedVote = await outsider
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_1}/governance/votes`)
        .send({
            scores: {
                alignment: 3
            }
        });
    assert.equal(deniedVote.status, 403);
});

test('voting is blocked once deadline is in the past', async () => {
    await resetGovernanceReviewState();
    const pool = await getPool();
    await pool.request()
        .input('reviewId', sql.Int, TEST_FIXTURE_IDS.REVIEW_1)
        .query(`
            UPDATE GovernanceReview
            SET voteDeadlineAt = DATEADD(minute, -10, GETDATE())
            WHERE id = @reviewId
        `);

    const member = asPersona(request, 'governance_member');
    const response = await member
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_1}/governance/votes`)
        .send({
            scores: {
                alignment: 5
            }
        });

    assert.equal(response.status, 409);
    assert.match(String(response.body?.error || ''), /closed/i);
});

test('governance chair can record final decision for active review', async () => {
    await resetGovernanceReviewState();

    const member = asPersona(request, 'governance_member');
    await member
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_1}/governance/votes`)
        .send({
            scores: {
                alignment: 4
            }
        });

    const chair = asPersona(request, 'governance_chair');
    const decision = await chair
        .post(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_1}/governance/decide`)
        .send({
            decision: 'approved-now',
            decisionReason: 'Decision recorded in integration test'
        });

    assert.equal(decision.status, 200);
    assert.equal(decision.body.success, true);
    assert.equal(String(decision.body.decision), 'approved-now');
});

test('governance views are limited to same-org scope or explicit board membership', async (t) => {
    await seedScopedGovernanceFixture();
    t.after(async () => {
        await cleanupScopedGovernanceFixture();
    });

    const org2IntakeManager = asPersona(request, 'org2_intake_manager');
    const governanceMember = asPersona(request, 'governance_member');

    const ownOrgQueue = await org2IntakeManager.get(`/api/intake/governance-queue?boardId=${TEMP_SCOPE_FIXTURE_IDS.BOARD_2}`);
    assert.equal(ownOrgQueue.status, 200);
    assert.ok(ownOrgQueue.body.items.some((item) => item.id === String(TEMP_SCOPE_FIXTURE_IDS.SUBMISSION_4)));

    const blockedQueue = await governanceMember.get(`/api/intake/governance-queue?boardId=${TEMP_SCOPE_FIXTURE_IDS.BOARD_2}`);
    assert.equal(blockedQueue.status, 200);
    assert.ok(!blockedQueue.body.items.some((item) => item.id === String(TEMP_SCOPE_FIXTURE_IDS.SUBMISSION_4)));

    const blockedGovernanceQueue = await governanceMember.get(`/api/governance/queue?boardId=${TEMP_SCOPE_FIXTURE_IDS.BOARD_2}`);
    assert.equal(blockedGovernanceQueue.status, 200);
    assert.ok(!blockedGovernanceQueue.body.items.some((item) => item.id === String(TEMP_SCOPE_FIXTURE_IDS.SUBMISSION_4)));

    const crossOrgMemberDetail = await org2IntakeManager.get(`/api/intake/submissions/${TEST_FIXTURE_IDS.SUBMISSION_1}/governance`);
    assert.equal(crossOrgMemberDetail.status, 200);
    assert.equal(crossOrgMemberDetail.body.submission?.id, String(TEST_FIXTURE_IDS.SUBMISSION_1));

    const blockedDetail = await governanceMember.get(`/api/intake/submissions/${TEMP_SCOPE_FIXTURE_IDS.SUBMISSION_4}/governance`);
    assert.equal(blockedDetail.status, 403);
});
