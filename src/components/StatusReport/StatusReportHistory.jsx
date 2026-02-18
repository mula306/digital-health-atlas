import { useState } from 'react';
import { Clock, Eye, RotateCcw, GitCompare } from 'lucide-react';
import { useData } from '../../context/DataContext';
import './StatusReport.css';

export function StatusReportHistory({
    projectId,
    reports,
    onViewReport,
    onRestoreReport: _onRestoreReport,
    onCompare
}) {
    const { restoreStatusReport } = useData();
    const [compareMode, setCompareMode] = useState(false);
    const [selectedForCompare, setSelectedForCompare] = useState([]);

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleRestore = (report) => {
        const author = prompt('Enter your name to restore this version:');
        if (author) {
            restoreStatusReport(projectId, report.id, author);
        }
    };

    const toggleCompareSelection = (report) => {
        if (selectedForCompare.find(r => r.id === report.id)) {
            setSelectedForCompare(selectedForCompare.filter(r => r.id !== report.id));
        } else if (selectedForCompare.length < 2) {
            setSelectedForCompare([...selectedForCompare, report]);
        }
    };

    const handleCompare = () => {
        if (selectedForCompare.length === 2 && onCompare) {
            onCompare(selectedForCompare[0], selectedForCompare[1]);
        }
    };

    const getChangeSummary = (report, index) => {
        if (index === 0) return 'Initial version';

        const prevReport = reports[index - 1];
        const changes = [];

        if (report.overallStatus !== prevReport.overallStatus) {
            changes.push(`Status: ${prevReport.overallStatus} → ${report.overallStatus}`);
        }

        const newWorkstreams = (report.workstreams?.length || 0) - (prevReport.workstreams?.length || 0);
        if (newWorkstreams > 0) changes.push(`+${newWorkstreams} workstream(s)`);
        if (newWorkstreams < 0) changes.push(`${newWorkstreams} workstream(s)`);

        const newRisks = (report.risks?.length || 0) - (prevReport.risks?.length || 0);
        if (newRisks > 0) changes.push(`+${newRisks} risk(s)`);

        const closedRisks = (report.risks?.filter(r => r.status === 'closed').length || 0) -
            (prevReport.risks?.filter(r => r.status === 'closed').length || 0);
        if (closedRisks > 0) changes.push(`${closedRisks} risk(s) closed`);

        const newDecisions = (report.decisions?.length || 0) - (prevReport.decisions?.length || 0);
        if (newDecisions > 0) changes.push(`+${newDecisions} decision(s)`);

        const resolvedDecisions = (report.decisions?.filter(d => d.status !== 'pending').length || 0) -
            (prevReport.decisions?.filter(d => d.status !== 'pending').length || 0);
        if (resolvedDecisions > 0) changes.push(`${resolvedDecisions} decision(s) resolved`);

        if (report.restoredFrom) {
            changes.push(`Restored from v${report.restoredFrom}`);
        }

        return changes.length > 0 ? changes.join(' • ') : 'Minor updates';
    };

    const sortedReports = [...reports].reverse(); // Newest first

    return (
        <div className="status-report-history">
            {/* Compare Mode Toggle */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem'
            }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    {reports.length} version{reports.length !== 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {compareMode && selectedForCompare.length === 2 && (
                        <button className="btn-primary" onClick={handleCompare}>
                            <GitCompare size={16} /> Compare Selected
                        </button>
                    )}
                    <button
                        className={`btn-secondary ${compareMode ? 'active' : ''}`}
                        onClick={() => {
                            setCompareMode(!compareMode);
                            setSelectedForCompare([]);
                        }}
                    >
                        <GitCompare size={16} />
                        {compareMode ? 'Cancel Compare' : 'Compare Versions'}
                    </button>
                </div>
            </div>

            {/* History List */}
            {sortedReports.map((report, idx) => {
                const originalIndex = reports.length - 1 - idx;
                const isCurrent = idx === 0;
                const isSelected = selectedForCompare.find(r => r.id === report.id);

                return (
                    <div
                        key={report.id}
                        className={`history-item ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}`}
                        onClick={() => compareMode ? toggleCompareSelection(report) : onViewReport(report)}
                        style={isSelected ? {
                            borderColor: 'var(--accent-primary)',
                            background: 'rgba(79, 70, 229, 0.1)'
                        } : {}}
                    >
                        {compareMode && (
                            <input
                                type="checkbox"
                                checked={!!isSelected}
                                onChange={() => toggleCompareSelection(report)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ width: 'auto' }}
                            />
                        )}

                        <div className="history-version">v{report.version}</div>

                        <div className="history-details">
                            <div className="history-date">
                                {formatDate(report.createdAt)}
                                {isCurrent && <span style={{
                                    marginLeft: '0.5rem',
                                    fontSize: '0.7rem',
                                    background: 'var(--accent-primary)',
                                    color: 'white',
                                    padding: '0.125rem 0.5rem',
                                    borderRadius: '9999px'
                                }}>Current</span>}
                            </div>
                            <div className="history-author">
                                By {report.createdBy} • {getChangeSummary(report, originalIndex)}
                            </div>
                        </div>

                        <div className={`history-status ${report.overallStatus}`}>
                            {report.overallStatus === 'green' ? 'On Track' :
                                report.overallStatus === 'yellow' ? 'At Risk' : 'Off Track'}
                        </div>

                        {!compareMode && (
                            <div className="history-actions">
                                <button
                                    className="btn-icon"
                                    onClick={(e) => { e.stopPropagation(); onViewReport(report); }}
                                    title="View Report"
                                >
                                    <Eye size={16} />
                                </button>
                                {!isCurrent && (
                                    <button
                                        className="btn-icon"
                                        onClick={(e) => { e.stopPropagation(); handleRestore(report); }}
                                        title="Restore as New Version"
                                    >
                                        <RotateCcw size={16} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
