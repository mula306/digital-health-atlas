import { useState, useEffect, useCallback, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import {
    Building2, Plus, Edit3, Users, Share2, Check, X,
    Search, UserPlus, Trash2, Eye, PenTool, Shield, RefreshCw,
    ToggleLeft, ToggleRight, CircleDot, Target, CheckSquare,
    Square, MinusSquare, ChevronRight, Filter
} from 'lucide-react';
import { API_BASE } from '../../apiClient';
import { getGoalTypeLabel } from '../../../shared/goalLevels.js';
import './OrganizationManager.css';

const ORG_SECTIONS = new Set(['orgs', 'members', 'sharing']);
const ORG_SHARING_TABS = new Set(['projects', 'goals']);
const ORG_SHARING_VIEWS = new Set(['available', 'shared']);

const normalizeComparableId = (value) => (
    value === null || value === undefined || value === '' ? '' : String(value)
);

const sortByOwnerThenTitle = (a, b) => {
    const ownerCompare = String(a.ownerOrgName || '').localeCompare(String(b.ownerOrgName || ''));
    if (ownerCompare !== 0) return ownerCompare;
    return String(a.title || a.projectTitle || a.goalTitle || '').localeCompare(
        String(b.title || b.projectTitle || b.goalTitle || '')
    );
};

export function OrganizationManager({
    initialSection = null,
    onSectionChange = null,
    initialSharingTab = null,
    onSharingTabChange = null
}) {
    const {
        fetchOrganizations, createOrganization, updateOrganization,
        assignUserToOrg, unshareProject,
        fetchOrgSharingSummary, bulkShareProjects, bulkUnshareProjects,
        bulkShareGoals, bulkUnshareGoals,
        authFetch, currentUser, hasPermission
    } = useData();
    const { success, error: showError } = useToast();

    const [organizations, setOrganizations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [editingOrg, setEditingOrg] = useState(null);
    const [activeSectionState, setActiveSectionState] = useState('orgs'); // orgs | members | sharing
    const [selectedOrgId, setSelectedOrgId] = useState(null);

    // Create/edit form state
    const [formName, setFormName] = useState('');
    const [formSlug, setFormSlug] = useState('');

    // User assignment state
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [allUsers, setAllUsers] = useState([]);
    const [loadingAllUsers, setLoadingAllUsers] = useState(false);
    const [usersLoaded, setUsersLoaded] = useState(false);
    const [selectedUserIds, setSelectedUserIds] = useState(new Set());
    const [bulkAssigningUsers, setBulkAssigningUsers] = useState(false);

    // ─── Data Sharing State ───
    const [sharingSubTabState, setSharingSubTabState] = useState('projects'); // projects | goals
    const [sharingViewState, setSharingViewState] = useState('available'); // available | shared
    const [sharingSummary, setSharingSummary] = useState({ projects: [], goals: [] });
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [loadedSharingSummaryOrgId, setLoadedSharingSummaryOrgId] = useState(null);
    const [projectSearch, setProjectSearch] = useState('');
    const [goalSearch, setGoalSearch] = useState('');
    const [selectedProjectIds, setSelectedProjectIds] = useState(new Set());
    const [selectedGoalIds, setSelectedGoalIds] = useState(new Set());
    const [shareAccessLevel, setShareAccessLevel] = useState('read');
    const [shareExpiresAt, setShareExpiresAt] = useState('');
    const [bulkActionLoading, setBulkActionLoading] = useState(false);
    const [ensuringProjectGoalContextId, setEnsuringProjectGoalContextId] = useState(null);

    // ─── All projects/goals for sharing (fetched directly, not paginated) ───
    const [allProjects, setAllProjects] = useState([]);
    const [allGoals, setAllGoals] = useState([]);
    const [pickerDataLoaded, setPickerDataLoaded] = useState(false);
    const canManageOrganizations = hasPermission('can_manage_organizations');
    const canManageSharingRequests = hasPermission('can_manage_sharing_requests');
    const isSectionControlled = typeof onSectionChange === 'function';
    const isSharingTabControlled = typeof onSharingTabChange === 'function';
    const availableSections = useMemo(() => {
        const sections = [];
        if (canManageOrganizations) {
            sections.push('orgs', 'members');
        }
        if (canManageSharingRequests) {
            sections.push('sharing');
        }
        return sections;
    }, [canManageOrganizations, canManageSharingRequests]);
    const normalizedInitialSection = (
        typeof initialSection === 'string' &&
        ORG_SECTIONS.has(initialSection) &&
        availableSections.includes(initialSection)
    ) ? initialSection : (availableSections[0] || 'orgs');
    const normalizedInitialSharingTab = (
        typeof initialSharingTab === 'string' &&
        ORG_SHARING_TABS.has(initialSharingTab)
    ) ? initialSharingTab : 'projects';
    const activeSection = isSectionControlled
        ? normalizedInitialSection
        : (
            ORG_SECTIONS.has(activeSectionState) && availableSections.includes(activeSectionState)
                ? activeSectionState
                : normalizedInitialSection
        );
    const sharingSubTab = isSharingTabControlled
        ? normalizedInitialSharingTab
        : (ORG_SHARING_TABS.has(sharingSubTabState) ? sharingSubTabState : normalizedInitialSharingTab);
    const sharingView = ORG_SHARING_VIEWS.has(sharingViewState) ? sharingViewState : 'available';

    const openSection = useCallback((nextSection) => {
        if (!ORG_SECTIONS.has(nextSection) || !availableSections.includes(nextSection)) return;
        if (isSectionControlled) {
            onSectionChange?.(nextSection);
            return;
        }
        setActiveSectionState(nextSection);
    }, [availableSections, isSectionControlled, onSectionChange]);

    const openSharingSubTab = useCallback((nextTab) => {
        if (!ORG_SHARING_TABS.has(nextTab)) return;
        if (isSharingTabControlled) {
            onSharingTabChange?.(nextTab);
            return;
        }
        setSharingSubTabState(nextTab);
    }, [isSharingTabControlled, onSharingTabChange]);

    useEffect(() => {
        if (!isSectionControlled) return;
        if (initialSection !== activeSection) {
            onSectionChange?.(activeSection);
        }
    }, [isSectionControlled, activeSection, initialSection, onSectionChange]);

    useEffect(() => {
        if (isSectionControlled) return;
        setActiveSectionState((currentSection) => (
            currentSection === normalizedInitialSection ? currentSection : normalizedInitialSection
        ));
    }, [isSectionControlled, normalizedInitialSection]);

    useEffect(() => {
        if (!isSharingTabControlled) return;
        if (initialSharingTab !== sharingSubTab) {
            onSharingTabChange?.(sharingSubTab);
        }
    }, [isSharingTabControlled, sharingSubTab, initialSharingTab, onSharingTabChange]);

    useEffect(() => {
        if (isSharingTabControlled) return;
        setSharingSubTabState((currentTab) => (
            currentTab === normalizedInitialSharingTab ? currentTab : normalizedInitialSharingTab
        ));
    }, [isSharingTabControlled, normalizedInitialSharingTab]);

    const toIsoOrNull = (value) => {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString();
    };

    const formatDateTime = (value) => {
        if (!value) return 'n/a';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return 'n/a';
        return parsed.toLocaleString();
    };

    const loadOrganizations = useCallback(async () => {
        try {
            setLoading(true);
            const orgs = await fetchOrganizations();
            setOrganizations(orgs);
        } catch {
            showError('Failed to load organizations');
        } finally {
            setLoading(false);
        }
    }, [fetchOrganizations, showError]);

    useEffect(() => { loadOrganizations(); }, [loadOrganizations]);

    const activeOrganizations = useMemo(
        () => organizations.filter(org => org.isActive),
        [organizations]
    );

    useEffect(() => {
        if (activeOrganizations.length === 0) {
            if (selectedOrgId !== null) {
                setSelectedOrgId(null);
            }
            return;
        }

        const selectedIsActive = activeOrganizations.some(org => String(org.id) === String(selectedOrgId));
        if (!selectedIsActive) {
            setSelectedOrgId(activeOrganizations[0].id);
        }
    }, [activeOrganizations, selectedOrgId]);

    const selectedOrgForMembers = selectedOrgId;
    const sharingTargetOrg = selectedOrgId;

    // Auto-generate slug from name
    const handleNameChange = (value) => {
        setFormName(value);
        if (!editingOrg) {
            setFormSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
        }
    };

    const resetForm = () => {
        setFormName('');
        setFormSlug('');
        setEditingOrg(null);
        setShowCreateForm(false);
    };

    const handleCreate = async () => {
        if (!formName.trim() || !formSlug.trim()) return;
        try {
            await createOrganization({ name: formName.trim(), slug: formSlug.trim() });
            success('Organization created successfully');
            resetForm();
            loadOrganizations();
        } catch (err) {
            showError(err.message || 'Failed to create organization');
        }
    };

    const handleUpdate = async () => {
        if (!editingOrg || !formName.trim()) return;
        try {
            await updateOrganization(editingOrg.id, { name: formName.trim(), slug: formSlug.trim() });
            success('Organization updated');
            resetForm();
            loadOrganizations();
        } catch {
            showError('Failed to update organization');
        }
    };

    const handleToggleActive = async (org) => {
        try {
            await updateOrganization(org.id, { isActive: !org.isActive });
            success(`Organization ${org.isActive ? 'deactivated' : 'activated'}`);
            loadOrganizations();
        } catch {
            showError('Failed to update organization status');
        }
    };

    const startEdit = (org) => {
        setEditingOrg(org);
        setFormName(org.name);
        setFormSlug(org.slug);
        setShowCreateForm(true);
    };

    // Load all users for member assignment
    const loadAllUsers = useCallback(async () => {
        if (usersLoaded) return;
        setLoadingAllUsers(true);
        try {
            const res = await authFetch(`${API_BASE}/admin/all-users`);
            const data = await res.json();
            setAllUsers(data || []);
            setUsersLoaded(true);
        } catch {
            showError('Failed to load users');
        } finally {
            setLoadingAllUsers(false);
        }
    }, [authFetch, usersLoaded, showError]);

    // Lazy-load users when entering the members tab
    useEffect(() => {
        if (activeSection === 'members' && !usersLoaded) {
            loadAllUsers();
        }
    }, [activeSection, usersLoaded, loadAllUsers]);

    // Filtered users for the member list
    const filteredUsers = useMemo(() => {
        let list = [...allUsers];
        if (userSearchQuery.trim()) {
            const q = userSearchQuery.toLowerCase().trim();
            list = list.filter(u =>
                (u.name || '').toLowerCase().includes(q) ||
                (u.email || '').toLowerCase().includes(q)
            );
        }
        // Sort: assigned to selected org first, then alphabetical
        return list.sort((a, b) => {
            const aAssigned = String(a.orgId) === String(selectedOrgForMembers) ? 1 : 0;
            const bAssigned = String(b.orgId) === String(selectedOrgForMembers) ? 1 : 0;
            if (aAssigned !== bAssigned) return bAssigned - aAssigned;
            return (a.name || '').localeCompare(b.name || '');
        });
    }, [allUsers, userSearchQuery, selectedOrgForMembers]);

    const handleSelectOrg = (orgId) => {
        setSelectedOrgId(orgId);
        setSharingViewState('available');
        setUserSearchQuery('');
        setSelectedUserIds(new Set());
        setSelectedProjectIds(new Set());
        setSelectedGoalIds(new Set());
        setProjectSearch('');
        setGoalSearch('');
        setShareExpiresAt('');
    };

    const toggleUserSelection = (userId) => {
        const newSet = new Set(selectedUserIds);
        if (newSet.has(userId)) {
            newSet.delete(userId);
        } else {
            newSet.add(userId);
        }
        setSelectedUserIds(newSet);
    };

    const handleBulkAssignUsers = async () => {
        if (selectedUserIds.size === 0 || !selectedOrgForMembers) return;
        setBulkAssigningUsers(true);
        try {
            // Bulk assign users sequentially
            const userArray = Array.from(selectedUserIds);
            for (const userId of userArray) {
                await assignUserToOrg(userId, parseInt(selectedOrgForMembers));
            }
            success(`${userArray.length} user(s) assigned successfully`);
            setSelectedUserIds(new Set());
            // Update local users list
            setAllUsers(prev => prev.map(u =>
                userArray.includes(u.oid) ? { ...u, orgId: parseInt(selectedOrgForMembers), orgName: organizations.find(o => o.id === parseInt(selectedOrgForMembers))?.name || null } : u
            ));
            loadOrganizations();
        } catch {
            showError('Failed to bulk assign users');
        } finally {
            setBulkAssigningUsers(false);
        }
    };

    const handleAssignUser = async (userOid, orgId) => {
        try {
            await assignUserToOrg(userOid, parseInt(orgId));
            success('User assigned to organization');
            // Update local users list
            setAllUsers(prev => prev.map(u => u.oid === userOid ? { ...u, orgId: parseInt(orgId), orgName: organizations.find(o => o.id === parseInt(orgId))?.name || null } : u));
            loadOrganizations();
        } catch {
            showError('Failed to assign user');
        }
    };

    const handleRemoveFromOrg = async (userOid) => {
        try {
            await assignUserToOrg(userOid, null);
            success('User removed from organization');
            // Update local users list
            setAllUsers(prev => prev.map(u => u.oid === userOid ? { ...u, orgId: null, orgName: null } : u));
            loadOrganizations();
        } catch {
            showError('Failed to remove user');
        }
    };

    // ─── Data Sharing Logic ───

        // Load all projects + goals for the sharing picker (permission-scoped, no pagination)
    const loadPickerData = useCallback(async () => {
        if (pickerDataLoaded) return;
        try {
            const res = await authFetch(`${API_BASE}/admin/sharing-picker-data`);
            const data = await res.json();
            setAllProjects(data.projects || []);
            setAllGoals(data.goals || []);
            setPickerDataLoaded(true);
        } catch {
            showError('Failed to load sharing data');
        }
    }, [authFetch, pickerDataLoaded, showError]);

    // Lazy-load picker data when entering the sharing tab
    useEffect(() => {
        if (activeSection === 'sharing' && !pickerDataLoaded) {
            loadPickerData();
        }
    }, [activeSection, pickerDataLoaded, loadPickerData]);

    const loadSharingSummary = useCallback(async (orgId) => {
        if (!orgId) return;
        setLoadingSummary(true);
        try {
            const summary = await fetchOrgSharingSummary(orgId);
            setSharingSummary(summary);
            setLoadedSharingSummaryOrgId(normalizeComparableId(orgId));
        } catch {
            showError('Failed to load sharing summary');
            setSharingSummary({ projects: [], goals: [] });
            setLoadedSharingSummaryOrgId(normalizeComparableId(orgId));
        } finally {
            setLoadingSummary(false);
        }
    }, [fetchOrgSharingSummary, showError]);

    useEffect(() => {
        if (activeSection !== 'sharing') return;
        if (!sharingTargetOrg) {
            setSharingSummary({ projects: [], goals: [] });
            setLoadedSharingSummaryOrgId(null);
            return;
        }
        setLoadedSharingSummaryOrgId((currentOrgId) => (
            normalizeComparableId(currentOrgId) === normalizeComparableId(sharingTargetOrg)
                ? currentOrgId
                : null
        ));
        loadSharingSummary(sharingTargetOrg);
    }, [activeSection, sharingTargetOrg, loadSharingSummary]);

    const sharingSummaryReady = normalizeComparableId(loadedSharingSummaryOrgId) === normalizeComparableId(sharingTargetOrg);
    const isSharingSummaryLoading = loadingSummary || (!!sharingTargetOrg && !sharingSummaryReady);

    const sharingTargetOrgObj = useMemo(() =>
        organizations.find(o => normalizeComparableId(o.id) === normalizeComparableId(sharingTargetOrg)),
        [organizations, sharingTargetOrg]
    );

    const projectsById = useMemo(
        () => new Map((allProjects || []).map((project) => [normalizeComparableId(project.id), project])),
        [allProjects]
    );
    const goalsById = useMemo(
        () => new Map((allGoals || []).map((goal) => [normalizeComparableId(goal.id), goal])),
        [allGoals]
    );
    const allRootGoals = useMemo(
        () => (allGoals || []).filter((goal) => !goal.parentId),
        [allGoals]
    );
    const goalChildrenByParentId = useMemo(() => {
        const map = new Map();
        for (const goal of allGoals || []) {
            const parentId = normalizeComparableId(goal.parentId);
            if (!parentId) continue;
            if (!map.has(parentId)) map.set(parentId, []);
            map.get(parentId).push(goal);
        }
        return map;
    }, [allGoals]);
    const goalRootIdById = useMemo(() => {
        const map = new Map();

        for (const goal of allGoals || []) {
            const goalId = normalizeComparableId(goal.id);
            let current = goal;
            const visited = new Set([goalId]);

            while (current?.parentId) {
                const parentId = normalizeComparableId(current.parentId);
                if (!parentId || visited.has(parentId)) break;
                visited.add(parentId);
                current = goalsById.get(parentId);
            }

            map.set(goalId, normalizeComparableId(current?.id || goal.id));
        }

        return map;
    }, [allGoals, goalsById]);
    const goalIdsByRootId = useMemo(() => {
        const map = new Map();
        for (const goal of allGoals || []) {
            const goalId = normalizeComparableId(goal.id);
            const rootId = goalRootIdById.get(goalId) || goalId;
            if (!map.has(rootId)) map.set(rootId, []);
            map.get(rootId).push(goalId);
        }
        return map;
    }, [allGoals, goalRootIdById]);

    const matchesProjectSearch = useCallback((project, rawQuery) => {
        const query = String(rawQuery || '').trim().toLowerCase();
        if (!query) return true;
        return (project.title || '').toLowerCase().includes(query) ||
            (project.tags || []).some((tag) => String(tag.tagName || tag.name || '').toLowerCase().includes(query)) ||
            String(project.ownerOrgName || '').toLowerCase().includes(query);
    }, []);

    const matchesGoalSearch = useCallback((goal, rawQuery) => {
        const query = String(rawQuery || '').trim().toLowerCase();
        if (!query) return true;

        const rootId = normalizeComparableId(goal.id);
        const goalIds = goalIdsByRootId.get(rootId) || [rootId];
        return goalIds.some((goalId) => {
            const candidate = goalsById.get(goalId);
            return (
                String(candidate?.title || '').toLowerCase().includes(query) ||
                String(candidate?.ownerOrgName || '').toLowerCase().includes(query)
            );
        });
    }, [goalIdsByRootId, goalsById]);

    const allSharedProjects = useMemo(() => (
        (sharingSummary.projects || [])
            .filter((project) => normalizeComparableId(project.ownerOrgId) !== normalizeComparableId(sharingTargetOrg))
            .map((project) => ({
                ...(projectsById.get(normalizeComparableId(project.projectId)) || {}),
                id: normalizeComparableId(project.projectId),
                title: project.projectTitle,
                ownerOrgId: project.ownerOrgId,
                ownerOrgName: project.ownerOrgName || null,
                accessLevel: project.accessLevel,
                grantedAt: project.grantedAt,
                expiresAt: project.expiresAt || null,
                isExpired: !!project.isExpired,
                linkedGoalCount: Number(project.linkedGoalCount || 0),
                linkedGoalsSharedCount: Number(project.linkedGoalsSharedCount || 0),
                goalContextStatus: project.goalContextStatus,
                goalContextMissing: !!project.goalContextMissing
            }))
            .sort(sortByOwnerThenTitle)
    ), [projectsById, sharingSummary.projects, sharingTargetOrg]);
    const sharedProjectIds = useMemo(
        () => new Set(allSharedProjects.map((project) => normalizeComparableId(project.id))),
        [allSharedProjects]
    );
    const allAvailableProjects = useMemo(() => (
        (allProjects || [])
            .filter((project) => normalizeComparableId(project.ownerOrgId) !== normalizeComparableId(sharingTargetOrg))
            .filter((project) => !sharedProjectIds.has(normalizeComparableId(project.id)))
            .sort(sortByOwnerThenTitle)
    ), [allProjects, sharingTargetOrg, sharedProjectIds]);
    const visibleAvailableProjects = useMemo(
        () => allAvailableProjects.filter((project) => matchesProjectSearch(project, projectSearch)),
        [allAvailableProjects, matchesProjectSearch, projectSearch]
    );
    const visibleSharedProjects = useMemo(
        () => allSharedProjects.filter((project) => matchesProjectSearch(project, projectSearch)),
        [allSharedProjects, matchesProjectSearch, projectSearch]
    );
    const visibleProjects = sharingView === 'shared' ? visibleSharedProjects : visibleAvailableProjects;

    const allSharedGoalEntries = useMemo(() => (
        (sharingSummary.goals || [])
            .filter((goal) => normalizeComparableId(goal.ownerOrgId) !== normalizeComparableId(sharingTargetOrg))
            .map((goal) => {
                const goalId = normalizeComparableId(goal.goalId);
                return {
                    ...goal,
                    goalId,
                    rootGoalId: goalRootIdById.get(goalId) || goalId
                };
            })
    ), [goalRootIdById, sharingSummary.goals, sharingTargetOrg]);
    const sharedGoalIds = useMemo(
        () => new Set(allSharedGoalEntries.map((goal) => normalizeComparableId(goal.goalId))),
        [allSharedGoalEntries]
    );
    const sharedRootGoalInfoById = useMemo(() => {
        const map = new Map();

        for (const goalEntry of allSharedGoalEntries) {
            const rootGoalId = normalizeComparableId(goalEntry.rootGoalId);
            const rootGoal = goalsById.get(rootGoalId);
            const existing = map.get(rootGoalId) || {
                goalId: rootGoalId,
                title: rootGoal?.title || goalEntry.goalTitle,
                type: rootGoal?.type || goalEntry.goalType,
                ownerOrgId: rootGoal?.ownerOrgId ?? goalEntry.ownerOrgId ?? null,
                ownerOrgName: rootGoal?.ownerOrgName || goalEntry.ownerOrgName || null,
                accessLevel: 'read',
                expiresAt: null,
                hasDirectShare: false,
                hasDescendantShare: false
            };

            existing.accessLevel = goalEntry.accessLevel === 'write' || existing.accessLevel === 'write' ? 'write' : 'read';
            if (!existing.expiresAt || (goalEntry.expiresAt && new Date(goalEntry.expiresAt).getTime() > new Date(existing.expiresAt).getTime())) {
                existing.expiresAt = goalEntry.expiresAt || existing.expiresAt;
            }
            if (rootGoalId === normalizeComparableId(goalEntry.goalId)) {
                existing.hasDirectShare = true;
            } else {
                existing.hasDescendantShare = true;
            }

            map.set(rootGoalId, existing);
        }

        return map;
    }, [allSharedGoalEntries, goalsById]);
    const allAvailableRootGoals = useMemo(() => (
        allRootGoals
            .filter((goal) => normalizeComparableId(goal.ownerOrgId) !== normalizeComparableId(sharingTargetOrg))
            .filter((goal) => !sharedRootGoalInfoById.has(normalizeComparableId(goal.id)))
            .sort(sortByOwnerThenTitle)
    ), [allRootGoals, sharingTargetOrg, sharedRootGoalInfoById]);
    const allSharedRootGoals = useMemo(() => (
        Array.from(sharedRootGoalInfoById.values())
            .map((goal) => ({
                ...(goalsById.get(normalizeComparableId(goal.goalId)) || {}),
                ...goal,
                id: normalizeComparableId(goal.goalId)
            }))
            .sort(sortByOwnerThenTitle)
    ), [goalsById, sharedRootGoalInfoById]);
    const visibleAvailableRootGoals = useMemo(
        () => allAvailableRootGoals.filter((goal) => matchesGoalSearch(goal, goalSearch)),
        [allAvailableRootGoals, matchesGoalSearch, goalSearch]
    );
    const visibleSharedRootGoals = useMemo(
        () => allSharedRootGoals.filter((goal) => matchesGoalSearch(goal, goalSearch)),
        [allSharedRootGoals, matchesGoalSearch, goalSearch]
    );
    const visibleGoalRoots = sharingView === 'shared' ? visibleSharedRootGoals : visibleAvailableRootGoals;

    useEffect(() => {
        setSelectedProjectIds(new Set());
        setSelectedGoalIds(new Set());
    }, [sharingSubTab, sharingView, sharingTargetOrg]);

    // Selection handlers
    const toggleProjectSelect = (id) => {
        setSelectedProjectIds(prev => {
            const next = new Set(prev);
            if (next.has(String(id))) next.delete(String(id));
            else next.add(String(id));
            return next;
        });
    };

    const toggleGoalSelect = (id) => {
        setSelectedGoalIds(prev => {
            const next = new Set(prev);
            if (next.has(String(id))) next.delete(String(id));
            else next.add(String(id));
            return next;
        });
    };

    const selectAllVisibleProjects = () => {
        setSelectedProjectIds(new Set(visibleProjects.map((project) => String(project.id))));
    };

    const deselectAllProjects = () => setSelectedProjectIds(new Set());

    const selectAllVisibleGoals = () => {
        setSelectedGoalIds(new Set(visibleGoalRoots.map((goal) => String(goal.id || goal.goalId))));
    };

    const deselectAllGoals = () => setSelectedGoalIds(new Set());

    // Bulk actions
    const handleBulkShareProjects = async () => {
        if (selectedProjectIds.size === 0 || !sharingTargetOrg) return;
        setBulkActionLoading(true);
        try {
            const result = await bulkShareProjects(
                Array.from(selectedProjectIds),
                sharingTargetOrg,
                shareAccessLevel,
                toIsoOrNull(shareExpiresAt)
            );
            const linkedGoalCount = Number(result?.linkedGoalCount || 0);
            const linkedGoalSharesInserted = Number(result?.linkedGoalSharesInserted || 0);
            const linkedGoalSharesRefreshed = Number(result?.linkedGoalSharesRefreshed || 0);
            const linkedGoalMessage = linkedGoalCount > 0
                ? ` Linked goals ensured: ${linkedGoalCount} (${linkedGoalSharesInserted} new, ${linkedGoalSharesRefreshed} refreshed).`
                : '';
            success(`${selectedProjectIds.size} project${selectedProjectIds.size > 1 ? 's' : ''} shared successfully.${linkedGoalMessage}`);
            setSelectedProjectIds(new Set());
            setShareExpiresAt('');
            loadSharingSummary(sharingTargetOrg);
        } catch {
            showError('Failed to share projects');
        } finally {
            setBulkActionLoading(false);
        }
    };

    const handleBulkUnshareProjects = async () => {
        if (selectedProjectIds.size === 0 || !sharingTargetOrg) return;
        setBulkActionLoading(true);
        try {
            await bulkUnshareProjects(Array.from(selectedProjectIds), sharingTargetOrg);
            success(`${selectedProjectIds.size} project${selectedProjectIds.size > 1 ? 's' : ''} unshared`);
            setSelectedProjectIds(new Set());
            loadSharingSummary(sharingTargetOrg);
        } catch {
            showError('Failed to unshare projects');
        } finally {
            setBulkActionLoading(false);
        }
    };

    const handleBulkShareGoals = async () => {
        if (selectedGoalIds.size === 0 || !sharingTargetOrg) return;
        setBulkActionLoading(true);
        try {
            await bulkShareGoals(
                Array.from(selectedGoalIds),
                sharingTargetOrg,
                shareAccessLevel,
                true,
                toIsoOrNull(shareExpiresAt)
            );
            success(`Goals shared successfully (including sub-goals)`);
            setSelectedGoalIds(new Set());
            setShareExpiresAt('');
            loadSharingSummary(sharingTargetOrg);
        } catch {
            showError('Failed to share goals');
        } finally {
            setBulkActionLoading(false);
        }
    };

    const handleBulkUnshareGoals = async () => {
        if (selectedGoalIds.size === 0 || !sharingTargetOrg) return;
        setBulkActionLoading(true);
        try {
            await bulkUnshareGoals(Array.from(selectedGoalIds), sharingTargetOrg);
            success(`Goals unshared`);
            setSelectedGoalIds(new Set());
            loadSharingSummary(sharingTargetOrg);
        } catch {
            showError('Failed to unshare goals');
        } finally {
            setBulkActionLoading(false);
        }
    };

    const handleEnsureProjectGoalContext = async (projectId, shareInfo) => {
        if (!sharingTargetOrg) return;
        setEnsuringProjectGoalContextId(String(projectId));
        try {
            const result = await bulkShareProjects(
                [String(projectId)],
                sharingTargetOrg,
                shareInfo?.accessLevel || 'read',
                shareInfo?.expiresAt || null
            );
            const linkedGoalCount = Number(result?.linkedGoalCount || 0);
            success(
                linkedGoalCount > 0
                    ? `Linked goal context refreshed for this project (${linkedGoalCount} goal${linkedGoalCount === 1 ? '' : 's'}).`
                    : 'Project share refreshed.'
            );
            loadSharingSummary(sharingTargetOrg);
        } catch {
            showError('Failed to ensure linked goal sharing');
        } finally {
            setEnsuringProjectGoalContextId(null);
        }
    };

    // Quick unshare single item
    const handleQuickUnshareProject = async (projectId) => {
        try {
            await unshareProject(projectId, sharingTargetOrg);
            success('Project unshared');
            loadSharingSummary(sharingTargetOrg);
        } catch {
            showError('Failed to unshare project');
        }
    };

    const totalMembers = organizations.reduce((sum, o) => sum + (o.memberCount || 0), 0);
    const activeOrgs = activeOrganizations.length;
    const orgsWithMembersCount = activeOrganizations.filter(org => Number(org.memberCount || 0) > 0).length;
    const selectedOrgAvailableCount = allAvailableProjects.length + allAvailableRootGoals.length;
    const selectedOrgSharedCount = allSharedProjects.length + allSharedRootGoals.length;

    const workflowSteps = useMemo(() => ([
        {
            id: 'orgs',
            step: '1',
            label: 'Organizations',
            icon: Building2,
            description: 'Create organizations and set active/inactive status.',
            ready: canManageOrganizations,
            complete: activeOrgs > 0,
            counter: `${activeOrgs}/${organizations.length} active`,
            blocker: !canManageOrganizations
                ? 'Requires organization management permission.'
                : (organizations.length === 0 ? 'Create your first organization to continue.' : '')
        },
        {
            id: 'members',
            step: '2',
            label: 'Members',
            icon: Users,
            description: 'Assign users to active organizations.',
            ready: canManageOrganizations && activeOrgs > 0,
            complete: activeOrgs > 0 && orgsWithMembersCount === activeOrgs,
            counter: `${orgsWithMembersCount}/${activeOrgs || 0} staffed`,
            blocker: !canManageOrganizations
                ? 'Requires organization management permission.'
                : (activeOrgs > 0 ? '' : 'Activate at least one organization in Step 1.')
        },
        {
            id: 'sharing',
            step: '3',
            label: 'Sharing',
            icon: Share2,
            description: 'Configure cross-organization project and goal sharing.',
            ready: canManageSharingRequests && activeOrgs > 1,
            complete: activeOrgs > 1 && selectedOrgSharedCount > 0,
            counter: selectedOrgId ? `${selectedOrgSharedCount} shared` : 'Select org',
            blocker: !canManageSharingRequests
                ? 'Requires data sharing management permission.'
                : (activeOrgs > 1 ? '' : 'Activate at least two organizations to enable sharing.')
        }
    ]), [activeOrgs, canManageOrganizations, canManageSharingRequests, organizations.length, orgsWithMembersCount, selectedOrgId, selectedOrgSharedCount]);

    const visibleWorkflowSteps = useMemo(
        () => workflowSteps.filter((step) => availableSections.includes(step.id)),
        [availableSections, workflowSteps]
    );

    const getStepState = useCallback((step) => {
        if (!step.ready) return 'not-ready';
        if (step.complete) return 'complete';
        return 'ready';
    }, []);

    // Selection state helpers
    const allVisibleProjectsSelected = useMemo(() => (
        visibleProjects.length > 0 &&
        visibleProjects.every((project) => selectedProjectIds.has(String(project.id)))
    ), [visibleProjects, selectedProjectIds]);

    const someProjectsSelected = selectedProjectIds.size > 0;

    const allVisibleGoalsSelected = useMemo(() => (
        visibleGoalRoots.length > 0 &&
        visibleGoalRoots.every((goal) => selectedGoalIds.has(String(goal.id || goal.goalId)))
    ), [visibleGoalRoots, selectedGoalIds]);

    const someGoalsSelected = selectedGoalIds.size > 0;

    const allFilteredUnassignedUsersSelected = useMemo(() => {
        if (!selectedOrgForMembers) return false;
        const unassigned = filteredUsers.filter(u => String(u.orgId) !== String(selectedOrgForMembers));
        return unassigned.length > 0 && unassigned.every(u => selectedUserIds.has(u.oid));
    }, [filteredUsers, selectedUserIds, selectedOrgForMembers]);

    const someUsersSelected = selectedUserIds.size > 0;

    if (loading) {
        return <div className="org-loading"><div className="org-loading-spinner" /><span>Loading organizations...</span></div>;
    }

    if (visibleWorkflowSteps.length === 0) {
        return (
            <div className="org-loading">
                <span>No organization administration actions are available for your account.</span>
            </div>
        );
    }

    return (
        <div className="org-manager">
            {/* Overview Bar */}
            <div className="org-overview-bar">
                <div className="org-overview-stat">
                    <div className="org-overview-number">{organizations.length}</div>
                    <div className="org-overview-label">Organizations</div>
                </div>
                <div className="org-overview-divider" />
                <div className="org-overview-stat">
                    <div className="org-overview-number">{activeOrgs}</div>
                    <div className="org-overview-label">Active</div>
                </div>
                <div className="org-overview-divider" />
                <div className="org-overview-stat">
                    <div className="org-overview-number">{totalMembers}</div>
                    <div className="org-overview-label">Total Members</div>
                </div>
                {currentUser?.organization && (
                    <>
                        <div className="org-overview-divider" />
                        <div className="org-overview-stat highlight">
                            <div className="org-overview-number">{currentUser.organization.name}</div>
                            <div className="org-overview-label">Your Organization</div>
                        </div>
                    </>
                )}
            </div>

            {/* Guided Workflow Navigation */}
            <div className="org-workflow-nav">
                {visibleWorkflowSteps.map((step) => {
                    const StepIcon = step.icon;
                    const state = getStepState(step);
                    return (
                        <button
                            key={step.id}
                            className={`org-workflow-card ${activeSection === step.id ? 'active' : ''} ${state}`}
                            onClick={() => openSection(step.id)}
                            disabled={!step.ready}
                        >
                            <div className="org-workflow-card-head">
                                <span className="org-workflow-label">
                                    <span className="org-workflow-index">{step.step}</span>
                                    <StepIcon size={14} />
                                    {step.label}
                                </span>
                                <span className={`org-workflow-badge ${state}`}>
                                    {state === 'not-ready' ? 'Not Ready' : state === 'complete' ? 'Complete' : 'Ready'}
                                </span>
                            </div>
                            <div className="org-workflow-card-body">
                                <p>{step.description}</p>
                                <div className="org-workflow-meta">
                                    <span>{step.counter}</span>
                                    {step.blocker && <span className="org-workflow-blocker">{step.blocker}</span>}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* ────────── SECTION: Organizations ────────── */}
            {activeSection === 'orgs' && (
                <div className="org-section-panel">
                    <div className="org-section-header">
                        <div>
                            <h3><Building2 size={18} /> Step 1 of 3: Organizations</h3>
                            <p className="org-section-subtitle">Create and manage organizational units for data isolation.</p>
                        </div>
                        <button className="btn-primary btn-sm" onClick={() => { setShowCreateForm(!showCreateForm); if (editingOrg) resetForm(); }}>
                            <Plus size={14} /> {showCreateForm ? 'Cancel' : 'New Organization'}
                        </button>
                    </div>

                    {/* Create / Edit Form */}
                    {showCreateForm && (
                        <div className="org-form-card">
                            <h4>{editingOrg ? 'Edit Organization' : 'Create New Organization'}</h4>
                            <div className="org-form-grid">
                                <div className="org-field">
                                    <label>Organization Name</label>
                                    <input
                                        type="text"
                                        value={formName}
                                        onChange={(e) => handleNameChange(e.target.value)}
                                        placeholder="e.g. Health Services Division"
                                        autoFocus
                                    />
                                </div>
                                <div className="org-field">
                                    <label>URL Slug</label>
                                    <div className="org-slug-input">
                                        <span className="org-slug-prefix">/</span>
                                        <input
                                            type="text"
                                            value={formSlug}
                                            onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                            placeholder="health-services"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="org-form-footer">
                                <button className="btn-primary btn-sm" onClick={editingOrg ? handleUpdate : handleCreate} disabled={!formName.trim() || !formSlug.trim()}>
                                    <Check size={14} /> {editingOrg ? 'Save Changes' : 'Create Organization'}
                                </button>
                                <button className="btn-ghost btn-sm" onClick={resetForm}>
                                    <X size={14} /> Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Organization Cards */}
                    <div className="org-card-grid">
                        {organizations.map(org => (
                            <div key={org.id} className={`org-card ${!org.isActive ? 'org-card-inactive' : ''}`}>
                                <div className="org-card-top">
                                    <div className="org-card-icon">
                                        <Building2 size={20} />
                                    </div>
                                    <div className="org-card-title">
                                        <h4>{org.name}</h4>
                                        <span className="org-card-slug">/{org.slug}</span>
                                    </div>
                                    <span className={`org-status-pill ${org.isActive ? 'active' : 'inactive'}`}>
                                        <CircleDot size={10} />
                                        {org.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                <div className="org-card-stats">
                                    <div className="org-card-stat">
                                        <Users size={13} />
                                        <span>{org.memberCount || 0} member{org.memberCount !== 1 ? 's' : ''}</span>
                                    </div>
                                </div>
                                <div className="org-card-actions">
                                    <button className="org-action-btn" onClick={() => startEdit(org)} title="Edit">
                                        <Edit3 size={13} /> Edit
                                    </button>
                                    <button
                                        className={`org-action-btn ${org.isActive ? 'warn' : 'success'}`}
                                        onClick={() => handleToggleActive(org)}
                                        title={org.isActive ? 'Deactivate' : 'Activate'}
                                    >
                                        {org.isActive ? <><ToggleRight size={13} /> Deactivate</> : <><ToggleLeft size={13} /> Activate</>}
                                    </button>
                                </div>
                            </div>
                        ))}

                        {organizations.length === 0 && (
                            <div className="org-empty-state">
                                <Building2 size={36} />
                                <h4>No organizations yet</h4>
                                <p>Create your first organization to start isolating data between teams.</p>
                                <button className="btn-primary btn-sm" onClick={() => setShowCreateForm(true)}>
                                    <Plus size={14} /> Create Organization
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="org-info-note">
                        <Shield size={14} />
                                <span>Visibility follows your assigned permissions and organization access scope.</span>
                    </div>
                </div>
            )}

            {/* ────────── SECTION: Member Assignment ────────── */}
            {activeSection === 'members' && (
                <div className="org-section-panel">
                    <div className="org-section-header">
                        <div>
                            <h3><Users size={18} /> Step 2 of 3: Member Assignment</h3>
                            <p className="org-section-subtitle">Assign users to the selected active organization.</p>
                        </div>
                    </div>
                    {activeOrganizations.length === 0 && (
                        <p className="org-step-warning">Activate at least one organization in Step 1 before assigning members.</p>
                    )}

                    <div className="org-sharing-layout">
                        {/* Org Selector Sidebar */}
                        <div className="org-sharing-sidebar">
                            <label className="org-field-label">Selected Organization</label>
                            <div className="org-member-org-list">
                                {activeOrganizations.map(org => (
                                    <button
                                        key={org.id}
                                        className={`org-member-org-btn ${String(selectedOrgForMembers) === String(org.id) ? 'selected' : ''}`}
                                        onClick={() => handleSelectOrg(org.id)}
                                    >
                                        <Building2 size={14} />
                                        <span className="org-member-org-name">{org.name}</span>
                                        <span className="org-member-org-count">{org.memberCount || 0}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* User List Main Panel */}
                        <div className="org-sharing-main">
                            {selectedOrgForMembers ? (
                                <>
                                    <div className="org-sharing-main-header">
                                        <h4>
                                            Manage members of <strong>{organizations.find(o => o.id === selectedOrgForMembers)?.name}</strong>
                                        </h4>
                                        <div className="org-sharing-summary-badges">
                                            <span className="org-sharing-summary-badge">
                                                {filteredUsers.filter(u => String(u.orgId) === String(selectedOrgForMembers)).length} assigned
                                            </span>
                                            <span className="org-sharing-summary-badge">
                                                {allUsers.length} total users
                                            </span>
                                        </div>
                                    </div>

                                    {/* Search & Bulk Actions */}
                                    <div className="org-sharing-toolbar" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                        <div className="org-sharing-search-box" style={{ flex: 1 }}>
                                            <Search size={14} />
                                            <input
                                                type="text"
                                                placeholder="Search users by name or email..."
                                                value={userSearchQuery}
                                                onChange={(e) => setUserSearchQuery(e.target.value)}
                                            />
                                            {userSearchQuery && (
                                                <button className="org-sharing-search-clear" onClick={() => setUserSearchQuery('')}>
                                                    <X size={12} />
                                                </button>
                                            )}
                                        </div>
                                        {someUsersSelected && (
                                            <button
                                                className="btn-primary btn-sm"
                                                onClick={handleBulkAssignUsers}
                                                disabled={bulkAssigningUsers}
                                            >
                                                {bulkAssigningUsers ? <RefreshCw className="spin" size={14} /> : <UserPlus size={14} />}
                                                Assign Selected ({selectedUserIds.size})
                                            </button>
                                        )}
                                    </div>

                                    {/* User List Header (for select all) */}
                                    {filteredUsers.length > 0 && (
                                        <div className="org-sharing-list-header" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            <input
                                                type="checkbox"
                                                checked={allFilteredUnassignedUsersSelected}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        const unassigned = filteredUsers.filter(u => String(u.orgId) !== String(selectedOrgForMembers));
                                                        setSelectedUserIds(new Set(unassigned.map(u => u.oid)));
                                                    } else {
                                                        setSelectedUserIds(new Set());
                                                    }
                                                }}
                                                className="org-sharing-checkbox"
                                                title="Select all unassigned users in view"
                                            />
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Select All Unassigned</span>
                                        </div>
                                    )}

                                    {/* User List */}
                                    <div className="org-sharing-item-list">
                                        {loadingAllUsers ? (
                                            <div className="org-member-hint">Loading users...</div>
                                        ) : filteredUsers.length === 0 ? (
                                            <div className="org-member-hint">
                                                {userSearchQuery ? `No users matching "${userSearchQuery}"` : 'No users found'}
                                            </div>
                                        ) : (
                                            filteredUsers.map(user => {
                                                const isAssigned = String(user.orgId) === String(selectedOrgForMembers);
                                                const isInOtherOrg = user.orgId && String(user.orgId) !== String(selectedOrgForMembers);
                                                const isSelected = selectedUserIds.has(user.oid);

                                                return (
                                                    <div
                                                        key={user.oid}
                                                        className={`org-sharing-item ${isAssigned ? 'shared' : ''} ${isSelected ? 'selected' : ''}`}
                                                        onClick={() => !isAssigned && toggleUserSelection(user.oid)}
                                                        style={{ cursor: isAssigned ? 'default' : 'pointer' }}
                                                    >
                                                        {!isAssigned && (
                                                            <div className="org-sharing-item-check" onClick={e => e.stopPropagation()}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={() => toggleUserSelection(user.oid)}
                                                                    className="org-sharing-checkbox"
                                                                />
                                                            </div>
                                                        )}
                                                        {isAssigned && <div style={{ width: '24px' }}></div>} {/* Spacer to align with checkboxes */}

                                                        <div className="org-member-avatar">{(user.name || '?')[0].toUpperCase()}</div>
                                                        <div className="org-sharing-item-info">
                                                            <div className="org-sharing-item-name">
                                                                {user.name || 'Unknown'}
                                                                {isInOtherOrg && (
                                                                    <span className="org-sharing-tag-chip">{user.orgName}</span>
                                                                )}
                                                            </div>
                                                            <div className="org-sharing-item-tags">
                                                                <span className="org-sharing-tag-chip">{user.email || 'No email'}</span>
                                                            </div>
                                                        </div>
                                                        <div className="org-sharing-item-status">
                                                            {isAssigned ? (
                                                                <>
                                                                    <span className="org-access-badge write">
                                                                        <Check size={10} /> Assigned
                                                                    </span>
                                                                    <button
                                                                        className="org-sharing-quick-remove"
                                                                        title="Remove from organization"
                                                                        onClick={(e) => { e.stopPropagation(); handleRemoveFromOrg(user.oid); }}
                                                                    >
                                                                        <X size={12} />
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <button
                                                                    className="org-action-btn success"
                                                                    onClick={(e) => { e.stopPropagation(); handleAssignUser(user.oid, selectedOrgForMembers); }}
                                                                >
                                                                    <UserPlus size={12} /> Assign
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    <div className="org-sharing-list-footer">
                                        Showing {filteredUsers.length} of {allUsers.length} users
                                        {filteredUsers.filter(u => String(u.orgId) === String(selectedOrgForMembers)).length > 0 &&
                                            ` · ${filteredUsers.filter(u => String(u.orgId) === String(selectedOrgForMembers)).length} assigned to this org`}
                                    </div>
                                </>
                            ) : (
                                <div className="org-member-placeholder">
                                    <Users size={28} />
                                    <p>Select an active organization to manage members.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="org-info-note">
                        <Shield size={14} />
                        <span>Users already assigned to another organization are shown with their current org. Assigning them here will move them to this organization.</span>
                    </div>
                </div>
            )}

            {/* ────────── SECTION: Data Sharing ────────── */}
            {activeSection === 'sharing' && (
                <div className="org-section-panel">
                    <div className="org-section-header">
                        <div>
                            <h3><Share2 size={18} /> Step 3 of 3: Cross-Organization Sharing</h3>
                            <p className="org-section-subtitle">Choose what other organizations share with the selected recipient organization.</p>
                        </div>
                    </div>
                    {activeOrganizations.length < 2 && (
                        <p className="org-step-warning">Activate at least two organizations in Step 1 before configuring sharing.</p>
                    )}

                    <div className="org-sharing-layout">
                        {/* Org Selector Sidebar */}
                        <div className="org-sharing-sidebar">
                            <label className="org-field-label">Recipient Organization</label>
                            <div className="org-member-org-list">
                                {activeOrganizations.map(org => (
                                    <button
                                        key={org.id}
                                        className={`org-member-org-btn ${String(sharingTargetOrg) === String(org.id) ? 'selected' : ''}`}
                                        onClick={() => handleSelectOrg(org.id)}
                                    >
                                        <Building2 size={14} />
                                        <span className="org-member-org-name">{org.name}</span>
                                        <span className="org-sharing-badge-count">
                                            {selectedOrgSharedCount > 0 && String(sharingTargetOrg) === String(org.id)
                                                ? `${selectedOrgSharedCount}`
                                                : ''
                                            }
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Main Content Area */}
                        <div className="org-sharing-main">
                            {sharingTargetOrg ? (
                                <>
                                    {/* Sharing header */}
                                    <div className="org-sharing-main-header">
                                        <h4>
                                            <ChevronRight size={14} />
                                            Share data with <strong>{sharingTargetOrgObj?.name || 'Organization'}</strong>
                                        </h4>
                                        <div className="org-sharing-summary-badges">
                                            <span className="org-sharing-summary-badge">
                                                {selectedOrgAvailableCount} available to share
                                            </span>
                                            <span className="org-sharing-summary-badge">
                                                {selectedOrgSharedCount} currently shared
                                            </span>
                                        </div>
                                    </div>

                                    <div className="org-info-note">
                                        <Share2 size={14} />
                                        <span>Only cross-organization items appear here. Items already owned by <strong>{sharingTargetOrgObj?.name || 'this organization'}</strong> are hidden because they do not need sharing.</span>
                                    </div>

                                    {/* Sub-tabs: Projects | Goals */}
                                    <div className="org-sharing-sub-tabs">
                                        <button
                                            className={`org-sharing-sub-tab ${sharingSubTab === 'projects' ? 'active' : ''}`}
                                            onClick={() => {
                                                openSharingSubTab('projects');
                                                setSharingViewState('available');
                                                setSelectedGoalIds(new Set());
                                            }}
                                        >
                                            <Filter size={13} /> Projects ({allAvailableProjects.length + allSharedProjects.length})
                                        </button>
                                        <button
                                            className={`org-sharing-sub-tab ${sharingSubTab === 'goals' ? 'active' : ''}`}
                                            onClick={() => {
                                                openSharingSubTab('goals');
                                                setSharingViewState('available');
                                                setSelectedProjectIds(new Set());
                                            }}
                                        >
                                            <Target size={13} /> Goals ({allAvailableRootGoals.length + allSharedRootGoals.length})
                                        </button>
                                    </div>

                                    {isSharingSummaryLoading ? (
                                        <div className="org-member-hint">Loading sharing data...</div>
                                    ) : sharingSubTab === 'projects' ? (
                                        /* ─── Projects Tab ─── */
                                        <div className="org-sharing-list-panel">
                                            <div className="org-sharing-view-toggle">
                                                <button
                                                    className={`org-sharing-view-btn ${sharingView === 'available' ? 'active' : ''}`}
                                                    onClick={() => setSharingViewState('available')}
                                                >
                                                    Available to Share ({allAvailableProjects.length})
                                                </button>
                                                <button
                                                    className={`org-sharing-view-btn ${sharingView === 'shared' ? 'active' : ''}`}
                                                    onClick={() => setSharingViewState('shared')}
                                                >
                                                    Currently Shared ({allSharedProjects.length})
                                                </button>
                                            </div>
                                            {/* Toolbar */}
                                            <div className="org-sharing-toolbar">
                                                <div className="org-sharing-search-box">
                                                    <Search size={14} />
                                                    <input
                                                        type="text"
                                                        placeholder="Search projects by name or tag..."
                                                        value={projectSearch}
                                                        onChange={(e) => setProjectSearch(e.target.value)}
                                                    />
                                                    {projectSearch && (
                                                        <button className="org-sharing-search-clear" onClick={() => setProjectSearch('')}>
                                                            <X size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="org-sharing-toolbar-actions">
                                                    <button
                                                        className="org-sharing-select-btn"
                                                        onClick={allVisibleProjectsSelected ? deselectAllProjects : selectAllVisibleProjects}
                                                    >
                                                        {allVisibleProjectsSelected ? <MinusSquare size={13} /> : <CheckSquare size={13} />}
                                                        {allVisibleProjectsSelected ? 'Deselect All' : 'Select All'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Bulk Action Bar (visible when items selected) */}
                                            {someProjectsSelected && (
                                                <div className="org-sharing-bulk-bar">
                                                    <span className="org-sharing-bulk-count">
                                                        {selectedProjectIds.size} selected
                                                    </span>
                                                    <div className="org-sharing-bulk-actions">
                                                        {sharingView === 'available' && (
                                                            <>
                                                                <select
                                                                    value={shareAccessLevel}
                                                                    onChange={(e) => setShareAccessLevel(e.target.value)}
                                                                    className="org-sharing-access-select"
                                                                >
                                                                    <option value="read">Read Only</option>
                                                                    <option value="write">Read & Write</option>
                                                                </select>
                                                                <input
                                                                    type="datetime-local"
                                                                    value={shareExpiresAt}
                                                                    onChange={(e) => setShareExpiresAt(e.target.value)}
                                                                    className="org-sharing-access-select"
                                                                    title="Optional expiry for new sharing grants"
                                                                />
                                                                <button
                                                                    className="btn-primary btn-sm"
                                                                    onClick={handleBulkShareProjects}
                                                                    disabled={bulkActionLoading}
                                                                >
                                                                    <Share2 size={13} />
                                                                    {bulkActionLoading ? 'Sharing...' : `Share ${selectedProjectIds.size}`}
                                                                </button>
                                                            </>
                                                        )}
                                                        {sharingView === 'shared' && (
                                                            <button
                                                                className="org-action-btn danger"
                                                                onClick={handleBulkUnshareProjects}
                                                                disabled={bulkActionLoading}
                                                            >
                                                                <Trash2 size={13} />
                                                                {bulkActionLoading ? 'Removing...' : `Unshare ${selectedProjectIds.size}`}
                                                            </button>
                                                        )}
                                                        <button className="org-sharing-select-btn" onClick={deselectAllProjects}>
                                                            <X size={12} /> Clear
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Project List */}
                                            <div className="org-sharing-item-list">
                                                {visibleProjects.length === 0 ? (
                                                    <div className="org-member-hint">
                                                        {projectSearch
                                                            ? `No projects matching "${projectSearch}"`
                                                            : (sharingView === 'available'
                                                                ? 'No cross-org items available to share'
                                                                : 'No items are currently shared with this organization')}
                                                    </div>
                                                ) : (
                                                    visibleProjects.map(project => {
                                                        const isShared = sharingView === 'shared';
                                                        const isSelected = selectedProjectIds.has(String(project.id));
                                                        const shareInfo = project;

                                                        return (
                                                            <div
                                                                key={project.id}
                                                                className={`org-sharing-item ${isShared ? 'shared' : ''} ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => toggleProjectSelect(String(project.id))}
                                                            >
                                                                <div className="org-sharing-item-checkbox">
                                                                    {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                                                </div>
                                                                <div className="org-sharing-item-info">
                                                                    <span className="org-sharing-item-name">{project.title}</span>
                                                                    <span className="org-sharing-owner-line">
                                                                        Owned by {project.ownerOrgName || 'Unknown organization'}
                                                                    </span>
                                                                    {project.tags && project.tags.length > 0 && (
                                                                        <div className="org-sharing-item-tags">
                                                                            {project.tags.slice(0, 3).map(t => (
                                                                                <span key={t.tagId || t.id} className="org-sharing-tag-chip">{t.tagName || t.name}</span>
                                                                            ))}
                                                                            {project.tags.length > 3 && (
                                                                                <span className="org-sharing-tag-chip more">+{project.tags.length - 3}</span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <div className="org-sharing-item-tags">
                                                                        {Number(project.linkedGoalCount || 0) > 0 && (
                                                                            <span className="org-sharing-tag-chip">
                                                                                {project.linkedGoalCount} linked goal{Number(project.linkedGoalCount || 0) === 1 ? '' : 's'}
                                                                            </span>
                                                                        )}
                                                                        {Number(project.externalGoalLinkCount || 0) > 0 && (
                                                                            <span className="org-sharing-tag-chip">
                                                                                Project linked to external-org goal
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                {isShared && (
                                                                    <div className="org-sharing-item-status">
                                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem' }}>
                                                                            <span className={`org-access-badge ${shareInfo?.accessLevel || 'read'}`}>
                                                                                {shareInfo?.accessLevel === 'write' ? <PenTool size={10} /> : <Eye size={10} />}
                                                                                {shareInfo?.accessLevel === 'write' ? 'Write' : 'Read'}
                                                                            </span>
                                                                            {shareInfo?.expiresAt && (
                                                                                <span className="org-access-badge-mini">expires {formatDateTime(shareInfo.expiresAt)}</span>
                                                                            )}
                                                                            {shareInfo?.goalContextStatus === 'none-shared' && (
                                                                                <span className="org-access-badge-mini warn">goal context missing</span>
                                                                            )}
                                                                            {shareInfo?.goalContextStatus === 'partial' && (
                                                                                <span className="org-access-badge-mini warn">goal context partial</span>
                                                                            )}
                                                                            {(shareInfo?.goalContextStatus === 'none-shared' || shareInfo?.goalContextStatus === 'partial') && (
                                                                                <button
                                                                                    type="button"
                                                                                    className="org-access-badge-mini warn"
                                                                                    style={{ cursor: ensuringProjectGoalContextId === String(project.id) ? 'wait' : 'pointer', border: 'none' }}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        handleEnsureProjectGoalContext(project.id, shareInfo);
                                                                                    }}
                                                                                    disabled={ensuringProjectGoalContextId === String(project.id)}
                                                                                >
                                                                                    {ensuringProjectGoalContextId === String(project.id) ? 'Sharing linked goals...' : 'Share linked goals'}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        <button
                                                                            className="org-sharing-quick-remove"
                                                                            onClick={(e) => { e.stopPropagation(); handleQuickUnshareProject(project.id); }}
                                                                            title="Remove sharing"
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>

                                            <div className="org-sharing-list-footer">
                                                {sharingView === 'available'
                                                    ? `Showing ${visibleAvailableProjects.length} available project${visibleAvailableProjects.length !== 1 ? 's' : ''}`
                                                    : `Showing ${visibleSharedProjects.length} currently shared project${visibleSharedProjects.length !== 1 ? 's' : ''}`}
                                            </div>
                                        </div>
                                    ) : (
                                        /* ─── Goals Tab ─── */
                                        <div className="org-sharing-list-panel">
                                            <div className="org-sharing-view-toggle">
                                                <button
                                                    className={`org-sharing-view-btn ${sharingView === 'available' ? 'active' : ''}`}
                                                    onClick={() => setSharingViewState('available')}
                                                >
                                                    Available to Share ({allAvailableRootGoals.length})
                                                </button>
                                                <button
                                                    className={`org-sharing-view-btn ${sharingView === 'shared' ? 'active' : ''}`}
                                                    onClick={() => setSharingViewState('shared')}
                                                >
                                                    Currently Shared ({allSharedRootGoals.length})
                                                </button>
                                            </div>
                                            {/* Toolbar */}
                                            <div className="org-sharing-toolbar">
                                                <div className="org-sharing-search-box">
                                                    <Search size={14} />
                                                    <input
                                                        type="text"
                                                        placeholder="Search goals..."
                                                        value={goalSearch}
                                                        onChange={(e) => setGoalSearch(e.target.value)}
                                                    />
                                                    {goalSearch && (
                                                        <button className="org-sharing-search-clear" onClick={() => setGoalSearch('')}>
                                                            <X size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="org-sharing-toolbar-actions">
                                                    <button
                                                        className="org-sharing-select-btn"
                                                        onClick={allVisibleGoalsSelected ? deselectAllGoals : selectAllVisibleGoals}
                                                    >
                                                        {allVisibleGoalsSelected ? <MinusSquare size={13} /> : <CheckSquare size={13} />}
                                                        {allVisibleGoalsSelected ? 'Deselect All' : 'Select All'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Bulk Action Bar */}
                                            {someGoalsSelected && (
                                                <div className="org-sharing-bulk-bar">
                                                    <span className="org-sharing-bulk-count">
                                                        {selectedGoalIds.size} selected
                                                    </span>
                                                    <div className="org-sharing-bulk-actions">
                                                        {sharingView === 'available' && (
                                                            <>
                                                                <select
                                                                    value={shareAccessLevel}
                                                                    onChange={(e) => setShareAccessLevel(e.target.value)}
                                                                    className="org-sharing-access-select"
                                                                >
                                                                    <option value="read">Read Only</option>
                                                                    <option value="write">Read & Write</option>
                                                                </select>
                                                                <input
                                                                    type="datetime-local"
                                                                    value={shareExpiresAt}
                                                                    onChange={(e) => setShareExpiresAt(e.target.value)}
                                                                    className="org-sharing-access-select"
                                                                    title="Optional expiry for new sharing grants"
                                                                />
                                                                <button
                                                                    className="btn-primary btn-sm"
                                                                    onClick={handleBulkShareGoals}
                                                                    disabled={bulkActionLoading}
                                                                >
                                                                    <Share2 size={13} />
                                                                    {bulkActionLoading ? 'Sharing...' : `Share ${selectedGoalIds.size} (+ sub-goals)`}
                                                                </button>
                                                            </>
                                                        )}
                                                        {sharingView === 'shared' && (
                                                            <button
                                                                className="org-action-btn danger"
                                                                onClick={handleBulkUnshareGoals}
                                                                disabled={bulkActionLoading}
                                                            >
                                                                <Trash2 size={13} />
                                                                {bulkActionLoading ? 'Removing...' : `Unshare ${selectedGoalIds.size}`}
                                                            </button>
                                                        )}
                                                        <button className="org-sharing-select-btn" onClick={deselectAllGoals}>
                                                            <X size={12} /> Clear
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Goal List */}
                                            <div className="org-sharing-item-list">
                                                {visibleGoalRoots.length === 0 ? (
                                                    <div className="org-member-hint">
                                                        {goalSearch
                                                            ? `No goals matching "${goalSearch}"`
                                                            : (sharingView === 'available'
                                                                ? 'No cross-org items available to share'
                                                                : 'No items are currently shared with this organization')}
                                                    </div>
                                                ) : (
                                                    visibleGoalRoots.map(goal => {
                                                        const goalId = String(goal.id || goal.goalId);
                                                        const isShared = sharingView === 'shared';
                                                        const isSelected = selectedGoalIds.has(goalId);
                                                        const childGoals = goalChildrenByParentId.get(goalId) || [];
                                                        const shareInfo = goal;

                                                        return (
                                                            <div key={goalId} className="org-sharing-goal-group">
                                                                <div
                                                                    className={`org-sharing-item goal ${isShared ? 'shared' : ''} ${isSelected ? 'selected' : ''}`}
                                                                    onClick={() => toggleGoalSelect(goalId)}
                                                                >
                                                                    <div className="org-sharing-item-checkbox">
                                                                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                                                    </div>
                                                                    <div className="org-sharing-item-info">
                                                                        <span className="org-sharing-item-name">
                                                                            <Target size={13} className="org-sharing-goal-icon" />
                                                                            {goal.title}
                                                                        </span>
                                                                        <span className="org-sharing-owner-line">
                                                                            Owned by {goal.ownerOrgName || 'Unknown organization'}
                                                                        </span>
                                                                        <span className="org-sharing-goal-meta">
                                                                            {getGoalTypeLabel(goal.type)} - {childGoals.length} sub-goal{childGoals.length !== 1 ? 's' : ''}
                                                                            {goal.kpis?.length > 0 && ` - ${goal.kpis.length} KPI${goal.kpis.length !== 1 ? 's' : ''}`}
                                                                        </span>
                                                                    </div>
                                                                    {isShared && (
                                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem' }}>
                                                                            <span className={`org-access-badge ${(shareInfo?.accessLevel || 'read')}`}>
                                                                                {(shareInfo?.accessLevel || 'read') === 'write' ? <PenTool size={10} /> : <Eye size={10} />}
                                                                                {(shareInfo?.accessLevel || 'read') === 'write' ? 'Write' : 'Read'}
                                                                            </span>
                                                                            {shareInfo?.expiresAt && (
                                                                                <span className="org-access-badge-mini">expires {formatDateTime(shareInfo.expiresAt)}</span>
                                                                            )}
                                                                            {shareInfo?.hasDescendantShare && !shareInfo?.hasDirectShare && (
                                                                                <span className="org-access-badge-mini">descendant share</span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {childGoals.length > 0 && (
                                                                    <div className="org-sharing-goal-children">
                                                                        {childGoals.map(child => (
                                                                            <div key={child.id} className={`org-sharing-child-row ${sharedGoalIds.has(String(child.id)) ? 'shared' : ''}`}>
                                                                                <span className="org-sharing-child-indent">↳</span>
                                                                                <span className="org-sharing-child-name">
                                                                                    {child.title}
                                                                                    {child.ownerOrgName && child.ownerOrgName !== goal.ownerOrgName && (
                                                                                        <span className="org-sharing-child-owner">Owned by {child.ownerOrgName}</span>
                                                                                    )}
                                                                                </span>
                                                                                {sharedGoalIds.has(String(child.id)) && (
                                                                                    <span className="org-access-badge-mini">shared</span>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>

                                            <div className="org-sharing-list-footer">
                                                {sharingView === 'available'
                                                    ? `Showing ${visibleAvailableRootGoals.length} available goal tree${visibleAvailableRootGoals.length !== 1 ? 's' : ''}`
                                                    : `Showing ${visibleSharedRootGoals.length} currently shared goal tree${visibleSharedRootGoals.length !== 1 ? 's' : ''}`}
                                            </div>

                                            <div className="org-info-note">
                                                <Target size={14} />
                                                <span>Sharing a goal automatically shares its <strong>sub-goals</strong> and <strong>KPIs/metrics</strong> with the recipient organization.</span>
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="org-member-placeholder">
                                    <Share2 size={28} />
                                    <p>Select a recipient organization from the left to manage cross-organization sharing.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

