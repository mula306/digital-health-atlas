import { useState, useEffect, useCallback } from 'react';
import { useData } from '../../context/DataContext';
import { KanbanBoard } from './KanbanBoard';
import { Plus, Folder, Target, Search, X, LayoutGrid, Table } from 'lucide-react';
import { Modal } from '../UI/Modal';
import { AddProjectForm } from './AddProjectForm';
import { getDescendantGoalIds } from '../../utils/goalHelpers';
import { FilterBar } from '../UI/FilterBar';
import { ProjectTagBadges } from '../UI/ProjectTagSelector';
import './KanbanView.css';

import { useAuth } from '../../hooks/useAuth';

import { EmptyState } from '../UI/EmptyState';
import { API_BASE } from '../../apiClient';

const STATUS_OPTIONS = [
    { id: 'red', label: 'Red', color: '#ef4444' },
    { id: 'yellow', label: 'Yellow', color: '#f59e0b' },
    { id: 'green', label: 'Green', color: '#10b981' },
    { id: 'unknown', label: 'No Report', color: '#9ca3af' }
];

export default function KanbanView({ initialGoalFilter, onClearFilter }) {
    const { projects, goals, loadProjectDetails, loading, loadMoreProjects, projectsPagination, loadingMore, authFetch } = useData();
    const { canEdit } = useAuth();

    // Persist selected project to survive remounts/refresh
    const [selectedProjectId, setSelectedProjectIdState] = useState(() => {
        const saved = localStorage.getItem('dha_selected_project_id');
        return saved || null;
    });

    const setSelectedProjectId = (id) => {
        if (id) {
            localStorage.setItem('dha_selected_project_id', id);
        } else {
            localStorage.removeItem('dha_selected_project_id');
        }
        setSelectedProjectIdState(id);
    };

    const [showProjectModal, setShowProjectModal] = useState(false);
    const [goalFilter, setGoalFilter] = useState(initialGoalFilter || '');
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [projectListView, setProjectListViewState] = useState(() => {
        const stored = localStorage.getItem('dha_projects_list_view');
        return stored === 'table' ? 'table' : 'cards';
    });
    const [exactProjectFilterId, setExactProjectFilterId] = useState(() => {
        const stored = localStorage.getItem('dha_project_filter_id');
        return stored || '';
    });
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);

    // Server-side filtered projects state
    const [filteredServerProjects, setFilteredServerProjects] = useState(null);
    const [filteredPagination, setFilteredPagination] = useState(null);
    const [filterLoading, setFilterLoading] = useState(false);
    const [filteredLoadingMore, setFilteredLoadingMore] = useState(false);

    const hasActiveFilters = !!(goalFilter || selectedTags.length > 0 || selectedStatuses.length > 0 || searchTerm.trim() || exactProjectFilterId);

    // Sync with external filter changes
    useEffect(() => {
        if (initialGoalFilter) {
            setGoalFilter(initialGoalFilter);
        }
    }, [initialGoalFilter]);

    useEffect(() => {
        const handleProjectFilterEvent = (event) => {
            const projectId = String(event?.detail?.projectId || '').trim();
            if (!projectId) return;

            setSelectedProjectId(null);
            setGoalFilter('');
            setSelectedTags([]);
            setSelectedStatuses([]);
            setSearchTerm('');
            setExactProjectFilterId(projectId);
            localStorage.setItem('dha_project_filter_id', projectId);
        };

        window.addEventListener('dha:filter-project', handleProjectFilterEvent);
        return () => window.removeEventListener('dha:filter-project', handleProjectFilterEvent);
    }, []);

    // Build filter query params (shared by initial fetch and load-more)
    const buildFilterParams = useCallback((page = 1) => {
        const params = new URLSearchParams({ page: String(page), limit: '100' });
        if (exactProjectFilterId) {
            params.set('projectId', exactProjectFilterId);
        }
        if (goalFilter) {
            const descendantIds = getDescendantGoalIds(goals, goalFilter);
            const allGoalIds = [String(goalFilter), ...descendantIds.map(String)];
            params.set('goalIds', allGoalIds.join(','));
        }
        if (selectedTags.length > 0) {
            params.set('tagIds', selectedTags.join(','));
        }
        if (selectedStatuses.length > 0) {
            params.set('statuses', selectedStatuses.join(','));
        }
        if (searchTerm.trim()) {
            params.set('search', searchTerm.trim());
        }
        return params;
    }, [exactProjectFilterId, goalFilter, selectedTags, selectedStatuses, searchTerm, goals]);

    // Fetch filtered projects from server when filters change
    useEffect(() => {
        if (!hasActiveFilters) {
            setFilteredServerProjects(null);
            setFilteredPagination(null);
            return;
        }

        let cancelled = false;
        async function fetchFiltered() {
            setFilterLoading(true);
            try {
                const params = buildFilterParams(1);
                const res = await authFetch(`${API_BASE}/projects?${params.toString()}`);
                if (!res.ok) throw new Error('Failed to fetch filtered projects');
                const data = await res.json();

                if (!cancelled) {
                    setFilteredServerProjects(data.projects || []);
                    setFilteredPagination(data.pagination || null);
                }
            } catch (err) {
                console.error('Error fetching filtered projects:', err);
                if (!cancelled) setFilteredServerProjects([]);
            } finally {
                if (!cancelled) setFilterLoading(false);
            }
        }

        fetchFiltered();
        return () => { cancelled = true; };
    }, [exactProjectFilterId, goalFilter, selectedTags, selectedStatuses, searchTerm, goals, authFetch, buildFilterParams, hasActiveFilters]);

    // Load more filtered projects
    const loadMoreFilteredProjects = useCallback(async () => {
        if (!filteredPagination?.hasMore || filteredLoadingMore) return;
        setFilteredLoadingMore(true);
        try {
            const nextPage = filteredPagination.page + 1;
            const params = buildFilterParams(nextPage);
            const res = await authFetch(`${API_BASE}/projects?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to load more filtered projects');
            const data = await res.json();
            setFilteredServerProjects(prev => [...(prev || []), ...(data.projects || [])]);
            setFilteredPagination(data.pagination || null);
        } catch (err) {
            console.error('Error loading more filtered projects:', err);
        } finally {
            setFilteredLoadingMore(false);
        }
    }, [filteredPagination, filteredLoadingMore, buildFilterParams, authFetch]);

    // Load full details when a project is selected
    useEffect(() => {
        if (!selectedProjectId) return;

        let cancelled = false;
        const project = projects.find(p => p.id == selectedProjectId);
        if (project && project._detailsLoaded) return;

        setIsLoadingDetails(true);
        loadProjectDetails(selectedProjectId)
            .then((loaded) => {
                if (!cancelled && !loaded) {
                    setSelectedProjectId(null);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoadingDetails(false);
                }
            });

        return () => { cancelled = true; };
    }, [selectedProjectId, projects, loadProjectDetails]);

    const selectedProject = projects.find(p => p.id == selectedProjectId);

    // Use server-filtered projects when filters are active, otherwise global paginated projects
    const displayProjects = hasActiveFilters ? (filteredServerProjects || []) : projects;

    const setProjectListView = (mode) => {
        const normalized = mode === 'table' ? 'table' : 'cards';
        localStorage.setItem('dha_projects_list_view', normalized);
        setProjectListViewState(normalized);
    };

    const getProjectStatus = (project) => {
        return String(project.report?.overallStatus || project.latestReport?.overallStatus || 'unknown').toLowerCase();
    };

    const getProjectStatusLabel = (project) => {
        const status = getProjectStatus(project);
        if (status === 'red') return 'Red';
        if (status === 'yellow') return 'Yellow';
        if (status === 'green') return 'Green';
        return 'No Report';
    };

    const getProjectStatusColor = (project) => {
        const status = getProjectStatus(project);
        if (status === 'red') return '#ef4444';
        if (status === 'yellow') return '#f59e0b';
        if (status === 'green') return '#10b981';
        return '#9ca3af';
    };

    const getGoalTitle = (goalId) => {
        const goal = goals.find(g => String(g.id) === String(goalId));
        return goal ? goal.title : null;
    };

    const getProjectGoalTitles = (project) => {
        const goalIds = Array.isArray(project.goalIds) && project.goalIds.length > 0
            ? project.goalIds
            : (project.goalId ? [project.goalId] : []);

        const uniqueGoalIds = [...new Set(goalIds.map((id) => String(id)))];
        return uniqueGoalIds
            .map((goalId) => getGoalTitle(goalId))
            .filter(Boolean);
    };

    const getProjectGoalSummary = (project) => {
        const titles = getProjectGoalTitles(project);
        if (titles.length === 0) return 'Unlinked';
        if (titles.length === 1) return titles[0];
        return `${titles[0]} +${titles.length - 1} more`;
    };

    const handleFilterChange = (newGoalId) => {
        if (exactProjectFilterId) {
            setExactProjectFilterId('');
            localStorage.removeItem('dha_project_filter_id');
        }
        setGoalFilter(newGoalId);
        if (!newGoalId && onClearFilter) onClearFilter();
    };

    // Show loading state if we have a selected ID but no project found yet (likely initial load)
    if (selectedProjectId && !selectedProject) {
        if (loading || isLoadingDetails) {
            return (
                <div className="flex justify-center items-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    <span className="ml-2 text-gray-500">Restoring project...</span>
                </div>
            );
        }
    }

    if (selectedProject) {
        if (isLoadingDetails) {
            return (
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    <span className="ml-2 text-gray-500">Loading project details...</span>
                </div>
            );
        }

        return (
            <KanbanBoard
                project={selectedProject}
                onBack={() => setSelectedProjectId(null)}
                goalTitle={getProjectGoalSummary(selectedProject)}
            />
        );
    }

    return (
        <div className="kanban-view">
            <div className="view-header actions-only">
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
                    <div className="project-view-toggle" role="tablist" aria-label="Project list view">
                        <button
                            type="button"
                            className={`project-view-toggle-btn ${projectListView === 'cards' ? 'active' : ''}`}
                            onClick={() => setProjectListView('cards')}
                            title="Card view"
                            aria-label="Card view"
                        >
                            <LayoutGrid size={16} />
                        </button>
                        <button
                            type="button"
                            className={`project-view-toggle-btn ${projectListView === 'table' ? 'active' : ''}`}
                            onClick={() => setProjectListView('table')}
                            title="Table view"
                            aria-label="Table view"
                        >
                            <Table size={16} />
                        </button>
                    </div>
                    {canEdit && (
                        <button className="btn-primary" onClick={() => setShowProjectModal(true)}>
                            <Plus size={18} />
                            New Project
                        </button>
                    )}
                </div>
            </div>

            {/* Filters */}
            <FilterBar
                goalFilter={goalFilter}
                onGoalFilterChange={handleFilterChange}
                selectedTags={selectedTags}
                onTagsChange={setSelectedTags}
                selectedStatuses={selectedStatuses}
                onStatusesChange={setSelectedStatuses}
                statusOptions={STATUS_OPTIONS}
                countLabel={hasActiveFilters
                    ? `${displayProjects.length} of ${filteredPagination?.total || displayProjects.length} project(s)`
                    : `${displayProjects.length} project(s)`
                }
            >
                {exactProjectFilterId && (
                    <button
                        className="btn-secondary btn-sm shared-clear-btn"
                        onClick={() => {
                            setExactProjectFilterId('');
                            localStorage.removeItem('dha_project_filter_id');
                        }}
                    >
                        <X size={14} /> Clear Project Filter
                    </button>
                )}
                {searchTerm && (
                    <button className="btn-secondary btn-sm shared-clear-btn" onClick={() => setSearchTerm('')}>
                        <X size={14} /> Clear Search
                    </button>
                )}
            </FilterBar>

            {filterLoading && (
                <div className="filter-loading-indicator" style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>
                    Loading filtered projects...
                </div>
            )}

            {displayProjects.length === 0 && !filterLoading ? (
                <EmptyState
                    title="No projects found"
                    message={`No projects found${goalFilter ? ' for this goal' : ''}.`}
                />
            ) : projectListView === 'table' ? (
                <div className="projects-table-wrap">
                    <table className="projects-table">
                        <thead>
                            <tr>
                                <th>Project</th>
                                <th>Goals</th>
                                <th>Status</th>
                                <th>Tasks</th>
                                <th>Progress</th>
                                <th>Tags</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayProjects.map(project => {
                                const goalTitles = getProjectGoalTitles(project);
                                const visibleGoalTitles = goalTitles.slice(0, 2);
                                const hiddenGoalCount = Math.max(0, goalTitles.length - visibleGoalTitles.length);
                                return (
                                <tr
                                    key={project.id}
                                    className="project-table-row"
                                    onClick={() => setSelectedProjectId(project.id)}
                                >
                                    <td>
                                        <div className="project-cell-primary">
                                            <span className="project-cell-title">{project.title}</span>
                                            <span className="project-cell-desc">{project.description || 'No description'}</span>
                                        </div>
                                    </td>
                                    <td>
                                        {goalTitles.length > 0 ? (
                                            <div className="project-goals-cell" title={goalTitles.join(', ')}>
                                                {visibleGoalTitles.map((title, index) => (
                                                    <span
                                                        key={`${project.id}-goal-${index}`}
                                                        className="project-goal-chip"
                                                    >
                                                        {title}
                                                    </span>
                                                ))}
                                                {hiddenGoalCount > 0 && (
                                                    <span className="project-goal-chip project-goal-chip-more">
                                                        +{hiddenGoalCount} more
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="project-table-empty">Unlinked</span>
                                        )}
                                    </td>
                                    <td>
                                        <span
                                            className="project-status-badge"
                                            style={{
                                                backgroundColor: `${getProjectStatusColor(project)}20`,
                                                color: getProjectStatusColor(project)
                                            }}
                                        >
                                            {getProjectStatusLabel(project)}
                                        </span>
                                    </td>
                                    <td>{project.taskCount || project.tasks?.length || 0}</td>
                                    <td>
                                        <div className="project-table-progress">
                                            <div className="progress-bar-track">
                                                <div
                                                    className="progress-bar-fill"
                                                    style={{ width: `${project.completion || 0}%` }}
                                                ></div>
                                            </div>
                                            <span className="progress-label">{project.completion || 0}%</span>
                                        </div>
                                    </td>
                                    <td>
                                        {project.tags && project.tags.length > 0 ? (
                                            <ProjectTagBadges tags={project.tags} maxDisplay={2} />
                                        ) : (
                                            <span className="project-table-empty">No tags</span>
                                        )}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="projects-grid">
                    {displayProjects.map(project => {
                        const goalTitles = getProjectGoalTitles(project);
                        const visibleGoalTitles = goalTitles.slice(0, 2);
                        const hiddenGoalCount = Math.max(0, goalTitles.length - visibleGoalTitles.length);
                        return (
                        <div
                            key={project.id}
                            className="project-card"
                            onClick={() => setSelectedProjectId(project.id)}
                        >
                            <div className="project-card-header">
                                <div className="project-icon">
                                    <Folder size={22} />
                                </div>
                                <span className="project-task-count">
                                    {project.taskCount || project.tasks?.length || 0} Tasks
                                </span>
                            </div>

                            <h3 className="project-title">{project.title}</h3>
                            <p className="project-description">{project.description || 'No description'}</p>

                            {project.tags && project.tags.length > 0 && (
                                <ProjectTagBadges tags={project.tags} maxDisplay={3} />
                            )}

                            <div className="project-goal-section">
                                <div className="project-goal-label">
                                    <Target size={14} />
                                    <span>Goals</span>
                                </div>
                                <div className="project-goal-links" title={goalTitles.join(', ')}>
                                    {goalTitles.length === 0 && (
                                        <span className="project-goal-chip project-goal-chip-empty">Unlinked</span>
                                    )}
                                    {visibleGoalTitles.map((title, index) => (
                                        <span
                                            key={`${project.id}-goal-card-${index}`}
                                            className="project-goal-chip"
                                        >
                                            {title}
                                        </span>
                                    ))}
                                    {hiddenGoalCount > 0 && (
                                        <span className="project-goal-chip project-goal-chip-more">
                                            +{hiddenGoalCount} more
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="project-progress">
                                <div className="progress-bar-track">
                                    <div
                                        className="progress-bar-fill"
                                        style={{ width: `${project.completion || 0}%` }}
                                    ></div>
                                </div>
                                <span className="progress-label">{project.completion || 0}% Complete</span>
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination Controls */}
            <div className="pagination-controls-wrapper">
                <div className="pagination-info">
                    Showing {displayProjects.length} of {hasActiveFilters ? (filteredPagination?.total || displayProjects.length) : (projectsPagination?.total || 0)} projects
                </div>

                {hasActiveFilters ? (
                    filteredPagination?.hasMore && (
                        <button
                            className="btn-secondary load-more-btn"
                            onClick={loadMoreFilteredProjects}
                            disabled={filteredLoadingMore}
                        >
                            {filteredLoadingMore ? (
                                <span className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                                    Loading...
                                </span>
                            ) : (
                                'Load More Projects'
                            )}
                        </button>
                    )
                ) : (
                    projectsPagination?.hasMore && (
                        <button
                            className="btn-secondary load-more-btn"
                            onClick={loadMoreProjects}
                            disabled={loadingMore}
                        >
                            {loadingMore ? (
                                <span className="flex items-center">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                                    Loading...
                                </span>
                            ) : (
                                'Load More Projects'
                            )}
                        </button>
                    )
                )}
            </div>

            <Modal
                isOpen={showProjectModal}
                onClose={() => setShowProjectModal(false)}
                title="Create New Project"
            >
                <AddProjectForm onClose={() => setShowProjectModal(false)} />
            </Modal>
        </div>
    );
}

