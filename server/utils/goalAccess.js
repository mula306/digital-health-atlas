import { sql } from '../db.js';
import { addParams, buildInClause } from './sqlHelpers.js';

const createRequest = (dbOrTx) => (
    dbOrTx instanceof sql.Transaction
        ? new sql.Request(dbOrTx)
        : dbOrTx.request()
);

const normalizeGoalIds = (goalIds) => (
    [...new Set((Array.isArray(goalIds) ? goalIds : [])
        .map((goalId) => Number.parseInt(goalId, 10))
        .filter((goalId) => !Number.isNaN(goalId)))]
);

export const fetchGoalAccessRowsForOrg = async ({ dbOrTx, goalIds, orgId }) => {
    const normalizedGoalIds = normalizeGoalIds(goalIds);
    if (normalizedGoalIds.length === 0) return [];

    const { text, params } = buildInClause('goalId', normalizedGoalIds);
    const request = createRequest(dbOrTx).input('orgId', sql.Int, orgId);
    addParams(request, params);

    const result = await request.query(`
        SELECT
            g.id,
            g.title,
            g.orgId,
            CASE
                WHEN g.orgId = @orgId THEN 1
                WHEN goa.goalId IS NOT NULL THEN 1
                ELSE 0
            END AS hasAccess,
            CASE WHEN goa.goalId IS NOT NULL THEN 1 ELSE 0 END AS hasSharedAccess
        FROM Goals g
        LEFT JOIN GoalOrgAccess goa
            ON goa.goalId = g.id
           AND goa.orgId = @orgId
           AND (goa.expiresAt IS NULL OR goa.expiresAt > GETDATE())
        WHERE g.id IN (${text})
    `);

    return result.recordset.map((row) => ({
        goalId: Number(row.id),
        title: row.title || `Goal ${row.id}`,
        ownerOrgId: row.orgId === null || row.orgId === undefined ? null : Number(row.orgId),
        hasAccess: !!row.hasAccess,
        hasSharedAccess: !!row.hasSharedAccess
    }));
};

export const findGoalAccessGapsForOrg = async ({ dbOrTx, goalIds, orgId }) => {
    if (orgId === null || orgId === undefined) return [];
    const rows = await fetchGoalAccessRowsForOrg({ dbOrTx, goalIds, orgId });
    return rows.filter((row) => !row.hasAccess);
};

export const ensureReadGoalAccessForOrg = async ({
    dbOrTx,
    goalIds,
    orgId,
    grantedByOid,
    expiresAt = null
}) => {
    const rows = await fetchGoalAccessRowsForOrg({ dbOrTx, goalIds, orgId });
    const crossOrgGoals = rows.filter((row) => row.ownerOrgId !== null && row.ownerOrgId !== orgId);

    let insertedGoalCount = 0;
    let refreshedExpiredGoalCount = 0;

    for (const goal of crossOrgGoals) {
        const mergeResult = await createRequest(dbOrTx)
            .input('goalId', sql.Int, goal.goalId)
            .input('orgId', sql.Int, orgId)
            .input('accessLevel', sql.NVarChar(20), 'read')
            .input('expiresAt', sql.DateTime2, expiresAt)
            .input('grantedByOid', sql.NVarChar(100), grantedByOid || null)
            .query(`
                MERGE GoalOrgAccess AS target
                USING (SELECT @goalId AS goalId, @orgId AS orgId) AS source
                ON target.goalId = source.goalId AND target.orgId = source.orgId
                WHEN MATCHED AND target.expiresAt IS NOT NULL AND target.expiresAt <= GETDATE() THEN
                    UPDATE SET
                        accessLevel = @accessLevel,
                        expiresAt = @expiresAt,
                        grantedAt = GETDATE(),
                        grantedByOid = @grantedByOid
                WHEN NOT MATCHED THEN
                    INSERT (goalId, orgId, accessLevel, expiresAt, grantedByOid)
                    VALUES (@goalId, @orgId, @accessLevel, @expiresAt, @grantedByOid)
                OUTPUT $action AS mergeAction;
            `);

        for (const row of mergeResult.recordset || []) {
            if (row.mergeAction === 'INSERT') insertedGoalCount += 1;
            if (row.mergeAction === 'UPDATE') refreshedExpiredGoalCount += 1;
        }
    }

    return {
        linkedGoalCount: crossOrgGoals.length,
        insertedGoalCount,
        refreshedExpiredGoalCount
    };
};
