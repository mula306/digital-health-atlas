import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, RefreshCw, Save, Settings2, Users } from 'lucide-react';
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
    const [memberUserOid, setMemberUserOid] = useState('');
    const [memberRole, setMemberRole] = useState('member');

    const [criteriaVersions, setCriteriaVersions] = useState([]);
    const [selectedVersionId, setSelectedVersionId] = useState('');
    const [criteriaDraft, setCriteriaDraft] = useState(cloneCriteria([]));

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
        } catch (err) {
            console.error('Failed to load governance board details:', err);
            toast.error(err.message || 'Failed to load governance board details');
        }
    }, [fetchGovernanceBoardMembers, fetchGovernanceCriteriaVersions, toast]);

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
            toast.error('User OID is required');
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
    };

    const handleUpdateCriterion = (index, patch) => {
        setCriteriaDraft(prev => prev.map((criterion, idx) => {
            if (idx !== index) return criterion;
            return { ...criterion, ...patch };
        }));
    };

    const handleRemoveCriterion = (index) => {
        setCriteriaDraft(prev => prev.filter((_, idx) => idx !== index).map((criterion, idx) => ({
            ...criterion,
            sortOrder: idx + 1
        })));
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
                <h3><Settings2 size={18} /> Governance Configuration</h3>
                <button className="btn-secondary" onClick={() => loadAll(true)} disabled={refreshing}>
                    <RefreshCw size={14} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            <section className="governance-section">
                <h4>Global Setting</h4>
                <div className="governance-grid">
                    <div className="form-group">
                        <label>Governance</label>
                        <label className="required-checkbox">
                            <input
                                type="checkbox"
                                checked={governanceEnabled}
                                onChange={(e) => setGovernanceEnabled(e.target.checked)}
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
                            onChange={(e) => setVoteWindowDays(e.target.value)}
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
                            onChange={(e) => setQuorumPercent(Number(e.target.value))}
                            disabled={!phase3Ready}
                        />
                    </div>
                    <div className="form-group">
                        <label>Quorum Minimum Votes</label>
                        <input
                            type="number"
                            min="1"
                            value={quorumMinCount}
                            onChange={(e) => setQuorumMinCount(Number(e.target.value))}
                            disabled={!phase3Ready}
                        />
                    </div>
                </div>
                <div className="governance-inline-row">
                    <label className="required-checkbox">
                        <input
                            type="checkbox"
                            checked={decisionRequiresQuorum}
                            onChange={(e) => setDecisionRequiresQuorum(e.target.checked)}
                            disabled={!phase3Ready}
                        />
                        Require quorum before final decision
                    </label>
                    <button className="btn-primary" onClick={handleSaveSettings} disabled={settingsSaving}>
                        <Save size={14} /> {settingsSaving ? 'Saving...' : 'Save Setting'}
                    </button>
                </div>
                {!phase3Ready && (
                    <p className="governance-muted" style={{ marginTop: '0.5rem' }}>
                        Phase 3 schema is not installed yet. Run `npm run migrate:governance:phase2` in `server`.
                    </p>
                )}
            </section>

            <section className="governance-section">
                <h4>Boards</h4>
                <div className="governance-grid">
                    <div className="form-group">
                        <label>Select Board</label>
                        <select value={selectedBoardId} onChange={(e) => setSelectedBoardId(e.target.value)}>
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
                            onChange={(e) => setNewBoardName(e.target.value)}
                            placeholder="e.g., Clinical Governance Board"
                        />
                    </div>
                </div>
                <div className="governance-inline-row">
                    <label className="required-checkbox">
                        <input
                            type="checkbox"
                            checked={newBoardActive}
                            onChange={(e) => setNewBoardActive(e.target.checked)}
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
                                    onChange={(e) => setSelectedBoardName(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label>Status</label>
                                <label className="required-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={selectedBoardActive}
                                        onChange={(e) => setSelectedBoardActive(e.target.checked)}
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

            {selectedBoardId && (
                <>
                    <section className="governance-section">
                        <h4><Users size={16} /> Board Members</h4>
                        <div className="governance-grid">
                            <div className="form-group">
                                <label>User OID</label>
                                <input
                                    type="text"
                                    value={memberUserOid}
                                    onChange={(e) => setMemberUserOid(e.target.value)}
                                    placeholder="Azure AD object id"
                                />
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
                                                    <div>{member.userName || member.userEmail || member.userOid}</div>
                                                    <div className="governance-muted">{member.userOid}</div>
                                                </td>
                                                <td>{member.role}</td>
                                                <td>{member.isActive ? 'Active' : 'Inactive'}</td>
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

                    <section className="governance-section">
                        <h4><ClipboardList size={16} /> Criteria Versions</h4>
                        <div className="governance-grid">
                            <div className="form-group">
                                <label>Version</label>
                                <select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}>
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

                        <div className="governance-inline-row">
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

                        <div className="governance-table-wrap">
                            <table className="permissions-table">
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
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={criterion.sortOrder}
                                                    onChange={(e) => handleUpdateCriterion(index, { sortOrder: Number(e.target.value) || index + 1 })}
                                                />
                                            </td>
                                            <td>
                                                <button className="btn-secondary" onClick={() => handleRemoveCriterion(index)}>
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
                </>
            )}
        </div>
    );
}
