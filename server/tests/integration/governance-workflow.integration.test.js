import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTestSetup } from '../helpers/testSetup.js';
import { createTestRequest, asPersona } from '../helpers/testServer.js';
import { TEST_FIXTURE_IDS } from '../fixtures/seed_test_dataset.js';
import { getPool, sql } from '../../db.js';

await ensureTestSetup();
const request = createTestRequest();

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

