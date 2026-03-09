import sql from 'mssql';
import { faker } from '@faker-js/faker';
import { getPool } from '../db.js';

const PROJECT_COUNT = Number.parseInt(process.env.FAKER_PROJECTS || '40', 10);
const TASKS_PER_PROJECT_MIN = Number.parseInt(process.env.FAKER_TASKS_MIN || '6', 10);
const TASKS_PER_PROJECT_MAX = Number.parseInt(process.env.FAKER_TASKS_MAX || '14', 10);
const REPORTS_PER_PROJECT_MIN = Number.parseInt(process.env.FAKER_REPORTS_MIN || '1', 10);
const REPORTS_PER_PROJECT_MAX = Number.parseInt(process.env.FAKER_REPORTS_MAX || '3', 10);
const TAGS_PER_PROJECT_MIN = Number.parseInt(process.env.FAKER_TAGS_MIN || '1', 10);
const TAGS_PER_PROJECT_MAX = Number.parseInt(process.env.FAKER_TAGS_MAX || '3', 10);

const existsTable = async (pool, tableName) => {
    const result = await pool.request()
        .input('tableName', sql.NVarChar, tableName)
        .query(`
            SELECT CASE WHEN EXISTS (
                SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tableName
            ) THEN 1 ELSE 0 END AS tableExists
        `);
    return result.recordset[0].tableExists === 1;
};

const existsColumn = async (pool, tableName, columnName) => {
    const result = await pool.request()
        .input('tableName', sql.NVarChar, tableName)
        .input('columnName', sql.NVarChar, columnName)
        .query(`
            SELECT CASE WHEN EXISTS (
                SELECT 1
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = @tableName AND COLUMN_NAME = @columnName
            ) THEN 1 ELSE 0 END AS columnExists
        `);
    return result.recordset[0].columnExists === 1;
};

const ensureDefaultOrganization = async (pool) => {
    const hasOrganizations = await existsTable(pool, 'Organizations');
    if (!hasOrganizations) return null;

    const existing = await pool.request().query(`
        SELECT TOP 1 id
        FROM Organizations
        WHERE isActive = 1
        ORDER BY id ASC
    `);
    if (existing.recordset.length > 0) {
        return existing.recordset[0].id;
    }

    const inserted = await pool.request()
        .input('name', sql.NVarChar, 'Default Organization')
        .input('slug', sql.NVarChar, 'default-organization')
        .query(`
            INSERT INTO Organizations (name, slug, isActive)
            OUTPUT INSERTED.id
            VALUES (@name, @slug, 1)
        `);
    return inserted.recordset[0].id;
};

