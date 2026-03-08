import { useRef, useState, useEffect } from 'react';
import { Download, Printer, CheckSquare, Square, FileText } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { StatusReportView } from '../StatusReport/StatusReportView';
import { useData } from '../../context/DataContext';

import { API_BASE } from '../../apiClient';

export function ReportPreview({ selectedProjectIds, allProjects = [] }) {
    const { projects, goals, getLatestStatusReport, authFetch } = useData();
    const [includeAppendix, setIncludeAppendix] = useState(false);
    const [fullReports, setFullReports] = useState({});
    const [loadingFullReports, setLoadingFullReports] = useState(false);
    const printRef = useRef(null);

    // Use allProjects (full list with embedded reports) if available, fallback to context
    const sourceProjects = allProjects.length > 0 ? allProjects : projects;

    // Filter projects
    const reportProjects = sourceProjects.filter(p => selectedProjectIds.includes(`project-${p.id}`));

    // Fetch full reports for ALL selected projects to ensure we have milestones/details for the main view
    useEffect(() => {
        if (reportProjects.length === 0) {
            return;
        }

        let isMounted = true;

        const fetchBatch = async () => {
            // Determine which reports we still need to fetch
            const projectsToFetch = reportProjects.filter(p => !fullReports[p.id]);

            if (projectsToFetch.length === 0) {
                if (isMounted) setLoadingFullReports(false);
                return;
            }

            if (isMounted) setLoadingFullReports(true);

            // BATCHING: Only fetch the first 5 items
            // This relies on the state update triggering the effect again to fetch the next batch
            const batch = projectsToFetch.slice(0, 5);
            const newReports = {};

            await Promise.all(
                batch.map(async (project) => {
                    try {
                        const res = await authFetch(`${API_BASE}/projects/${project.id}/reports`);
                        if (res.ok) {
                            const reports = await res.json();
                            if (reports.length > 0) {
                                newReports[project.id] = reports[0]; // Latest report
                            } else {
                                // Mark as fetched even if empty to prevent infinite loop
                                newReports[project.id] = null;
                            }
                        } else {
                            // If failed, mark as null to avoid re-fetching forever
                            newReports[project.id] = null;
                        }
                    } catch (err) {
                        console.error(`Error fetching report for project ${project.id}:`, err);
                        newReports[project.id] = null; // Mark as failed
                    }
                })
            );

            if (isMounted) {
                setFullReports(prev => ({ ...prev, ...newReports }));
            }
        };

        fetchBatch();

        return () => { isMounted = false; };
    }, [reportProjects, fullReports, authFetch]); // dependency on reportProjects encompasses selectedProjectIds changes

    // Helper: Find the Division level (second level in hierarchy, child of root organization) for a project
    const getDivision = (goalId) => {
        let current = goals.find(g => g.id === goalId);
        if (!current) return null;

        // Build the path from current goal up to root
        const path = [current];
        while (current && current.parentId) {
            const parent = goals.find(g => g.id === current.parentId);
            if (!parent) break;
            path.unshift(parent);
            current = parent;
        }

        // path[0] is Organization (root), path[1] is Division
        // Return the Division level (index 1), or the project's direct goal if hierarchy is shallow
        return path.length >= 2 ? path[1] : path[0];
    };

    // Group projects by Division (second level in hierarchy)
    const groupedProjects = {};

    reportProjects.forEach(p => {
        const division = getDivision(p.goalId || (p.goalIds && p.goalIds[0]) || null);
        const groupName = division ? division.title : 'Uncategorized';
        if (!groupedProjects[groupName]) {
            groupedProjects[groupName] = {
                division: division,
                projects: []
            };
        }
        groupedProjects[groupName].projects.push(p);
    });

    // Sort groups alphabetically by department name
    const sortedGroupEntries = Object.entries(groupedProjects).sort((a, b) =>
        a[0].localeCompare(b[0])
    );

    // Helper to get Status Color
    const getStatusColor = (status) => {
        switch (status) {
            case 'green': return '#10b981';
            case 'yellow': return '#f59e0b';
            case 'red': return '#ef4444';
            default: return '#6b7280';
        }
    };

    const getStatusGradient = (status) => {
        switch (status) {
            case 'green': return 'linear-gradient(135deg, #059669, #10b981)';
            case 'yellow': return 'linear-gradient(135deg, #d97706, #f59e0b)';
            case 'red': return 'linear-gradient(135deg, #dc2626, #ef4444)';
            default: return 'linear-gradient(135deg, #4b5563, #6b7280)';
        }
    };

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

    const handleExportPdf = async () => {
        if (!printRef.current) return;
        const element = printRef.current;
        const opt = {
            margin: [0.3, 0.3, 0.3, 0.3],
            filename: `Portfolio_Report_${new Date().toISOString().split('T')[0]}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                letterRendering: true,
                scrollY: 0, // Critical for capturing full height
                windowHeight: element.scrollHeight
            },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        };
        await html2pdf().set(opt).from(element).save();
    };

    // Render a single Summary Card
    const SummaryCard = ({ project }) => {
        // Use embedded report from exec-summary data first, fallback to context
        // BUT for the main view, we want the FULL report if possible.
        // The user wants the screenshot view which has milestones etc. 
        // We might need to fetch full reports for the main view too if they are not already there?
        // Actually, ExecDashboard uses lightweight reports and shows basic info. 
        // The screenshot shows "Key Milestones" which are usually in the full report.
        // Let's use the full report if we have it (from the appendix fetch), otherwise fallback.
        // Wait, the appendix fetch only happens if includeAppendix is true. 
        // If the user wants full details in the MAIN view, we should fetch them by default?
        // The screenshot shows "Key Milestones", so yes, we need full data.

        // HOWEVER, for now let's just restore the card.
        // If the lightweight report has milestones (it might), then it works.
        // If not, we might need to fetch full reports for EVERYTHING selected.

        const report = fullReports[project.id] || project.report || getLatestStatusReport(project.id);
        const statusColor = report ? getStatusColor(report.overallStatus) : '#d1d5db';
        const statusGradient = report ? getStatusGradient(report.overallStatus) : 'linear-gradient(135deg, #4b5563, #6b7280)';

        const flexHeaderStyle = {
            display: 'flex',
            width: '100%',
            background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
            border: '1px solid #0284c7',
            color: 'white',
            borderTopLeftRadius: '2px',
            borderTopRightRadius: '2px'
        };

        const flexRowStyle = {
            display: 'flex',
            width: '100%',
            border: '1px solid #d1d5db',
            borderTop: 'none',
            background: 'white'
        };

        const flexColHeaderStyle = {
            padding: '8px 12px',
            fontWeight: '600',
            fontSize: '11px',
            borderRight: '1px solid rgba(255,255,255,0.2)'
        };

        const flexColStyle = {
            padding: '8px 12px',
            fontSize: '11px',
            color: '#374151',
            borderRight: '1px solid #e5e7eb',
            wordBreak: 'break-word'
        };

        const labelColStyle = {
            padding: '8px 12px',
            fontSize: '11px',
            fontWeight: '600',
            background: '#f9fafb',
            color: '#374151',
            borderRight: '1px solid #e5e7eb',
            width: '25%',
            flexShrink: 0
        };

        const bannerStyle = {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            border: '2px solid #1f2937',
            borderBottom: 'none',
            overflow: 'hidden',
            marginTop: '1rem'
        };

        const statusBarStyle = {
            height: '24px',
            width: '100%',
            borderRadius: '2px',
            backgroundColor: statusColor
        };

        return (
            <div style={{ breakInside: 'avoid' }}>
                {/* Header Banner */}
                <div style={bannerStyle}>
                    <div style={{ flex: '1', minWidth: 0 }}>
                        {/* Placeholder for Logo if needed, user screenshot has it */}
                    </div>
                    <div style={{
                        background: statusGradient,
                        color: 'white',
                        padding: '6px 20px',
                        fontSize: '14px',
                        fontWeight: '600',
                        borderRadius: '4px',
                        flexShrink: 0
                    }}>
                        Status Update
                    </div>
                </div>

                {/* Project Info Table via Flexbox */}
                <div>
                    <div style={flexHeaderStyle}>
                        <div style={{ ...flexColHeaderStyle, width: '25%' }}>Project Name</div>
                        <div style={{ ...flexColHeaderStyle, width: '20%' }}>Report Date</div>
                        <div style={{ ...flexColHeaderStyle, width: '20%' }}>Prepared By</div>
                        <div style={{ ...flexColHeaderStyle, width: '35%', borderRight: 'none' }}>Overall Status</div>
                    </div>
                    <div style={flexRowStyle}>
                        <div style={{ ...flexColStyle, width: '25%' }}>{project.title}</div>
                        <div style={{ ...flexColStyle, width: '20%' }}>{report ? formatDate(report.reportDate) : '-'}</div>
                        <div style={{ ...flexColStyle, width: '20%' }}>{report ? report.createdBy : '-'}</div>
                        <div style={{ ...flexColStyle, width: '35%', borderRight: 'none', display: 'flex', alignItems: 'center' }}>
                            <div style={statusBarStyle} />
                        </div>
                    </div>
                </div>

                {report && (
                    <>
                        {/* Project Purpose */}
                        {report.purpose && (
                            <div style={flexRowStyle}>
                                <div style={labelColStyle}>Project Purpose:</div>
                                <div style={{ ...flexColStyle, flex: 1, borderRight: 'none' }}>{report.purpose}</div>
                            </div>
                        )}

                        {/* Executive Summary */}
                        {report.executiveSummary && (
                            <div style={flexRowStyle}>
                                <div style={labelColStyle}>Executive Summary:</div>
                                <div style={{ ...flexColStyle, flex: 1, borderRight: 'none' }}>{report.executiveSummary}</div>
                            </div>
                        )}

                        {/* Key Contacts */}
                        {report.contacts?.length > 0 && (
                            <div style={flexRowStyle}>
                                <div style={labelColStyle}>Key Contact(s):</div>
                                <div style={{ ...flexColStyle, flex: 1, borderRight: 'none' }}>
                                    {report.contacts.map((c, i) => (
                                        <span key={i}>
                                            {c.name}
                                            {i < report.contacts.length - 1 ? ', ' : ''}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Milestones */}
                        {report.milestones?.some(m => m.date) && (
                            <div>
                                <div style={{
                                    background: 'linear-gradient(135deg, #059669, #10b981)',
                                    color: 'white',
                                    padding: '8px 12px',
                                    fontWeight: '600',
                                    fontSize: '11px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}>
                                    Key Milestones
                                </div>
                                <div style={{
                                    border: '1px solid #d1d5db',
                                    borderTop: 'none',
                                    padding: '24px 16px',
                                    background: 'white',
                                    overflowX: 'auto'
                                }}>
                                    <div style={{ display: 'flex', position: 'relative', padding: '10px 0', minWidth: 'min-content', gap: '4rem' }}>
                                        <div style={{
                                            position: 'absolute', top: '50%', left: '0', right: '0', height: '3px',
                                            background: '#e5e7eb', transform: 'translateY(-50%)', zIndex: 0
                                        }} />
                                        {report.milestones.filter(m => m.date).sort((a, b) => new Date(a.date) - new Date(b.date)).map((m, idx) => (
                                            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, minWidth: '80px', textAlign: 'center' }}>
                                                <div style={{ fontSize: '10px', color: '#4b5563', marginBottom: '8px', fontWeight: '600', background: 'white', padding: '0 4px' }}>
                                                    {formatShortDate(m.date)}
                                                </div>
                                                <div style={{
                                                    width: '14px', height: '14px', transform: 'rotate(45deg)',
                                                    background: m.status === 'complete' ? '#10b981' : (m.status === 'in-progress' ? '#f59e0b' : 'white'),
                                                    border: `2px solid ${m.status === 'complete' ? '#10b981' : (m.status === 'in-progress' ? '#f59e0b' : '#9ca3af')}`,
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                                }} />
                                                <div style={{ fontSize: '10px', color: '#1f2937', marginTop: '10px', maxWidth: '100px', lineHeight: '1.4', fontWeight: '500' }}>
                                                    {m.name}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    };

    if (reportProjects.length === 0) {
        return (
            <div className="report-preview-pane">
                <div className="preview-content report-empty-state-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', textAlign: 'center' }}>
                    <FileText size={64} className="report-empty-state-icon" style={{ opacity: 0.5, marginBottom: '1rem', color: 'var(--text-tertiary)' }} />
                    <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>No Projects Selected</h3>
                    <p style={{ color: 'var(--text-secondary)' }}>Select one or more projects from the sidebar to generate a portfolio report.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="report-preview-pane">
            <div className="preview-header" style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <h3>Report Preview ({reportProjects.length} Projects)</h3>
                    <button
                        className="btn-secondary"
                        onClick={() => setIncludeAppendix(!includeAppendix)}
                    >
                        {includeAppendix ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                        Include Detailed Appendices
                    </button>
                </div>
                <div className="preview-actions">
                    <button className="btn-secondary" onClick={() => window.print()}>
                        <Printer size={16} /> Print
                    </button>
                    <button className="btn-primary" onClick={handleExportPdf}>
                        <Download size={16} /> Export PDF
                    </button>
                </div>
            </div>

            <div className="preview-content">
                <div className="preview-sheet" id="report-print-content" ref={printRef}>

                    {/* PART 1: PROJECT SUMMARIES (CARDS) */}
                    <div className="report-summary-header" style={{
                        background: '#1f2937',
                        color: 'white',
                        padding: '1rem',
                        textAlign: 'center',
                        fontSize: '1.5rem',
                        fontWeight: '700',
                        marginBottom: '2rem'
                    }}>
                        Portfolio Status Report
                        <div style={{ fontSize: '1rem', fontWeight: '400', marginTop: '0.5rem' }}>
                            {formatDate(new Date())}
                        </div>
                    </div>

                    {sortedGroupEntries.map(([groupName, { projects }]) => (
                        <div key={groupName} className="hierarchy-section">
                            <div className="hierarchy-header">{groupName}</div>
                            {projects.map(project => (
                                <SummaryCard key={project.id} project={project} />
                            ))}
                        </div>
                    ))}

                    {/* PART 2: DETAILED APPENDICES */}
                    {includeAppendix && (
                        <>
                            <div style={{ pageBreakBefore: 'always' }} />

                            <div className="report-summary-header" style={{
                                background: '#1f2937',
                                color: 'white',
                                padding: '1rem',
                                textAlign: 'center',
                                fontSize: '1.5rem',
                                fontWeight: '700',
                                marginBottom: '0'
                            }}>
                                Appendix: Detailed Reports
                            </div>

                            {loadingFullReports && (
                                <div style={{ padding: '2rem 1rem' }}>
                                    {[1, 2].map(i => (
                                        <div key={i} className="skeleton-loader" style={{ height: '300px', marginBottom: '2rem', borderRadius: 'var(--radius-md)' }}></div>
                                    ))}
                                </div>
                            )}

                            {sortedGroupEntries.map(([groupName, { projects: groupProjects }]) => (
                                <div key={groupName}>
                                    {/* Division Subheader */}
                                    <div style={{
                                        background: 'linear-gradient(135deg, #374151, #4b5563)',
                                        color: 'white',
                                        padding: '8px 12px',
                                        fontSize: '1rem',
                                        fontWeight: '600'
                                    }}>
                                        {groupName}
                                    </div>

                                    {groupProjects.map((project) => {
                                        // Use full report if available, fallback to embedded/context report
                                        const report = fullReports[project.id] || project.report || getLatestStatusReport(project.id);
                                        if (!report) return null;
                                        return (
                                            <div key={project.id}>
                                                <StatusReportView
                                                    report={report}
                                                    projectTitle={project.title}
                                                    onExportPdf={() => { }}
                                                    hideActions={true}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </>
                    )}

                </div>
            </div>
        </div>
    );
}
