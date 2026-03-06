import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, RefreshCw, Save, Search, Settings2, Users, ArrowUp, ArrowDown } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';

const DEFAULT_CRITERIA = [
    { id: 'strategic-alignment', name: 'Strategic alignment', weight: 30, enabled: true, sortOrder: 1 },
    { id: 'impact', name: 'Patient/operational impact', weight: 25, enabled: true, sortOrder: 2 },
    { id: 'urgency', name: 'Regulatory/safety urgency', weight: 20, enabled: true, sortOrder: 3 },
    { id: 'feasibility', name: 'Delivery feasibility/capacity fit', weight: 15, enabled: true, sortOrder: 4 },
    { id: 'cost-efficiency', name: 'Cost efficiency', weight: 10, enabled: true, sortOrder: 5 }
];

const cloneCriteria = (criteria) => {
    if (!Array.isArray(criteria) || criteria.length === 0) {
        return DEFAULT_CRITERIA.map(item => ({ ...item }));
    }
    return criteria.map((item, idx) => ({
        id: item.id || `criterion-${idx + 1}`,
        name: item.name || '',
        weight: Number(item.weight) || 0,
        enabled: item.enabled !== false,
        sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : idx + 1
    }));
};

const normalizeCriteriaForSave = (criteria) => {
    return criteria.map((item, idx) => ({
        id: item.id || `criterion-${idx + 1}`,
        name: String(item.name || '').trim(),
        weight: Number(item.weight) || 0,
        enabled: item.enabled !== false,
        sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : idx + 1
    }));
};

