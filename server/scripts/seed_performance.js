
import sql from 'mssql';
import { faker } from '@faker-js/faker';
import { getPool } from '../db.js';

const TOTAL_PROJECTS = 900;
const TASKS_PER_PROJECT_MIN = 50;
const TASKS_PER_PROJECT_MAX = 100;
const REPORT_VERSIONS_MIN = 5;
const REPORT_VERSIONS_MAX = 10;
const KPI_PER_GOAL_MIN = 5;
const KPI_PER_GOAL_MAX = 8;
const TAGS_PER_PROJECT_MIN = 3;
const TAGS_PER_PROJECT_MAX = 5;

async function seedPerformanceData() {
    console.log('🚀 Starting Performance Seeding...');
    const pool = await getPool();

    try {
        // 1. Fetch Existing Goals
        console.log('🔹 Fetching existing goals...');
        const goalsResult = await pool.request().query('SELECT id FROM Goals');
        const goalIds = goalsResult.recordset.map(g => g.id);

        if (goalIds.length === 0) {
            console.error('❌ No goals found! Please create some goals first.');
            process.exit(1);
        }
        console.log(`✅ Found ${goalIds.length} existing goals.`);

        // 2. Ensure KPIs for Goals
        console.log('🔹 Ensuring KPIs for goals...');
        for (const goalId of goalIds) {
            // Check existing KPIs
            const kpiCountResult = await pool.request()
                .input('goalId', sql.Int, goalId)
                .query('SELECT COUNT(*) as count FROM KPIs WHERE goalId = @goalId');

            let currentCount = kpiCountResult.recordset[0].count;
            const targetCount = faker.number.int({ min: KPI_PER_GOAL_MIN, max: KPI_PER_GOAL_MAX });

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
        console.log('✅ KPIs seeded.');

        // 3. Generate Projects
        console.log(`🔹 Generating ${TOTAL_PROJECTS} Projects...`);
        const projectsTable = new sql.Table('Projects');
        projectsTable.create = false;
        projectsTable.columns.add('title', sql.NVarChar(255), { nullable: false });
        projectsTable.columns.add('description', sql.NVarChar(sql.MAX), { nullable: true });
        projectsTable.columns.add('status', sql.NVarChar(20), { nullable: true });
        projectsTable.columns.add('goalId', sql.Int, { nullable: true });

        // We need to insert projects first to get their IDs for Tasks
        // Bulk insert doesn't return IDs easily in older mssql packages, 
        // but we can insert them in batches or use a loop if bulk is tricky for ID retrieval.
        // Actually, for performance, we should use bulk. 
        // But to link Tasks, we need the Project IDs.
        // Strategy: Insert Projects, then fetch all Project IDs created (or just fetch all projects).

        // Let's generate data first
        const projectData = [];
        for (let i = 0; i < TOTAL_PROJECTS; i++) {
            projectData.push({
                title: faker.commerce.productName() + ' Initiative',
                description: faker.lorem.sentence(),
                status: faker.helpers.arrayElement(['active', 'completed', 'on-hold', 'planning']),
                goalId: faker.helpers.arrayElement(goalIds)
            });
            projectsTable.rows.add(
                projectData[i].title,
                projectData[i].description,
                projectData[i].status,
                projectData[i].goalId
            );
        }

        const request = new sql.Request(pool);
        await request.bulk(projectsTable);
        console.log('✅ Projects inserted.');

        // 4. Fetch New Project IDs
        // We assume we want to seed tasks for ALL projects, or just the new ones?
        // Let's fetch the top 300 desc to catch the new ones, or just all.
        const projectsResult = await pool.request().query(`SELECT TOP ${TOTAL_PROJECTS} id FROM Projects ORDER BY id DESC`);
        const projectIds = projectsResult.recordset.map(p => p.id);

        // 4b. Seed Project Tags
        console.log('🔹 Seeding Project Tags...');
        const tagsResult = await pool.request().query('SELECT id FROM Tags');
        const tagIds = tagsResult.recordset.map(t => t.id);

        if (tagIds.length > 0) {
            const projectTagsTable = new sql.Table('ProjectTags');
            projectTagsTable.create = false;
            projectTagsTable.columns.add('projectId', sql.Int, { nullable: false });
            projectTagsTable.columns.add('tagId', sql.Int, { nullable: false });
            projectTagsTable.columns.add('isPrimary', sql.Bit, { nullable: false });

            for (const pid of projectIds) {
                const tagCount = faker.number.int({ min: TAGS_PER_PROJECT_MIN, max: TAGS_PER_PROJECT_MAX });
                // Ensure we don't try to pick more tags than exist
                const countToPick = Math.min(tagCount, tagIds.length);
                const selectedTags = faker.helpers.arrayElements(tagIds, countToPick);

                for (const tid of selectedTags) {
                    projectTagsTable.rows.add(pid, tid, 0); // isPrimary = 0
                }
            }

            const tagReq = new sql.Request(pool);
            await tagReq.bulk(projectTagsTable);
            console.log('✅ Project Tags seeded.');
        } else {
            console.log('⚠️ No tags found. Skipping project tagging.');
        }

        // 5. Generate Tasks (Batching to avoid memory issues)
        console.log(`🔹 Generating Tasks for ${projectIds.length} projects...`);

        const BATCH_SIZE = 50; // Process projects in chunks
        for (let i = 0; i < projectIds.length; i += BATCH_SIZE) {
            const chunk = projectIds.slice(i, i + BATCH_SIZE);
            const tasksTable = new sql.Table('Tasks');
            tasksTable.create = false;
            tasksTable.columns.add('projectId', sql.Int, { nullable: false });
            tasksTable.columns.add('title', sql.NVarChar(255), { nullable: false });
            tasksTable.columns.add('status', sql.NVarChar(20), { nullable: true });
            tasksTable.columns.add('priority', sql.NVarChar(20), { nullable: true });
            tasksTable.columns.add('startDate', sql.Date, { nullable: true });
            tasksTable.columns.add('endDate', sql.Date, { nullable: true });

            for (const pid of chunk) {
                const taskCount = faker.number.int({ min: TASKS_PER_PROJECT_MIN, max: TASKS_PER_PROJECT_MAX });
                for (let t = 0; t < taskCount; t++) {
                    tasksTable.rows.add(
                        pid,
                        faker.hacker.verb() + ' ' + faker.hacker.noun(),
                        faker.helpers.arrayElement(['todo', 'in-progress', 'review', 'done']),
                        faker.helpers.arrayElement(['low', 'medium', 'high']),
                        faker.date.past(),
                        faker.date.future()
                    );
                }
            }
            const taskReq = new sql.Request(pool);
            await taskReq.bulk(tasksTable);
            console.log(`   Processed tasks for projects ${i} to ${i + chunk.length}`);
        }
        console.log('✅ Tasks seeded.');

        // 6. Generate Status Reports
        console.log(`🔹 Generating Status Reports...`);
        for (let i = 0; i < projectIds.length; i += BATCH_SIZE) {
            const chunk = projectIds.slice(i, i + BATCH_SIZE);
            const reportsTable = new sql.Table('StatusReports');
            reportsTable.create = false;
            reportsTable.columns.add('projectId', sql.Int, { nullable: false });
            reportsTable.columns.add('version', sql.Int, { nullable: false });
            reportsTable.columns.add('reportData', sql.NVarChar(sql.MAX), { nullable: true });
            reportsTable.columns.add('createdBy', sql.NVarChar(100), { nullable: true });

            for (const pid of chunk) {
                const reportCount = faker.number.int({ min: REPORT_VERSIONS_MIN, max: REPORT_VERSIONS_MAX });
                for (let v = 1; v <= reportCount; v++) {
                    const reportData = JSON.stringify({
                        summary: faker.lorem.paragraph(),
                        overallStatus: faker.helpers.arrayElement(['green', 'yellow', 'red']),
                        reportDate: faker.date.recent(),
                        purpose: faker.lorem.sentence(),
                        executiveSummary: faker.lorem.paragraph(),

                        risks: Array.from({ length: faker.number.int({ min: 2, max: 4 }) }, () => ({
                            description: faker.lorem.sentence(),
                            impact: faker.lorem.sentence(),
                            priority: faker.helpers.arrayElement(['low', 'medium', 'high']),
                            mitigation: faker.lorem.sentence(),
                            status: faker.helpers.arrayElement(['open', 'closed']),
                            closedDate: faker.date.recent()
                        })),

                        milestones: Array.from({ length: faker.number.int({ min: 2, max: 5 }) }, () => ({
                            name: faker.company.buzzPhrase(),
                            date: faker.date.future(),
                            status: faker.helpers.arrayElement(['pending', 'in-progress', 'complete'])
                        })),

                        workstreams: Array.from({ length: faker.number.int({ min: 4, max: 8 }) }, () => ({
                            name: faker.commerce.department(),
                            progressLastPeriod: faker.lorem.sentence(),
                            workAhead: faker.lorem.sentence(),
                            barriers: faker.lorem.sentence(),
                            status: faker.helpers.arrayElement(['green', 'yellow', 'red'])
                        })),

                        decisions: Array.from({ length: faker.number.int({ min: 2, max: 4 }) }, () => ({
                            description: faker.lorem.sentence(),
                            priority: faker.helpers.arrayElement(['low', 'medium', 'high']),
                            status: faker.helpers.arrayElement(['pending', 'approved', 'rejected']),
                            decisionStatement: faker.lorem.sentence(),
                            decisionDate: faker.date.recent()
                        }))
                    });
                    reportsTable.rows.add(
                        pid,
                        v,
                        reportData,
                        faker.internet.email()
                    );
                }
            }
            const reportReq = new sql.Request(pool);
            await reportReq.bulk(reportsTable);
            console.log(`   Processed reports for projects ${i} to ${i + chunk.length}`);
        }
        console.log('✅ Status Reports seeded.');

        console.log('🎉 POPULATION COMPLETE!');
        process.exit(0);

    } catch (err) {
        console.error('❌ Seeding Failed:', err);
        process.exit(1);
    }
}

seedPerformanceData();