const ensureGoals = async (pool, orgId, goalsHaveOrgId) => {
    const goalsCount = await pool.request().query('SELECT COUNT(*) AS count FROM Goals');
    if (goalsCount.recordset[0].count > 0) {
        const existingGoals = await pool.request().query('SELECT id FROM Goals');
        return existingGoals.recordset.map((row) => row.id);
    }

    const insertGoal = async ({ title, type, parentId = null }) => {
        const request = pool.request()
            .input('title', sql.NVarChar, title)
            .input('type', sql.NVarChar, type)
            .input('parentId', sql.Int, parentId);

        if (goalsHaveOrgId) {
            request.input('orgId', sql.Int, orgId);
        }

        const query = goalsHaveOrgId
            ? `
                INSERT INTO Goals (title, type, parentId, orgId)
                OUTPUT INSERTED.id
                VALUES (@title, @type, @parentId, @orgId)
            `
            : `
                INSERT INTO Goals (title, type, parentId)
                OUTPUT INSERTED.id
                VALUES (@title, @type, @parentId)
            `;

        const result = await request.query(query);
        return result.recordset[0].id;
    };

    const rootGoalId = await insertGoal({ title: 'Health System Transformation', type: 'org' });
    const div1 = await insertGoal({
        title: 'Digital Front Door',
        type: 'div',
        parentId: rootGoalId
    });
    const div2 = await insertGoal({
        title: 'Clinical Platform Modernization',
        type: 'div',
        parentId: rootGoalId
    });
    await insertGoal({ title: 'Virtual Care Access', type: 'dept', parentId: div1 });
    await insertGoal({ title: 'Scheduling and Referrals', type: 'dept', parentId: div1 });
    await insertGoal({ title: 'EHR Optimization', type: 'dept', parentId: div2 });
    await insertGoal({ title: 'Data and Reporting', type: 'dept', parentId: div2 });

    const seededGoalsResult = await pool.request().query('SELECT id FROM Goals');
    const seededGoalIds = seededGoalsResult.recordset.map((row) => row.id);

    // Create KPIs for existing goals
    console.log('Seeding KPIs for goals...');
    for (const goalId of seededGoalIds) {
        const kpiCountResult = await pool.request()
            .input('goalId', sql.Int, goalId)
            .query('SELECT COUNT(*) as count FROM KPIs WHERE goalId = @goalId');

        const currentCount = kpiCountResult.recordset[0].count;
        const targetCount = faker.number.int({ min: 3, max: 5 });

        if (currentCount < targetCount) {
            const needed = targetCount - currentCount;
            const table = new sql.Table('KPIs');
            table.create = false;
            table.columns.add('goalId', sql.Int, { nullable: false });
            table.columns.add('name', sql.NVarChar(255), { nullable: false });
            table.columns.add('target', sql.Decimal(18, 2), { nullable: true });
            table.columns.add('currentValue', sql.Decimal(18, 2), { nullable: true });
            table.columns.add('unit', sql.NVarChar(20), { nullable: true });

            for (let i = 0; i < needed; i++) {
                table.rows.add(
                    goalId,
                    faker.company.buzzPhrase(),
                    faker.number.float({ min: 80, max: 100, precision: 0.1 }),
                    faker.number.float({ min: 50, max: 95, precision: 0.1 }),
                    '%'
                );
            }
            const request = new sql.Request(pool);
            await request.bulk(table);
        }
    }

    return seededGoalIds;
};

const maybeSeedProjectGoals = async (pool, hasProjectGoals, projectId, goalId) => {
    if (!hasProjectGoals) return;

    await pool.request()
        .input('projectId', sql.Int, projectId)
        .input('goalId', sql.Int, goalId)
        .query(`
            IF NOT EXISTS (
                SELECT 1 FROM ProjectGoals WHERE projectId = @projectId AND goalId = @goalId
            )
            BEGIN
                INSERT INTO ProjectGoals (projectId, goalId) VALUES (@projectId, @goalId)
            END
        `);
};

