import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';

const EMPTY_FORM = {
    title: '',
    status: 'planned',
    baselineValue: '',
    targetValue: '',
    currentValue: '',
    unit: '',
    dueAt: '',
    notes: ''
};

const STATUS_LABELS = {
    planned: 'Planned',
    'in-progress': 'In Progress',
    realized: 'Realized',
    'at-risk': 'At Risk',
    'not-realized': 'Not Realized'
};

export function ProjectBenefitsPanel({ projectId, canEditProject }) {
    const {
        fetchProjectBenefitsRisk,
        createProjectBenefit,
        updateProjectBenefit,
        deleteProjectBenefit
    } = useData();
    const toast = useToast();

    const [loading, setLoading] = useState(false);
    const [schemaReady, setSchemaReady] = useState(true);
    const [riskSignal, setRiskSignal] = useState(null);
    const [governanceRationale, setGovernanceRationale] = useState(null);
    const [benefits, setBenefits] = useState([]);
    const [form, setForm] = useState(EMPTY_FORM);
    const [editingBenefitId, setEditingBenefitId] = useState('');
    const [saving, setSaving] = useState(false);

    const loadData = useCallback(async () => {
        if (!projectId) return;
        setLoading(true);
        try {
            const data = await fetchProjectBenefitsRisk(projectId);
            setSchemaReady(data?.schemaReady !== false);
            setRiskSignal(data?.riskSignal || null);
            setGovernanceRationale(data?.governanceRationale || null);
            setBenefits(Array.isArray(data?.benefits) ? data.benefits : []);
        } catch (err) {
            console.error('Failed to load project benefits/risk:', err);
            toast.error(err.message || 'Failed to load project benefits and risk');
        } finally {
            setLoading(false);
        }
    }, [projectId, fetchProjectBenefitsRisk, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const riskLevel = riskSignal?.level || 'low';
    const riskScore = Number(riskSignal?.score || 0);
    const sortedSignals = useMemo(() => {
        const rows = Array.isArray(riskSignal?.signals) ? riskSignal.signals : [];
        return [...rows].sort((a, b) => Number(b.points || 0) - Number(a.points || 0));
    }, [riskSignal?.signals]);

    const resetForm = () => {
        setEditingBenefitId('');
        setForm(EMPTY_FORM);
    };

    const startEdit = (benefit) => {
        setEditingBenefitId(String(benefit.id));
        setForm({
            title: benefit.title || '',
            status: benefit.status || 'planned',
            baselineValue: benefit.baselineValue ?? '',
            targetValue: benefit.targetValue ?? '',
            currentValue: benefit.currentValue ?? '',
            unit: benefit.unit || '',
            dueAt: benefit.dueAt ? String(benefit.dueAt).slice(0, 10) : '',
            notes: benefit.notes || ''
        });
    };

    const buildPayload = () => ({
        title: form.title,
        status: form.status,
        baselineValue: form.baselineValue === '' ? null : Number(form.baselineValue),
        targetValue: form.targetValue === '' ? null : Number(form.targetValue),
        currentValue: form.currentValue === '' ? null : Number(form.currentValue),
        unit: form.unit || null,
        dueAt: form.dueAt || null,
        notes: form.notes || null
    });

    const handleSave = async () => {
        if (!form.title.trim()) {
            toast.error('Benefit title is required');
            return;
        }

        const payload = buildPayload();
        try {
            setSaving(true);
            if (editingBenefitId) {
                await updateProjectBenefit(projectId, editingBenefitId, payload);
                toast.success('Benefit updated');
            } else {
                await createProjectBenefit(projectId, payload);
                toast.success('Benefit created');
            }
            resetForm();
            await loadData();
        } catch (err) {
            console.error('Failed to save project benefit:', err);
            toast.error(err.message || 'Failed to save benefit');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (benefitId) => {
        try {
            await deleteProjectBenefit(projectId, benefitId);
            toast.success('Benefit removed');
            await loadData();
        } catch (err) {
            console.error('Failed to delete project benefit:', err);
            toast.error(err.message || 'Failed to delete benefit');
        }
    };

    return (
        <section className="project-benefits-panel">
            <div className="project-benefits-grid">
                <article className={`project-risk-card level-${riskLevel}`}>
                    <div className="project-risk-head">
                        <h3><TrendingUp size={16} /> Predictive Risk Signal</h3>
                        <span className="project-risk-score">{riskScore}</span>
                    </div>
                    <div className="project-risk-meta">
                        <span className={`status-badge ${riskLevel === 'critical' || riskLevel === 'high' ? 'rejected' : riskLevel === 'medium' ? 'pending' : 'approved'}`}>
                            {riskLevel.toUpperCase()}
                        </span>
                        <span>{benefits.length} tracked benefit{benefits.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="project-risk-metrics">
                        <span>Overdue: {riskSignal?.metrics?.overdueTasks ?? 0}</span>
                        <span>Blocked: {riskSignal?.metrics?.blockedTasks ?? 0}</span>
                        <span>Report: {(riskSignal?.metrics?.reportStatus || 'unknown').toUpperCase()}</span>
                    </div>
                    {sortedSignals.length > 0 ? (
                        <ul className="project-risk-signal-list">
                            {sortedSignals.slice(0, 4).map((signal) => (
                                <li key={signal.key}>
                                    <strong>+{signal.points}</strong> {signal.message}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="project-benefits-muted">No active risk signals detected.</p>
                    )}
                </article>

                <article className="project-governance-trace">
                    <h3>Governance Trace</h3>
                    {governanceRationale ? (
                        <>
                            <div className="project-trace-row">
                                <strong>Decision</strong>
                                <span>{governanceRationale.governanceDecision || 'n/a'}</span>
                            </div>
                            <div className="project-trace-row">
                                <strong>Decided</strong>
                                <span>{governanceRationale.decidedAt ? new Date(governanceRationale.decidedAt).toLocaleString() : 'n/a'}</span>
                            </div>
                            <p className="project-benefits-muted">
                                {governanceRationale.governanceReason || 'No rationale text captured.'}
                            </p>
                        </>
                    ) : (
                        <p className="project-benefits-muted">
                            No linked governance rationale found for this project.
                        </p>
                    )}
                </article>
            </div>

            {!schemaReady && (
                <div className="project-benefits-warning">
                    <AlertTriangle size={15} />
                    Benefits schema is unavailable. Run `npm run migrate:wave3` in `server`.
                </div>
            )}

            {canEditProject && schemaReady && (
                <article className="project-benefit-editor">
                    <h3>{editingBenefitId ? 'Edit Benefit' : 'Add Benefit'}</h3>
                    <div className="project-benefit-editor-grid">
                        <div className="form-group">
                            <label>Benefit</label>
                            <input
                                type="text"
                                value={form.title}
                                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                                placeholder="Example: Reduce duplicate referrals"
                            />
                        </div>
                        <div className="form-group">
                            <label>Status</label>
                            <select
                                value={form.status}
                                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                            >
                                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Target</label>
                            <input
                                type="number"
                                value={form.targetValue}
                                onChange={(e) => setForm((prev) => ({ ...prev, targetValue: e.target.value }))}
                                placeholder="Target value"
                            />
                        </div>
                        <div className="form-group">
                            <label>Current</label>
                            <input
                                type="number"
                                value={form.currentValue}
                                onChange={(e) => setForm((prev) => ({ ...prev, currentValue: e.target.value }))}
                                placeholder="Current value"
                            />
                        </div>
                        <div className="form-group">
                            <label>Unit</label>
                            <input
                                type="text"
                                value={form.unit}
                                onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                                placeholder="% or hours"
                            />
                        </div>
                        <div className="form-group">
                            <label>Due Date</label>
                            <input
                                type="date"
                                value={form.dueAt}
                                onChange={(e) => setForm((prev) => ({ ...prev, dueAt: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Notes</label>
                        <textarea
                            value={form.notes}
                            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                            placeholder="Outcome assumptions, evidence source, and owner notes."
                        />
                    </div>
                    <div className="project-benefit-editor-actions">
                        {editingBenefitId && (
                            <button className="btn-secondary" onClick={resetForm} disabled={saving}>
                                Cancel
                            </button>
                        )}
                        <button className="btn-primary" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving...' : editingBenefitId ? 'Save Changes' : 'Add Benefit'}
                        </button>
                    </div>
                </article>
            )}

            <article className="project-benefit-list">
                <div className="project-benefit-list-head">
                    <h3>Benefits Realization</h3>
                    <button className="btn-secondary btn-sm" onClick={loadData} disabled={loading}>
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>

                {loading ? (
                    <div className="project-benefits-muted">Loading benefits...</div>
                ) : benefits.length === 0 ? (
                    <div className="project-benefits-muted">No benefits tracked yet.</div>
                ) : (
                    <div className="project-benefit-list-grid">
                        {benefits.map((benefit) => (
                            <article key={benefit.id} className="project-benefit-card">
                                <div className="project-benefit-card-head">
                                    <strong>{benefit.title}</strong>
                                    <span className={`status-badge ${benefit.status === 'realized' ? 'approved' : benefit.status === 'at-risk' ? 'rejected' : 'pending'}`}>
                                        {STATUS_LABELS[benefit.status] || benefit.status}
                                    </span>
                                </div>
                                <div className="project-benefit-card-metrics">
                                    <span>Target: {benefit.targetValue ?? 'n/a'} {benefit.unit || ''}</span>
                                    <span>Current: {benefit.currentValue ?? 'n/a'} {benefit.unit || ''}</span>
                                    <span>Due: {benefit.dueAt ? new Date(benefit.dueAt).toLocaleDateString() : 'n/a'}</span>
                                </div>
                                {benefit.notes && (
                                    <p className="project-benefits-muted">{benefit.notes}</p>
                                )}
                                {canEditProject && schemaReady && (
                                    <div className="project-benefit-card-actions">
                                        <button className="btn-secondary btn-sm" onClick={() => startEdit(benefit)}>Edit</button>
                                        <button className="btn-secondary btn-sm" onClick={() => handleDelete(benefit.id)}>Delete</button>
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                )}
            </article>
        </section>
    );
}
