import { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { ReportFilterTree } from './ReportFilterTree';
import { ReportPreview } from './ReportPreview';
import './Reports.css';

const DEFAULT_PACK_FILTERS = {
    goalIds: [],
    tagIds: [],
    statuses: [],
    watchedOnly: false
};

const STATUS_FILTER_OPTIONS = [
    { value: 'red', label: 'Red' },
    { value: 'yellow', label: 'Yellow' },
    { value: 'green', label: 'Green' },
    { value: 'unknown', label: 'Unknown' }
];

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ReportsView() {
    const {
        fetchExecSummaryProjects,
        fetchExecutiveReportPacks,
        createExecutiveReportPack,
        updateExecutiveReportPack,
        fetchExecutiveReportPackRuns,
        runExecutiveReportPackNow,
        fetchExecutivePackSchedulerStatus,
        runDueExecutivePacks,
        goals,
        tagGroups,
        hasRole
    } = useData();
    const toast = useToast();
    const [selectedProjectIds, setSelectedProjectIds] = useState([]);
    const [allProjects, setAllProjects] = useState([]);
    const [packs, setPacks] = useState([]);
    const [loadingPacks, setLoadingPacks] = useState(false);
    const [savingPack, setSavingPack] = useState(false);
    const [runningPackId, setRunningPackId] = useState('');
    const [selectedPackId, setSelectedPackId] = useState('');
    const [packRuns, setPackRuns] = useState([]);
    const [loadingPackRuns, setLoadingPackRuns] = useState(false);
    const [showPackEditor, setShowPackEditor] = useState(false);
    const [editingPackId, setEditingPackId] = useState('');
    const [schedulerStatus, setSchedulerStatus] = useState(null);
    const [loadingScheduler, setLoadingScheduler] = useState(false);
    const [runningDue, setRunningDue] = useState(false);
    const [packForm, setPackForm] = useState({
        name: '',
        description: '',
        scheduleType: 'weekly',
        scheduleDayOfWeek: 1,
        scheduleHour: 9,
        scheduleMinute: 0,
        exceptionOnly: false,
        isActive: true,
        filters: { ...DEFAULT_PACK_FILTERS }
    });
    const canRunDuePacks = hasRole('Admin');

    const availableGoals = useMemo(
        () => (Array.isArray(goals) ? goals : [])
            .map((goal) => ({
                id: Number.parseInt(goal.id, 10),
                title: goal.title || goal.name || `Goal ${goal.id}`
            }))
            .filter((goal) => !Number.isNaN(goal.id))
            .sort((a, b) => a.title.localeCompare(b.title)),
        [goals]
    );

    const availableTags = useMemo(() => {
        const groups = Array.isArray(tagGroups) ? tagGroups : [];
        const tags = groups.flatMap((group) => (Array.isArray(group.tags) ? group.tags.map((tag) => ({
            id: Number.parseInt(tag.id, 10),
            name: tag.name || `Tag ${tag.id}`,
            groupName: group.name || ''
        })) : []));
        return tags
            .filter((tag) => !Number.isNaN(tag.id))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [tagGroups]);

    const selectedPack = useMemo(
        () => packs.find((pack) => String(pack.id) === String(selectedPackId)) || null,
        [packs, selectedPackId]
    );

    const loadExecutivePacks = async () => {
        try {
            setLoadingPacks(true);
            const rows = await fetchExecutiveReportPacks();
            const items = Array.isArray(rows) ? rows : [];
            setPacks(items);
            if (items.length > 0 && !selectedPackId) {
                setSelectedPackId(String(items[0].id));
            }
            if (items.length === 0) {
                setSelectedPackId('');
            }
        } catch (err) {
            console.error('Failed to load executive packs:', err);
            toast.error(err.message || 'Failed to load executive packs');
        } finally {
            setLoadingPacks(false);
        }
    };

    const loadSchedulerStatus = async () => {
        try {
            setLoadingScheduler(true);
            const status = await fetchExecutivePackSchedulerStatus();
            setSchedulerStatus(status || null);
        } catch (err) {
            console.error('Failed to load scheduler status:', err);
            setSchedulerStatus(null);
        } finally {
            setLoadingScheduler(false);
        }
    };

    // Fetch full project list once on mount
    useEffect(() => {
        let isMounted = true;
        fetchExecSummaryProjects().then((data) => {
            if (isMounted && Array.isArray(data)) {
                setAllProjects(data);
            }
        });
        loadExecutivePacks();
        loadSchedulerStatus();
        return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchExecSummaryProjects]);

    useEffect(() => {
        if (!selectedPackId) {
            setPackRuns([]);
            return;
        }
        let cancelled = false;
        const loadRuns = async () => {
            try {
                setLoadingPackRuns(true);
                const runs = await fetchExecutiveReportPackRuns(selectedPackId);
                if (!cancelled) {
                    setPackRuns(Array.isArray(runs) ? runs : []);
                }
            } catch (err) {
                if (!cancelled) {
                    setPackRuns([]);
                    toast.error(err.message || 'Failed to load pack run history');
                }
            } finally {
                if (!cancelled) setLoadingPackRuns(false);
            }
        };

        loadRuns();
        return () => { cancelled = true; };
    }, [fetchExecutiveReportPackRuns, selectedPackId, toast]);

    const resetPackForm = () => {
        setEditingPackId('');
        setPackForm({
            name: '',
            description: '',
            scheduleType: 'weekly',
            scheduleDayOfWeek: 1,
            scheduleHour: 9,
            scheduleMinute: 0,
            exceptionOnly: false,
            isActive: true,
            filters: { ...DEFAULT_PACK_FILTERS }
        });
    };

    const startCreatePack = () => {
        resetPackForm();
        setShowPackEditor(true);
    };

    const startEditPack = (pack) => {
        const filters = pack?.filters || {};
        setEditingPackId(String(pack.id));
        setPackForm({
            name: pack.name || '',
            description: pack.description || '',
            scheduleType: pack.scheduleType || 'weekly',
            scheduleDayOfWeek: Number(pack.scheduleDayOfWeek ?? 1),
            scheduleHour: Number(pack.scheduleHour ?? 9),
            scheduleMinute: Number(pack.scheduleMinute ?? 0),
            exceptionOnly: !!pack.exceptionOnly,
            isActive: !!pack.isActive,
            filters: {
                goalIds: Array.isArray(filters.goalIds)
                    ? filters.goalIds.map((id) => Number.parseInt(id, 10)).filter((id) => !Number.isNaN(id))
                    : [],
                tagIds: Array.isArray(filters.tagIds)
                    ? filters.tagIds.map((id) => Number.parseInt(id, 10)).filter((id) => !Number.isNaN(id))
                    : [],
                statuses: Array.isArray(filters.statuses)
                    ? filters.statuses.map((status) => String(status).toLowerCase().trim()).filter(Boolean)
                    : [],
                watchedOnly: !!filters.watchedOnly
            }
        });
        setShowPackEditor(true);
    };

    const updatePackFilters = (updater) => {
        setPackForm((previous) => {
            const currentFilters = previous.filters || DEFAULT_PACK_FILTERS;
            return {
                ...previous,
                filters: updater(currentFilters)
            };
        });
    };

    const toggleNumericFilter = (key, value) => {
        updatePackFilters((filters) => {
            const numericValue = Number.parseInt(value, 10);
            if (Number.isNaN(numericValue)) return filters;
            const current = new Set((filters[key] || []).map((item) => Number.parseInt(item, 10)));
            if (current.has(numericValue)) current.delete(numericValue);
            else current.add(numericValue);
            return {
                ...filters,
                [key]: Array.from(current).filter((item) => !Number.isNaN(item))
            };
        });
    };

    const toggleStatusFilter = (value) => {
        updatePackFilters((filters) => {
            const normalized = String(value || '').toLowerCase().trim();
            if (!normalized) return filters;
            const current = new Set((filters.statuses || []).map((status) => String(status).toLowerCase().trim()));
            if (current.has(normalized)) current.delete(normalized);
            else current.add(normalized);
            return {
                ...filters,
                statuses: Array.from(current)
            };
        });
    };

    const clearPackFilters = () => {
        updatePackFilters(() => ({ ...DEFAULT_PACK_FILTERS }));
    };

    const handleSavePack = async () => {
        if (!packForm.name.trim()) {
            toast.error('Pack name is required');
            return;
        }
        const normalizedStatuses = new Set(STATUS_FILTER_OPTIONS.map((option) => option.value));

        const payload = {
            name: packForm.name.trim(),
            description: packForm.description.trim() || null,
            scheduleType: packForm.scheduleType,
            scheduleDayOfWeek: Number(packForm.scheduleDayOfWeek),
            scheduleHour: Number(packForm.scheduleHour),
            scheduleMinute: Number(packForm.scheduleMinute),
            exceptionOnly: !!packForm.exceptionOnly,
            isActive: !!packForm.isActive,
            filters: {
                goalIds: Array.from(new Set((packForm.filters?.goalIds || [])
                    .map((id) => Number.parseInt(id, 10))
                    .filter((id) => !Number.isNaN(id)))),
                tagIds: Array.from(new Set((packForm.filters?.tagIds || [])
                    .map((id) => Number.parseInt(id, 10))
                    .filter((id) => !Number.isNaN(id)))),
                statuses: Array.from(new Set((packForm.filters?.statuses || [])
                    .map((status) => String(status).toLowerCase().trim())
                    .filter((status) => normalizedStatuses.has(status)))),
                watchedOnly: !!packForm.filters?.watchedOnly
            }
        };

        try {
            setSavingPack(true);
            if (editingPackId) {
                await updateExecutiveReportPack(editingPackId, payload);
                toast.success('Executive pack updated');
            } else {
                await createExecutiveReportPack(payload);
                toast.success('Executive pack created');
            }
            setShowPackEditor(false);
            resetPackForm();
            await loadExecutivePacks();
        } catch (err) {
            console.error('Failed to save executive pack:', err);
            toast.error(err.message || 'Failed to save executive pack');
        } finally {
            setSavingPack(false);
        }
    };

    const handleRunPackNow = async (packId) => {
        try {
            setRunningPackId(String(packId));
            await runExecutiveReportPackNow(packId);
            toast.success('Executive pack run complete');
            await loadExecutivePacks();
            await loadSchedulerStatus();
            if (String(selectedPackId) === String(packId)) {
                const runs = await fetchExecutiveReportPackRuns(packId);
                setPackRuns(Array.isArray(runs) ? runs : []);
            }
        } catch (err) {
            console.error('Failed to run executive pack:', err);
            toast.error(err.message || 'Failed to run executive pack');
        } finally {
            setRunningPackId('');
        }
    };

    const handleRunDuePacks = async () => {
        try {
            setRunningDue(true);
            const result = await runDueExecutivePacks(20);
            const completed = Array.isArray(result?.results)
                ? result.results.filter((item) => item.ok).length
                : 0;
            const failed = Array.isArray(result?.results)
                ? result.results.filter((item) => !item.ok).length
                : 0;
            toast.success(`Due packs run complete (${completed} succeeded${failed > 0 ? `, ${failed} failed` : ''})`);
            await loadExecutivePacks();
            await loadSchedulerStatus();
            if (selectedPackId) {
                const runs = await fetchExecutiveReportPackRuns(selectedPackId);
                setPackRuns(Array.isArray(runs) ? runs : []);
            }
        } catch (err) {
            console.error('Failed to run due packs:', err);
            toast.error(err.message || 'Failed to run due packs');
        } finally {
            setRunningDue(false);
        }
    };

    const formatDateTime = (value) => {
        if (!value) return 'n/a';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'n/a';
        return date.toLocaleString();
    };

    const getPackFilterSummary = (pack) => {
        const filters = pack?.filters || {};
        const goalCount = Array.isArray(filters.goalIds) ? filters.goalIds.length : 0;
        const tagCount = Array.isArray(filters.tagIds) ? filters.tagIds.length : 0;
        const statusCount = Array.isArray(filters.statuses) ? filters.statuses.length : 0;
        const watchedOnly = !!filters.watchedOnly;

        const parts = [];
        if (goalCount > 0) parts.push(`${goalCount} goal${goalCount === 1 ? '' : 's'}`);
        if (tagCount > 0) parts.push(`${tagCount} tag${tagCount === 1 ? '' : 's'}`);
        if (statusCount > 0) parts.push(`${statusCount} status`);
        if (watchedOnly) parts.push('watched only');

        return parts.length > 0 ? `Filters: ${parts.join(' • ')}` : 'Filters: none';
    };

    return (
        <div className="reports-page">
            <section className="reports-pack-panel">
                <div className="reports-pack-header">
                    <h3>Executive Packs</h3>
                    <div className="reports-pack-actions">
                        <button className="btn-secondary" onClick={loadSchedulerStatus} disabled={loadingScheduler}>
                            {loadingScheduler ? 'Scheduler...' : `Due: ${schedulerStatus?.dueCount ?? 0}`}
                        </button>
                        {canRunDuePacks && (
                            <button className="btn-secondary" onClick={handleRunDuePacks} disabled={runningDue}>
                                {runningDue ? 'Running Due...' : 'Run Due Packs'}
                            </button>
                        )}
                        <button className="btn-secondary" onClick={loadExecutivePacks} disabled={loadingPacks}>
                            <RefreshCw size={14} /> {loadingPacks ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <button className="btn-primary" onClick={startCreatePack}>
                            New Pack
                        </button>
                    </div>
                </div>

                {showPackEditor && (
                    <div className="reports-pack-editor">
                        <div className="reports-pack-editor-grid">
                            <div className="form-group">
                                <label>Name</label>
                                <input
                                    type="text"
                                    value={packForm.name}
                                    onChange={(e) => setPackForm((previous) => ({ ...previous, name: e.target.value }))}
                                    placeholder="Weekly governance exception report"
                                />
                            </div>
                            <div className="form-group">
                                <label>Schedule</label>
                                <select
                                    value={packForm.scheduleType}
                                    onChange={(e) => setPackForm((previous) => ({ ...previous, scheduleType: e.target.value }))}
                                >
                                    <option value="weekly">Weekly</option>
                                    <option value="manual">Manual only</option>
                                </select>
                            </div>
                            {packForm.scheduleType === 'weekly' && (
                                <>
                                    <div className="form-group">
                                        <label>Day</label>
                                        <select
                                            value={packForm.scheduleDayOfWeek}
                                            onChange={(e) => setPackForm((previous) => ({ ...previous, scheduleDayOfWeek: Number(e.target.value) }))}
                                        >
                                            <option value={0}>Sunday</option>
                                            <option value={1}>Monday</option>
                                            <option value={2}>Tuesday</option>
                                            <option value={3}>Wednesday</option>
                                            <option value={4}>Thursday</option>
                                            <option value={5}>Friday</option>
                                            <option value={6}>Saturday</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label>Hour</label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={23}
                                            value={packForm.scheduleHour}
                                            onChange={(e) => setPackForm((previous) => ({ ...previous, scheduleHour: Number(e.target.value) }))}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Minute</label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={59}
                                            value={packForm.scheduleMinute}
                                            onChange={(e) => setPackForm((previous) => ({ ...previous, scheduleMinute: Number(e.target.value) }))}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="form-group">
                            <label>Description</label>
                            <textarea
                                value={packForm.description}
                                onChange={(e) => setPackForm((previous) => ({ ...previous, description: e.target.value }))}
                                placeholder="Optional audience and context notes..."
                            />
                        </div>
                        <div className="reports-pack-filter-head">
                            <strong>Pack Filters</strong>
                            <button type="button" className="btn-secondary btn-sm" onClick={clearPackFilters}>
                                Clear Filters
                            </button>
                        </div>
                        <div className="reports-pack-filter-grid">
                            <div className="form-group">
                                <label>Goals</label>
                                <div className="reports-pack-filter-options">
                                    {availableGoals.length === 0 ? (
                                        <span className="reports-pack-empty">No goals available</span>
                                    ) : availableGoals.map((goal) => {
                                        const selected = (packForm.filters?.goalIds || []).includes(goal.id);
                                        return (
                                            <button
                                                key={`goal-filter-${goal.id}`}
                                                type="button"
                                                className={`reports-filter-chip ${selected ? 'active' : ''}`}
                                                onClick={() => toggleNumericFilter('goalIds', goal.id)}
                                            >
                                                {goal.title}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Tags</label>
                                <div className="reports-pack-filter-options">
                                    {availableTags.length === 0 ? (
                                        <span className="reports-pack-empty">No tags available</span>
                                    ) : availableTags.map((tag) => {
                                        const selected = (packForm.filters?.tagIds || []).includes(tag.id);
                                        return (
                                            <button
                                                key={`tag-filter-${tag.id}`}
                                                type="button"
                                                className={`reports-filter-chip ${selected ? 'active' : ''}`}
                                                onClick={() => toggleNumericFilter('tagIds', tag.id)}
                                                title={tag.groupName || tag.name}
                                            >
                                                {tag.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Status</label>
                                <div className="reports-pack-filter-options">
                                    {STATUS_FILTER_OPTIONS.map((statusOption) => {
                                        const selected = (packForm.filters?.statuses || []).includes(statusOption.value);
                                        return (
                                            <button
                                                key={`status-filter-${statusOption.value}`}
                                                type="button"
                                                className={`reports-filter-chip ${selected ? 'active' : ''}`}
                                                onClick={() => toggleStatusFilter(statusOption.value)}
                                            >
                                                {statusOption.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        <div className="reports-pack-editor-toggles">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={packForm.exceptionOnly}
                                    onChange={(e) => setPackForm((previous) => ({ ...previous, exceptionOnly: e.target.checked }))}
                                />
                                Exception only mode
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={packForm.isActive}
                                    onChange={(e) => setPackForm((previous) => ({ ...previous, isActive: e.target.checked }))}
                                />
                                Active
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={!!packForm.filters?.watchedOnly}
                                    onChange={(e) => updatePackFilters((filters) => ({ ...filters, watchedOnly: e.target.checked }))}
                                />
                                Watched projects only
                            </label>
                        </div>
                        <div className="reports-pack-editor-actions">
                            <button
                                className="btn-secondary"
                                onClick={() => {
                                    setShowPackEditor(false);
                                    resetPackForm();
                                }}
                                disabled={savingPack}
                            >
                                Cancel
                            </button>
                            <button className="btn-primary" onClick={handleSavePack} disabled={savingPack}>
                                {savingPack ? 'Saving...' : editingPackId ? 'Save Changes' : 'Create Pack'}
                            </button>
                        </div>
                    </div>
                )}

                <div className="reports-pack-grid">
                    {packs.length === 0 ? (
                        <div className="reports-pack-empty">
                            No executive packs configured yet.
                        </div>
                    ) : packs.map((pack) => (
                        <article
                            key={pack.id}
                            className={`reports-pack-card ${String(selectedPackId) === String(pack.id) ? 'active' : ''}`}
                        >
                            <div className="reports-pack-card-head">
                                <button className="reports-pack-select" onClick={() => setSelectedPackId(String(pack.id))}>
                                    <strong>{pack.name}</strong>
                                    <span>
                                        {pack.scheduleType === 'weekly'
                                            ? `Weekly ${WEEKDAY_LABELS[Number(pack.scheduleDayOfWeek ?? 1)] || pack.scheduleDayOfWeek} @ ${pack.scheduleHour}:${String(pack.scheduleMinute).padStart(2, '0')}`
                                            : 'Manual run only'}
                                    </span>
                                </button>
                                <span className={`reports-pack-status ${pack.isActive ? 'active' : 'paused'}`}>
                                    {pack.isActive ? 'Active' : 'Paused'}
                                </span>
                            </div>
                            <div className="reports-pack-card-meta">
                                <span>Last run: {formatDateTime(pack.lastRunAt)}</span>
                                <span>Next run: {formatDateTime(pack.nextRunAt)}</span>
                                <span>{getPackFilterSummary(pack)}</span>
                            </div>
                            <div className="reports-pack-card-actions">
                                <button className="btn-secondary btn-sm" onClick={() => startEditPack(pack)}>
                                    Edit
                                </button>
                                <button
                                    className="btn-primary btn-sm"
                                    onClick={() => handleRunPackNow(pack.id)}
                                    disabled={runningPackId === String(pack.id)}
                                >
                                    {runningPackId === String(pack.id) ? 'Running...' : 'Run Now'}
                                </button>
                            </div>
                        </article>
                    ))}
                </div>

                {selectedPack && (
                    <div className="reports-pack-runs">
                        <div className="reports-pack-runs-head">
                            <h4>Run History - {selectedPack.name}</h4>
                        </div>
                        {loadingPackRuns ? (
                            <div className="reports-pack-empty">Loading run history...</div>
                        ) : packRuns.length === 0 ? (
                            <div className="reports-pack-empty">No run history yet.</div>
                        ) : (
                            <div className="reports-pack-run-list">
                                {packRuns.slice(0, 8).map((run) => (
                                    <div key={run.id} className="reports-pack-run-row">
                                        <span>{run.status} ({run.runType})</span>
                                        <span>{formatDateTime(run.startedAt)}</span>
                                        <span>
                                            {run.summary?.totalProjects ?? 0} projects
                                            {run.summary?.exceptionOnly ? ' - exceptions only' : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </section>

            <div className="reports-container">
                <div className="report-sidebar">
                    <div className="report-sidebar-header">
                        <h3>Select Projects</h3>
                    </div>
                    <div className="report-tree-content">
                        <ReportFilterTree
                            onSelectionChange={setSelectedProjectIds}
                            allProjects={allProjects}
                        />
                    </div>
                </div>

                <ReportPreview
                    selectedProjectIds={selectedProjectIds}
                    allProjects={allProjects}
                />
            </div>
        </div>
    );
}