async function seedFakerData() {
    const pool = await getPool();

    try {
        console.log('Starting faker seed...');
        const projectsHaveOrgId = await existsColumn(pool, 'Projects', 'orgId');
        const goalsHaveOrgId = await existsColumn(pool, 'Goals', 'orgId');
        const hasProjectGoals = await existsTable(pool, 'ProjectGoals');
        const orgId = await ensureDefaultOrganization(pool);
        const goalIds = await ensureGoals(pool, orgId, goalsHaveOrgId);

        const createdProjectIds = [];
        for (let i = 0; i < PROJECT_COUNT; i += 1) {
            const goalId = faker.helpers.arrayElement(goalIds);
            const request = pool.request()
                .input('title', sql.NVarChar(255), `${faker.commerce.productName()} Initiative`)
                .input('description', sql.NVarChar(sql.MAX), faker.lorem.sentences({ min: 1, max: 2 }))
                .input('status', sql.NVarChar(20), faker.helpers.arrayElement(['active', 'planning', 'on-hold', 'completed']))
                .input('goalId', sql.Int, goalId);

            if (projectsHaveOrgId) {
                request.input('orgId', sql.Int, orgId);
            }

            const insertProjectQuery = projectsHaveOrgId
                ? `
                    INSERT INTO Projects (title, description, status, goalId, orgId)
                    OUTPUT INSERTED.id
                    VALUES (@title, @description, @status, @goalId, @orgId)
                `
                : `
                    INSERT INTO Projects (title, description, status, goalId)
                    OUTPUT INSERTED.id
                    VALUES (@title, @description, @status, @goalId)
                `;

            const projectResult = await request.query(insertProjectQuery);
            const projectId = projectResult.recordset[0].id;
            createdProjectIds.push(projectId);
            await maybeSeedProjectGoals(pool, hasProjectGoals, projectId, goalId);

            // Fetch PDEs (KPIs) for this project's Goal
            const kpisResult = await pool.request()
                .input('goalId', sql.Int, goalId)
                .query('SELECT id, name FROM KPIs WHERE goalId = @goalId');

            const availableKpis = kpisResult.recordset;
            if (availableKpis.length > 0) {
                // Determine how many benefits to seed (e.g. 1 to 3, but not more than available KPIs)
                const benefitCount = Math.min(
                    faker.number.int({ min: 1, max: 3 }),
                    availableKpis.length
                );
                const selectedKpis = faker.helpers.arrayElements(availableKpis, benefitCount);

                for (const kpi of selectedKpis) {
                    await pool.request()
                        .input('projectId', sql.Int, projectId)
                        .input('title', sql.NVarChar(255), kpi.name)
                        .input('linkedKpiId', sql.Int, kpi.id)
                        .input('baselineValue', sql.Decimal(18, 2), faker.number.float({ min: 10, max: 50, precision: 0.1 }))
                        .input('targetValue', sql.Decimal(18, 2), faker.number.float({ min: 80, max: 100, precision: 0.1 }))
                        .input('currentValue', sql.Decimal(18, 2), faker.number.float({ min: 50, max: 95, precision: 0.1 }))
                        .input('unit', sql.NVarChar(50), '%')
                        .input('status', sql.NVarChar(50), faker.helpers.arrayElement(['planned', 'in-progress', 'realized', 'at-risk', 'not-realized']))
                        .query(`
                            INSERT INTO ProjectBenefitRealization (projectId, title, linkedKpiId, baselineValue, targetValue, currentValue, unit, status)
                            VALUES (@projectId, @title, @linkedKpiId, @baselineValue, @targetValue, @currentValue, @unit, @status)
                        `);
                }
            }
        }
        console.log(`Created projects: ${createdProjectIds.length}`);

        const tasksTable = new sql.Table('Tasks');
        tasksTable.create = false;
        tasksTable.columns.add('projectId', sql.Int, { nullable: false });
        tasksTable.columns.add('title', sql.NVarChar(255), { nullable: false });
        tasksTable.columns.add('status', sql.NVarChar(20), { nullable: true });
        tasksTable.columns.add('priority', sql.NVarChar(20), { nullable: true });
        tasksTable.columns.add('startDate', sql.Date, { nullable: true });
        tasksTable.columns.add('endDate', sql.Date, { nullable: true });

        let taskCount = 0;
        for (const projectId of createdProjectIds) {
            const count = faker.number.int({ min: TASKS_PER_PROJECT_MIN, max: TASKS_PER_PROJECT_MAX });
            for (let i = 0; i < count; i += 1) {
                const startDate = faker.date.recent({ days: 90 });
                const endDate = faker.date.soon({ days: 120, refDate: startDate });
                tasksTable.rows.add(
                    projectId,
                    `${faker.hacker.verb()} ${faker.hacker.noun()}`,
                    faker.helpers.arrayElement(['todo', 'in-progress', 'review', 'done']),
                    faker.helpers.arrayElement(['low', 'medium', 'high']),
                    startDate,
                    endDate
                );
                taskCount += 1;
            }
        }
        if (taskCount > 0) {
            await new sql.Request(pool).bulk(tasksTable);
        }
        console.log(`Created tasks: ${taskCount}`);

        let reportCount = 0;
        for (const projectId of createdProjectIds) {
            const versions = faker.number.int({
                min: REPORTS_PER_PROJECT_MIN,
                max: REPORTS_PER_PROJECT_MAX
            });
            for (let version = 1; version <= versions; version += 1) {
                const reportData = JSON.stringify({
                    summary: faker.lorem.paragraph(),
                    overallStatus: faker.helpers.arrayElement(['green', 'yellow', 'red']),
                    purpose: faker.lorem.paragraph(),
                    executiveSummary: faker.lorem.paragraph(),
                    goodNews: faker.lorem.paragraph(),
                    kpis: faker.lorem.paragraph(),
                    contacts: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        name: faker.person.fullName(),
                        organization: faker.company.name()
                    })),
                    workstreams: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        name: faker.company.catchPhrase(),
                        progressLastPeriod: faker.lorem.sentence(),
                        workAhead: faker.lorem.sentence(),
                        barriers: faker.lorem.sentence(),
                        status: faker.helpers.arrayElement(['green', 'yellow', 'red'])
                    })),
                    risks: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        description: faker.lorem.sentence(),
                        impact: faker.lorem.sentence(),
                        priority: faker.helpers.arrayElement(['low', 'medium', 'high']),
                        mitigation: faker.lorem.sentence(),
                        status: faker.helpers.arrayElement(['open', 'closed']),
                        closedDate: faker.date.recent(),
                        closedRationale: faker.lorem.sentence()
                    })),
                    milestones: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        name: faker.company.buzzPhrase(),
                        date: faker.date.future(),
                        status: faker.helpers.arrayElement(['pending', 'in-progress', 'complete'])
                    })),
                    decisions: Array.from({ length: faker.number.int({ min: 4, max: 6 }) }, () => ({
                        id: faker.string.uuid(),
                        description: faker.lorem.sentence(),
                        priority: faker.helpers.arrayElement(['low', 'medium', 'high']),
                        status: faker.helpers.arrayElement(['pending', 'approved', 'rejected']),
                        decisionStatement: faker.lorem.sentence(),
                        decisionDate: faker.date.recent()
                    }))
                });

                await pool.request()
                    .input('projectId', sql.Int, projectId)
                    .input('version', sql.Int, version)
                    .input('reportData', sql.NVarChar(sql.MAX), reportData)
                    .input('createdBy', sql.NVarChar(100), faker.internet.email())
                    .query(`
                        INSERT INTO StatusReports (projectId, version, reportData, createdBy)
                        VALUES (@projectId, @version, @reportData, @createdBy)
                    `);
                reportCount += 1;
            }
        }
        console.log(`Created status reports: ${reportCount}`);

        const hasTags = await existsTable(pool, 'Tags');
        const hasProjectTags = await existsTable(pool, 'ProjectTags');
        if (hasTags && hasProjectTags) {
            const tagsResult = await pool.request()
                .query(`SELECT id FROM Tags WHERE status = 'active'`);
            const tagIds = tagsResult.recordset.map((row) => row.id);

            if (tagIds.length > 0) {
                const projectTagsTable = new sql.Table('ProjectTags');
                projectTagsTable.create = false;
                projectTagsTable.columns.add('projectId', sql.Int, { nullable: false });
                projectTagsTable.columns.add('tagId', sql.Int, { nullable: false });
                projectTagsTable.columns.add('isPrimary', sql.Bit, { nullable: false });

                for (const projectId of createdProjectIds) {
                    const count = Math.min(
                        faker.number.int({ min: TAGS_PER_PROJECT_MIN, max: TAGS_PER_PROJECT_MAX }),
                        tagIds.length
                    );
                    const picked = faker.helpers.arrayElements(tagIds, count);
                    for (const tagId of picked) {
                        projectTagsTable.rows.add(projectId, tagId, 0);
                    }
                }

                if (projectTagsTable.rows.length > 0) {
                    await new sql.Request(pool).bulk(projectTagsTable);
                    console.log(`Created project tags: ${projectTagsTable.rows.length}`);
                }
            }
        }

        console.log('Faker seed complete.');
        process.exit(0);
    } catch (err) {
        console.error('Faker seed failed:', err.message);
        process.exit(1);
    }
}

seedFakerData();
