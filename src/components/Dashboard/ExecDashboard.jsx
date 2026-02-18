import React, { useState, useMemo, useRef } from 'react';
import { useData } from '../../context/DataContext';
import { Search, Download, X } from 'lucide-react';
import { Modal } from '../UI/Modal';
import { StatusReportView } from '../StatusReport/StatusReportView';

import { FilterBar } from '../UI/FilterBar';
import html2pdf from 'html2pdf.js';
import './ExecDashboard.css';

import { formatCompactDate as formatShortDate } from '../../utils';
import { API_BASE } from '../../apiClient';

import { getDescendantGoalIds } from '../../utils/goalHelpers';

// Helper to get hierarchy for a project
const getProjectHierarchy = (goals, goalId) => {
    const hierarchy = {
        organization: '-',
        division: '-',
        department: '-',
        branch: '-'
    };

    if (!goalId) return hierarchy;

    const path = [];
    // Loose equality for initial find to handle string/number mismatch
    let current = goals.find(g => g.id == goalId);

    // Traverse up using loose equality for parentId check
    while (current) {
        path.unshift(current);
        if (!current.parentId) break;
        current = goals.find(g => g.id == current.parentId);
    }

    // Map depth to levels
    if (path[0]) hierarchy.organization = path[0].title;
    if (path[1]) hierarchy.division = path[1].title;
    if (path[2]) hierarchy.department = path[2].title;
    if (path[3]) hierarchy.branch = path[3].title;

    return hierarchy;
};

