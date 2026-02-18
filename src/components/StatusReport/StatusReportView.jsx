import { useRef, useState, useMemo, memo } from 'react';
import { Printer, Download } from 'lucide-react';
import './StatusReport.css';

export const StatusReportView = memo(function StatusReportView({ report, projectTitle, onExportPdf: _onExportPdf, hideActions = false }) {
    const reportRef = useRef(null);
    const [isExporting, setIsExporting] = useState(false);

    const getStatusGradient = (status) => {
        switch (status) {
            case 'green': return 'linear-gradient(135deg, #059669, #10b981)';
            case 'yellow': return 'linear-gradient(135deg, #d97706, #f59e0b)';
            case 'red': return 'linear-gradient(135deg, #dc2626, #ef4444)';
            default: return 'linear-gradient(135deg, #4b5563, #6b7280)';
        }
    };

    // Inline styles for print reliability - FULL WIDTH
    // NOTE: Must be called before early return to satisfy Rules of Hooks
    const styles = useMemo(() => ({
        wrapper: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
        },
        actionBar: {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.5rem'
        },
        report: {
            background: 'white',
            color: '#1f2937',
            fontFamily: "'Segoe UI', 'Inter', -apple-system, sans-serif",
            fontSize: '12px',
            lineHeight: '1.4',
            width: '100%',
            maxWidth: '100%',
            padding: '0'
        },
        banner: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            border: '2px solid #1f2937',
            overflow: 'hidden'
        },
        orgName: {
            fontWeight: '700',
            fontSize: '18px',
            color: '#1f2937',
            flex: '1',
            minWidth: 0
        },
        bannerTitle: {
            background: getStatusGradient(report.overallStatus),
            color: 'white',
            padding: '6px 20px',
            fontSize: '14px',
            fontWeight: '600',
            borderRadius: '4px',
            flexShrink: 0
        },
        infoTable: {
            width: 'calc(100% - 8px)',
            margin: '0 4px',
            borderCollapse: 'collapse',
            marginTop: '4px'
        },
        infoTh: {
            background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
            color: 'white',
            padding: '6px 8px',
            textAlign: 'left',
            fontWeight: '600',
            fontSize: '10px',
            border: '1px solid #0284c7'
        },
        infoTd: {
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            background: 'white',
            verticalAlign: 'top'
        },
        labelCell: {
            background: '#f3f4f6',
            fontWeight: '600',
            color: '#374151',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            verticalAlign: 'top'
        },
        statusBar: {
            height: '24px',
            width: '100%',
            borderRadius: '2px'
        },
        statusBarVertical: {
            width: '24px',
            height: '60px',
            borderRadius: '2px',
            margin: '0 auto'
        },
        sectionHeader: {
            background: 'linear-gradient(135deg, #059669, #10b981)',
            color: 'white',
            padding: '6px 12px',
            fontWeight: '600',
            fontSize: '11px',
            borderRadius: '2px 2px 0 0'
        },
        milestonesContainer: {
            border: '1px solid #d1d5db',
            borderTop: 'none',
            padding: '16px 8px',
            background: 'white'
        },
        milestoneRow: {
            display: 'flex',
            justifyContent: 'space-around',
            textAlign: 'center'
        },
        milestoneItem: {
            flex: 1,
            padding: '0 4px'
        },
        milestoneDateText: {
            fontSize: '10px',
            color: '#374151',
            marginBottom: '8px'
        },
        milestoneLine: {
            display: 'flex',
            justifyContent: 'space-around',
            position: 'relative',
            padding: '8px 0'
        },
        milestoneLineBar: {
            position: 'absolute',
            top: '50%',
            left: '5%',
            right: '5%',
            height: '3px',
            background: '#374151',
            transform: 'translateY(-50%)'
        },
        milestoneMarker: {
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 1
        },
        milestoneDiamond: {
            width: '14px',
            height: '14px',
            background: 'white',
            border: '2px solid #374151',
            transform: 'rotate(45deg)'
        },
        milestoneLabelText: {
            fontSize: '9px',
            color: '#6b7280',
            marginTop: '8px'
        },
        workstreamTable: {
            width: '100%',
            borderCollapse: 'collapse'
        },
        workstreamTh: {
            background: 'linear-gradient(135deg, #374151, #4b5563)',
            color: 'white',
            padding: '8px',
            textAlign: 'left',
            fontWeight: '600',
            fontSize: '10px',
            border: '1px solid #1f2937'
        },
        workstreamTd: {
            padding: '8px',
            border: '1px solid #d1d5db',
            verticalAlign: 'top',
            fontSize: '10px'
        },
        workstreamNameCell: {
            fontWeight: '600',
            background: '#f9fafb',
            padding: '8px',
            border: '1px solid #d1d5db',
            verticalAlign: 'top',
            fontSize: '10px',
            minWidth: '120px',
            wordWrap: 'break-word'
        },
        dataTh: {
            background: 'linear-gradient(135deg, #374151, #4b5563)',
            color: 'white',
            padding: '6px 8px',
            textAlign: 'left',
            fontWeight: '600',
            fontSize: '10px',
            border: '1px solid #1f2937'
        },
        dataTd: {
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            verticalAlign: 'top',
            fontSize: '10px'
        },
        priorityHigh: { fontWeight: '600', textAlign: 'center', color: '#dc2626' },
        priorityMedium: { fontWeight: '600', textAlign: 'center', color: '#d97706' },
        priorityLow: { fontWeight: '600', textAlign: 'center', color: '#6b7280' },
        statusPillOpen: {
            display: 'inline-block',
            padding: '2px 6px',
            borderRadius: '3px',
            fontSize: '9px',
            fontWeight: '500',
            background: '#fef3c7',
            color: '#92400e'
        },
        statusPillClosed: {
            display: 'inline-block',
            padding: '2px 6px',
            borderRadius: '3px',
            fontSize: '9px',
            fontWeight: '500',
            background: '#d1fae5',
            color: '#065f46'
        },
        footer: {
            margin: '8px',
            paddingTop: '8px',
            borderTop: '1px solid #e5e7eb',
            fontSize: '9px',
            color: '#9ca3af',
            display: 'flex',
            gap: '8px'
        }
    }), [report?.overallStatus]);

    // Early return AFTER all hooks have been called (Rules of Hooks)
    if (!report) return null;

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const formatShortDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric'
        });
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'green': return '#10b981';
            case 'yellow': return '#f59e0b';
            case 'red': return '#ef4444';
            default: return '#6b7280';
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const handleExportPdf = async () => {
        if (!reportRef.current || isExporting) return;

        try {
            setIsExporting(true);
            const html2pdf = (await import('html2pdf.js')).default;

            const element = reportRef.current;
            const filename = `Status_Report_${projectTitle.replace(/\s+/g, '_')}_v${report.version}.pdf`;

            const opt = {
                margin: [0.3, 0.3, 0.3, 0.3],
                filename: filename,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    letterRendering: true,
                    logging: false
                },
                jsPDF: {
                    unit: 'in',
                    format: 'letter',
                    orientation: 'portrait'
                },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
            };

            await html2pdf().set(opt).from(element).save();
        } catch (error) {
            console.error('PDF export failed:', error);
            window.print();
        } finally {
            setIsExporting(false);
        }
    };

    const getMilestoneDiamondStyle = (status) => {
        const base = { ...styles.milestoneDiamond };
        if (status === 'complete') {
            base.background = '#10b981';
            base.borderColor = '#10b981';
        } else if (status === 'in-progress') {
            base.background = '#f59e0b';
            base.borderColor = '#f59e0b';
        }
        return base;
    };

    const getPriorityStyle = (priority) => {
        switch (priority) {
            case 'high': return styles.priorityHigh;
            case 'medium': return styles.priorityMedium;
            default: return styles.priorityLow;
        }
    };

    return (
        <div style={styles.wrapper} className="status-report-wrapper">
            {/* Action Bar - Hidden on print or if hidden by prop */}
            {!hideActions && (
                <div style={styles.actionBar} className="report-action-bar no-print">
                    <button className="btn-secondary" onClick={handlePrint}>
                        <Printer size={16} /> Print
                    </button>
                    <button className="btn-primary" onClick={handleExportPdf} disabled={isExporting}>
                        <Download size={16} /> {isExporting ? 'Exporting...' : 'Export PDF'}
                    </button>
                </div>
            )}

            <div style={styles.report} ref={reportRef} id="status-report-printable">
                {/* Header Banner */}
                <div style={styles.banner}>
                    <div>
                        <img src={`${window.location.origin}/header-logo.png`} alt="Saskatchewan Health Partners" style={{ height: '45px', maxWidth: '500px', objectFit: 'contain' }} />
                    </div>
                    <div style={styles.bannerTitle}>
                        Status Update
                    </div>
                </div>

                {/* Project Info Table */}
                <table style={styles.infoTable}>
                    <thead>
                        <tr>
                            <th style={{ ...styles.infoTh, width: '25%' }}>Project Name</th>
                            <th style={{ ...styles.infoTh, width: '20%' }}>Report Date</th>
                            <th style={{ ...styles.infoTh, width: '20%' }}>Prepared By</th>
                            <th style={{ ...styles.infoTh, width: '35%' }}>Overall Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style={styles.infoTd}>{projectTitle}</td>
                            <td style={styles.infoTd}>{formatDate(report.reportDate)}</td>
                            <td style={styles.infoTd}>{report.createdBy}</td>
                            <td style={styles.infoTd}>
                                <div style={{
                                    ...styles.statusBar,
                                    backgroundColor: getStatusColor(report.overallStatus)
                                }} />
                            </td>
                        </tr>
                    </tbody>
                </table>

                {/* Project Purpose */}
                {report.purpose && (
                    <table style={styles.infoTable}>
                        <tbody>
                            <tr>
                                <td style={{ ...styles.labelCell, width: '15%' }}>Project Purpose:</td>
                                <td style={styles.infoTd}>{report.purpose}</td>
                            </tr>
                        </tbody>
                    </table>
                )}

                {/* Executive Summary - Current State */}
                {report.executiveSummary && (
                    <table style={styles.infoTable}>
                        <tbody>
                            <tr>
                                <td style={{ ...styles.labelCell, width: '15%' }}>Executive Summary - Current State:</td>
                                <td style={styles.infoTd}>{report.executiveSummary}</td>
                            </tr>
                        </tbody>
                    </table>
                )}

                {/* Key Contacts */}
                {report.contacts?.length > 0 && (
                    <table style={styles.infoTable}>
                        <tbody>
                            <tr>
                                <td style={{ ...styles.labelCell, width: '15%' }}>Key Contact(s):</td>
                                <td style={styles.infoTd}>
                                    {report.contacts.map((c, i) => (
                                        <span key={i}>
                                            {c.name}{c.organization ? ` (${c.organization})` : ''}
                                            {i < report.contacts.length - 1 ? ', ' : ''}
                                        </span>
                                    ))}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                )}

                {/* Key Milestones */}
                {report.milestones?.some(m => m.date) && (
                    <div style={{ margin: '4px' }}>
                        <div style={styles.sectionHeader}>Key Milestones</div>
                        <div style={styles.milestonesContainer}>
                            <div style={styles.milestoneRow}>
                                {report.milestones.filter(m => m.date).map((m, idx) => (
                                    <div key={idx} style={styles.milestoneItem}>
                                        <div style={styles.milestoneDateText}>{formatShortDate(m.date)}</div>
                                    </div>
                                ))}
                            </div>
                            <div style={styles.milestoneLine}>
                                <div style={styles.milestoneLineBar} />
                                {report.milestones.filter(m => m.date).map((m, idx) => (
                                    <div key={idx} style={styles.milestoneMarker}>
                                        <div style={getMilestoneDiamondStyle(m.status)} />
                                    </div>
                                ))}
                            </div>
                            <div style={styles.milestoneRow}>
                                {report.milestones.filter(m => m.date).map((m, idx) => (
                                    <div key={idx} style={styles.milestoneItem}>
                                        <div style={styles.milestoneLabelText}>{m.name || m.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Workstream Status */}
                {report.workstreams?.length > 0 && (
                    <div style={{ margin: '4px' }}>
                        <table style={styles.workstreamTable}>
                            <thead>
                                <tr>
                                    <th style={{ ...styles.workstreamTh, width: '20%' }}>Workstream</th>
                                    <th style={{ ...styles.workstreamTh, width: '22%' }}>Progress Last Month</th>
                                    <th style={{ ...styles.workstreamTh, width: '22%' }}>Work Ahead</th>
                                    <th style={{ ...styles.workstreamTh, width: '26%' }}>Barriers</th>
                                    <th style={{ ...styles.workstreamTh, width: '10%' }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.workstreams.map((ws, idx) => (
                                    <tr key={idx}>
                                        <td style={styles.workstreamNameCell}>{ws.name}</td>
                                        <td style={styles.workstreamTd}>{ws.progressLastPeriod}</td>
                                        <td style={styles.workstreamTd}>{ws.workAhead}</td>
                                        <td style={styles.workstreamTd}>{ws.barriers}</td>
                                        <td style={styles.workstreamTd}>
                                            <div style={{
                                                ...styles.statusBarVertical,
                                                backgroundColor: getStatusColor(ws.status)
                                            }} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Risk Register */}
                {report.risks?.length > 0 && (
                    <div style={{ margin: '4px', marginTop: '16px' }}>
                        <div style={styles.sectionHeader}>Risk Register</div>
                        <table style={{ ...styles.workstreamTable, borderTop: 'none' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...styles.dataTh, width: '25%' }}>Risk</th>
                                    <th style={{ ...styles.dataTh, width: '20%' }}>Impact</th>
                                    <th style={{ ...styles.dataTh, width: '10%' }}>Priority</th>
                                    <th style={{ ...styles.dataTh, width: '30%' }}>Mitigation</th>
                                    <th style={{ ...styles.dataTh, width: '15%' }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.risks.map((risk, idx) => (
                                    <tr key={idx} style={risk.status === 'closed' ? { opacity: 0.6, background: '#f3f4f6' } : {}}>
                                        <td style={styles.dataTd}>{risk.description}</td>
                                        <td style={styles.dataTd}>{risk.impact}</td>
                                        <td style={{ ...styles.dataTd, ...getPriorityStyle(risk.priority) }}>
                                            {risk.priority.charAt(0).toUpperCase() + risk.priority.slice(1)}
                                        </td>
                                        <td style={styles.dataTd}>{risk.mitigation}</td>
                                        <td style={styles.dataTd}>
                                            <span style={risk.status === 'open' ? styles.statusPillOpen : styles.statusPillClosed}>
                                                {risk.status === 'open' ? '⚠️ Open' : '✅ Closed'}
                                            </span>
                                            {risk.closedDate && (
                                                <div style={{ fontSize: '8px', color: '#6b7280', marginTop: '4px' }}>
                                                    {formatShortDate(risk.closedDate)}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Decision Log */}
                {report.decisions?.length > 0 && (
                    <div style={{ margin: '4px', marginTop: '16px' }}>
                        <div style={styles.sectionHeader}>Decision Log</div>
                        <table style={{ ...styles.workstreamTable, borderTop: 'none' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...styles.dataTh, width: '30%' }}>Decision</th>
                                    <th style={{ ...styles.dataTh, width: '10%' }}>Priority</th>
                                    <th style={{ ...styles.dataTh, width: '12%' }}>Status</th>
                                    <th style={{ ...styles.dataTh, width: '33%' }}>Decision Statement</th>
                                    <th style={{ ...styles.dataTh, width: '15%' }}>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.decisions.map((d, idx) => {
                                    const statusStyle = d.status === 'pending' ? styles.statusPillOpen :
                                        d.status === 'approved' ? styles.statusPillClosed :
                                            { ...styles.statusPillOpen, background: '#fee2e2', color: '#991b1b' };
                                    return (
                                        <tr key={idx}>
                                            <td style={styles.dataTd}>{d.description}</td>
                                            <td style={{ ...styles.dataTd, ...getPriorityStyle(d.priority) }}>
                                                {d.priority.charAt(0).toUpperCase() + d.priority.slice(1)}
                                            </td>
                                            <td style={styles.dataTd}>
                                                <span style={statusStyle}>
                                                    {d.status === 'pending' && '⏳ Pending'}
                                                    {d.status === 'approved' && '✅ Approved'}
                                                    {d.status === 'rejected' && '❌ Rejected'}
                                                </span>
                                            </td>
                                            <td style={styles.dataTd}>{d.decisionStatement || '-'}</td>
                                            <td style={styles.dataTd}>{d.decisionDate ? formatShortDate(d.decisionDate) : '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Additional Notes */}
                {(report.kpis || report.goodNews || report.governanceNotes) && (
                    <div style={{ margin: '8px', marginTop: '16px', border: '1px solid #d1d5db', padding: '12px' }}>
                        {report.kpis && (
                            <div style={{ marginBottom: '12px' }}>
                                <div style={{ fontWeight: '600', color: '#374151', fontSize: '10px', marginBottom: '4px' }}>
                                    KPIs / Statistics:
                                </div>
                                <div style={{ color: '#4b5563', fontSize: '10px', lineHeight: '1.5' }}>
                                    {report.kpis}
                                </div>
                            </div>
                        )}
                        {report.goodNews && (
                            <div style={{ marginBottom: '12px' }}>
                                <div style={{ fontWeight: '600', color: '#374151', fontSize: '10px', marginBottom: '4px' }}>
                                    Good News:
                                </div>
                                <div style={{ color: '#4b5563', fontSize: '10px', lineHeight: '1.5' }}>
                                    {report.goodNews}
                                </div>
                            </div>
                        )}
                        {report.governanceNotes && (
                            <div>
                                <div style={{ fontWeight: '600', color: '#374151', fontSize: '10px', marginBottom: '4px' }}>
                                    Notes to Governance:
                                </div>
                                <div style={{ color: '#4b5563', fontSize: '10px', lineHeight: '1.5' }}>
                                    {report.governanceNotes}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Footer */}
                <div style={styles.footer}>
                    <span>Version {report.version} • Generated {formatDate(report.createdAt)}</span>
                    {report.restoredFrom && <span>• Restored from v{report.restoredFrom}</span>}
                </div>
            </div>
        </div>
    );
});
