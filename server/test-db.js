import 'dotenv/config';
import { getPool, sql } from './db.js';

async function run() {
    try {
        const pool = await getPool();
        const r2 = await pool.request()
            .input('limit', sql.Int, 8)
            .input('offset', sql.Int, 0)
            .input('requestUserOid', sql.NVarChar(100), 'test')
            .query(`
                SELECT
                    s.id,
                    s.priorityScore,
                    NULL AS latestReviewId,
                    NULL AS latestReviewStatus,
                    NULL AS latestReviewStartedAt,
                    NULL AS latestReviewDecidedAt,
                    NULL AS lastSlaNudgedAt,
                    NULL AS lastSlaNudgedByOid,
                    NULL AS estimatedEffortHours,
                    NULL AS weeklyCapacityHours,
                    NULL AS wipLimit,
                    NULL AS defaultSubmissionEffortHours,
                    f.name AS formName,
                    f.governanceMode,
                    f.governanceBoardId,
                    b.name AS governanceBoardName
                FROM IntakeSubmissions s
                INNER JOIN IntakeForms f ON f.id = s.formId
                LEFT JOIN GovernanceBoard b ON b.id = f.governanceBoardId
                WHERE s.governanceRequired = 1 AND EXISTS (
                    SELECT 1
                    FROM GovernanceReview gr
                    INNER JOIN GovernanceReviewParticipant grp
                        ON grp.reviewId = gr.id
                       AND grp.userOid = @requestUserOid
                       AND grp.isEligibleVoter = 1
                    LEFT JOIN GovernanceVote gv
                        ON gv.reviewId = gr.id
                       AND gv.voterUserOid = @requestUserOid
                    WHERE gr.submissionId = s.id
                      AND gr.reviewRound = (
                          SELECT MAX(gr2.reviewRound)
                          FROM GovernanceReview gr2
                          WHERE gr2.submissionId = s.id
                      )
                      AND gr.status = 'in-review'
                      AND gv.id IS NULL
                )
                ORDER BY
                    CASE WHEN s.priorityScore IS NULL THEN 1 ELSE 0 END,
                    s.priorityScore DESC,
                    s.submittedAt ASC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `);
        console.log('Query ok', r2.recordset.length);
    } catch(e) {
        console.error('SQL ERROR:', e.message);
    }
    process.exit(0);
}

run();