export function ExecDashboard() {
    const { projects, goals, getLatestStatusReport, fetchExecSummaryProjects, authFetch } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGoalId, setSelectedGoalId] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedProject, setSelectedProject] = useState(null);
    const tableRef = useRef(null);

    // Export to PDF
    const handleExportPDF = () => {
        const element = tableRef.current.cloneNode(true);
        const opt = {
            margin: [0.3, 0.3],
            filename: 'digital-health-executive-summary.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                letterRendering: true,
                logging: false
            },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
        };

        const today = new Date().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        const filterTitle = selectedGoalId
            ? goals.find(g => g.id == selectedGoalId)?.title || 'Filtered View'
            : 'All Projects';

        // Create a temporary container
        const container = document.createElement('div');
        container.style.width = '1100px'; // Approx A4 landscape width (297mm - margins)


        // Create elements securely
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
            body { margin: 0; padding: 20px; font-family: 'Segoe UI', 'Inter', sans-serif; color: #1f2937; -webkit-font-smoothing: antialiased; }
            
            /* Banner Header */
            .banner {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border: 2px solid #1f2937;
                margin-bottom: 20px;
                background: white;
            }
            .banner-title {
                background: linear-gradient(135deg, #059669, #10b981);
                color: white;
                padding: 6px 20px;
                font-size: 14px;
                font-weight: 600;
                border-radius: 4px;
                flex-shrink: 0;
            }
            
            /* Subtitle / Filter Context */
            .subtitle { color: #64748b; font-size: 12px; margin-bottom: 12px; font-weight: 500; }

            /* Table Styles */
            table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; }
            th { 
                background: linear-gradient(135deg, #0ea5e9, #38bdf8);
                color: white; 
                font-weight: 600; 
                text-transform: uppercase; 
                letter-spacing: 0.05em; 
                font-size: 9px;
                padding: 8px 12px; 
                border: 1px solid #0284c7;
                text-align: left;
            }
            
            td { 
                padding: 8px 12px; 
                border: 1px solid #d1d5db; 
                color: #374151; 
                vertical-align: top;
                font-size: 10px;
                line-height: 1.4;
                background: white;
            }

            /* Layout specific column widths based on table headers */
            th:nth-child(1), td:nth-child(1) { width: 25%; }
            th:nth-child(2), td:nth-child(2) { width: 10%; text-align: center; }
            th:nth-child(3), td:nth-child(3) { width: 65%; }

            /* Organization Header Row */
            .org-header-row td { 
                background-color: #f3f4f6; 
                color: #111827; 
                font-weight: 700; 
                font-size: 12px; 
                padding: 10px 12px; 
                border-top: 2px solid #d1d5db;
            }

            /* Division Header Row */
            .div-header-row td { 
                background-color: #f9fafb; 
                color: #4b5563; 
                font-style: italic; 
                font-weight: 600; 
                padding: 6px 12px 6px 24px; 
                border-bottom: 1px dashed #cbd5e1;
            }

            /* Utility Classes */
            .text-primary { color: #111827; }
            .text-secondary { color: #4b5563; }
            .text-sm { font-size: 9px; }
            .font-medium { font-weight: 600; color: #111827; }
            .text-center { text-align: center; }
            
            /* Status Dot */
            .status-dot { 
                display: inline-block; 
                width: 12px; 
                height: 12px; 
                border-radius: 50%; 
                margin-top: 1px;
                border: 1px solid rgba(0,0,0,0.1);
            }
        `;

        const wrapper = document.createElement('div');

        // Banner
        const banner = document.createElement('div');
        banner.className = 'banner';

        const logoDiv = document.createElement('div');
        const logoImg = document.createElement('img');
        logoImg.src = `${window.location.origin}/header-logo.png`;
        logoImg.alt = "Saskatchewan Health Partners";
        logoImg.style.height = '45px';
        logoImg.style.maxWidth = '500px';
        logoImg.style.objectFit = 'contain';
        logoDiv.appendChild(logoImg);

        const titleDiv = document.createElement('div');
        titleDiv.className = 'banner-title';
        titleDiv.textContent = 'Executive Summary';

        banner.appendChild(logoDiv);
        banner.appendChild(titleDiv);

        // Subtitle
        const subtitle = document.createElement('div');
        subtitle.className = 'subtitle';
        subtitle.textContent = `${filterTitle} • Generated on ${today}`;

        // Assemble
        wrapper.appendChild(banner);
        wrapper.appendChild(subtitle);
        wrapper.appendChild(element); // The cloned table

        container.appendChild(styleEl);
        container.appendChild(wrapper);

        // Remove React-specific classes or attributes that might interfere (optional, but robust)
        // Since we provided new CSS, the existing utility classes like 'text-primary' won't affect colors unless we define them.
        // We defined .font-medium, .text-center, .text-secondary above to catch the React classes used in the table.

        html2pdf().set(opt).from(container).save();
    };

    const [fullReport, setFullReport] = useState(null);
    const [loadingReport, setLoadingReport] = useState(false);
    const [allProjects, setAllProjects] = useState([]);
    const [loadingSummary, setLoadingSummary] = useState(true);
    const [fetchError, setFetchError] = useState(null);


    // Fetch the full status report when user clicks a project row
    const handleProjectClick = async (row) => {
        setSelectedProject(row);
        setFullReport(null);
        setLoadingReport(true);
        try {
            const res = await authFetch(`${API_BASE}/projects/${row.id}/reports`);
            if (res.ok) {
                const reports = await res.json();
                // API returns sorted DESC — first one is the latest
                setFullReport(reports.length > 0 ? reports[0] : null);
            }
        } catch (err) {
            console.error('Error fetching full report:', err);
        } finally {
            setLoadingReport(false);
        }
    };

    // Helper functions moved outside component

    // Fetch full executive summary data on mount
    React.useEffect(() => {
        let isMounted = true;

        const fetchSummary = async () => {
            setLoadingSummary(true);
            setFetchError(null);
            try {
                // Add simple timeout
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Request timed out (8s)')), 8000)
                );

                const data = await Promise.race([
                    fetchExecSummaryProjects(),
                    timeoutPromise
                ]);

                if (isMounted) {
                    if (data && Array.isArray(data) && data.length > 0) {
                        console.log(`ExecDashboard: Loaded ${data.length} projects successfully.`);
                        setAllProjects(data);
                    } else {
                        console.warn("ExecDashboard: Fetched data was empty or invalid", data);
                        // Don't show error for empty list, just use fallback
                    }
                }
            } catch (err) {
                console.error("ExecDashboard: Error fetching summary:", err);
                if (isMounted) setFetchError(err.message);
            } finally {
                if (isMounted) setLoadingSummary(false);
            }
        };

        fetchSummary();
        return () => { isMounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Process data using Cascading Filter logic
    const groupedData = useMemo(() => {
        // Use allProjects if available, otherwise fallback to context projects (paginated)
        const sourceProjects = allProjects.length > 0 ? allProjects : projects;

        // 1. Filter projects based on selected goal (and descendants)
        // Mimics logic from KanbanView.jsx
        // 1a. Filter by goal
        let filteredProjects = sourceProjects;

        if (selectedGoalId) {
            const descendantIds = getDescendantGoalIds(goals, selectedGoalId);
            // Normalize IDs to strings for comparison to avoid mismatches
            const targetIds = [selectedGoalId, ...descendantIds].map(id => String(id));

            console.log(`Filtering: Selected ${selectedGoalId}, Found ${descendantIds.length} descendants.`);

            filteredProjects = sourceProjects.filter(p => {
                if (!p.goalId) return false;
                return targetIds.includes(String(p.goalId));
            });

            console.log(`Filtering Result: ${filteredProjects.length} / ${sourceProjects.length} projects match.`);
        }

        // 1b. Filter by selected tags (AND logic — project must have ALL selected tags)
        if (selectedTags.length > 0) {
            filteredProjects = filteredProjects.filter(p => {
                if (!p.tags || p.tags.length === 0) return false;
                const projectTagIds = p.tags.map(t => String(t.tagId));
                return selectedTags.every(tagId => projectTagIds.includes(String(tagId)));
            });
        }

        // 2. Process and Map
        const mapped = filteredProjects.map(p => {
            const h = getProjectHierarchy(goals, p.goalId);
            // Use pre-fetched report if available, otherwise try context
            const report = p.report || getLatestStatusReport(p.id);
            return {
                id: p.id,
                title: p.title,
                ...h,
                overallStatus: report ? report.overallStatus : 'unknown',
                execSummary: report ? report.executiveSummary : 'No report filed',
                report: report
            };
        });

        // 3. Apply Search Filter
        const finalFiltered = mapped.filter(item => {
            const matchesSearch = item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.execSummary?.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesSearch;
        });

        // Group by Organization -> Division
        const groups = {};

        finalFiltered.forEach(item => {
            if (!groups[item.organization]) {
                groups[item.organization] = {};
            }
            if (!groups[item.organization][item.division]) {
                groups[item.organization][item.division] = [];
            }
            groups[item.organization][item.division].push(item);
        });

        // Sort items within divisions
        Object.keys(groups).forEach(org => {
            Object.keys(groups[org]).forEach(div => {
                groups[org][div].sort((a, b) => a.title.localeCompare(b.title));
            });
        });

        return groups;
    }, [projects, allProjects, goals, getLatestStatusReport, searchTerm, selectedGoalId, selectedTags]);

    const getStatusColor = (status) => {
        switch (status) {
            case 'green': return '#10b981';
            case 'yellow': return '#f59e0b';
            case 'red': return '#ef4444';
            default: return '#9ca3af';
        }
    };

    return (
        <div className="exec-dashboard">
            <div className="view-header">
                <div>
                    <h2>Executive Summary</h2>
                    <p className="view-subtitle">High-level portfolio status overview</p>
                </div>
                <div className="header-actions">
                    <div className="search-bar">
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder="Search projects..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button className="btn-primary" onClick={handleExportPDF}>
                        <Download size={16} />
                        Export PDF
                    </button>
                </div>
            </div>

            {/* Filters */}
            <FilterBar
                goalFilter={selectedGoalId}
                onGoalFilterChange={setSelectedGoalId}
                selectedTags={selectedTags}
                onTagsChange={setSelectedTags}
                countLabel={`${Object.values(groupedData).reduce((acc, org) => acc + Object.values(org).reduce((acc2, div) => acc2 + div.length, 0), 0)} project(s)`}
            >
                {searchTerm && (
                    <button className="btn-secondary btn-sm shared-clear-btn" onClick={() => setSearchTerm('')}>
                        <X size={14} /> Clear Search
                    </button>
                )}
            </FilterBar>

            {/* Table */}
            <div className="table-container glass">
                {fetchError && (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 mx-4 mt-4">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <p className="text-sm text-red-700">
                                    Error loading full portfolio: {fetchError}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
                <table className="exec-table" ref={tableRef}>
                    <thead>
                        <tr>
                            <th style={{ width: '25%' }}>Project Name</th>
                            <th style={{ width: '10%' }} className="text-center">Status</th>
                            <th style={{ width: '55%' }}>Exec Current Status</th>
                            <th style={{ width: '10%' }}>Last Report</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loadingSummary ? (
                            // Skeleton Loader Rows
                            Array.from({ length: 5 }).map((_, idx) => (
                                <tr key={`skeleton-${idx}`}>
                                    <td style={{ padding: '1rem' }}>
                                        <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse"></div>
                                        <div className="h-3 bg-gray-100 rounded w-1/2 mt-2 animate-pulse"></div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div className="h-6 w-20 bg-gray-200 rounded mx-auto animate-pulse"></div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div className="space-y-2">
                                            <div className="h-3 bg-gray-200 rounded w-full animate-pulse"></div>
                                            <div className="h-3 bg-gray-200 rounded w-5/6 animate-pulse"></div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div className="h-3 bg-gray-200 rounded w-24 animate-pulse"></div>
                                    </td>
                                </tr>
                            ))
                        ) : Object.keys(groupedData).length === 0 ? (
                            <tr>
                                <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                                    No projects found matching your filters.
                                </td>
                            </tr>
                        ) : (
                            Object.entries(groupedData)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([orgName, divisions]) => (
                                    <React.Fragment key={orgName}>
                                        {/* Organization Header */}
                                        <tr className="org-header-row">
                                            <td colSpan={4}>{orgName}</td>
                                        </tr>
                                        {/* Divisions */}
                                        {Object.entries(divisions)
                                            .sort(([a], [b]) => a.localeCompare(b))
                                            .map(([divName, projects]) => (
                                                <React.Fragment key={`${orgName}-${divName}`}>
                                                    <tr className="div-header-row">
                                                        <td colSpan={4}>{divName}</td>
                                                    </tr>
                                                    {/* Projects */}
                                                    {projects.map(project => {
                                                        const report = project.report || getLatestStatusReport(project.id);
                                                        const statusColor = report ? getStatusColor(report.overallStatus) : '#e5e7eb';
                                                        const statusLabel = report
                                                            ? (report.overallStatus.charAt(0).toUpperCase() + report.overallStatus.slice(1))
                                                            : 'No Report';

                                                        const reportCountText = project.reportCount > 0 ? `${project.reportCount} reports` : '';

                                                        return (
                                                            <tr
                                                                key={project.id}
                                                                className="project-row"
                                                                onClick={() => handleProjectClick(project)}
                                                                style={{ cursor: 'pointer' }}
                                                            >
                                                                <td className="text-sm text-gray-600 font-normal">
                                                                    <div className="exec-project-title">{project.title}</div>
                                                                    {reportCountText && (
                                                                        <div className="text-xs text-gray-500 mt-1">
                                                                            {reportCountText}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="text-center">
                                                                    <div
                                                                        className="status-dot"
                                                                        style={{ backgroundColor: statusColor }}
                                                                        title={statusLabel}
                                                                    />
                                                                </td>
                                                                <td className="text-sm text-gray-600 max-w-md truncate-cell">
                                                                    {report?.executiveSummary || (
                                                                        <span className="italic text-gray-400">No executive summary available</span>
                                                                    )}
                                                                </td>
                                                                <td className="text-sm text-gray-500 whitespace-nowrap">
                                                                    {report ? formatShortDate(report.updatedAt) : '-'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </React.Fragment>
                                            ))}
                                    </React.Fragment>
                                ))
                        )}
                    </tbody>
                </table>
            </div>

            {selectedProject && (
                <Modal
                    isOpen={!!selectedProject}
                    onClose={() => { setSelectedProject(null); setFullReport(null); }}
                    title={`Status Report: ${selectedProject.title}`}
                    size="xl"
                    closeOnOverlayClick={false}
                >
                    <div style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                        {loadingReport ? (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" style={{ margin: '0 auto 1rem' }}></div>
                                Loading full report...
                            </div>
                        ) : fullReport ? (
                            <StatusReportView
                                report={fullReport}
                                projectTitle={selectedProject.title}
                                hideActions={true}
                            />
                        ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                <p>No status report has been filed for <strong>{selectedProject.title}</strong> yet.</p>
                            </div>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    );
}
