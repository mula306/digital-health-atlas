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
    const [boards, setBoards] = useState([]);
    const [selectedBoardId, setSelectedBoardId] = useState('');
    const [selectedBoardName, setSelectedBoardName] = useState('');
    const [selectedBoardActive, setSelectedBoardActive] = useState(true);
    const [newBoardName, setNewBoardName] = useState('');
    const [newBoardActive, setNewBoardActive] = useState(true);

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

    const activeWeightTotal = useMemo(() => {
        return criteriaDraft
            .filter(item => item.enabled)
            .reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
    }, [criteriaDraft]);

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
            setMembers(Array.isArray(memberResults) ? memberResults : []);
            const versions = Array.isArray(versionResults) ? versionResults : [];
            setCriteriaVersions(versions);

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

    const loadAll = useCallback(async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const [settingsResult, boardResults] = await Promise.all([
                getGovernanceSettings(),
                fetchGovernanceBoards({ includeInactive: true })
            ]);

            setGovernanceEnabled(!!settingsResult?.governanceEnabled);
            setQuorumPercent(Number(settingsResult?.quorumPercent ?? 60));
            setQuorumMinCount(Number(settingsResult?.quorumMinCount ?? 1));
            setDecisionRequiresQuorum(settingsResult?.decisionRequiresQuorum !== false);
            setVoteWindowDays(
                settingsResult?.voteWindowDays === null || settingsResult?.voteWindowDays === undefined
                    ? ''
                    : String(settingsResult.voteWindowDays)
            );
            setPhase3Ready(!!settingsResult?.phase3Ready);
            const nextBoards = Array.isArray(boardResults) ? boardResults : [];
            setBoards(nextBoards);

            const selectedId = nextBoards.some(b => String(b.id) === String(selectedBoardId))
                ? selectedBoardId
                : (nextBoards[0]?.id || '');
            setSelectedBoardId(selectedId);

            if (selectedId) {
                await loadBoardDetails(selectedId);
            } else {
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
        selectedBoardId,
        loadBoardDetails,
        toast
    ]);

    useEffect(() => {
        loadAll(false);
    }, [loadAll]);

    useEffect(() => {
        if (selectedBoard) {
            setSelectedBoardName(selectedBoard.name || '');
            setSelectedBoardActive(!!selectedBoard.isActive);
        } else {
            setSelectedBoardName('');
            setSelectedBoardActive(true);
        }
    }, [selectedBoard]);

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
                quorumPercent: Number(quorumPercent),
                quorumMinCount: Number(quorumMinCount),
                decisionRequiresQuorum: !!decisionRequiresQuorum,
                voteWindowDays: parsedWindow
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
            setSelectedBoardId(created.id);
            setNewBoardName('');
            setNewBoardActive(true);
            await loadBoardDetails(created.id);
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
        try {
            setBoardSaving(true);
            await updateGovernanceBoard(selectedBoardId, {
                name: selectedBoardName.trim(),
                isActive: selectedBoardActive
            });
            const nextBoards = await fetchGovernanceBoards({ includeInactive: true });
            setBoards(nextBoards);
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
                    onClick={() => {
                        if (!confirmDiscardChanges()) return;
                        resetDirtyFlags();
                        loadAll(true);
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

            {/* ─── Settings Tab ─── */}
            {configTab === 'settings' && (
                <section className="governance-section">
                    <h4>Global Settings</h4>
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
                            <label>Voting Window (days, optional)</label>
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
                            <label>Quorum Percent (1-100)</label>
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
                            <label>Quorum Minimum Votes</label>
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
                                Require quorum before final decision
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
                </section>
            )}

            {/* ─── Boards Tab ─── */}
            {configTab === 'boards' && (
                <section className="governance-section">
                    <h4>Governance Boards</h4>
                    <div className="governance-grid">
                        <div className="form-group">
                            <label>Select Board</label>
                            <select value={selectedBoardId} onChange={(e) => handleBoardSelectionChange(e.target.value)}>
                                <option value="">No boards yet</option>
                                {boards.map(board => (
                                    <option key={board.id} value={board.id}>
                                        {board.name} {board.isActive ? '' : '(Inactive)'}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>New Board Name</label>
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

                    {selectedBoard && (
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
                            <div className="form-actions">
                                <button className="btn-primary" onClick={handleUpdateBoard} disabled={boardSaving}>
                                    <Save size={14} /> Save Board
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {/* ─── Members Tab ─── */}
            {configTab === 'members' && (
                selectedBoardId ? (
                    <section className="governance-section">
                        <h4><Users size={16} /> Board Members — {selectedBoard?.name || 'Board'}</h4>
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
                    </section>
                ) : (
                    <div className="governance-empty-tab">
                        <Users size={32} />
                        <p>Select a board on the <strong>Boards</strong> tab to manage its members.</p>
                    </div>
                )
            )}

            {/* ─── Criteria Tab ─── */}
            {configTab === 'criteria' && (
                selectedBoardId ? (
                    <section className="governance-section governance-criteria-section">
                        <h4><ClipboardList size={16} /> Criteria Versions — {selectedBoard?.name || 'Board'}</h4>
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
                                                <div style={{ display: 'flex', gap: '0.25rem' }}>
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
