import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError, BrowserAuthError } from '@azure/msal-browser';
import { apiRequest } from '../authConfig';
import { fetchWithAuth, API_BASE } from '../apiClient';

const DataContext = createContext();

// Helper: Calculate project completion percentage
function calcProjectCompletion(project) {
    // ... (unchanged)
    if (!project._detailsLoaded) return project.completion || 0;
    if (!project.tasks || project.tasks.length === 0) return 0;
    const doneCount = project.tasks.filter(t => t.status === 'done').length;
    return Math.round((doneCount / project.tasks.length) * 100);
}

export function DataProvider({ children }) {
    // ... State definitions (unchanged)
    const [goals, setGoals] = useState([]);
    const [projects, setProjects] = useState([]);
    const [projectsPagination, setProjectsPagination] = useState({
        page: 1, limit: 50, total: 0, totalPages: 0, hasMore: false
    });
    const [intakeForms, setIntakeForms] = useState([]);
    const [intakeSubmissions, setIntakeSubmissions] = useState([]);
    const [tagGroups, setTagGroups] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [permissionCatalog, setPermissionCatalog] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const { instance } = useMsal();
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);
    const [projectsError, setProjectsError] = useState(null);
    const isTestAuthMock = String(import.meta.env.VITE_TEST_AUTH_MODE || '').toLowerCase() === 'mock';


    // Helper: Authenticated fetch wrapper using centralized client
    const authFetch = useCallback(async (url, options = {}) => {
        if (isTestAuthMock) {
            return fetchWithAuth(url, null, options);
        }
        let token = null;
        try {
            const account = instance.getActiveAccount();
            if (account) {
                const response = await instance.acquireTokenSilent({
                    ...apiRequest,
                    account: account
                });
                token = response.accessToken;
            }
        } catch (error) {
            console.warn('Silent token acquisition failed, attempting interactive fallback...', error);

            // Fallback to interaction if silent fails
            // This handles expired sessions, password changes, or MFA requirements
            if (error instanceof InteractionRequiredAuthError ||
                error instanceof BrowserAuthError ||
                error.name === "BrowserAuthError") { // Checking name is safer for instance checks across bundles
                try {
                    // Use redirect instead of popup to avoid blockers
                    console.log("Redirecting to login...");
                    await instance.acquireTokenRedirect(apiRequest);
                    // Execution stops here as page redirects
                    return;
                } catch (redirectError) {
                    console.error('Redirect token acquisition failed', redirectError);
                }
            } else {
                console.error('Non-interactive token error:', error);
            }
        }

        return fetchWithAuth(url, token, options);
    }, [instance, isTestAuthMock]);

    const getApiErrorMessage = useCallback(async (response, fallbackMessage) => {
        const fallback = fallbackMessage || `Request failed (HTTP ${response?.status || 'unknown'})`;
        if (!response) return fallback;
        const payload = await response.json().catch(() => null);
        if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
        if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
        return fallback;
    }, []);

    // Load more projects (pagination)
    const loadMoreProjects = useCallback(async () => {
        if (!projectsPagination.hasMore || loadingMore) return;

        setLoadingMore(true);
        try {
            const nextPage = projectsPagination.page + 1;
            const res = await authFetch(`${API_BASE}/projects?page=${nextPage}&limit=${projectsPagination.limit}`);
            // fetchWithAuth throws on error, so res is OK here
            const data = await res.json();
            setProjects(prev => [...prev, ...data.projects]);
            setProjectsPagination(data.pagination);
        } catch (err) {
            console.error('Error loading more projects:', err);
        } finally {
            setLoadingMore(false);
        }
    }, [projectsPagination, loadingMore, authFetch]);

    // Fetch Exec Summary (All Projects)
    const fetchExecSummaryProjects = useCallback(async () => {
        const res = await authFetch(`${API_BASE}/projects/exec-summary`);
        return await res.json();
    }, [authFetch]);

    // Fetch all data on mount (Permission-Aware)
    useEffect(() => {
        async function fetchData() {
            try {
                console.log("DataContext: Starting data fetch...");
                setLoading(true);
                setProjectsError(null);

                // 1. Fetch permissions + user profile first
                let currentPermissions = [];
                let userProfile = null;
                const account = instance.getActiveAccount();

                const [permsResult, userResult, catalogResult] = await Promise.allSettled([
                    authFetch(`${API_BASE}/admin/permissions`),
                    authFetch(`${API_BASE}/users/me`),
                    authFetch(`${API_BASE}/admin/permission-catalog`)
                ]);

                try {
                    if (permsResult.status === 'fulfilled') {
                        currentPermissions = await permsResult.value.json();
                        setPermissions(currentPermissions);
                    } else {
                        console.warn("DataContext: Failed to load permissions", permsResult.reason);
                    }
                    if (userResult.status === 'fulfilled') {
                        userProfile = await userResult.value.json();
                        setCurrentUser(userProfile);
                    } else {
                        console.warn("DataContext: Failed to load user profile", userResult.reason);
                    }
                    if (catalogResult && catalogResult.status === 'fulfilled') {
                        const catalog = await catalogResult.value.json();
                        setPermissionCatalog(catalog || null);
                    } else if (catalogResult?.status === 'rejected') {
                        console.warn("DataContext: Failed to load permission catalog", catalogResult.reason);
                    }
                } catch (err) {
                    console.warn("DataContext: Failed to parse permissions or user payload", err);
                }

                // Helper to check permission against the JUST loaded permissions
                // (State update hasn't propagated yet)
                const tokenRoles = Array.isArray(account?.idTokenClaims?.roles) ? account.idTokenClaims.roles : [];
                const roles = Array.isArray(userProfile?.roles) && userProfile.roles.length > 0
                    ? userProfile.roles
                    : tokenRoles;
                const checkPerm = (permKey) => {
                    if (roles.includes('Admin')) return true;
                    // Check if any user role has the permission allowed
                    return currentPermissions.some(p => roles.includes(p.role) && p.permission === permKey && p.isAllowed);
                };

                // 2. Fetch core data
                const [goalsResult, projectsResult] = await Promise.allSettled([
                    authFetch(`${API_BASE}/goals`),
                    authFetch(`${API_BASE}/projects?page=1&limit=50`)
                ]);

                if (goalsResult.status === 'fulfilled') {
                    setGoals(await goalsResult.value.json());
                } else {
                    if (goalsResult.reason?.status === 403) {
                        setGoals([]);
                    } else {
                        console.error("Failed to load goals", goalsResult.reason);
                    }
                }

                if (projectsResult.status === 'fulfilled') {
                    const projectsData = await projectsResult.value.json();
                    setProjects(projectsData.projects || projectsData);
                    if (projectsData.pagination) setProjectsPagination(projectsData.pagination);
                    setProjectsError(null);
                } else {
                    if (projectsResult.reason?.status === 403) {
                        setProjects([]);
                        setProjectsError(projectsResult.reason?.message || 'You do not have access to any projects.');
                    } else {
                        console.error("Failed to load projects", projectsResult.reason);
                        setProjects([]);
                        setProjectsError(projectsResult.reason?.message || 'Failed to load projects.');
                    }
                }

                console.log("DataContext: Critical data loaded. Unblocking render.");
                setLoading(false);

                // 3. Fetch Secondary Data (Intake, Tags) - Background
                const secondaryPromises = [];

                // Tags (generally public/authenticated)
                secondaryPromises.push(authFetch(`${API_BASE}/tags`).then(r => r.json()).then(setTagGroups).catch(e => console.warn('Tags fetch failed', e)));

                // Intake Forms (needed for submit, triage labels, and governance queue context)
                if (
                    checkPerm('can_view_intake') ||
                    checkPerm('can_manage_intake') ||
                    checkPerm('can_manage_intake_forms') ||
                    checkPerm('can_view_incoming_requests') ||
                    checkPerm('can_view_governance_queue')
                ) {
                    secondaryPromises.push(authFetch(`${API_BASE}/intake/forms`).then(r => r.json()).then(setIntakeForms).catch(e => console.warn('Intake forms failed', e)));
                }

                // Submissions - ONLY if allowed
                // 'can_view_incoming_requests' -> All submissions
                if (checkPerm('can_view_incoming_requests')) {
                    secondaryPromises.push(authFetch(`${API_BASE}/intake/submissions`).then(r => r.json()).then(setIntakeSubmissions).catch(e => console.warn('Submissions fetch failed', e)));
                }

                // My Submissions - Always allowed for authenticated users
                if (account || isTestAuthMock) {
                    secondaryPromises.push(authFetch(`${API_BASE}/intake/my-submissions`).then(r => r.json()).then(setMySubmissions).catch(e => console.warn('My Submissions failed', e)));
                }

                await Promise.allSettled(secondaryPromises);

                setError(null);
            } catch (err) {
                console.error('Error fetching data:', err);
                setError(err.message);
                setLoading(false);
            }
        }

        const account = instance.getActiveAccount();
        if (account || isTestAuthMock) {
            fetchData();
        } else {
            setLoading(false);
        }
    }, [instance, authFetch, isTestAuthMock]);


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

    // Derived: Goals with progress calculated from server-provided stats (recursive aggregation)
    const goalsWithProgress = useMemo(() => {
        if (goals.length === 0) return [];

        // 1. Goal Hierarchy Lookup (O(G)) - Parent -> Children
        const goalChildrenMap = {};
        goals.forEach(g => {
            if (g.parentId) {
                if (!goalChildrenMap[g.parentId]) goalChildrenMap[g.parentId] = [];
                goalChildrenMap[g.parentId].push(g.id);
            }
        });

        // 2. Recursive Stats Aggregation with Memoization
        const statsCache = {}; // Stores { count, sum, kpiCount } for each goal (including descendants)

        const getGoalStats = (goalId) => {
            if (statsCache[goalId] !== undefined) return statsCache[goalId];

            // Prevent infinite recursion
            statsCache[goalId] = { count: 0, sum: 0, kpiCount: 0 };

            const goal = goals.find(g => g.id === goalId);
            if (!goal) return { count: 0, sum: 0, kpiCount: 0 };

            // Start with direct/server stats
            let totalCount = goal.directProjectCount || 0;
            let totalSum = goal.directCompletionSum || 0;
            let totalKpiCount = (goal.kpis ? goal.kpis.length : 0);

            // Add stats from child goals
            const childGoalIds = goalChildrenMap[goalId] || [];
            childGoalIds.forEach(childId => {
                const childStats = getGoalStats(childId);
                totalCount += childStats.count;
                totalSum += childStats.sum;
                totalKpiCount += childStats.kpiCount;
            });

            const result = { count: totalCount, sum: totalSum, kpiCount: totalKpiCount };
            statsCache[goalId] = result;
            return result;
        };

        return goals.map(goal => {
            // Get aggregated stats
            const stats = getGoalStats(goal.id);

            // Calculate progress
            let progress = 0;
            if (stats.count > 0) {
                progress = Math.round(stats.sum / stats.count);
            }

            return {
                ...goal,
                progress,
                linkedProjectCount: goal.directProjectCount || 0, // Direct only
                totalProjectCount: stats.count,                   // Rolling up count
                totalKpiCount: stats.kpiCount                     // Rolling up KPI count
            };
        });
    }, [goals]);

    const effectiveRoles = useMemo(() => {
        const account = instance.getActiveAccount();
        const tokenRoles = Array.isArray(account?.idTokenClaims?.roles) ? account.idTokenClaims.roles : [];
        const profileRoles = Array.isArray(currentUser?.roles) ? currentUser.roles : [];
        const sourceRoles = profileRoles.length > 0 ? profileRoles : tokenRoles;
        return [...new Set(sourceRoles
            .filter(role => typeof role === 'string')
            .map(role => role.trim())
            .filter(Boolean))];
    }, [instance, currentUser]);

    // Optimization: Pre-calculate user permissions into a Set for O(1) lookup
    const userPermissions = useMemo(() => {
        if (effectiveRoles.length === 0) return new Set();

        // Admin bypass - Efficiently handle admins
        if (effectiveRoles.includes('Admin')) return 'ALL';

        const allowed = new Set();
        // Iterate permissions once to build the lookup set
        permissions.forEach(p => {
            // If user has the role and permission is allowed, add to set
            if (effectiveRoles.includes(p.role) && p.isAllowed) {
                allowed.add(p.permission);
            }
        });
        return allowed;
    }, [effectiveRoles, permissions]);

    // Optimized O(1) permission check
    const hasPermission = useCallback((permissionKey) => {
        if (userPermissions === 'ALL') return true;
        return userPermissions.has(permissionKey);
    }, [userPermissions]);

    const hasRole = useCallback((role) => effectiveRoles.includes(role), [effectiveRoles]);

    const hasAnyRole = useCallback((roles = []) => {
        if (!Array.isArray(roles) || roles.length === 0) return false;
        return roles.some(role => effectiveRoles.includes(role));
    }, [effectiveRoles]);

    // ==================== GOALS ====================

    const addGoal = useCallback(async (goal) => {
        try {
            const res = await authFetch(`${API_BASE}/goals`, {
                method: 'POST',
                body: JSON.stringify(goal)
            });
            if (!res.ok) {
                throw new Error(await getApiErrorMessage(res, 'Failed to create goal'));
            }
            const newGoal = await res.json();
            setGoals(prev => [...prev, newGoal]);
            return newGoal.id;
        } catch (err) {
            console.error('Error adding goal:', err);
            throw err;
        }
    }, [authFetch, getApiErrorMessage]);

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
                const normalizedId = String(projectId);
                const detailedWithFlag = { ...detailedProject, _detailsLoaded: true };

                // Upsert the detailed project so selecting an unloaded project still opens correctly
                setProjects(prev => {
                    const existingIndex = prev.findIndex(p => String(p.id) === normalizedId);
                    if (existingIndex === -1) {
                        return [...prev, detailedWithFlag];
                    }
                    return prev.map(p =>
                        String(p.id) === normalizedId ? { ...p, ...detailedWithFlag } : p
                    );
                });
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
            return true;
        } catch (err) {
            console.error('Error updating project:', err);
            throw err;
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

    const setProjectWatchState = useCallback((projectId, isWatched) => {
        const normalizedId = String(projectId);
        setProjects(prev => prev.map((project) => (
            String(project.id) === normalizedId ? { ...project, isWatched: !!isWatched } : project
        )));
    }, []);

    const watchProject = useCallback(async (projectId) => {
        const normalizedId = String(projectId);
        const previousState = !!projects.find((project) => String(project.id) === normalizedId)?.isWatched;
        setProjectWatchState(normalizedId, true);
        try {
            const res = await authFetch(`${API_BASE}/projects/${normalizedId}/watch`, {
                method: 'POST'
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to watch project');
            }
            const payload = await res.json().catch(() => ({}));
            if (typeof payload.isWatched === 'boolean') {
                setProjectWatchState(normalizedId, payload.isWatched);
            }
            return true;
        } catch (err) {
            setProjectWatchState(normalizedId, previousState);
            throw err;
        }
    }, [authFetch, projects, setProjectWatchState]);

    const unwatchProject = useCallback(async (projectId) => {
        const normalizedId = String(projectId);
        const previousState = !!projects.find((project) => String(project.id) === normalizedId)?.isWatched;
        setProjectWatchState(normalizedId, false);
        try {
            const res = await authFetch(`${API_BASE}/projects/${normalizedId}/watch`, {
                method: 'DELETE'
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to unwatch project');
            }
            const payload = await res.json().catch(() => ({}));
            if (typeof payload.isWatched === 'boolean') {
                setProjectWatchState(normalizedId, payload.isWatched);
            }
            return true;
        } catch (err) {
            setProjectWatchState(normalizedId, previousState);
            throw err;
        }
    }, [authFetch, projects, setProjectWatchState]);

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
            return newTask;
        } catch (err) {
            console.error('Error adding task:', err);
            throw err;
        }
    }, [authFetch]);

    const updateTask = useCallback(async (projectId, taskId, updates) => {
        try {
            const res = await authFetch(`${API_BASE}/tasks/${taskId}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            const data = await res.json().catch(() => ({}));
            const serverTaskPatch = data?.task || {};
            setProjects(prev => prev.map(p => {
                if (String(p.id) !== String(projectId)) return p;
                if (!p.tasks) return p; // Tasks not loaded, nothing to update in state

                return {
                    ...p,
                    tasks: p.tasks.map(t => String(t.id) === String(taskId) ? { ...t, ...updates, ...serverTaskPatch } : t)
                };
            }));
            return { ...updates, ...serverTaskPatch };
        } catch (err) {
            console.error('Error updating task:', err);
            throw err;
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
            return true;
        } catch (err) {
            console.error('Error deleting task:', err);
            throw err;
        }
    }, [authFetch]);

    const fetchAssignableUsers = useCallback(async (query = '') => {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        const suffix = params.toString() ? `?${params.toString()}` : '';
        const res = await authFetch(`${API_BASE}/users/assignable${suffix}`);
        return await res.json();
    }, [authFetch]);

    const fetchTaskChecklist = useCallback(async (taskId) => {
        const res = await authFetch(`${API_BASE}/tasks/${taskId}/checklist`);
        return await res.json();
    }, [authFetch]);

    const addTaskChecklistItem = useCallback(async (taskId, payload) => {
        const res = await authFetch(`${API_BASE}/tasks/${taskId}/checklist`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        return await res.json();
    }, [authFetch]);

    const updateTaskChecklistItem = useCallback(async (taskId, itemId, payload) => {
        const res = await authFetch(`${API_BASE}/tasks/${taskId}/checklist/${itemId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        return await res.json();
    }, [authFetch]);

    const deleteTaskChecklistItem = useCallback(async (taskId, itemId) => {
        const res = await authFetch(`${API_BASE}/tasks/${taskId}/checklist/${itemId}`, {
            method: 'DELETE'
        });
        return await res.json();
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

    const fetchProjectBenefitsRisk = useCallback(async (projectId) => {
        const res = await authFetch(`${API_BASE}/projects/${projectId}/benefits-risk`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load project benefits and risk'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const createProjectBenefit = useCallback(async (projectId, payload) => {
        const res = await authFetch(`${API_BASE}/projects/${projectId}/benefits`, {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to create project benefit'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const updateProjectBenefit = useCallback(async (projectId, benefitId, payload) => {
        const res = await authFetch(`${API_BASE}/projects/${projectId}/benefits/${benefitId}`, {
            method: 'PUT',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to update project benefit'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const deleteProjectBenefit = useCallback(async (projectId, benefitId) => {
        const res = await authFetch(`${API_BASE}/projects/${projectId}/benefits/${benefitId}`, {
            method: 'DELETE'
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to delete project benefit'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    // ==================== INTAKE FORMS ====================

    const addIntakeForm = useCallback(async (form) => {
        try {
            const res = await authFetch(`${API_BASE}/intake/forms`, {
                method: 'POST',
                body: JSON.stringify(form)
            });
            if (!res.ok) {
                throw new Error(await getApiErrorMessage(res, 'Failed to create intake form'));
            }
            const newForm = await res.json();
            setIntakeForms(prev => [...prev, newForm]);
            return newForm.id;
        } catch (err) {
            console.error('Error adding intake form:', err);
            throw err;
        }
    }, [authFetch, getApiErrorMessage]);

    const updateIntakeForm = useCallback(async (id, updates) => {
        try {
            const res = await authFetch(`${API_BASE}/intake/forms/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
            if (!res.ok) {
                throw new Error(await getApiErrorMessage(res, 'Failed to update intake form'));
            }
            setIntakeForms(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
        } catch (err) {
            console.error('Error updating intake form:', err);
            throw err;
        }
    }, [authFetch, getApiErrorMessage]);

    const deleteIntakeForm = useCallback(async (id) => {
        try {
            await authFetch(`${API_BASE}/intake/forms/${id}`, { method: 'DELETE' });
            setIntakeForms(prev => prev.filter(f => f.id !== id));
        } catch (err) {
            console.error('Error deleting intake form:', err);
        }
    }, [authFetch]);


    // ==================== ORGANIZATIONS ====================

    const fetchOrganizations = useCallback(async () => {
        const res = await authFetch(`${API_BASE}/admin/organizations`);
        return await res.json();
    }, [authFetch]);

    const createOrganization = useCallback(async (payload) => {
        const res = await authFetch(`${API_BASE}/admin/organizations`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to create organization');
        }
        return await res.json();
    }, [authFetch]);

    const updateOrganization = useCallback(async (id, payload) => {
        const res = await authFetch(`${API_BASE}/admin/organizations/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to update organization');
        return await res.json();
    }, [authFetch]);

    const assignUserToOrg = useCallback(async (userOid, orgId) => {
        const res = await authFetch(`${API_BASE}/admin/users/${userOid}/organization`, {
            method: 'PUT',
            body: JSON.stringify({ orgId })
        });
        if (!res.ok) throw new Error('Failed to assign user to organization');
        return await res.json();
    }, [authFetch]);

    const fetchProjectSharing = useCallback(async (projectId) => {
        const res = await authFetch(`${API_BASE}/admin/projects/${projectId}/sharing`);
        return await res.json();
    }, [authFetch]);

    const shareProject = useCallback(async (projectId, orgId, accessLevel = 'read', expiresAt = null) => {
        const res = await authFetch(`${API_BASE}/admin/projects/${projectId}/sharing`, {
            method: 'POST',
            body: JSON.stringify({ orgId, accessLevel, expiresAt })
        });
        if (!res.ok) throw new Error('Failed to share project');
        return await res.json();
    }, [authFetch]);

    const unshareProject = useCallback(async (projectId, orgId) => {
        const res = await authFetch(`${API_BASE}/admin/projects/${projectId}/sharing/${orgId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to remove sharing');
        return await res.json();
    }, [authFetch]);

    // ==================== ORG SHARING (BULK + GOALS) ====================

    const fetchOrgSharingSummary = useCallback(async (orgId) => {
        const res = await authFetch(`${API_BASE}/admin/organizations/${orgId}/sharing-summary`);
        if (!res.ok) throw new Error('Failed to fetch sharing summary');
        return await res.json();
    }, [authFetch]);

    const bulkShareProjects = useCallback(async (projectIds, orgId, accessLevel = 'read', expiresAt = null) => {
        const res = await authFetch(`${API_BASE}/admin/projects/bulk-share`, {
            method: 'POST',
            body: JSON.stringify({ projectIds, orgId, accessLevel, expiresAt })
        });
        if (!res.ok) throw new Error('Failed to bulk share projects');
        return await res.json();
    }, [authFetch]);

    const bulkUnshareProjects = useCallback(async (projectIds, orgId) => {
        const res = await authFetch(`${API_BASE}/admin/projects/bulk-unshare`, {
            method: 'POST',
            body: JSON.stringify({ projectIds, orgId })
        });
        if (!res.ok) throw new Error('Failed to bulk unshare projects');
        return await res.json();
    }, [authFetch]);

    const fetchGoalSharing = useCallback(async (goalId) => {
        const res = await authFetch(`${API_BASE}/admin/goals/${goalId}/sharing`);
        return await res.json();
    }, [authFetch]);

    const shareGoal = useCallback(async (goalId, orgId, accessLevel = 'read', includeDescendants = true, expiresAt = null) => {
        const res = await authFetch(`${API_BASE}/admin/goals/${goalId}/sharing`, {
            method: 'POST',
            body: JSON.stringify({ orgId, accessLevel, includeDescendants, expiresAt })
        });
        if (!res.ok) throw new Error('Failed to share goal');
        return await res.json();
    }, [authFetch]);

    const unshareGoal = useCallback(async (goalId, orgId) => {
        const res = await authFetch(`${API_BASE}/admin/goals/${goalId}/sharing/${orgId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to unshare goal');
        return await res.json();
    }, [authFetch]);

    const bulkShareGoals = useCallback(async (goalIds, orgId, accessLevel = 'read', includeDescendants = true, expiresAt = null) => {
        const res = await authFetch(`${API_BASE}/admin/goals/bulk-share`, {
            method: 'POST',
            body: JSON.stringify({ goalIds, orgId, accessLevel, includeDescendants, expiresAt })
        });
        if (!res.ok) throw new Error('Failed to bulk share goals');
        return await res.json();
    }, [authFetch]);

    const bulkUnshareGoals = useCallback(async (goalIds, orgId) => {
        const res = await authFetch(`${API_BASE}/admin/goals/bulk-unshare`, {
            method: 'POST',
            body: JSON.stringify({ goalIds, orgId })
        });
        if (!res.ok) throw new Error('Failed to bulk unshare goals');
        return await res.json();
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

    const patchSubmissionLocal = useCallback((id, patch) => {
        setIntakeSubmissions(prev => prev.map(s => String(s.id) === String(id) ? { ...s, ...patch } : s));
        setMySubmissions(prev => prev.map(s => String(s.id) === String(id) ? { ...s, ...patch } : s));
    }, []);

    const getGovernanceSettings = useCallback(async () => {
        const res = await authFetch(`${API_BASE}/governance/settings`);
        return await res.json();
    }, [authFetch]);

    const updateGovernanceSettings = useCallback(async (payload) => {
        const res = await authFetch(`${API_BASE}/governance/settings`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        return await res.json();
    }, [authFetch]);

    const fetchGovernanceUsers = useCallback(async (params = {}) => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                searchParams.set(key, String(value));
            }
        });
        const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
        const res = await authFetch(`${API_BASE}/governance/users${suffix}`);
        return await res.json();
    }, [authFetch]);

    const fetchGovernanceBoards = useCallback(async (params = {}) => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                searchParams.set(key, String(value));
            }
        });
        const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
        const res = await authFetch(`${API_BASE}/governance/boards${suffix}`);
        return await res.json();
    }, [authFetch]);

    const createGovernanceBoard = useCallback(async (payload) => {
        const res = await authFetch(`${API_BASE}/governance/boards`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to create governance board'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const updateGovernanceBoard = useCallback(async (boardId, payload) => {
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to update governance board'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const fetchGovernanceBoardMembers = useCallback(async (boardId, params = {}) => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                searchParams.set(key, String(value));
            }
        });
        const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/members${suffix}`);
        return await res.json();
    }, [authFetch]);

    const upsertGovernanceBoardMember = useCallback(async (boardId, payload) => {
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/members`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        return await res.json();
    }, [authFetch]);

    const fetchGovernanceCriteriaVersions = useCallback(async (boardId) => {
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/criteria/versions`);
        return await res.json();
    }, [authFetch]);

    const createGovernanceCriteriaVersion = useCallback(async (boardId, payload) => {
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/criteria/versions`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        return await res.json();
    }, [authFetch]);

    const updateGovernanceCriteriaVersion = useCallback(async (boardId, versionId, payload) => {
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/criteria/versions/${versionId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        return await res.json();
    }, [authFetch]);

    const publishGovernanceCriteriaVersion = useCallback(async (boardId, versionId) => {
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/criteria/versions/${versionId}/publish`, {
            method: 'POST'
        });
        return await res.json();
    }, [authFetch]);

    const fetchIntakeGovernanceQueue = useCallback(async (params = {}) => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                searchParams.set(key, String(value));
            }
        });

        const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
        const res = await authFetch(`${API_BASE}/intake/governance-queue${suffix}`);
        return await res.json();
    }, [authFetch]);

    const getSubmissionGovernance = useCallback(async (submissionId) => {
        const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/governance`);
        return await res.json();
    }, [authFetch]);

    const startSubmissionGovernance = useCallback(async (submissionId, payload = {}) => {
        const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/governance/start`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        patchSubmissionLocal(submissionId, {
            governanceRequired: true,
            governanceStatus: 'in-review',
            governanceDecision: null
        });
        return data;
    }, [authFetch, patchSubmissionLocal]);

    const submitSubmissionGovernanceVote = useCallback(async (submissionId, payload) => {
        const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/governance/votes`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data?.priorityScore !== undefined) {
            patchSubmissionLocal(submissionId, { priorityScore: data.priorityScore });
        }
        return data;
    }, [authFetch, patchSubmissionLocal]);

    const decideSubmissionGovernance = useCallback(async (submissionId, payload) => {
        const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/governance/decide`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        patchSubmissionLocal(submissionId, {
            governanceStatus: 'decided',
            governanceDecision: payload?.decision || null,
            governanceReason: payload?.decisionReason || null,
            priorityScore: data?.priorityScore ?? null
        });
        return data;
    }, [authFetch, patchSubmissionLocal]);

    const applySubmissionGovernance = useCallback(async (submissionId, reason = '') => {
        const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/governance/apply`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
        const data = await res.json().catch(() => ({ success: true }));
        patchSubmissionLocal(submissionId, {
            governanceRequired: true,
            governanceStatus: 'not-started',
            governanceDecision: null,
            governanceReason: reason || 'Marked for governance review by intake manager.'
        });
        return data;
    }, [authFetch, patchSubmissionLocal]);

    const skipSubmissionGovernance = useCallback(async (submissionId, reason = '') => {
        const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/governance/skip`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
        const data = await res.json().catch(() => ({ success: true }));
        patchSubmissionLocal(submissionId, {
            governanceRequired: false,
            governanceStatus: 'skipped',
            governanceReason: reason || 'Governance skipped by intake manager.'
        });
        return data;
    }, [authFetch, patchSubmissionLocal]);

    // ==================== WAVE 2: INTAKE SLA ====================

    const fetchIntakeSlaPolicies = useCallback(async () => {
        const res = await authFetch(`${API_BASE}/intake/sla/policies`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load SLA policies'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const updateIntakeSlaPolicies = useCallback(async (policies = []) => {
        const res = await authFetch(`${API_BASE}/intake/sla/policies`, {
            method: 'PUT',
            body: JSON.stringify({ policies })
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to update SLA policies'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const fetchIntakeSlaSummary = useCallback(async () => {
        const res = await authFetch(`${API_BASE}/intake/sla/summary`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load SLA summary'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const nudgeSubmissionSla = useCallback(async (submissionId) => {
        const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/sla/nudge`, {
            method: 'POST'
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to send SLA nudge'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    // ==================== WAVE 2: GOVERNANCE SESSION MODE ====================

    const fetchGovernanceSessions = useCallback(async (boardId, params = {}) => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                searchParams.set(key, String(value));
            }
        });
        const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/sessions${suffix}`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load governance sessions'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const fetchActiveGovernanceSession = useCallback(async (boardId) => {
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/sessions/active`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load active governance session'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const createGovernanceSession = useCallback(async (boardId, payload) => {
        const res = await authFetch(`${API_BASE}/governance/boards/${boardId}/sessions`, {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to create governance session'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const updateGovernanceSessionAgenda = useCallback(async (sessionId, payload) => {
        const res = await authFetch(`${API_BASE}/governance/sessions/${sessionId}/agenda`, {
            method: 'PUT',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to update session agenda'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const startGovernanceSession = useCallback(async (sessionId) => {
        const res = await authFetch(`${API_BASE}/governance/sessions/${sessionId}/start`, {
            method: 'POST'
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to start governance session'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const closeGovernanceSession = useCallback(async (sessionId) => {
        const res = await authFetch(`${API_BASE}/governance/sessions/${sessionId}/close`, {
            method: 'POST'
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to close governance session'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    // ==================== WAVE 2: EXECUTIVE REPORT PACKS ====================

    const fetchExecutiveReportPacks = useCallback(async () => {
        const res = await authFetch(`${API_BASE}/reports/packs`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load executive packs'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const createExecutiveReportPack = useCallback(async (payload) => {
        const res = await authFetch(`${API_BASE}/reports/packs`, {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to create executive pack'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const updateExecutiveReportPack = useCallback(async (packId, payload) => {
        const res = await authFetch(`${API_BASE}/reports/packs/${packId}`, {
            method: 'PUT',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to update executive pack'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const fetchExecutiveReportPackRuns = useCallback(async (packId) => {
        const res = await authFetch(`${API_BASE}/reports/packs/${packId}/runs`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load pack runs'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const runExecutiveReportPackNow = useCallback(async (packId) => {
        const res = await authFetch(`${API_BASE}/reports/packs/${packId}/run-now`, {
            method: 'POST'
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to run executive pack'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const fetchExecutivePackSchedulerStatus = useCallback(async () => {
        const res = await authFetch(`${API_BASE}/reports/scheduler/status`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load executive pack scheduler status'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const runDueExecutivePacks = useCallback(async (maxRuns = 10) => {
        const res = await authFetch(`${API_BASE}/reports/scheduler/run-due`, {
            method: 'POST',
            body: JSON.stringify({ maxRuns })
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to run due executive packs'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    // ==================== WAVE 2: SHARING REQUEST WORKFLOW ====================

    const fetchSharingRequests = useCallback(async (params = {}) => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                searchParams.set(key, String(value));
            }
        });
        const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
        const res = await authFetch(`${API_BASE}/admin/sharing-requests${suffix}`);
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to load sharing requests'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const createSharingRequest = useCallback(async (payload) => {
        const res = await authFetch(`${API_BASE}/admin/sharing-requests`, {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to submit sharing request'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const approveSharingRequest = useCallback(async (requestId, payload = {}) => {
        const res = await authFetch(`${API_BASE}/admin/sharing-requests/${requestId}/approve`, {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to approve sharing request'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const rejectSharingRequest = useCallback(async (requestId, payload = {}) => {
        const res = await authFetch(`${API_BASE}/admin/sharing-requests/${requestId}/reject`, {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to reject sharing request'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

    const revokeSharingRequest = useCallback(async (requestId, payload = {}) => {
        const res = await authFetch(`${API_BASE}/admin/sharing-requests/${requestId}/revoke`, {
            method: 'POST',
            body: JSON.stringify(payload || {})
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to revoke sharing request'));
        }
        return await res.json();
    }, [authFetch, getApiErrorMessage]);

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

    const convertSubmissionToProject = useCallback(async (submissionId, projectData, options = {}) => {
        const conversionContext = String(options?.conversionContext || '').trim();
        const kickoffTasks = Array.isArray(options?.kickoffTasks)
            ? options.kickoffTasks
                .filter(task => task && String(task.title || '').trim() !== '')
                .map(task => ({
                    title: String(task.title || '').trim(),
                    description: String(task.description || '').trim(),
                    priority: ['high', 'medium', 'low'].includes(String(task.priority || '').toLowerCase())
                        ? String(task.priority).toLowerCase()
                        : 'medium',
                    status: ['todo', 'in-progress', 'blocked', 'review', 'done'].includes(String(task.status || '').toLowerCase())
                        ? String(task.status).toLowerCase()
                        : 'todo',
                    startDate: task.startDate || null,
                    endDate: task.endDate || null
                }))
            : [];
        const res = await authFetch(`${API_BASE}/intake/submissions/${submissionId}/convert`, {
            method: 'POST',
            body: JSON.stringify({
                projectData,
                conversionContext,
                kickoffTasks
            })
        });
        if (!res.ok) {
            throw new Error(await getApiErrorMessage(res, 'Failed to convert submission to project'));
        }

        const data = await res.json();
        if (data?.project) {
            setProjects(prev => {
                const existingIndex = prev.findIndex(p => String(p.id) === String(data.project.id));
                if (existingIndex === -1) return [...prev, data.project];
                return prev.map(p => String(p.id) === String(data.project.id) ? { ...p, ...data.project } : p);
            });
        }

        if (data?.projectId) {
            patchSubmissionLocal(submissionId, {
                status: 'approved',
                convertedProjectId: String(data.projectId)
            });
        }

        return {
            projectId: data?.projectId || data?.project?.id || null,
            seededTaskCount: data?.seededTaskCount || 0,
            seededTaskErrors: Array.isArray(data?.seededTaskErrors) ? data.seededTaskErrors : []
        };
    }, [authFetch, getApiErrorMessage, patchSubmissionLocal]);

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
        const isAuthError = typeof error === 'string' && (error.includes('401') || error.includes('Session'));

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
                {isAuthError ? (
                    <>
                        <h2 style={{ color: '#f59e0b' }}>Session Expired</h2>
                        <p>Your session has expired or is invalid. Please sign in again.</p>
                        <button
                            onClick={() => instance.loginRedirect(apiRequest)}
                            style={{
                                padding: '0.6rem 1.2rem',
                                background: '#2563eb',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '1rem',
                                cursor: 'pointer',
                                marginTop: '0.5rem',
                                fontWeight: '500'
                            }}
                        >
                            Sign In Again
                        </button>
                    </>
                ) : (
                    <>
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
                    </>
                )}
            </div>
        );
    }

    return (
        <DataContext.Provider value={{
            goals: goalsWithProgress,
            currentUser,
            addGoal, updateGoal, deleteGoal,
            addKpi, updateKpi, deleteKpi,
            projects: projectsWithCompletion,
            projectsPagination,
            projectsError,
            loadMoreProjects,
            loading,
            loadingMore,
            moveTask, addTask, addProject, updateProject, deleteProject, loadProjectDetails,
            watchProject, unwatchProject,
            updateTask, deleteTask,
            fetchAssignableUsers, fetchTaskChecklist, addTaskChecklistItem, updateTaskChecklistItem, deleteTaskChecklistItem,
            intakeForms, addIntakeForm, updateIntakeForm, deleteIntakeForm,
            intakeSubmissions, mySubmissions, addIntakeSubmission, updateIntakeSubmission,
            getGovernanceSettings, updateGovernanceSettings,
            fetchGovernanceUsers,
            fetchGovernanceBoards, createGovernanceBoard, updateGovernanceBoard,
            fetchGovernanceBoardMembers, upsertGovernanceBoardMember,
            fetchGovernanceCriteriaVersions, createGovernanceCriteriaVersion,
            updateGovernanceCriteriaVersion, publishGovernanceCriteriaVersion,
            fetchIntakeGovernanceQueue, getSubmissionGovernance, startSubmissionGovernance,
            submitSubmissionGovernanceVote, decideSubmissionGovernance, applySubmissionGovernance, skipSubmissionGovernance,
            fetchIntakeSlaPolicies, updateIntakeSlaPolicies, fetchIntakeSlaSummary, nudgeSubmissionSla,
            fetchGovernanceSessions, fetchActiveGovernanceSession, createGovernanceSession,
            updateGovernanceSessionAgenda, startGovernanceSession, closeGovernanceSession,
            addConversationMessage, markConversationRead, migrateInfoRequestsToConversation, convertSubmissionToProject,
            addStatusReport, getLatestStatusReport, restoreStatusReport,
            fetchProjectBenefitsRisk, createProjectBenefit, updateProjectBenefit, deleteProjectBenefit,
            fetchExecutiveReportPacks, createExecutiveReportPack, updateExecutiveReportPack,
            fetchExecutiveReportPackRuns, runExecutiveReportPackNow, fetchExecutivePackSchedulerStatus, runDueExecutivePacks,
            authFetch, fetchExecSummaryProjects,

            permissionCatalog, permissions, hasPermission, hasRole, hasAnyRole, userRoles: effectiveRoles, updatePermissionsBulk,

            fetchOrganizations, createOrganization, updateOrganization,
            assignUserToOrg, fetchProjectSharing, shareProject, unshareProject,
            fetchOrgSharingSummary, bulkShareProjects, bulkUnshareProjects,
            fetchGoalSharing, shareGoal, unshareGoal, bulkShareGoals, bulkUnshareGoals,
            fetchSharingRequests, createSharingRequest, approveSharingRequest, rejectSharingRequest, revokeSharingRequest,
            tagGroups, addTagGroup, updateTagGroup, deleteTagGroup,
            addTag, updateTag, deleteTag, updateProjectTags
        }}>
            {children}
        </DataContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useData = () => useContext(DataContext);
