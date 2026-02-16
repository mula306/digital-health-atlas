import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { apiRequest } from '../authConfig';

const DataContext = createContext();

// Dynamically detect API URL - works from localhost or network
const API_BASE = `http://${window.location.hostname}:3001/api`;

// Helper: Calculate project completion percentage
function calcProjectCompletion(project) {
    // Use server-computed completion unless full details have been loaded
    // (The initial project list only includes active tasks, not all tasks)
    if (!project._detailsLoaded) return project.completion || 0;
    if (!project.tasks || project.tasks.length === 0) return 0;
    const doneCount = project.tasks.filter(t => t.status === 'done').length;
    return Math.round((doneCount / project.tasks.length) * 100);
}

export function DataProvider({ children }) {
    const [goals, setGoals] = useState([]);
    const [projects, setProjects] = useState([]);
    const [projectsPagination, setProjectsPagination] = useState({
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
        hasMore: false
    });
    const [intakeForms, setIntakeForms] = useState([]);
    const [intakeSubmissions, setIntakeSubmissions] = useState([]);
    const [tagGroups, setTagGroups] = useState([]);
    const [permissions, setPermissions] = useState([]); // Dynamic Role Permissions
    const { instance } = useMsal();
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);

    // Helper: Authenticated fetch wrapper
    const authFetch = useCallback(async (url, options = {}) => {
        const headers = new Headers(options.headers || {});

        // standard headers
        if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
            headers.set('Content-Type', 'application/json');
        }

        try {
            const account = instance.getActiveAccount();
            if (account) {
                const response = await instance.acquireTokenSilent({
                    ...apiRequest,
                    account: account
                });
                headers.set('Authorization', `Bearer ${response.accessToken}`);
            }
        } catch (error) {
            console.error('Token acquisition failed', error);
            // Fallback: Proceed without token (backend might reject) or redirect to login
        }

        const config = {
            ...options,
            headers: headers
        };

        return fetch(url, config);
    }, [instance]);

    // Load more projects (pagination)
    const loadMoreProjects = useCallback(async () => {
        if (!projectsPagination.hasMore || loadingMore) return;

        setLoadingMore(true);
        try {
            const nextPage = projectsPagination.page + 1;
            const res = await authFetch(`${API_BASE}/projects?page=${nextPage}&limit=${projectsPagination.limit}`);
            if (!res.ok) throw new Error('Failed to fetch more projects');

            const data = await res.json();
            setProjects(prev => [...prev, ...data.projects]);
            setProjectsPagination(data.pagination);
        } catch (err) {
            console.error('Error loading more projects:', err);
        } finally {
            setLoadingMore(false);
        }
    }, [projectsPagination, loadingMore, authFetch]);

    // Fetch all data on mount
    useEffect(() => {
        async function fetchData() {
            try {
                console.log("DataContext: Starting data fetch...");
                setLoading(true);
                // We need to wait for MSAL to be ready/authenticated
                // Use authFetch for these too
                console.log("DataContext: Fetching critical data (Permissions, Goals, Projects)...");

                // 1. Fetch Critical Data
                const [permsRes, goalsRes, projectsRes] = await Promise.all([
                    authFetch(`${API_BASE}/admin/permissions`),
                    authFetch(`${API_BASE}/goals`),
                    authFetch(`${API_BASE}/projects?page=1&limit=50`)
                ]);

                // Process Critical Data
                if (permsRes.ok) {
                    setPermissions(await permsRes.json());
                } else {
                    console.warn("DataContext: Failed to load permissions", permsRes.status);
                    if (permsRes.status === 403) setPermissions([]);
                }

                if (goalsRes.ok) {
                    setGoals(await goalsRes.json());
                } else {
                    if (goalsRes.status === 403) {
                        console.info("DataContext: User does not have access to goals (403). Using empty list.");
                        setGoals([]);
                    } else {
                        throw new Error(`Failed to load goals: ${goalsRes.status}`);
                    }
                }

                if (projectsRes.ok) {
                    const projectsData = await projectsRes.json();
                    setProjects(projectsData.projects || projectsData); // Support both formats
                    if (projectsData.pagination) {
                        setProjectsPagination(projectsData.pagination);
                    }
                } else {
                    if (projectsRes.status === 403) {
                        console.info("DataContext: User does not have access to projects (403). Using empty list.");
                        setProjects([]);
                        setProjectsPagination({ page: 1, limit: 50, total: 0, totalPages: 0, hasMore: false });
                    } else {
                        throw new Error(`Failed to load projects: ${projectsRes.status}`);
                    }
                }

                console.log("DataContext: Critical data loaded. Unblocking render.");
                setLoading(false); // UI can render now

                // 2. Fetch Secondary Data (Intake) - Background
                console.log("DataContext: Fetching secondary data (Intake) in background...");
                try {
                    const [formsRes, subsRes, mySubsRes, tagsRes] = await Promise.all([
                        authFetch(`${API_BASE}/intake/forms`),
                        authFetch(`${API_BASE}/intake/submissions`),
                        authFetch(`${API_BASE}/intake/my-submissions`),
                        authFetch(`${API_BASE}/tags`)
                    ]);

                    if (formsRes.ok) setIntakeForms(await formsRes.json());
                    if (subsRes.ok) setIntakeSubmissions(await subsRes.json());
                    if (mySubsRes.ok) setMySubmissions(await mySubsRes.json());
                    if (tagsRes.ok) setTagGroups(await tagsRes.json());
                } catch (bgErr) {
                    console.warn("DataContext: Background fetch failed", bgErr);
                }

                setError(null);
            } catch (err) {
                console.error('Error fetching data:', err);
                setError(err.message);
                setLoading(false);
            }
        }
        // Only fetch if authenticated (which DataContext is wrapped in, but good check)
        const account = instance.getActiveAccount();
        if (account) {
            console.log("DataContext: Authenticated user found, fetching data for:", account.username);
            fetchData();
        } else {
            console.log("DataContext: No active account found yet.");
        }
    }, [instance, authFetch]);


    const updatePermissionsBulk = useCallback(async (updates) => {
        try {
            const res = await authFetch(`${API_BASE}/admin/permissions/bulk`, {
                method: 'POST',
                body: JSON.stringify({ updates })
            });
            if (!res.ok) throw new Error('Failed to update permissions');

            // Update local state
            setPermissions(prev => {
                const newPerms = [...prev];
                updates.forEach(u => {
                    const idx = newPerms.findIndex(p => p.role === u.role && p.permission === u.permission);
                    if (idx >= 0) {
                        newPerms[idx] = { ...newPerms[idx], isAllowed: u.isAllowed };
                    } else {
                        newPerms.push({ role: u.role, permission: u.permission, isAllowed: u.isAllowed });
                    }
                });
                return newPerms;
            });
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    }, [authFetch]);

    // Derived: Projects with completion %
    const projectsWithCompletion = useMemo(() => {
        return projects.map(p => ({
            ...p,
            completion: calcProjectCompletion(p)
        }));
    }, [projects]);

    // Derived: Goals with progress calculated from linked projects AND child goals
    const goalsWithProgress = useMemo(() => {
        // console.log('Recalculating goal progress...', { goalsCount: goals.length, projectsCount: projectsWithCompletion.length });
        if (goals.length === 0) return [];

        // 1. Projects Lookup (O(P))
        const projectsByGoal = projectsWithCompletion.reduce((acc, p) => {
            if (p.goalId) {
                if (!acc[p.goalId]) acc[p.goalId] = [];
                acc[p.goalId].push(p);
            }
            return acc;
        }, {});

        // 2. Goal Hierarchy Lookup (O(G)) - Parent -> Children
        const goalChildrenMap = {};
        goals.forEach(g => {
            if (g.parentId) {
                if (!goalChildrenMap[g.parentId]) goalChildrenMap[g.parentId] = [];
                goalChildrenMap[g.parentId].push(g.id);
            }
        });

        // 3. Recursive Project Aggregation with Memoization
        const projectCache = {}; // Stores array of project objects for each goal (including descendants)

        const getGoalProjects = (goalId) => {
            if (projectCache[goalId] !== undefined) return projectCache[goalId];

            // Prevent infinite recursion loops
            projectCache[goalId] = []; // Temporary value

            // Start with direct projects
            let allProjects = projectsByGoal[goalId] || [];

            // Add projects from child goals
            const childGoalIds = goalChildrenMap[goalId] || [];
            childGoalIds.forEach(childId => {
                const childProjects = getGoalProjects(childId);
                allProjects = [...allProjects, ...childProjects];
            });

            projectCache[goalId] = allProjects;
            return allProjects;
        };

        return goals.map(goal => {
            // Get ALL projects (direct + descendant)
            const allProjects = getGoalProjects(goal.id);

            // Calculate progress based on ALL projects
            let progress = 0;
            if (allProjects.length > 0) {
                const totalCompletion = allProjects.reduce((sum, p) => sum + p.completion, 0);
                progress = Math.round(totalCompletion / allProjects.length);
            }

            // Get direct projects for the specific "Linked Project Count" display if needed, 
            // OR use total count if user wants to see total scope.
            // Usually "Linked Project Count" implies direct links, but progress implies total scope.
            // We'll return totalCount as a new property for clarity.

            const directProjects = projectsByGoal[goal.id] || [];

            return {
                ...goal,
                progress,
                linkedProjectCount: directProjects.length, // Keep explicit links count
                totalProjectCount: allProjects.length      // Total rolling up count
            };
        });
    }, [goals, projectsWithCompletion]);

    // Optimization: Pre-calculate user permissions into a Set for O(1) lookup
    const userPermissions = useMemo(() => {
        const account = instance.getActiveAccount();
        if (!account || !account.idTokenClaims || !account.idTokenClaims.roles) return new Set();

        const roles = account.idTokenClaims.roles;

        // Admin bypass - Efficiently handle admins
        if (roles.includes('Admin')) return 'ALL';

        const allowed = new Set();
        // Iterate permissions once to build the lookup set
        permissions.forEach(p => {
            // If user has the role and permission is allowed, add to set
            if (roles.includes(p.role) && p.isAllowed) {
                allowed.add(p.permission);
            }
        });
        return allowed;
    }, [instance, permissions]);

    // Optimized O(1) permission check
    const hasPermission = useCallback((permissionKey) => {
        if (userPermissions === 'ALL') return true;
        return userPermissions.has(permissionKey);
    }, [userPermissions]);

    // ==================== GOALS ====================

    const addGoal = useCallback(async (goal) => {
        try {
            const res = await authFetch(`${API_BASE}/goals`, {
                method: 'POST',
                body: JSON.stringify(goal)
            });
            const newGoal = await res.json();
            setGoals(prev => [...prev, newGoal]);
            return newGoal.id;
        } catch (err) {
            console.error('Error adding goal:', err);
        }
    }, [authFetch]);

    const updateGoal = useCallback(async (id, updates) => {
        try {
            await authFetch(`${API_BASE}/goals/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            setGoals(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g));
        } catch (err) {
            console.error('Error updating goal:', err);
        }
    }, [authFetch]);

    const deleteGoal = useCallback(async (id) => {
        try {
            await authFetch(`${API_BASE}/goals/${id}`, { method: 'DELETE' });
            setGoals(prev => prev.filter(g => g.id !== id));
        } catch (err) {
            console.error('Error deleting goal:', err);
        }
    }, [authFetch]);

    // ==================== KPIs ====================

    const addKpi = useCallback(async (goalId, kpi) => {
        try {
            const res = await authFetch(`${API_BASE}/goals/${goalId}/kpis`, {
                method: 'POST',
                body: JSON.stringify(kpi)
            });
            const newKpi = await res.json();
            setGoals(prev => prev.map(g => {
                if (g.id !== goalId) return g;
                return { ...g, kpis: [...(g.kpis || []), newKpi] };
            }));
        } catch (err) {
            console.error('Error adding KPI:', err);
        }
    }, [authFetch]);

    const updateKpi = useCallback(async (goalId, kpiId, updates) => {
        try {
            await authFetch(`${API_BASE}/kpis/${kpiId}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            setGoals(prev => prev.map(g => {
                if (g.id !== goalId) return g;
                return {
                    ...g,
                    kpis: (g.kpis || []).map(k => k.id === kpiId ? { ...k, ...updates } : k)
                };
            }));
        } catch (err) {
            console.error('Error updating KPI:', err);
        }
    }, [authFetch]);

    const deleteKpi = useCallback(async (goalId, kpiId) => {
        try {
            await authFetch(`${API_BASE}/kpis/${kpiId}`, { method: 'DELETE' });
            setGoals(prev => prev.map(g => {
                if (g.id !== goalId) return g;
                return { ...g, kpis: (g.kpis || []).filter(k => k.id !== kpiId) };
            }));
        } catch (err) {
            console.error('Error deleting KPI:', err);
        }
    }, [authFetch]);

    // ==================== PROJECTS ====================

    // Fetch full project details (tasks, reports, etc.) on demand
    const loadProjectDetails = useCallback(async (projectId) => {
        try {
            setLoading(true);
            const res = await authFetch(`${API_BASE}/projects/${projectId}`);
            if (!res.ok) throw new Error('Failed to load project details');

            const detailedProject = await res.json();

            if (detailedProject) {
                // Update local state with the detailed version
                setProjects(prev => prev.map(p =>
                    p.id === projectId ? { ...p, ...detailedProject, _detailsLoaded: true } : p
                ));
            }

            return detailedProject;
        } catch (err) {
            console.error('Error loading project details:', err);
            return null;
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    const addProject = useCallback(async (project) => {
        try {
            const res = await authFetch(`${API_BASE}/projects`, {
                method: 'POST',
                body: JSON.stringify(project)
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to create project (HTTP ${res.status})`);
            }
            const newProject = await res.json();
            setProjects(prev => [...prev, newProject]);
            return newProject.id;
        } catch (err) {
            console.error('Error adding project:', err);
            throw err;
        }
    }, [authFetch]);

    const updateProject = useCallback(async (id, updates) => {
        try {
            await authFetch(`${API_BASE}/projects/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
        } catch (err) {
            console.error('Error updating project:', err);
        }
    }, [authFetch]);

    const deleteProject = useCallback(async (id) => {
        try {
            await authFetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
            setProjects(prev => prev.filter(p => p.id !== id));
        } catch (err) {
            console.error('Error deleting project:', err);
        }
    }, [authFetch]);

    // ==================== TASKS ====================

    const addTask = useCallback(async (projectId, task) => {
        try {
            const res = await authFetch(`${API_BASE}/projects/${projectId}/tasks`, {
                method: 'POST',
                body: JSON.stringify(task)
            });
            const newTask = await res.json();
            setProjects(prev => prev.map(p => {
                if (String(p.id) !== String(projectId)) return p;
                // If tasks array exists, update it. If not, just update count/metadata if needed
                if (!p.tasks) return { ...p, taskCount: (p.taskCount || 0) + 1 };

                return { ...p, tasks: [...p.tasks, newTask], taskCount: p.tasks.length + 1 };
            }));
        } catch (err) {
            console.error('Error adding task:', err);
        }
    }, [authFetch]);

    const updateTask = useCallback(async (projectId, taskId, updates) => {
        try {
            await authFetch(`${API_BASE}/tasks/${taskId}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            setProjects(prev => prev.map(p => {
                if (String(p.id) !== String(projectId)) return p;
                if (!p.tasks) return p; // Tasks not loaded, nothing to update in state

                return {
                    ...p,
                    tasks: p.tasks.map(t => String(t.id) === String(taskId) ? { ...t, ...updates } : t)
                };
            }));
        } catch (err) {
            console.error('Error updating task:', err);
        }
    }, [authFetch]);

    const moveTask = useCallback(async (projectId, taskId, newStatus) => {
        await updateTask(projectId, taskId, { status: newStatus });
    }, [updateTask]);

    const deleteTask = useCallback(async (projectId, taskId) => {
        try {
            await authFetch(`${API_BASE}/tasks/${taskId}`, { method: 'DELETE' });
            setProjects(prev => prev.map(p => {
                if (String(p.id) !== String(projectId)) return p;
                if (!p.tasks) return { ...p, taskCount: Math.max(0, (p.taskCount || 1) - 1) };

                return {
                    ...p,
                    tasks: p.tasks.filter(t => String(t.id) !== String(taskId)),
                    taskCount: p.tasks.length - 1
                };
            }));
        } catch (err) {
            console.error('Error deleting task:', err);
        }
    }, [authFetch]);

    // ==================== STATUS REPORTS ====================

    const addStatusReport = useCallback(async (projectId, reportData) => {
        try {
            const res = await authFetch(`${API_BASE}/projects/${projectId}/reports`, {
                method: 'POST',
                body: JSON.stringify({ reportData, createdBy: reportData.createdBy })
            });
            const newReport = await res.json();
            setProjects(prev => prev.map(p => {
                if (p.id !== projectId) return p;
                return {
                    ...p,
                    statusReports: [...(p.statusReports || []), newReport],
                    latestReport: newReport,
                    reportCount: (p.reportCount || 0) + 1
                };
            }));
        } catch (err) {
            console.error('Error adding status report:', err);
        }
    }, [authFetch]);

    const getLatestStatusReport = useCallback((projectId) => {
        const project = projects.find(p => p.id === projectId);
        if (!project) return null;
        // optimization: check pre-fetched latestReport
        if (project.latestReport) return project.latestReport;
        // fallback: check statusReports array if loaded
        if (project.statusReports?.length) return project.statusReports[project.statusReports.length - 1];
        return null;
    }, [projects]);

    const restoreStatusReport = useCallback(async (projectId, reportId, author) => {
        const project = projects.find(p => p.id === projectId);
        const reportToRestore = project?.statusReports?.find(r => r.id === reportId);
        if (!reportToRestore) return;

        try {
            const res = await authFetch(`${API_BASE}/projects/${projectId}/reports`, {
                method: 'POST',
                body: JSON.stringify({
                    reportData: reportToRestore,
                    createdBy: author,
                    restoredFrom: reportToRestore.version
                })
            });
            const newReport = await res.json();
            setProjects(prev => prev.map(p => {
                if (p.id !== projectId) return p;
                return { ...p, statusReports: [...(p.statusReports || []), newReport] };
            }));
        } catch (err) {
            console.error('Error restoring status report:', err);
        }
    }, [projects, authFetch]);

    // ==================== INTAKE FORMS ====================

    const addIntakeForm = useCallback(async (form) => {
        try {
            const res = await authFetch(`${API_BASE}/intake/forms`, {
                method: 'POST',
                body: JSON.stringify(form)
            });
            const newForm = await res.json();
            setIntakeForms(prev => [...prev, newForm]);
            return newForm.id;
        } catch (err) {
            console.error('Error adding intake form:', err);
        }
    }, [authFetch]);

    const updateIntakeForm = useCallback(async (id, updates) => {
        try {
            await authFetch(`${API_BASE}/intake/forms/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            setIntakeForms(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
        } catch (err) {
            console.error('Error updating intake form:', err);
        }
    }, [authFetch]);

    const deleteIntakeForm = useCallback(async (id) => {
        try {
            await authFetch(`${API_BASE}/intake/forms/${id}`, { method: 'DELETE' });
            setIntakeForms(prev => prev.filter(f => f.id !== id));
        } catch (err) {
            console.error('Error deleting intake form:', err);
        }
    }, [authFetch]);

    // ==================== INTAKE SUBMISSIONS ====================

    const [mySubmissions, setMySubmissions] = useState([]);

    // ... (existing code)

    // Helper: Authenticated fetch wrapper
    // ...



    // ...

    // ==================== INTAKE SUBMISSIONS ====================

    const addIntakeSubmission = useCallback(async (submission) => {
        try {
            const res = await authFetch(`${API_BASE}/intake/submissions`, {
                method: 'POST',
                body: JSON.stringify(submission)
            });
            const newSubmission = await res.json();

            // Update both lists
            setIntakeSubmissions(prev => [...prev, newSubmission]);
            setMySubmissions(prev => [newSubmission, ...prev]); // Add to top of my list

            return newSubmission.id;
        } catch (err) {
            console.error('Error adding submission:', err);
        }
    }, [authFetch]);

    const updateIntakeSubmission = useCallback(async (id, updates) => {
        try {
            await authFetch(`${API_BASE}/intake/submissions/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });

            // Update both lists
            setIntakeSubmissions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
            setMySubmissions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));

        } catch (err) {
            console.error('Error updating submission:', err);
        }
    }, [authFetch]);

    const addConversationMessage = useCallback(async (submissionId, message, senderType) => {
        try {
            const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/message`, {
                method: 'POST',
                body: JSON.stringify({ message })
            });

            if (!res.ok) throw new Error('Failed to send message');

            const { conversation } = await res.json();

            const newStatus = senderType === 'admin' ? 'awaiting-response' : 'pending';

            // Optimistic update or refetch - here taking the returned conversation
            const updateLocal = (prev) => prev.map(s => {
                if (s.id !== submissionId) return s;
                return {
                    ...s,
                    status: newStatus,
                    conversation: conversation
                };
            });

            setIntakeSubmissions(prev => updateLocal(prev));
            setMySubmissions(prev => updateLocal(prev));

        } catch (err) {
            console.error('Error sending message:', err);
            throw err;
        }
    }, [authFetch]);

    const markConversationRead = useCallback(async (submissionId) => {
        const submission = intakeSubmissions.find(s => s.id === submissionId);
        if (!submission?.conversation) return;

        const updatedConversation = submission.conversation.map(msg => ({
            ...msg,
            read: true
        }));

        await updateIntakeSubmission(submissionId, {
            conversation: updatedConversation
        });
    }, [intakeSubmissions, updateIntakeSubmission]);

    // Legacy support: migrate old infoRequests to conversation format
    const migrateInfoRequestsToConversation = useCallback((submission) => {
        if (!submission.infoRequests || submission.conversation) return submission;

        const conversation = [];
        submission.infoRequests.forEach(ir => {
            // Add admin question
            conversation.push({
                id: `msg-${ir.id}-q`,
                type: 'admin',
                message: ir.question,
                timestamp: ir.askedAt,
                read: true
            });
            // Add requester response if exists
            if (ir.response) {
                conversation.push({
                    id: `msg-${ir.id}-r`,
                    type: 'requester',
                    message: ir.response,
                    timestamp: ir.respondedAt,
                    read: true
                });
            }
        });

        return { ...submission, conversation };
    }, []);



    const convertSubmissionToProject = useCallback(async (submissionId, projectData) => {
        const projectId = await addProject(projectData);
        if (!projectId) {
            throw new Error('Project creation failed — no project ID returned');
        }
        await updateIntakeSubmission(submissionId, {
            status: 'approved',
            convertedProjectId: projectId
        });
        return projectId;
    }, [addProject, updateIntakeSubmission]);

    // ==================== TAG MANAGEMENT ====================

    const refreshTags = useCallback(async () => {
        try {
            const res = await authFetch(`${API_BASE}/tags`);
            if (res.ok) setTagGroups(await res.json());
        } catch (err) {
            console.error('Failed to refresh tags:', err);
        }
    }, [authFetch]);

    const addTagGroup = useCallback(async (groupData) => {
        const res = await authFetch(`${API_BASE}/admin/tag-groups`, {
            method: 'POST',
            body: JSON.stringify(groupData)
        });
        if (!res.ok) throw new Error('Failed to create tag group');
        const newGroup = await res.json();
        setTagGroups(prev => [...prev, newGroup]);
        return newGroup;
    }, [authFetch]);

    const updateTagGroup = useCallback(async (id, groupData) => {
        const res = await authFetch(`${API_BASE}/admin/tag-groups/${id}`, {
            method: 'PUT',
            body: JSON.stringify(groupData)
        });
        if (!res.ok) throw new Error('Failed to update tag group');
        await refreshTags();
    }, [authFetch, refreshTags]);

    const deleteTagGroup = useCallback(async (id) => {
        const res = await authFetch(`${API_BASE}/admin/tag-groups/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete tag group');
        setTagGroups(prev => prev.filter(g => g.id !== id));
    }, [authFetch]);

    const addTag = useCallback(async (tagData) => {
        const res = await authFetch(`${API_BASE}/admin/tags`, {
            method: 'POST',
            body: JSON.stringify(tagData)
        });
        if (!res.ok) throw new Error('Failed to create tag');
        const newTag = await res.json();
        setTagGroups(prev => prev.map(g =>
            g.id === tagData.groupId ? { ...g, tags: [...g.tags, newTag] } : g
        ));
        return newTag;
    }, [authFetch]);

    const updateTag = useCallback(async (id, tagData) => {
        const res = await authFetch(`${API_BASE}/admin/tags/${id}`, {
            method: 'PUT',
            body: JSON.stringify(tagData)
        });
        if (!res.ok) throw new Error('Failed to update tag');
        await refreshTags();
    }, [authFetch, refreshTags]);

    const deleteTag = useCallback(async (id) => {
        const res = await authFetch(`${API_BASE}/admin/tags/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete tag');
        setTagGroups(prev => prev.map(g => ({
            ...g,
            tags: g.tags.filter(t => t.id !== id)
        })));
    }, [authFetch]);

    const updateProjectTags = useCallback(async (projectId, tags) => {
        const res = await authFetch(`${API_BASE}/projects/${projectId}/tags`, {
            method: 'PUT',
            body: JSON.stringify({ tags })
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to update project tags');
        }
        // Optimistically update the project's tags in state
        setProjects(prev => prev.map(p => {
            if (p.id === projectId) {
                // We need to resolve tag names from tagGroups
                const allTags = tagGroups.flatMap(g => g.tags);
                const resolvedTags = tags.map(t => {
                    const tag = allTags.find(at => at.id === t.tagId);
                    return tag ? {
                        tagId: t.tagId,
                        name: tag.name,
                        slug: tag.slug,
                        color: tag.color,
                        groupId: tag.groupId,
                        isPrimary: t.isPrimary,
                        tagStatus: tag.status
                    } : null;
                }).filter(Boolean);
                return { ...p, tags: resolvedTags };
            }
            return p;
        }));
        return true;
    }, [authFetch, tagGroups]);

    // Show loading state
    if (loading) {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                color: 'var(--text-secondary)'
            }}>
                Loading data from database...
            </div>
        );
    }

    // Show error state
    if (error) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                gap: '1rem',
                color: 'var(--text-secondary)'
            }}>
                <h2 style={{ color: '#ef4444' }}>Connection Error</h2>
                <p><strong>Error:</strong> {error}</p>
                <div style={{ fontSize: '0.9rem', color: '#666' }}>
                    <p>Possible causes:</p>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        <li>1. Backend server is not running on port 3001</li>
                        <li>2. Authentication failed (401 Unauthorized)</li>
                        <li>3. Network/CORS connectivity issue</li>
                    </ul>
                </div>
                <p>Make sure the API server is running on port 3001</p>
                <code>cd server && npm start</code>
            </div>
        );
    }

    return (
        <DataContext.Provider value={{
            goals: goalsWithProgress,
            addGoal, updateGoal, deleteGoal,
            addKpi, updateKpi, deleteKpi,
            projects: projectsWithCompletion,
            projectsPagination,
            loadMoreProjects,
            loading,
            loadingMore,
            moveTask, addTask, addProject, updateProject, deleteProject, loadProjectDetails,
            updateTask, deleteTask,
            intakeForms, addIntakeForm, updateIntakeForm, deleteIntakeForm,
            intakeSubmissions, mySubmissions, addIntakeSubmission, updateIntakeSubmission,
            addConversationMessage, markConversationRead, migrateInfoRequestsToConversation, convertSubmissionToProject,
            addStatusReport, getLatestStatusReport, restoreStatusReport,
            authFetch,

            permissions, hasPermission, updatePermissionsBulk,

            tagGroups, addTagGroup, updateTagGroup, deleteTagGroup,
            addTag, updateTag, deleteTag, updateProjectTags
        }}>
            {children}
        </DataContext.Provider>
    );
}

export const useData = () => useContext(DataContext);
