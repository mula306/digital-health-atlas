import React, { useState, useMemo, useRef } from 'react';
import { useData } from '../../context/DataContext';
import { Search, Download, X, Tag } from 'lucide-react';
import { Modal } from '../UI/Modal';
import { StatusReportView } from '../StatusReport/StatusReportView';
import { CascadingGoalFilter, getDescendantGoalIds } from '../UI/CascadingGoalFilter';
import html2pdf from 'html2pdf.js';
import './ExecDashboard.css';

export function ExecDashboard() {
    const { projects, goals, getLatestStatusReport, tagGroups } = useData();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGoalId, setSelectedGoalId] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedProject, setSelectedProject] = useState(null);
    const [showTagFilter, setShowTagFilter] = useState(false);
    const tableRef = useRef(null);

    // Get only active tags grouped for the filter UI
    const activeTags = useMemo(() => {
        if (!tagGroups || tagGroups.length === 0) return [];
        return tagGroups
            .map(group => ({
                ...group,
                tags: (group.tags || []).filter(t => t.status?.toLowerCase() === 'active')
            }))
            .filter(group => group.tags.length > 0);
    }, [tagGroups]);

    const toggleTag = (tagId) => {
        setSelectedTags(prev =>
            prev.includes(tagId)
                ? prev.filter(id => id !== tagId)
                : [...prev, tagId]
        );
    };

    const clearAllFilters = () => {
        setSelectedGoalId('');
        setSelectedTags([]);
        setSearchTerm('');
    };

    // Helper to get hierarchy for a project
    const getProjectHierarchy = (goalId) => {
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

    // Process data using Cascading Filter logic
    const groupedData = useMemo(() => {
        // 1. Filter projects based on selected goal (and descendants)
        // Mimics logic from KanbanView.jsx
        // 1a. Filter by goal
        let filteredProjects = selectedGoalId
            ? projects.filter(p => {
                if (p.goalId == selectedGoalId) return true;
                const descendantIds = getDescendantGoalIds(goals, selectedGoalId);
                return descendantIds.includes(p.goalId);
            })
            : projects;

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
            const h = getProjectHierarchy(p.goalId);
            const report = getLatestStatusReport(p.id);
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
    }, [projects, goals, getLatestStatusReport, searchTerm, selectedGoalId, selectedTags]);

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
            <div className="dashboard-filters glass">
                <div className="exec-filter-row">
                    <CascadingGoalFilter value={selectedGoalId} onChange={setSelectedGoalId} />

                    <button
                        className={`btn-secondary btn-sm exec-tag-toggle ${showTagFilter ? 'active' : ''} ${selectedTags.length > 0 ? 'has-selection' : ''}`}
                        onClick={() => setShowTagFilter(!showTagFilter)}
                    >
                        <Tag size={14} />
                        Tags{selectedTags.length > 0 && <span className="exec-tag-count">{selectedTags.length}</span>}
                    </button>

                    {(selectedGoalId || selectedTags.length > 0 || searchTerm) && (
                        <button className="btn-secondary btn-sm exec-clear-btn" onClick={clearAllFilters}>
                            <X size={14} /> Clear All
                        </button>
                    )}
                </div>

                {showTagFilter && activeTags.length > 0 && (
                    <div className="exec-tag-filter-panel">
                        {activeTags.map(group => (
                            <div key={group.id} className="exec-tag-group">
                                <span className="exec-tag-group-label">{group.name}</span>
                                <div className="exec-tag-options">
                                    {group.tags.map(tag => (
                                        <button
                                            key={tag.id}
                                            className={`exec-tag-pill ${selectedTags.includes(String(tag.id)) ? 'selected' : ''}`}
                                            onClick={() => toggleTag(String(tag.id))}
                                            style={{
                                                '--tag-color': tag.color || '#6366f1',
                                            }}
                                        >
                                            <span className="exec-tag-dot" style={{ background: tag.color || '#6366f1' }}></span>
                                            {tag.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="table-container glass">
                <table className="exec-table" ref={tableRef}>
                    <thead>
                        <tr>
                            <th style={{ width: '25%' }}>Project Name</th>
                            <th style={{ width: '10%' }} className="text-center">Status</th>
                            <th style={{ width: '65%' }}>Exec Current Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Object.keys(groupedData).length === 0 ? (
                            <tr>
                                <td colSpan={3} className="text-center py-8 text-secondary">
                                    No projects found matching filters.
                                </td>
                            </tr>
                        ) : (
                            Object.keys(groupedData).sort().map(org => (
                                <React.Fragment key={org}>
                                    {/* Organization Header */}
                                    <tr className="org-header-row">
                                        <td colSpan={3}>{org}</td>
                                    </tr>
                                    {Object.keys(groupedData[org]).sort().map(div => (
                                        <React.Fragment key={`${org}-${div}`}>
                                            {/* Division Header */}
                                            <tr className="div-header-row">
                                                <td colSpan={3}>{div}</td>
                                            </tr>
                                            {groupedData[org][div].map(row => (
                                                <tr
                                                    key={row.id}
                                                    onClick={() => setSelectedProject(row)}
                                                    className="clickable-row"
                                                >
                                                    <td className="font-medium text-primary" style={{ paddingLeft: '2rem' }}>
                                                        {row.title}
                                                    </td>
                                                    <td className="text-center">
                                                        <div
                                                            className="status-dot"
                                                            style={{ backgroundColor: getStatusColor(row.overallStatus) }}
                                                            title={row.overallStatus}
                                                        />
                                                    </td>
                                                    <td className="text-sm text-secondary">{row.execSummary}</td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </React.Fragment>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {selectedProject && selectedProject.report && (
                <Modal
                    isOpen={!!selectedProject}
                    onClose={() => setSelectedProject(null)}
                    title={`Status Report: ${selectedProject.title}`}
                    size="xl"
                    closeOnOverlayClick={false}
                >
                    <div style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                        <StatusReportView
                            report={selectedProject.report}
                            projectTitle={selectedProject.title}
                            hideActions={true}
                        />
                    </div>
                </Modal>
            )}

            {selectedProject && !selectedProject.report && (
                <Modal
                    isOpen={!!selectedProject}
                    onClose={() => setSelectedProject(null)}
                    title={`No Report Available`}
                    closeOnOverlayClick={false}
                >
                    <div className="p-4">
                        <p>No status report has been filed for <strong>{selectedProject.title}</strong> yet.</p>
                    </div>
                </Modal>
            )}
        </div>
    );
}
