import { ArrowLeft, Calendar, User } from 'lucide-react';
import './StatusReport.css';

export function StatusReportCompare({ report1, report2, projectTitle, onClose }) {
    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const compareValue = (val1, val2, label) => {
        if (val1 === val2) return null;
        return (
            <div className="compare-change">
                <strong>{label}:</strong>
                <span className="diff-removed">{val1 || '(empty)'}</span>
                <span>→</span>
                <span className="diff-added">{val2 || '(empty)'}</span>
            </div>
        );
    };

    const getStatusLabel = (status) => {
        switch (status) {
            case 'green': return '🟢 On Track';
            case 'yellow': return '🟡 At Risk';
            case 'red': return '🔴 Off Track';
            default: return status;
        }
    };

    // Find differences
    const statusChanged = report1.overallStatus !== report2.overallStatus;
    const purposeChanged = report1.purpose !== report2.purpose;

    // Workstream changes
    const ws1Ids = new Set(report1.workstreams?.map(w => w.id) || []);
    const ws2Ids = new Set(report2.workstreams?.map(w => w.id) || []);
    const addedWorkstreams = report2.workstreams?.filter(w => !ws1Ids.has(w.id)) || [];
    const removedWorkstreams = report1.workstreams?.filter(w => !ws2Ids.has(w.id)) || [];

    // Risk changes
    const r1Ids = new Set(report1.risks?.map(r => r.id) || []);
    const r2Ids = new Set(report2.risks?.map(r => r.id) || []);
    const addedRisks = report2.risks?.filter(r => !r1Ids.has(r.id)) || [];
    const closedRisks = report2.risks?.filter(r => {
        const prev = report1.risks?.find(pr => pr.id === r.id);
        return prev && prev.status === 'open' && r.status === 'closed';
    }) || [];

    // Decision changes
    const d1Ids = new Set(report1.decisions?.map(d => d.id) || []);
    const addedDecisions = report2.decisions?.filter(d => !d1Ids.has(d.id)) || [];
    const resolvedDecisions = report2.decisions?.filter(d => {
        const prev = report1.decisions?.find(pd => pd.id === d.id);
        return prev && prev.status === 'pending' && d.status !== 'pending';
    }) || [];

    // Milestone changes
    const milestoneChanges = report2.milestones?.filter(m => {
        const prev = report1.milestones?.find(pm => pm.type === m.type);
        return prev && (prev.date !== m.date || prev.status !== m.status);
    }) || [];

    return (
        <div className="compare-view">
            <button className="btn-secondary" onClick={onClose} style={{ marginBottom: '1rem' }}>
                <ArrowLeft size={16} /> Back to History
            </button>

            <div className="compare-header-section" style={{
                display: 'flex',
                gap: '2rem',
                marginBottom: '2rem',
                padding: '1rem',
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)'
            }}>
                <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>Version {report1.version}</h3>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
                        <Calendar size={12} /> {formatDate(report1.reportDate)} •
                        <User size={12} /> {report1.createdBy}
                    </div>
                    <div className={`history-status ${report1.overallStatus}`} style={{ marginTop: '0.5rem' }}>
                        {getStatusLabel(report1.overallStatus)}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', fontSize: '1.5rem', color: 'var(--text-tertiary)' }}>
                    →
                </div>
                <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>Version {report2.version}</h3>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
                        <Calendar size={12} /> {formatDate(report2.reportDate)} •
                        <User size={12} /> {report2.createdBy}
                    </div>
                    <div className={`history-status ${report2.overallStatus}`} style={{ marginTop: '0.5rem' }}>
                        {getStatusLabel(report2.overallStatus)}
                    </div>
                </div>
            </div>

            <h3 style={{ marginBottom: '1rem' }}>Changes Summary</h3>

            <div className="changes-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Status Change */}
                {statusChanged && (
                    <div className="change-item diff-changed" style={{ padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                        <strong>Overall Status Changed:</strong><br />
                        {getStatusLabel(report1.overallStatus)} → {getStatusLabel(report2.overallStatus)}
                    </div>
                )}

                {/* Purpose Change */}
                {purposeChanged && (
                    <div className="change-item diff-changed" style={{ padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                        <strong>Purpose Updated</strong>
                    </div>
                )}

                {/* Milestone Changes */}
                {milestoneChanges.length > 0 && (
                    <div className="change-item" style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                        <strong>Milestone Updates:</strong>
                        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                            {milestoneChanges.map(m => {
                                const prev = report1.milestones.find(pm => pm.type === m.type);
                                return (
                                    <li key={m.type}>
                                        <strong>{m.label}:</strong>
                                        {prev.date !== m.date && ` Date: ${formatDate(prev.date)} → ${formatDate(m.date)}`}
                                        {prev.status !== m.status && ` Status: ${prev.status} → ${m.status}`}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}

                {/* Added Workstreams */}
                {addedWorkstreams.length > 0 && (
                    <div className="change-item diff-added" style={{ padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                        <strong>New Workstreams:</strong>
                        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                            {addedWorkstreams.map(ws => (
                                <li key={ws.id}>{ws.name}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Removed Workstreams */}
                {removedWorkstreams.length > 0 && (
                    <div className="change-item diff-removed" style={{ padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                        <strong>Removed Workstreams:</strong>
                        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                            {removedWorkstreams.map(ws => (
                                <li key={ws.id}>{ws.name}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Added Risks */}
                {addedRisks.length > 0 && (
                    <div className="change-item diff-added" style={{ padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                        <strong>New Risks:</strong>
                        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                            {addedRisks.map(r => (
                                <li key={r.id}>{r.description} ({r.priority} priority)</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Closed Risks */}
                {closedRisks.length > 0 && (
                    <div className="change-item" style={{
                        padding: '1rem',
                        background: 'rgba(16, 185, 129, 0.1)',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        <strong>Risks Closed:</strong>
                        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                            {closedRisks.map(r => (
                                <li key={r.id}>{r.description}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Added Decisions */}
                {addedDecisions.length > 0 && (
                    <div className="change-item diff-added" style={{ padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                        <strong>New Decisions:</strong>
                        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                            {addedDecisions.map(d => (
                                <li key={d.id}>{d.description}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Resolved Decisions */}
                {resolvedDecisions.length > 0 && (
                    <div className="change-item" style={{
                        padding: '1rem',
                        background: 'rgba(16, 185, 129, 0.1)',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        <strong>Decisions Resolved:</strong>
                        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.5rem' }}>
                            {resolvedDecisions.map(d => (
                                <li key={d.id}>
                                    {d.description} -
                                    {d.status === 'approved' ? ' ✅ Approved' : ' ❌ Rejected'}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* No Changes */}
                {!statusChanged &&
                    !purposeChanged &&
                    milestoneChanges.length === 0 &&
                    addedWorkstreams.length === 0 &&
                    removedWorkstreams.length === 0 &&
                    addedRisks.length === 0 &&
                    closedRisks.length === 0 &&
                    addedDecisions.length === 0 &&
                    resolvedDecisions.length === 0 && (
                        <div style={{
                            padding: '2rem',
                            textAlign: 'center',
                            color: 'var(--text-tertiary)'
                        }}>
                            No significant structural changes detected between these versions.
                            <br />
                            <small>Narrative content may have been updated.</small>
                        </div>
                    )}
            </div>
        </div>
    );
}