export function GovernanceConfig() {
    const {
        getGovernanceSettings,
        updateGovernanceSettings,
        fetchGovernanceUsers,
        fetchGovernanceBoards,
        createGovernanceBoard,
        updateGovernanceBoard,
        fetchGovernanceBoardMembers,
        upsertGovernanceBoardMember,
        fetchGovernanceCriteriaVersions,
        createGovernanceCriteriaVersion,
        updateGovernanceCriteriaVersion,
        publishGovernanceCriteriaVersion
    } = useData();
    const toast = useToast();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [boardSaving, setBoardSaving] = useState(false);
    const [memberSaving, setMemberSaving] = useState(false);
    const [criteriaSaving, setCriteriaSaving] = useState(false);

    const [governanceEnabled, setGovernanceEnabled] = useState(false);
    const [quorumPercent, setQuorumPercent] = useState(60);
    const [quorumMinCount, setQuorumMinCount] = useState(1);
    const [decisionRequiresQuorum, setDecisionRequiresQuorum] = useState(true);
    const [voteWindowDays, setVoteWindowDays] = useState('');
    const [phase3Ready, setPhase3Ready] = useState(false);
    const [boardPolicyReady, setBoardPolicyReady] = useState(false);
    const [boards, setBoards] = useState([]);
    const [selectedBoardId, setSelectedBoardId] = useState('');
    const [selectedBoardName, setSelectedBoardName] = useState('');
    const [selectedBoardActive, setSelectedBoardActive] = useState(true);
    const [selectedBoardUseGlobalPolicyDefaults, setSelectedBoardUseGlobalPolicyDefaults] = useState(true);
    const [selectedBoardQuorumPercent, setSelectedBoardQuorumPercent] = useState(60);
    const [selectedBoardQuorumMinCount, setSelectedBoardQuorumMinCount] = useState(1);
    const [selectedBoardDecisionRequiresQuorum, setSelectedBoardDecisionRequiresQuorum] = useState(true);
    const [selectedBoardVoteWindowDays, setSelectedBoardVoteWindowDays] = useState('');
    const [newBoardName, setNewBoardName] = useState('');
    const [newBoardActive, setNewBoardActive] = useState(true);
    const [boardSearch, setBoardSearch] = useState('');
    const [boardCriteriaMeta, setBoardCriteriaMeta] = useState({});

    const [members, setMembers] = useState([]);
    const [availableUsers, setAvailableUsers] = useState([]);
    const [memberUserSearch, setMemberUserSearch] = useState('');
    const [usersLoading, setUsersLoading] = useState(false);
    const [memberUserOid, setMemberUserOid] = useState('');
    const [memberRole, setMemberRole] = useState('member');

    const [criteriaVersions, setCriteriaVersions] = useState([]);
    const [selectedVersionId, setSelectedVersionId] = useState('');
    const [criteriaDraft, setCriteriaDraft] = useState(cloneCriteria([]));
    const [configTab, setConfigTab] = useState('settings');
    const [settingsDirty, setSettingsDirty] = useState(false);
    const [boardDirty, setBoardDirty] = useState(false);
    const [criteriaDirty, setCriteriaDirty] = useState(false);

    const selectedBoard = useMemo(() => {
        return boards.find(board => String(board.id) === String(selectedBoardId)) || null;
    }, [boards, selectedBoardId]);

    const selectedVersion = useMemo(() => {
        return criteriaVersions.find(version => String(version.id) === String(selectedVersionId)) || null;
    }, [criteriaVersions, selectedVersionId]);

    const filteredBoards = useMemo(() => {
        const query = boardSearch.trim().toLowerCase();
        if (!query) return boards;
        return boards.filter(board => String(board.name || '').toLowerCase().includes(query));
    }, [boards, boardSearch]);

    const boardProgressMeta = useMemo(() => {
        return boards.reduce((acc, board) => {
            const criteriaMeta = boardCriteriaMeta[board.id] || { publishedCount: 0, draftCount: 0, totalCount: 0 };
            const checks = [
                !!board.isActive,
                Number(board.activeMemberCount || 0) > 0,
                Number(criteriaMeta.publishedCount || 0) > 0
            ];
            const completed = checks.filter(Boolean).length;
            acc[board.id] = {
                completed,
                total: checks.length,
                ready: completed === checks.length,
                criteriaMeta
            };
            return acc;
        }, {});
    }, [boards, boardCriteriaMeta]);

    const selectedBoardProgress = selectedBoard ? boardProgressMeta[selectedBoard.id] : null;
    const selectedBoardBlockers = useMemo(() => {
        if (!selectedBoard) return [];
        const criteriaMeta = selectedBoardProgress?.criteriaMeta || { publishedCount: 0 };
        const blockers = [];

        if (!selectedBoard.isActive) {
            blockers.push('Board is inactive. Activate it before using governance for submissions.');
        }
        if (Number(selectedBoard.activeMemberCount || 0) === 0) {
            blockers.push('No active members assigned. Add at least one member in Step 3.');
        }
        if (Number(criteriaMeta.publishedCount || 0) === 0) {
            blockers.push('No published criteria. Publish at least one criteria version in Step 4.');
        }
        return blockers;
    }, [selectedBoard, selectedBoardProgress]);
    const selectedBoardEffectivePolicy = useMemo(() => {
        const fromBoard = selectedBoard?.effectivePolicy || selectedBoard?.policy?.effective || null;
        return {
            quorumPercent: Number(fromBoard?.quorumPercent ?? quorumPercent ?? 60),
            quorumMinCount: Number(fromBoard?.quorumMinCount ?? quorumMinCount ?? 1),
            decisionRequiresQuorum: fromBoard?.decisionRequiresQuorum === undefined
                ? (decisionRequiresQuorum !== false)
                : !!fromBoard.decisionRequiresQuorum,
            voteWindowDays: fromBoard?.voteWindowDays === null || fromBoard?.voteWindowDays === undefined
                ? null
                : Number(fromBoard.voteWindowDays)
        };
    }, [selectedBoard, quorumPercent, quorumMinCount, decisionRequiresQuorum]);
    const activeMembersCount = useMemo(() => {
        return members.filter(member => member.isActive).length;
    }, [members]);
    const chairMembersCount = useMemo(() => {
        return members.filter(member => member.isActive && member.role === 'chair').length;
    }, [members]);
    const selectedBoardCriteriaMeta = selectedBoardProgress?.criteriaMeta || { publishedCount: 0, draftCount: 0, totalCount: 0 };
    const membersStepBlockers = useMemo(() => {
        if (!selectedBoard) return [];
        const blockers = [];
        if (!selectedBoard.isActive) {
            blockers.push('Selected board is inactive. Activate the board in Step 2 first.');
        }
        if (activeMembersCount === 0) {
            blockers.push('Add at least one active member before governance can run.');
        }
        return blockers;
    }, [selectedBoard, activeMembersCount]);
    const activeWeightTotal = useMemo(() => {
        return criteriaDraft
            .filter(item => item.enabled)
            .reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
    }, [criteriaDraft]);

    const criteriaStepBlockers = useMemo(() => {
        if (!selectedBoard) return [];
        const blockers = [];
        if (!selectedBoard.isActive) {
            blockers.push('Selected board is inactive. Activate the board in Step 2 first.');
        }
        if (activeMembersCount === 0) {
            blockers.push('No active members found. Complete Step 3 before publishing criteria.');
        }
        if (criteriaDraft.length === 0) {
            blockers.push('Add at least one criterion to create a valid configuration.');
        }
        if (activeWeightTotal <= 0) {
            blockers.push('Active criteria weight total must be greater than 0.');
        }
        if ((selectedBoardCriteriaMeta.publishedCount || 0) === 0) {
            blockers.push('No published version yet. Publish a draft to complete Step 4.');
        }
        return blockers;
    }, [
        selectedBoard,
        activeMembersCount,
        criteriaDraft.length,
        activeWeightTotal,
        selectedBoardCriteriaMeta.publishedCount
    ]);

    const hasUnsavedChanges = settingsDirty || boardDirty || criteriaDirty;
    const governanceStepReadiness = useMemo(() => {
        const settingsReady = !phase3Ready || (
            Number(quorumPercent) >= 1 &&
            Number(quorumPercent) <= 100 &&
            Number(quorumMinCount) >= 1 &&
            (voteWindowDays === '' || (Number(voteWindowDays) >= 1 && Number(voteWindowDays) <= 90))
        );
        const boardsReady = boards.some(board => board.isActive);
        const membersReady = members.some(member => member.isActive);
        const criteriaReady = criteriaVersions.some(version => version.status === 'published');
        return { settingsReady, boardsReady, membersReady, criteriaReady };
    }, [phase3Ready, quorumPercent, quorumMinCount, voteWindowDays, boards, members, criteriaVersions]);

    const memberOptions = useMemo(() => {
        if (!memberUserOid || availableUsers.some(user => user.oid === memberUserOid)) {
            return availableUsers;
        }

        const existingMember = members.find(member => member.userOid === memberUserOid);
        if (existingMember) {
            return [
                {
                    oid: existingMember.userOid,
                    name: existingMember.userName || existingMember.userEmail || 'Selected user',
                    email: existingMember.userEmail || null
                },
                ...availableUsers
            ];
        }

        return [{ oid: memberUserOid, name: 'Selected user', email: null }, ...availableUsers];
    }, [availableUsers, memberUserOid, members]);

    const selectedMemberOption = useMemo(() => {
        return memberOptions.find(user => user.oid === memberUserOid) || null;
    }, [memberOptions, memberUserOid]);

    const loadBoardReadiness = useCallback(async (boardList) => {
        if (!Array.isArray(boardList) || boardList.length === 0) {
            setBoardCriteriaMeta({});
            return;
        }

        const entries = await Promise.all(boardList.map(async (board) => {
            try {
                const versions = await fetchGovernanceCriteriaVersions(board.id);
                const versionList = Array.isArray(versions) ? versions : [];
                const publishedCount = versionList.filter(v => v.status === 'published').length;
                const draftCount = versionList.filter(v => v.status === 'draft').length;
                return [board.id, { publishedCount, draftCount, totalCount: versionList.length }];
            } catch {
                return [board.id, { publishedCount: 0, draftCount: 0, totalCount: 0 }];
            }
        }));

        setBoardCriteriaMeta(Object.fromEntries(entries));
    }, [fetchGovernanceCriteriaVersions]);

    const loadBoardDetails = useCallback(async (boardId, preferredVersionId = null) => {
        if (!boardId) {
            setMembers([]);
            setCriteriaVersions([]);
            setSelectedVersionId('');
            setCriteriaDraft(cloneCriteria([]));
            return;
        }

        try {
            const [memberResults, versionResults] = await Promise.all([
                fetchGovernanceBoardMembers(boardId, { includeInactive: true }),
                fetchGovernanceCriteriaVersions(boardId)
            ]);
            const memberList = Array.isArray(memberResults) ? memberResults : [];
            setMembers(memberList);
            const activeMemberCount = memberList.filter(member => member.isActive).length;
            setBoards(prev => prev.map(board =>
                String(board.id) === String(boardId)
                    ? { ...board, activeMemberCount }
                    : board
            ));
            const versions = Array.isArray(versionResults) ? versionResults : [];
            setCriteriaVersions(versions);
            setBoardCriteriaMeta(prev => ({
                ...prev,
                [boardId]: {
                    publishedCount: versions.filter(v => v.status === 'published').length,
                    draftCount: versions.filter(v => v.status === 'draft').length,
                    totalCount: versions.length
                }
            }));

            let versionToUse = null;
            if (preferredVersionId) {
                versionToUse = versions.find(v => String(v.id) === String(preferredVersionId)) || null;
            }
            if (!versionToUse) {
                versionToUse = versions.find(v => v.status === 'draft') || versions[0] || null;
            }

            setSelectedVersionId(versionToUse?.id || '');
            setCriteriaDraft(cloneCriteria(versionToUse?.criteria || []));
            setBoardDirty(false);
            setCriteriaDirty(false);
        } catch (err) {
            console.error('Failed to load governance board details:', err);
            toast.error(err.message || 'Failed to load governance board details');
        }
    }, [fetchGovernanceBoardMembers, fetchGovernanceCriteriaVersions, toast]);

    const loadGovernanceUsers = useCallback(async (searchText = '') => {
        if (!selectedBoardId) {
            setAvailableUsers([]);
            return;
        }

        try {
            setUsersLoading(true);
            const result = await fetchGovernanceUsers({
                q: searchText,
                limit: 30
            });
            setAvailableUsers(Array.isArray(result) ? result : []);
        } catch (err) {
            console.error('Failed to load governance users:', err);
            toast.error(err.message || 'Failed to load users');
            setAvailableUsers([]);
        } finally {
            setUsersLoading(false);
        }
    }, [fetchGovernanceUsers, selectedBoardId, toast]);

    const loadAll = useCallback(async (isRefresh = false, preferredBoardId = null) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const [settingsResult, boardResults] = await Promise.all([
                getGovernanceSettings(),
                fetchGovernanceBoards({ includeInactive: true })
            ]);

            setGovernanceEnabled(!!settingsResult?.governanceEnabled);
            setQuorumPercent(Number(settingsResult?.defaultQuorumPercent ?? settingsResult?.quorumPercent ?? 60));
            setQuorumMinCount(Number(settingsResult?.defaultQuorumMinCount ?? settingsResult?.quorumMinCount ?? 1));
            setDecisionRequiresQuorum(
                settingsResult?.defaultDecisionRequiresQuorum !== undefined
                    ? settingsResult.defaultDecisionRequiresQuorum !== false
                    : settingsResult?.decisionRequiresQuorum !== false
            );
            setVoteWindowDays(
                (settingsResult?.defaultVoteWindowDays ?? settingsResult?.voteWindowDays) === null ||
                (settingsResult?.defaultVoteWindowDays ?? settingsResult?.voteWindowDays) === undefined
                    ? ''
                    : String(settingsResult?.defaultVoteWindowDays ?? settingsResult?.voteWindowDays)
            );
            setPhase3Ready(!!settingsResult?.phase3Ready);
            setBoardPolicyReady(!!settingsResult?.boardPolicyReady);
            const nextBoards = Array.isArray(boardResults) ? boardResults : [];
            setBoards(nextBoards);
            await loadBoardReadiness(nextBoards);

            const candidateBoardId = preferredBoardId ?? '';
            const selectedId = nextBoards.some(b => String(b.id) === String(candidateBoardId))
                ? candidateBoardId
                : (nextBoards[0]?.id || '');
            setSelectedBoardId(selectedId);

            if (!selectedId) {
                setMembers([]);
                setCriteriaVersions([]);
                setSelectedVersionId('');
                setCriteriaDraft(cloneCriteria([]));
            }
            setSettingsDirty(false);
        } catch (err) {
            console.error('Failed to load governance configuration:', err);
            toast.error(err.message || 'Failed to load governance configuration');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [
        getGovernanceSettings,
        fetchGovernanceBoards,
        loadBoardReadiness,
        toast
    ]);

    useEffect(() => {
        loadAll(false);
    }, [loadAll]);

    useEffect(() => {
        if (!selectedBoardId) {
            setMembers([]);
            setCriteriaVersions([]);
            setSelectedVersionId('');
            setCriteriaDraft(cloneCriteria([]));
            return;
        }

        loadBoardDetails(selectedBoardId);
    }, [selectedBoardId, loadBoardDetails]);

    useEffect(() => {
        if (selectedBoard) {
            setSelectedBoardName(selectedBoard.name || '');
            setSelectedBoardActive(!!selectedBoard.isActive);
            const policy = selectedBoard.effectivePolicy || selectedBoard.policy?.effective || null;
            const useGlobalDefaults = selectedBoard.useGlobalPolicyDefaults ?? selectedBoard.policy?.useGlobalDefaults ?? true;
            setSelectedBoardUseGlobalPolicyDefaults(useGlobalDefaults);
            setSelectedBoardQuorumPercent(Number(policy?.quorumPercent ?? quorumPercent ?? 60));
            setSelectedBoardQuorumMinCount(Number(policy?.quorumMinCount ?? quorumMinCount ?? 1));
            setSelectedBoardDecisionRequiresQuorum(
                policy?.decisionRequiresQuorum === undefined
                    ? (decisionRequiresQuorum !== false)
                    : !!policy.decisionRequiresQuorum
            );
            setSelectedBoardVoteWindowDays(
                policy?.voteWindowDays === null || policy?.voteWindowDays === undefined
                    ? ''
                    : String(policy.voteWindowDays)
            );
        } else {
            setSelectedBoardName('');
            setSelectedBoardActive(true);
            setSelectedBoardUseGlobalPolicyDefaults(true);
            setSelectedBoardQuorumPercent(Number(quorumPercent || 60));
            setSelectedBoardQuorumMinCount(Number(quorumMinCount || 1));
            setSelectedBoardDecisionRequiresQuorum(decisionRequiresQuorum !== false);
            setSelectedBoardVoteWindowDays(
                voteWindowDays === null || voteWindowDays === undefined
                    ? ''
                    : String(voteWindowDays)
            );
        }
    }, [selectedBoard, quorumPercent, quorumMinCount, decisionRequiresQuorum, voteWindowDays]);

    useEffect(() => {
        if (!selectedVersion) return;
        setCriteriaDraft(cloneCriteria(selectedVersion.criteria || []));
    }, [selectedVersionId, selectedVersion]);

    useEffect(() => {
        if (!selectedBoardId) {
            setAvailableUsers([]);
            setMemberUserSearch('');
            setMemberUserOid('');
            return;
        }

        const timeoutId = setTimeout(() => {
            loadGovernanceUsers(memberUserSearch);
        }, 250);

        return () => clearTimeout(timeoutId);
    }, [selectedBoardId, memberUserSearch, loadGovernanceUsers]);

    const resetDirtyFlags = useCallback(() => {
        setSettingsDirty(false);
        setBoardDirty(false);
        setCriteriaDirty(false);
    }, []);

    const confirmDiscardChanges = useCallback(() => {
        if (!hasUnsavedChanges) return true;
        return window.confirm('You have unsaved changes. Discard them and continue?');
    }, [hasUnsavedChanges]);

    const handleConfigTabChange = (nextTab) => {
        if (nextTab === configTab) return;
        if (!confirmDiscardChanges()) return;
        resetDirtyFlags();
        setConfigTab(nextTab);
    };

    const handleBoardSelectionChange = (nextBoardId) => {
        if (String(nextBoardId) === String(selectedBoardId)) return;
        if (!confirmDiscardChanges()) return;
        resetDirtyFlags();
        setSelectedBoardId(nextBoardId);
    };

    const handleVersionSelectionChange = (nextVersionId) => {
        if (String(nextVersionId) === String(selectedVersionId)) return;
        if (!confirmDiscardChanges()) return;
        resetDirtyFlags();
        setSelectedVersionId(nextVersionId);
    };

    const handleSaveSettings = async () => {
        try {
            setSettingsSaving(true);
            const parsedWindow = voteWindowDays === '' ? null : Number(voteWindowDays);
            await updateGovernanceSettings({
                governanceEnabled: !!governanceEnabled,
                defaultQuorumPercent: Number(quorumPercent),
                defaultQuorumMinCount: Number(quorumMinCount),
                defaultDecisionRequiresQuorum: !!decisionRequiresQuorum,
                defaultVoteWindowDays: parsedWindow
            });
            setSettingsDirty(false);
            toast.success('Governance settings updated');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to update governance settings');
        } finally {
            setSettingsSaving(false);
        }
    };

    const handleCreateBoard = async () => {
        if (!newBoardName.trim()) {
            toast.error('Board name is required');
            return;
        }
        try {
            setBoardSaving(true);
            const created = await createGovernanceBoard({
                name: newBoardName.trim(),
                isActive: newBoardActive
            });
            const nextBoards = await fetchGovernanceBoards({ includeInactive: true });
            setBoards(nextBoards);
            await loadBoardReadiness(nextBoards);
            setSelectedBoardId(created.id);
            setNewBoardName('');
            setNewBoardActive(true);
            setBoardDirty(false);
            toast.success('Governance board created');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to create governance board');
        } finally {
            setBoardSaving(false);
        }
    };

    const handleUpdateBoard = async () => {
        if (!selectedBoardId) return;
        if (!selectedBoardName.trim()) {
            toast.error('Board name is required');
            return;
        }
        const canEditBoardPolicy = phase3Ready && boardPolicyReady;
        const parsedBoardVoteWindow = selectedBoardVoteWindowDays === '' ? null : Number(selectedBoardVoteWindowDays);
        if (canEditBoardPolicy && !selectedBoardUseGlobalPolicyDefaults) {
            const percent = Number(selectedBoardQuorumPercent);
            const minCount = Number(selectedBoardQuorumMinCount);
            if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
                toast.error('Board quorum percent must be between 1 and 100');
                return;
            }
            if (!Number.isFinite(minCount) || minCount < 1) {
                toast.error('Board quorum minimum votes must be at least 1');
                return;
            }
            if (
                parsedBoardVoteWindow !== null &&
                (!Number.isFinite(parsedBoardVoteWindow) || parsedBoardVoteWindow < 1 || parsedBoardVoteWindow > 90)
            ) {
                toast.error('Board voting window must be empty or between 1 and 90 days');
                return;
            }
        }
        try {
            setBoardSaving(true);
            const boardUpdatePayload = {
                name: selectedBoardName.trim(),
                isActive: selectedBoardActive
            };
            if (canEditBoardPolicy) {
                boardUpdatePayload.boardPolicy = {
                    useGlobalDefaults: selectedBoardUseGlobalPolicyDefaults,
                    quorumPercent: Number(selectedBoardQuorumPercent),
                    quorumMinCount: Number(selectedBoardQuorumMinCount),
                    decisionRequiresQuorum: !!selectedBoardDecisionRequiresQuorum,
                    voteWindowDays: parsedBoardVoteWindow
                };
            }

            await updateGovernanceBoard(selectedBoardId, boardUpdatePayload);
            const nextBoards = await fetchGovernanceBoards({ includeInactive: true });
            setBoards(nextBoards);
            await loadBoardReadiness(nextBoards);
            setBoardDirty(false);
            toast.success('Governance board updated');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to update governance board');
        } finally {
            setBoardSaving(false);
        }
    };

    const handleAddOrUpdateMember = async () => {
        if (!selectedBoardId) return;
        if (!memberUserOid.trim()) {
            toast.error('Select a user');
            return;
        }
        try {
            setMemberSaving(true);
            await upsertGovernanceBoardMember(selectedBoardId, {
                userOid: memberUserOid.trim(),
                role: memberRole,
                isActive: true
            });
            const nextMembers = await fetchGovernanceBoardMembers(selectedBoardId, { includeInactive: true });
            setMembers(nextMembers);
            setBoards(prev => prev.map(board =>
                String(board.id) === String(selectedBoardId)
                    ? { ...board, activeMemberCount: nextMembers.filter(member => member.isActive).length }
                    : board
            ));
            setMemberUserOid('');
            setMemberUserSearch('');
            setMemberRole('member');
            toast.success('Governance member saved');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to save governance member');
        } finally {
            setMemberSaving(false);
        }
    };

    const handleToggleMemberActive = async (member) => {
        try {
            setMemberSaving(true);
            await upsertGovernanceBoardMember(selectedBoardId, {
                userOid: member.userOid,
                role: member.role,
                isActive: !member.isActive,
                effectiveFrom: member.effectiveFrom,
                effectiveTo: member.effectiveTo
            });
            const nextMembers = await fetchGovernanceBoardMembers(selectedBoardId, { includeInactive: true });
            setMembers(nextMembers);
            setBoards(prev => prev.map(board =>
                String(board.id) === String(selectedBoardId)
                    ? { ...board, activeMemberCount: nextMembers.filter(item => item.isActive).length }
                    : board
            ));
            toast.success('Governance member updated');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to update member status');
        } finally {
            setMemberSaving(false);
        }
    };

    const handleAddCriterion = () => {
        setCriteriaDraft(prev => ([
            ...prev,
            {
                id: `criterion-${Date.now()}`,
                name: '',
                weight: 0,
                enabled: true,
                sortOrder: prev.length + 1
            }
        ]));
        setCriteriaDirty(true);
    };

    const handleUpdateCriterion = (index, patch) => {
        setCriteriaDraft(prev => prev.map((criterion, idx) => {
            if (idx !== index) return criterion;
            return { ...criterion, ...patch };
        }));
        setCriteriaDirty(true);
    };

    const handleRemoveCriterion = (index) => {
        setCriteriaDraft(prev => prev.filter((_, idx) => idx !== index).map((criterion, idx) => ({
            ...criterion,
            sortOrder: idx + 1
        })));
        setCriteriaDirty(true);
    };

    const moveCriterion = (index, direction) => {
        if ((index === 0 && direction === -1) || (index === criteriaDraft.length - 1 && direction === 1)) return;

        setCriteriaDraft(prev => {
            const newArr = [...prev];
            // Swap items
            const temp = newArr[index];
            newArr[index] = newArr[index + direction];
            newArr[index + direction] = temp;

            // Re-assign sort orders sequentially
            return newArr.map((item, i) => ({ ...item, sortOrder: i + 1 }));
        });
        setCriteriaDirty(true);
    };

    const createDraftFromCurrent = async () => {
        if (!selectedBoardId) return;
        const payload = normalizeCriteriaForSave(criteriaDraft);
        if (payload.some(item => !item.name)) {
            toast.error('Every criterion must have a name');
            return;
        }
        try {
            setCriteriaSaving(true);
            const created = await createGovernanceCriteriaVersion(selectedBoardId, { criteria: payload });
            await loadBoardDetails(selectedBoardId, created.id);
            toast.success('Draft criteria version created');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to create draft criteria version');
        } finally {
            setCriteriaSaving(false);
        }
    };

    const handleSaveCriteria = async () => {
        if (!selectedBoardId) return;
        const payload = normalizeCriteriaForSave(criteriaDraft);
        if (payload.length === 0) {
            toast.error('At least one criterion is required');
            return;
        }
        if (payload.some(item => !item.name)) {
            toast.error('Every criterion must have a name');
            return;
        }

        try {
            setCriteriaSaving(true);
            if (selectedVersion?.status === 'draft') {
                await updateGovernanceCriteriaVersion(selectedBoardId, selectedVersion.id, { criteria: payload });
                await loadBoardDetails(selectedBoardId, selectedVersion.id);
                toast.success('Draft criteria updated');
            } else {
                const created = await createGovernanceCriteriaVersion(selectedBoardId, { criteria: payload });
                await loadBoardDetails(selectedBoardId, created.id);
                toast.success('New draft criteria version created');
            }
            setCriteriaDirty(false);
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to save criteria');
        } finally {
            setCriteriaSaving(false);
        }
    };

    const handlePublishCriteria = async () => {
        if (!selectedBoardId || !selectedVersionId) return;
        try {
            setCriteriaSaving(true);
            await publishGovernanceCriteriaVersion(selectedBoardId, selectedVersionId);
            await loadBoardDetails(selectedBoardId, selectedVersionId);
            setCriteriaDirty(false);
            toast.success('Criteria version published');
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Failed to publish criteria version');
        } finally {
            setCriteriaSaving(false);
        }
    };

    if (loading) {
        return <div className="loading-spinner">Loading governance configuration...</div>;
    }

    return (
        <div className="admin-content glass governance-config">
            <div className="governance-toolbar">
                <div className="governance-toolbar-title">
                    <h3><Settings2 size={18} /> Governance Configuration</h3>
                    <p>Manage board membership, voting policy, and criteria versions.</p>
                </div>
                <button
                    className="btn-secondary"
                    onClick={async () => {
                        if (!confirmDiscardChanges()) return;
                        resetDirtyFlags();
                        await loadAll(true, selectedBoardId);
                        if (selectedBoardId) {
                            await loadBoardDetails(selectedBoardId);
                        }
                    }}
                    disabled={refreshing}
                >
                    <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            <section className="governance-section">
                <h4>Setup Checklist</h4>
                <div className="governance-summary-bar">
                    <div className="governance-summary-item">
                        <strong>1. Settings</strong>
                        <span>{governanceStepReadiness.settingsReady ? 'Ready' : 'Needs setup'}</span>
                    </div>
                    <div className="governance-summary-item">
                        <strong>2. Boards</strong>
                        <span>{governanceStepReadiness.boardsReady ? 'Ready' : 'Needs setup'}</span>
                    </div>
                    <div className="governance-summary-item">
                        <strong>3. Members</strong>
                        <span>{governanceStepReadiness.membersReady ? 'Ready' : 'Needs setup'}</span>
                    </div>
                    <div className="governance-summary-item">
                        <strong>4. Criteria</strong>
                        <span>{governanceStepReadiness.criteriaReady ? 'Ready' : 'Needs setup'}</span>
                    </div>
                </div>
                {hasUnsavedChanges && (
                    <p className="governance-warning">You have unsaved changes. Save before switching tabs, boards, or versions.</p>
                )}
            </section>

            {/* Tab Navigation */}
            <nav className="governance-tabs">
                <button
                    className={`governance-tab ${configTab === 'settings' ? 'active' : ''}`}
                    onClick={() => handleConfigTabChange('settings')}
                >
                    <Settings2 size={15} /> Settings
                    <span className={`governance-tab-badge ${governanceStepReadiness.settingsReady ? 'ready' : 'not-ready'}`}>
                        {governanceStepReadiness.settingsReady ? 'Ready' : 'Needs setup'}
                    </span>
                </button>
                <button
                    className={`governance-tab ${configTab === 'boards' ? 'active' : ''}`}
                    onClick={() => handleConfigTabChange('boards')}
                >
                    <ClipboardList size={15} /> Boards
                    <span className={`governance-tab-badge ${governanceStepReadiness.boardsReady ? 'ready' : 'not-ready'}`}>
                        {governanceStepReadiness.boardsReady ? 'Ready' : 'Needs setup'}
                    </span>
                </button>
                <button
                    className={`governance-tab ${configTab === 'members' ? 'active' : ''}`}
                    onClick={() => selectedBoardId ? handleConfigTabChange('members') : null}
                    disabled={!selectedBoardId}
                    title={!selectedBoardId ? 'Select a board first' : ''}
                >
                    <Users size={15} /> Members
                    <span className={`governance-tab-badge ${governanceStepReadiness.membersReady ? 'ready' : 'not-ready'}`}>
                        {governanceStepReadiness.membersReady ? 'Ready' : 'Needs setup'}
                    </span>
                </button>
                <button
                    className={`governance-tab ${configTab === 'criteria' ? 'active' : ''}`}
                    onClick={() => selectedBoardId ? handleConfigTabChange('criteria') : null}
                    disabled={!selectedBoardId}
                    title={!selectedBoardId ? 'Select a board first' : ''}
                >
                    <ClipboardList size={15} /> Criteria
                    <span className={`governance-tab-badge ${governanceStepReadiness.criteriaReady ? 'ready' : 'not-ready'}`}>
                        {governanceStepReadiness.criteriaReady ? 'Ready' : 'Needs setup'}
                    </span>
                </button>
            </nav>

            {/* â”€â”€â”€ Settings Tab â”€â”€â”€ */}
            {configTab === 'settings' && (
                <section className="governance-section">
                    <h4>Global Defaults</h4>
                    <p className="governance-muted">
                        These defaults apply to boards that use global policy values.
                    </p>
                    <div className="governance-grid">
                        <div className="form-group">
                            <label>Governance</label>
                            <label className="required-checkbox">
                                <input
                                    type="checkbox"
                                    checked={governanceEnabled}
                                    onChange={(e) => {
                                        setGovernanceEnabled(e.target.checked);
                                        setSettingsDirty(true);
                                    }}
                                />
                                Governance enabled globally
                            </label>
                        </div>
                        <div className="form-group">
                            <label>Default Voting Window (days, optional)</label>
                            <input
                                type="number"
                                min="1"
                                max="90"
                                value={voteWindowDays}
                                onChange={(e) => {
                                    setVoteWindowDays(e.target.value);
                                    setSettingsDirty(true);
                                }}
                                placeholder="No deadline"
                                disabled={!phase3Ready}
                            />
                        </div>
                        <div className="form-group">
                            <label>Default Quorum Percent (1-100)</label>
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={quorumPercent}
                                onChange={(e) => {
                                    setQuorumPercent(Number(e.target.value));
                                    setSettingsDirty(true);
                                }}
                                disabled={!phase3Ready}
                            />
                        </div>
                        <div className="form-group">
                            <label>Default Quorum Minimum Votes</label>
                            <input
                                type="number"
                                min="1"
                                value={quorumMinCount}
                                onChange={(e) => {
                                    setQuorumMinCount(Number(e.target.value));
                                    setSettingsDirty(true);
                                }}
                                disabled={!phase3Ready}
                            />
                        </div>
                    </div>
                    <div className="governance-inline-row">
                        <label className="required-checkbox">
                                <input
                                    type="checkbox"
                                    checked={decisionRequiresQuorum}
                                    onChange={(e) => {
                                        setDecisionRequiresQuorum(e.target.checked);
                                        setSettingsDirty(true);
                                    }}
                                    disabled={!phase3Ready}
                                />
                                Default: require quorum before final decision
                        </label>
                        <button className="btn-primary" onClick={handleSaveSettings} disabled={settingsSaving}>
                            <Save size={14} /> {settingsSaving ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                    {!phase3Ready && (
                        <p className="governance-alert">
                            Phase 3 schema is not installed yet. Run `npm run migrate:governance:phase2` in `server`.
                        </p>
                    )}
                    {phase3Ready && !boardPolicyReady && (
                        <p className="governance-alert">
                            Board-level policy overrides are not installed yet. Run `npm run migrate:governance:phase3` in `server`.
                        </p>
                    )}
                </section>
            )}

            {/* â”€â”€â”€ Boards Tab â”€â”€â”€ */}
            {configTab === 'boards' && (
                <section className="governance-section">
                    <h4><ClipboardList size={16} /> Board Setup Workspace</h4>
                    <div className="governance-board-workspace">
                        <aside className="governance-board-list-panel">
                            <div className="governance-board-list-toolbar">
                                <label>Find Board</label>
                                <div className="governance-user-search governance-board-search">
                                    <Search size={14} />
                                    <input
                                        type="text"
                                        value={boardSearch}
                                        onChange={(e) => setBoardSearch(e.target.value)}
                                        placeholder="Search by board name"
                                    />
                                </div>
                            </div>

                            <div className="governance-subcard governance-board-create-card">
                                <h5>Create Board</h5>
                                <div className="form-group">
                                    <label>Board Name</label>
                                    <input
                                        type="text"
                                        value={newBoardName}
                                        onChange={(e) => {
                                            setNewBoardName(e.target.value);
                                            setBoardDirty(true);
                                        }}
                                        placeholder="e.g., Clinical Governance Board"
                                    />
                                </div>
                                <div className="governance-inline-row">
                                    <label className="required-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={newBoardActive}
                                            onChange={(e) => {
                                                setNewBoardActive(e.target.checked);
                                                setBoardDirty(true);
                                            }}
                                        />
                                        New board active
                                    </label>
                                    <button className="btn-secondary" onClick={handleCreateBoard} disabled={boardSaving}>
                                        <Plus size={14} /> Create Board
                                    </button>
                                </div>
                            </div>

                            <div className="governance-board-list">
                                {filteredBoards.length === 0 ? (
                                    <div className="governance-board-empty">
                                        <p className="governance-muted">
                                            {boards.length === 0 ? 'No boards yet. Create one to continue Step 2.' : 'No boards match your search.'}
                                        </p>
                                    </div>
                                ) : (
                                    filteredBoards.map(board => {
                                        const progress = boardProgressMeta[board.id] || {
                                            completed: 0,
                                            total: 3,
                                            ready: false,
                                            criteriaMeta: { publishedCount: 0, draftCount: 0, totalCount: 0 }
                                        };
                                        const criteriaMeta = progress.criteriaMeta || { publishedCount: 0, draftCount: 0 };
                                        const activeMembers = Number(board.activeMemberCount || 0);
                                        const isSelected = String(board.id) === String(selectedBoardId);
                                        const policy = board.effectivePolicy || board.policy?.effective || null;
                                        const usesGlobalPolicy = board.useGlobalPolicyDefaults ?? board.policy?.useGlobalDefaults ?? true;

                                        return (
                                            <button
                                                key={board.id}
                                                className={`governance-board-item ${isSelected ? 'active' : ''}`}
                                                onClick={() => handleBoardSelectionChange(board.id)}
                                            >
                                                <div className="governance-board-item-header">
                                                    <span className="governance-board-item-name">{board.name || 'Unnamed board'}</span>
                                                    <span className={`governance-pill ${board.isActive ? 'active' : 'inactive'}`}>
                                                        {board.isActive ? 'Active' : 'Inactive'}
                                                    </span>
                                                </div>
                                                <div className="governance-board-item-meta">
                                                    <span>{activeMembers} active {activeMembers === 1 ? 'member' : 'members'}</span>
                                                    <span>{criteriaMeta.publishedCount || 0} published criteria</span>
                                                    <span>
                                                        Q{Number(policy?.quorumPercent ?? quorumPercent)}% / min {Number(policy?.quorumMinCount ?? quorumMinCount)}
                                                    </span>
                                                    <span>{usesGlobalPolicy ? 'Global policy' : 'Board policy'}</span>
                                                </div>
                                                <div className="governance-board-item-footer">
                                                    <span className="governance-board-item-progress">
                                                        {progress.completed}/{progress.total} checks complete
                                                    </span>
                                                    <span className={`governance-tab-badge ${progress.ready ? 'ready' : 'not-ready'}`}>
                                                        {progress.ready ? 'Ready' : 'Not ready'}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </aside>

                        <div className="governance-board-detail-panel">
                            {selectedBoard ? (
                                <>
                                    <div className="governance-board-detail-header">
                                        <h5>{selectedBoard.name || 'Selected board'}</h5>
                                        <p>Step 2 of 4: finalize this board, then continue to members and criteria.</p>
                                    </div>

                                    <div className="governance-summary-bar governance-board-detail-summary">
                                        <div className="governance-summary-item">
                                            <strong>Board status</strong>
                                            <span>{selectedBoard.isActive ? 'Active' : 'Inactive'}</span>
                                        </div>
                                        <div className="governance-summary-item">
                                            <strong>Active Members</strong>
                                            <span>{Number(selectedBoard.activeMemberCount || 0)}</span>
                                        </div>
                                        <div className="governance-summary-item">
                                            <strong>Published Criteria</strong>
                                            <span>{selectedBoardProgress?.criteriaMeta?.publishedCount || 0}</span>
                                        </div>
                                        <div className="governance-summary-item">
                                            <strong>Effective Policy</strong>
                                            <span>
                                                Q{selectedBoardEffectivePolicy.quorumPercent}% / min {selectedBoardEffectivePolicy.quorumMinCount}
                                            </span>
                                        </div>
                                        <div className="governance-summary-item">
                                            <strong>Readiness</strong>
                                            <span>
                                                {selectedBoardProgress?.completed || 0}/{selectedBoardProgress?.total || 3} checks complete
                                            </span>
                                        </div>
                                    </div>

                                    <div className="governance-checklist">
                                        <div className={`governance-check-item ${selectedBoard.isActive ? 'ready' : 'blocked'}`}>
                                            <div>
                                                <strong>Board is active</strong>
                                                <p className="governance-muted">Inactive boards cannot receive governance assignment.</p>
                                            </div>
                                            <span className={`governance-tab-badge ${selectedBoard.isActive ? 'ready' : 'not-ready'}`}>
                                                {selectedBoard.isActive ? 'Ready' : 'Blocked'}
                                            </span>
                                        </div>
                                        <div className={`governance-check-item ${Number(selectedBoard.activeMemberCount || 0) > 0 ? 'ready' : 'blocked'}`}>
                                            <div>
                                                <strong>At least one active member</strong>
                                                <p className="governance-muted">Add or activate members in Step 3.</p>
                                            </div>
                                            <span className={`governance-tab-badge ${Number(selectedBoard.activeMemberCount || 0) > 0 ? 'ready' : 'not-ready'}`}>
                                                {Number(selectedBoard.activeMemberCount || 0) > 0 ? 'Ready' : 'Blocked'}
                                            </span>
                                        </div>
                                        <div className={`governance-check-item ${(selectedBoardProgress?.criteriaMeta?.publishedCount || 0) > 0 ? 'ready' : 'blocked'}`}>
                                            <div>
                                                <strong>Published criteria exists</strong>
                                                <p className="governance-muted">Publish criteria in Step 4 before governance goes live.</p>
                                            </div>
                                            <span className={`governance-tab-badge ${(selectedBoardProgress?.criteriaMeta?.publishedCount || 0) > 0 ? 'ready' : 'not-ready'}`}>
                                                {(selectedBoardProgress?.criteriaMeta?.publishedCount || 0) > 0 ? 'Ready' : 'Blocked'}
                                            </span>
                                        </div>
                                    </div>

                                    {selectedBoardBlockers.length > 0 && (
                                        <p className="governance-warning">
                                            Blockers: {selectedBoardBlockers.join(' ')}
                                        </p>
                                    )}

                                    <div className="governance-subcard">
                                        <h5>Edit Selected Board</h5>
                                        <div className="governance-grid">
                                            <div className="form-group">
                                                <label>Board Name</label>
                                                <input
                                                    type="text"
                                                    value={selectedBoardName}
                                                    onChange={(e) => {
                                                        setSelectedBoardName(e.target.value);
                                                        setBoardDirty(true);
                                                    }}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Status</label>
                                                <label className="required-checkbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedBoardActive}
                                                        onChange={(e) => {
                                                            setSelectedBoardActive(e.target.checked);
                                                            setBoardDirty(true);
                                                        }}
                                                    />
                                                    Board is active
                                                </label>
                                            </div>
                                        </div>
                                        <div className="governance-subcard governance-board-policy-card">
                                            <h5>Voting Policy</h5>
                                            <label className="required-checkbox">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedBoardUseGlobalPolicyDefaults}
                                                    onChange={(e) => {
                                                        setSelectedBoardUseGlobalPolicyDefaults(e.target.checked);
                                                        setBoardDirty(true);
                                                    }}
                                                    disabled={!phase3Ready || !boardPolicyReady}
                                                />
                                                Use global defaults for this board
                                            </label>
                                            <p className="governance-muted">
                                                Source: {selectedBoardUseGlobalPolicyDefaults ? 'Global defaults' : 'Board-specific overrides'}
                                            </p>

                                            {!selectedBoardUseGlobalPolicyDefaults && (
                                                <div className="governance-grid">
                                                    <div className="form-group">
                                                        <label>Board Quorum Percent (1-100)</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="100"
                                                            value={selectedBoardQuorumPercent}
                                                            onChange={(e) => {
                                                                setSelectedBoardQuorumPercent(Number(e.target.value));
                                                                setBoardDirty(true);
                                                            }}
                                                            disabled={!phase3Ready || !boardPolicyReady}
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>Board Quorum Minimum Votes</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={selectedBoardQuorumMinCount}
                                                            onChange={(e) => {
                                                                setSelectedBoardQuorumMinCount(Number(e.target.value));
                                                                setBoardDirty(true);
                                                            }}
                                                            disabled={!phase3Ready || !boardPolicyReady}
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>Board Voting Window (days, optional)</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="90"
                                                            value={selectedBoardVoteWindowDays}
                                                            onChange={(e) => {
                                                                setSelectedBoardVoteWindowDays(e.target.value);
                                                                setBoardDirty(true);
                                                            }}
                                                            placeholder="No deadline"
                                                            disabled={!phase3Ready || !boardPolicyReady}
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>Decision Rule</label>
                                                        <label className="required-checkbox">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedBoardDecisionRequiresQuorum}
                                                                onChange={(e) => {
                                                                    setSelectedBoardDecisionRequiresQuorum(e.target.checked);
                                                                    setBoardDirty(true);
                                                                }}
                                                                disabled={!phase3Ready || !boardPolicyReady}
                                                            />
                                                            Require quorum before final decision
                                                        </label>
                                                    </div>
                                                </div>
                                            )}

                                            <p className="governance-muted">
                                                Effective policy: Q{selectedBoardUseGlobalPolicyDefaults ? selectedBoardEffectivePolicy.quorumPercent : selectedBoardQuorumPercent}% /
                                                min {selectedBoardUseGlobalPolicyDefaults ? selectedBoardEffectivePolicy.quorumMinCount : selectedBoardQuorumMinCount},
                                                window {selectedBoardUseGlobalPolicyDefaults
                                                    ? (selectedBoardEffectivePolicy.voteWindowDays ?? 'none')
                                                    : (selectedBoardVoteWindowDays || 'none')} day(s),
                                                quorum required: {selectedBoardUseGlobalPolicyDefaults
                                                    ? (selectedBoardEffectivePolicy.decisionRequiresQuorum ? 'yes' : 'no')
                                                    : (selectedBoardDecisionRequiresQuorum ? 'yes' : 'no')}.
                                            </p>

                                            {!boardPolicyReady && phase3Ready && (
                                                <p className="governance-alert">
                                                    Board override fields are unavailable until `npm run migrate:governance:phase3` is applied in `server`.
                                                </p>
                                            )}
                                        </div>
                                        <div className="governance-inline-row">
                                            <button className="btn-primary" onClick={handleUpdateBoard} disabled={boardSaving}>
                                                <Save size={14} /> Save Board
                                            </button>
                                            <button
                                                className="btn-secondary"
                                                onClick={() => handleConfigTabChange('members')}
                                            >
                                                Continue to Step 3: Members
                                            </button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="governance-empty-tab">
                                    <ClipboardList size={32} />
                                    <p>Select a board from the list to continue Step 2 setup.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            )}

            {/* Members Tab */}
            {configTab === 'members' && (
                selectedBoardId ? (
                    <section className="governance-section governance-step-section">
                        <h4><Users size={16} /> Step 3 of 4: Members — {selectedBoard?.name || 'Board'}</h4>
                        <div className="governance-step-layout">
                            <aside className="governance-step-sidebar">
                                <div className="governance-summary-bar governance-step-summary">
                                    <div className="governance-summary-item">
                                        <strong>Board Status</strong>
                                        <span>{selectedBoard?.isActive ? 'Active' : 'Inactive'}</span>
                                    </div>
                                    <div className="governance-summary-item">
                                        <strong>Active Members</strong>
                                        <span>{activeMembersCount}</span>
                                    </div>
                                    <div className="governance-summary-item">
                                        <strong>Active Chairs</strong>
                                        <span>{chairMembersCount}</span>
                                    </div>
                                    <div className="governance-summary-item">
                                        <strong>Readiness</strong>
                                        <span>{activeMembersCount > 0 ? 'Ready' : 'Needs setup'}</span>
                                    </div>
                                </div>

                                <div className="governance-checklist">
                                    <div className={`governance-check-item ${selectedBoard?.isActive ? 'ready' : 'blocked'}`}>
                                        <div>
                                            <strong>Board is active</strong>
                                            <p className="governance-muted">Board activation is managed in Step 2.</p>
                                        </div>
                                        <span className={`governance-tab-badge ${selectedBoard?.isActive ? 'ready' : 'not-ready'}`}>
                                            {selectedBoard?.isActive ? 'Ready' : 'Blocked'}
                                        </span>
                                    </div>
                                    <div className={`governance-check-item ${activeMembersCount > 0 ? 'ready' : 'blocked'}`}>
                                        <div>
                                            <strong>At least one active member</strong>
                                            <p className="governance-muted">Submissions cannot be voted without active participants.</p>
                                        </div>
                                        <span className={`governance-tab-badge ${activeMembersCount > 0 ? 'ready' : 'not-ready'}`}>
                                            {activeMembersCount > 0 ? 'Ready' : 'Blocked'}
                                        </span>
                                    </div>
                                    <div className={`governance-check-item ${chairMembersCount > 0 ? 'ready' : 'blocked'}`}>
                                        <div>
                                            <strong>Chair assigned (recommended)</strong>
                                            <p className="governance-muted">A chair improves escalation handling and final decisions.</p>
                                        </div>
                                        <span className={`governance-tab-badge ${chairMembersCount > 0 ? 'ready' : 'not-ready'}`}>
                                            {chairMembersCount > 0 ? 'Ready' : 'Missing'}
                                        </span>
                                    </div>
                                </div>

                                {membersStepBlockers.length > 0 && (
                                    <p className="governance-warning">Blockers: {membersStepBlockers.join(' ')}</p>
                                )}

                                <div className="governance-inline-actions governance-step-nav">
                                    <button className="btn-secondary" onClick={() => handleConfigTabChange('boards')}>
                                        Back to Step 2: Boards
                                    </button>
                                    <button
                                        className="btn-secondary"
                                        onClick={() => handleConfigTabChange('criteria')}
                                        disabled={activeMembersCount === 0}
                                    >
                                        Continue to Step 4: Criteria
                                    </button>
                                </div>
                            </aside>

                            <div className="governance-step-main">
                                <div className="governance-subcard">
                                    <h5>Add or Update Member</h5>
                                    <div className="governance-grid">
                                        <div className="form-group governance-user-field">
                                            <label>User (from Users table)</label>
                                            <div className="governance-user-search">
                                                <Search size={14} />
                                                <input
                                                    type="text"
                                                    value={memberUserSearch}
                                                    onChange={(e) => setMemberUserSearch(e.target.value)}
                                                    placeholder="Search by name or email"
                                                />
                                            </div>
                                            <select
                                                value={memberUserOid}
                                                onChange={(e) => setMemberUserOid(e.target.value)}
                                                disabled={usersLoading && memberOptions.length === 0}
                                            >
                                                <option value="">
                                                    {usersLoading ? 'Loading users...' : 'Select user'}
                                                </option>
                                                {memberOptions.map(user => (
                                                    <option key={user.oid} value={user.oid}>
                                                        {user.name}{user.email ? ` (${user.email})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="governance-muted">
                                                {memberOptions.length > 0
                                                    ? `${memberOptions.length} user${memberOptions.length === 1 ? '' : 's'} available`
                                                    : 'No matching users found in Users table'}
                                            </p>
                                            {selectedMemberOption && (
                                                <div className="governance-selected-user">
                                                    <span className="governance-selected-user-name">{selectedMemberOption.name}</span>
                                                    {selectedMemberOption.email && (
                                                        <span className="governance-selected-user-email">{selectedMemberOption.email}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="form-group">
                                            <label>Role</label>
                                            <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
                                                <option value="member">Member</option>
                                                <option value="chair">Chair</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="form-actions">
                                        <button className="btn-secondary" onClick={handleAddOrUpdateMember} disabled={memberSaving}>
                                            <Plus size={14} /> Add / Update Member
                                        </button>
                                    </div>
                                </div>

                                <div className="governance-subcard">
                                    <h5>Current Members</h5>
                                    <div className="governance-table-wrap">
                                        <table className="permissions-table">
                                            <thead>
                                                <tr>
                                                    <th>User</th>
                                                    <th>Role</th>
                                                    <th>Status</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {members.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={4}>No members configured for this board.</td>
                                                    </tr>
                                                ) : (
                                                    members.map(member => (
                                                        <tr key={member.id}>
                                                            <td>
                                                                <div className="governance-user-name">
                                                                    {member.userName || member.userEmail || 'Unknown user'}
                                                                </div>
                                                                <div className="governance-muted">
                                                                    {member.userEmail
                                                                        ? member.userEmail
                                                                        : (member.userName ? 'No email on profile' : 'User profile missing from Users table')}
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <span className={`governance-pill ${member.role === 'chair' ? 'chair' : 'member'}`}>
                                                                    {member.role === 'chair' ? 'Chair' : 'Member'}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <span className={`governance-pill ${member.isActive ? 'active' : 'inactive'}`}>
                                                                    {member.isActive ? 'Active' : 'Inactive'}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <button
                                                                    className="btn-secondary"
                                                                    onClick={() => handleToggleMemberActive(member)}
                                                                    disabled={memberSaving}
                                                                >
                                                                    {member.isActive ? 'Deactivate' : 'Activate'}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                ) : (
                    <div className="governance-empty-tab">
                        <Users size={32} />
                        <p>Select a board on the <strong>Boards</strong> tab to manage its members.</p>
                    </div>
                )
            )}

            {/* Criteria Tab */}
            {configTab === 'criteria' && (
                selectedBoardId ? (
                    <section className="governance-section governance-criteria-section governance-step-section">
                        <h4><ClipboardList size={16} /> Step 4 of 4: Criteria — {selectedBoard?.name || 'Board'}</h4>
                        <div className="governance-step-layout">
                            <aside className="governance-step-sidebar">
                                <div className="governance-summary-bar governance-step-summary">
                                    <div className="governance-summary-item">
                                        <strong>Versions</strong>
                                        <span>{criteriaVersions.length}</span>
                                    </div>
                                    <div className="governance-summary-item">
                                        <strong>Published</strong>
                                        <span>{selectedBoardCriteriaMeta.publishedCount || 0}</span>
                                    </div>
                                    <div className="governance-summary-item">
                                        <strong>Selected Version</strong>
                                        <span>{selectedVersion ? `v${selectedVersion.versionNo} (${selectedVersion.status})` : 'None'}</span>
                                    </div>
                                    <div className="governance-summary-item">
                                        <strong>Active Weight</strong>
                                        <span>{activeWeightTotal}</span>
                                    </div>
                                </div>

                                <div className="governance-checklist">
                                    <div className={`governance-check-item ${criteriaDraft.length > 0 ? 'ready' : 'blocked'}`}>
                                        <div>
                                            <strong>At least one criterion</strong>
                                            <p className="governance-muted">Configure criteria rows that define voting evaluation.</p>
                                        </div>
                                        <span className={`governance-tab-badge ${criteriaDraft.length > 0 ? 'ready' : 'not-ready'}`}>
                                            {criteriaDraft.length > 0 ? 'Ready' : 'Blocked'}
                                        </span>
                                    </div>
                                    <div className={`governance-check-item ${activeWeightTotal > 0 ? 'ready' : 'blocked'}`}>
                                        <div>
                                            <strong>Active weight total {'>'} 0</strong>
                                            <p className="governance-muted">Enabled criteria should contribute non-zero weight.</p>
                                        </div>
                                        <span className={`governance-tab-badge ${activeWeightTotal > 0 ? 'ready' : 'not-ready'}`}>
                                            {activeWeightTotal > 0 ? 'Ready' : 'Blocked'}
                                        </span>
                                    </div>
                                    <div className={`governance-check-item ${(selectedBoardCriteriaMeta.publishedCount || 0) > 0 ? 'ready' : 'blocked'}`}>
                                        <div>
                                            <strong>Published criteria exists</strong>
                                            <p className="governance-muted">Publish a version to complete governance setup.</p>
                                        </div>
                                        <span className={`governance-tab-badge ${(selectedBoardCriteriaMeta.publishedCount || 0) > 0 ? 'ready' : 'not-ready'}`}>
                                            {(selectedBoardCriteriaMeta.publishedCount || 0) > 0 ? 'Ready' : 'Blocked'}
                                        </span>
                                    </div>
                                </div>

                                {criteriaStepBlockers.length > 0 && (
                                    <p className="governance-warning">Blockers: {criteriaStepBlockers.join(' ')}</p>
                                )}

                                <div className="governance-inline-actions governance-step-nav">
                                    <button className="btn-secondary" onClick={() => handleConfigTabChange('members')}>
                                        Back to Step 3: Members
                                    </button>
                                    <button className="btn-secondary" onClick={() => handleConfigTabChange('settings')}>
                                        Review Step 1: Settings
                                    </button>
                                </div>
                            </aside>

                            <div className="governance-step-main">
                                <div className="governance-grid">
                                    <div className="form-group">
                                        <label>Version</label>
                                        <select value={selectedVersionId} onChange={(e) => handleVersionSelectionChange(e.target.value)}>
                                            <option value="">No versions</option>
                                            {criteriaVersions.map(version => (
                                                <option key={version.id} value={version.id}>
                                                    v{version.versionNo} ({version.status})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Active Weight Total</label>
                                        <input type="text" value={`${activeWeightTotal}`} readOnly />
                                    </div>
                                </div>

                                <div className="governance-inline-row governance-criteria-toolbar">
                                    <span className="governance-muted">
                                        {selectedVersion
                                            ? `Editing v${selectedVersion.versionNo} (${selectedVersion.status})`
                                            : 'No criteria version yet. Save to create draft.'}
                                    </span>
                                    <div className="governance-inline-actions">
                                        <button className="btn-secondary" onClick={createDraftFromCurrent} disabled={criteriaSaving}>
                                            <Plus size={14} /> New Draft
                                        </button>
                                        <button className="btn-primary" onClick={handleSaveCriteria} disabled={criteriaSaving}>
                                            <Save size={14} /> Save Draft
                                        </button>
                                        {selectedVersion?.status === 'draft' && (
                                            <button className="btn-secondary" onClick={handlePublishCriteria} disabled={criteriaSaving}>
                                                Publish
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="governance-table-wrap governance-criteria-table-wrap">
                                    <table className="permissions-table governance-criteria-table">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                <th>Weight</th>
                                                <th>Enabled</th>
                                                <th>Sort</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {criteriaDraft.map((criterion, index) => (
                                                <tr key={criterion.id || index}>
                                                    <td>
                                                        <input
                                                            type="text"
                                                            value={criterion.name}
                                                            onChange={(e) => handleUpdateCriterion(index, { name: e.target.value })}
                                                        />
                                                    </td>
                                                    <td>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="100"
                                                            value={criterion.weight}
                                                            onChange={(e) => handleUpdateCriterion(index, { weight: Number(e.target.value) })}
                                                        />
                                                    </td>
                                                    <td>
                                                        <label className="required-checkbox">
                                                            <input
                                                                type="checkbox"
                                                                checked={criterion.enabled}
                                                                onChange={(e) => handleUpdateCriterion(index, { enabled: e.target.checked })}
                                                            />
                                                            Enabled
                                                        </label>
                                                    </td>
                                                    <td>
                                                        <div className="governance-criteria-sort-controls">
                                                            <button
                                                                className="btn-icon"
                                                                onClick={() => moveCriterion(index, -1)}
                                                                disabled={index === 0}
                                                                title="Move Up"
                                                            >
                                                                <ArrowUp size={14} />
                                                            </button>
                                                            <button
                                                                className="btn-icon"
                                                                onClick={() => moveCriterion(index, 1)}
                                                                disabled={index === criteriaDraft.length - 1}
                                                                title="Move Down"
                                                            >
                                                                <ArrowDown size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <button className="btn-icon danger" onClick={() => handleRemoveCriterion(index)}>
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="form-actions">
                                    <button className="btn-secondary" onClick={handleAddCriterion}>
                                        <Plus size={14} /> Add Criterion
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                ) : (
                    <div className="governance-empty-tab">
                        <ClipboardList size={32} />
                        <p>Select a board on the <strong>Boards</strong> tab to manage its criteria.</p>
                    </div>
                )
            )}
        </div>
    );
}

