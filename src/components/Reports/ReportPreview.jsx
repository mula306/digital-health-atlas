import React, { useRef, useState, useEffect } from 'react';
import { Download, Printer, CheckSquare, Square } from 'lucide-react';
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
        if (reportProjects.length === 0) return;

        const fetchFullReports = async () => {
            setLoadingFullReports(true);
            const newReports = {};
            try {
                // Determine which reports we still need to fetch
                const projectsToFetch = reportProjects.filter(p => !fullReports[p.id]);

                if (projectsToFetch.length === 0) {
                    setLoadingFullReports(false);
                    return;
                }

                await Promise.all(
                    projectsToFetch.map(async (project) => {
                        try {
                            const res = await authFetch(`${API_BASE}/projects/${project.id}/reports`);
                            if (res.ok) {
                                const reports = await res.json();
                                if (reports.length > 0) {
                                    newReports[project.id] = reports[0]; // Latest report
                                }
                            }
                        } catch (err) {
                            console.error(`Error fetching report for project ${project.id}:`, err);
                        }
                    })
                );
                setFullReports(prev => ({ ...prev, ...newReports }));
            } finally {
                setLoadingFullReports(false);
            }
        };

        fetchFullReports();
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
        const division = getDivision(p.goalId);
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

        const infoTableStyle = {
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '0'
        };

        const infoThStyle = {
            background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
            color: 'white',
            padding: '6px 8px',
            textAlign: 'left',
            fontWeight: '600',
            fontSize: '10px',
            border: '1px solid #0284c7'
        };

        const infoTdStyle = {
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            background: 'white',
            verticalAlign: 'top',
            fontSize: '10px'
        };

        const labelCellStyle = {
            background: '#f3f4f6',
            fontWeight: '600',
            color: '#374151',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            verticalAlign: 'top',
            fontSize: '10px'
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

                {/* Project Info Table */}
                <table style={infoTableStyle}>
                    <thead>
                        <tr>
                            <th style={{ ...infoThStyle, width: '25%' }}>Project Name</th>
                            <th style={{ ...infoThStyle, width: '20%' }}>Report Date</th>
                            <th style={{ ...infoThStyle, width: '20%' }}>Prepared By</th>
                            <th style={{ ...infoThStyle, width: '35%' }}>Overall Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style={infoTdStyle}>{project.title}</td>
                            <td style={infoTdStyle}>{report ? formatDate(report.reportDate) : '-'}</td>
                            <td style={infoTdStyle}>{report ? report.createdBy : '-'}</td>
                            <td style={infoTdStyle}>
                                <div style={statusBarStyle} />
                            </td>
                        </tr>
                    </tbody>
                </table>

                {report && (
                    <>
                        {/* Project Purpose */}
                        {report.purpose && (
                            <table style={infoTableStyle}>
                                <tbody>
                                    <tr>
                                        <td style={{ ...labelCellStyle, width: '15%' }}>Project Purpose:</td>
                                        <td style={infoTdStyle}>{report.purpose}</td>
                                    </tr>
                                </tbody>
                            </table>
                        )}

                        {/* Executive Summary */}
                        {report.executiveSummary && (
                            <table style={infoTableStyle}>
                                <tbody>
                                    <tr>
                                        <td style={{ ...labelCellStyle, width: '15%' }}>Executive Summary - Current State:</td>
                                        <td style={infoTdStyle}>{report.executiveSummary}</td>
                                    </tr>
                                </tbody>
                            </table>
                        )}

                        {/* Key Contacts */}
                        {report.contacts?.length > 0 && (
                            <table style={infoTableStyle}>
                                <tbody>
                                    <tr>
                                        <td style={{ ...labelCellStyle, width: '15%' }}>Key Contact(s):</td>
                                        <td style={infoTdStyle}>
                                            {report.contacts.map((c, i) => (
                                                <span key={i}>
                                                    {c.name}
                                                    {i < report.contacts.length - 1 ? ', ' : ''}
                                                </span>
                                            ))}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        )}

                        {/* Milestones */}
                        {report.milestones?.some(m => m.date) && (
                            <div>
                                <div style={{
                                    background: 'linear-gradient(135deg, #059669, #10b981)',
                                    color: 'white',
                                    padding: '6px 12px',
                                    fontWeight: '600',
                                    fontSize: '11px',
                                    borderRadius: '2px 2px 0 0'
                                }}>
                                    Key Milestones
                                </div>
                                <div style={{
                                    border: '1px solid #d1d5db',
                                    borderTop: 'none',
                                    padding: '16px 8px',
                                    background: 'white'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-around', position: 'relative', padding: '10px 0' }}>
                                        <div style={{
                                            position: 'absolute', top: '50%', left: '5%', right: '5%', height: '3px',
                                            background: '#374151', transform: 'translateY(-50%)', zIndex: 0
                                        }} />
                                        {report.milestones.filter(m => m.date).map((m, idx) => (
                                            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, flex: 1, textAlign: 'center' }}>
                                                <div style={{ fontSize: '10px', color: '#1f2937', marginBottom: '8px', fontWeight: '600' }}>
                                                    {formatShortDate(m.date)}
                                                </div>
                                                <div style={{
                                                    width: '12px', height: '12px', transform: 'rotate(45deg)',
                                                    background: m.status === 'complete' ? '#10b981' : (m.status === 'in-progress' ? '#f59e0b' : 'white'),
                                                    border: `2px solid ${m.status === 'complete' ? '#10b981' : (m.status === 'in-progress' ? '#f59e0b' : '#374151')}`,
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                                                }} />
                                                <div style={{ fontSize: '9px', color: '#4b5563', marginTop: '8px', maxWidth: '80px', lineHeight: '1.2' }}>
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
                <div className="preview-content">
                    <div style={{ color: 'white' }}>Select projects from the left to generate report.</div>
                </div>
            </div>
        );
    }

    return (
        <div className="report-preview-pane">
            <div className="preview-header">
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
                                <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                                    Loading full reports...
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
