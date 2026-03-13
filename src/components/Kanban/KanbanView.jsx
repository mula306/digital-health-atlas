import { useState, useEffect, useCallback } from 'react';
import { useData } from '../../context/DataContext';
import { KanbanBoard } from './KanbanBoard';
import { Plus, Folder, Target, Search, X, LayoutGrid, Table, Star, Archive } from 'lucide-react';
import { Modal } from '../UI/Modal';
import { AddProjectForm } from './AddProjectForm';
import { getDescendantGoalIds } from '../../utils/goalHelpers';
import { FilterBar } from '../UI/FilterBar';
import { ProjectTagBadges } from '../UI/ProjectTagSelector';
import './KanbanView.css';
import { EmptyState } from '../UI/EmptyState';
import { API_BASE } from '../../apiClient';

const STATUS_OPTIONS = [
    { id: 'red', label: 'Red', color: '#ef4444' },
    { id: 'yellow', label: 'Yellow', color: '#f59e0b' },
    { id: 'green', label: 'Green', color: '#10b981' },
    { id: 'unknown', label: 'No Report', color: '#9ca3af' }
];

export default function KanbanView({ initialGoalFilter, onClearFilter }) {
    const {
        projects,
        goals,
        loadProjectDetails,
        loading,
        loadMoreProjects,
        projectsPagination,
        projectsError,
        loadingMore,
        authFetch,
        watchProject,
        unwatchProject,
        hasPermission,
        currentUser,
        hasRole
    } = useData();
    const canCreateProject = hasPermission('can_create_project');
    const isAdminUser = hasRole('Admin');

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
    const [watchedOnly, setWatchedOnly] = useState(false);
    const [projectListView, setProjectListViewState] = useState(() => {
        const stored = localStorage.getItem('dha_projects_list_view');
        return stored === 'table' ? 'table' : 'cards';
    });
    const [exactProjectFilterId, setExactProjectFilterId] = useState('');
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [ownershipFilter, setOwnershipFilter] = useState([]);
    const [projectLifecycleFilter, setProjectLifecycleFilter] = useState('active');

    // Server-side filtered projects state
    const [filteredServerProjects, setFilteredServerProjects] = useState(null);
    const [filteredPagination, setFilteredPagination] = useState(null);
    const [filterLoading, setFilterLoading] = useState(false);
    const [filteredLoadingMore, setFilteredLoadingMore] = useState(false);
    const [filterError, setFilterError] = useState('');

    const hasActiveFilters = !!(
        goalFilter ||
        selectedTags.length > 0 ||
        selectedStatuses.length > 0 ||
        searchTerm.trim() ||
        exactProjectFilterId ||
        watchedOnly ||
        ownershipFilter.length > 0 ||
        projectLifecycleFilter !== 'active'
    );

    // Sync with external filter changes
    useEffect(() => {
        if (initialGoalFilter) {
            setGoalFilter(initialGoalFilter);
        }
    }, [initialGoalFilter]);

    useEffect(() => {
        localStorage.removeItem('dha_project_filter_id');

        const oneTimeProjectFilterRaw = localStorage.getItem('dha_project_filter_payload');
        if (!oneTimeProjectFilterRaw) return;

        try {
            const parsed = JSON.parse(oneTimeProjectFilterRaw);
            const projectId = String(parsed?.projectId || '').trim();
            const requestedAt = Number(parsed?.requestedAt || 0);
            const isFresh = requestedAt > 0 && (Date.now() - requestedAt) <= 15000;
            if (projectId && isFresh) {
                setExactProjectFilterId(projectId);
            }
        } catch (error) {
            console.warn('Ignoring invalid one-time project filter payload', error);
        } finally {
            localStorage.removeItem('dha_project_filter_payload');
        }
    }, []);

    useEffect(() => {
        const handleProjectFilterEvent = (event) => {
            const projectId = String(event?.detail?.projectId || '').trim();
            if (!projectId) return;

            setSelectedProjectId(null);
            setGoalFilter('');
            setSelectedTags([]);
            setSelectedStatuses([]);
            setSearchTerm('');
            setWatchedOnly(false);
            setOwnershipFilter([]);
            setProjectLifecycleFilter('active');
            setExactProjectFilterId(projectId);
            localStorage.removeItem('dha_project_filter_payload');
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
        if (watchedOnly) {
            params.set('watchedOnly', '1');
        }
        if (ownershipFilter.length > 0) {
            params.set('ownership', ownershipFilter.join(','));
        }
        params.set('lifecycle', projectLifecycleFilter);
        return params;
    }, [exactProjectFilterId, goalFilter, selectedTags, selectedStatuses, searchTerm, watchedOnly, ownershipFilter, projectLifecycleFilter, goals]);

    // Fetch filtered projects from server when filters change
    useEffect(() => {
        if (!hasActiveFilters) {
            setFilteredServerProjects(null);
            setFilteredPagination(null);
            setFilterError('');
            return;
        }

        let cancelled = false;

        async function fetchFiltered() {
            setFilterLoading(true);
            if (!cancelled) setFilterError('');
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
                if (!cancelled) {
                    setFilteredServerProjects(null);
                    setFilteredPagination(null);
                    setFilterError('Unable to load filtered projects. Showing the current list instead.');
                }
            } finally {
                if (!cancelled) setFilterLoading(false);
            }
        }

        fetchFiltered();
        return () => { cancelled = true; };
    }, [exactProjectFilterId, goalFilter, selectedTags, selectedStatuses, searchTerm, watchedOnly, ownershipFilter, projectLifecycleFilter, goals, authFetch, buildFilterParams, hasActiveFilters]);

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
    const displayProjects = hasActiveFilters ? (filteredServerProjects ?? projects) : projects;
    const needsOrganizationAssignment = !isAdminUser && currentUser && !currentUser.orgId;

    const getEmptyStateConfig = () => {
        if (!hasActiveFilters && needsOrganizationAssignment) {
            return {
                title: 'Organization Assignment Needed',
                message: 'Your user account is not assigned to an organization. Projects are scoped by organization ownership and sharing, so ask an admin to assign you to an organization first.'
            };
        }
        if (!hasActiveFilters && projectsError) {
            return {
                title: 'Unable to Load Projects',
                message: projectsError
            };
        }
        if (ownershipFilter.length === 1 && ownershipFilter[0] === 'owner') {
            return {
                title: 'No projects found',
                message: 'No owned projects found for your organization.'
            };
        }
        if (ownershipFilter.length === 1 && ownershipFilter[0] === 'shared') {
            return {
                title: 'No projects found',
                message: 'No shared projects found for your organization.'
            };
        }
        if (projectLifecycleFilter === 'archived') {
            return {
                title: 'No archived projects found',
                message: 'There are no archived projects available for the current filters.'
            };
        }
        if (hasActiveFilters) {
            return {
                title: 'No projects found',
                message: 'No projects match the current filters.'
            };
        }
        if (goalFilter) {
            return {
                title: 'No projects found',
                message: 'No projects found for this goal.'
            };
        }
        return {
            title: 'No projects found',
            message: 'No projects found.'
        };
    };

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

    const handleToggleWatch = useCallback(async (event, project) => {
        event.preventDefault();
        event.stopPropagation();

        const normalizedId = String(project.id);
        const currentlyWatched = !!project.isWatched;
        try {
            if (currentlyWatched) {
                await unwatchProject(normalizedId);
                if (watchedOnly) {
                    setFilteredServerProjects((prev) => (prev || []).filter((item) => String(item.id) !== normalizedId));
                    setFilteredPagination((prev) => (
                        prev ? { ...prev, total: Math.max(0, (prev.total || 0) - 1) } : prev
                    ));
                } else {
                    setFilteredServerProjects((prev) => prev ? prev.map((item) => (
                        String(item.id) === normalizedId ? { ...item, isWatched: false } : item
                    )) : prev);
                }
                return;
            }

            await watchProject(normalizedId);
            setFilteredServerProjects((prev) => prev ? prev.map((item) => (
                String(item.id) === normalizedId ? { ...item, isWatched: true } : item
            )) : prev);
        } catch (error) {
            console.error('Failed to update watchlist status:', error);
        }
    }, [watchProject, unwatchProject, watchedOnly]);

    const handleFilterChange = (newGoalId) => {
        if (exactProjectFilterId) {
            setExactProjectFilterId('');
            localStorage.removeItem('dha_project_filter_id');
            localStorage.removeItem('dha_project_filter_payload');
        }
        setGoalFilter(newGoalId);
        if (!newGoalId && onClearFilter) onClearFilter();
    };

    // Show loading state if we have a selected ID but no project found yet (likely initial load)
    if (selectedProjectId && !selectedProject) {
        if (loading || isLoadingDetails) {
            return (
                <div className="flex justify-center items-center h-full">
                    <div
                        className="animate-spin rounded-full h-8 w-8 border-b-2"
                        style={{ borderBottomColor: 'var(--accent-primary)' }}
                    ></div>
                    <span className="ml-2 text-gray-500">Restoring project...</span>
                </div>
            );
        }
    }

    if (selectedProject) {
        if (isLoadingDetails) {
            return (
                <div className="flex justify-center items-center h-64">
                    <div
                        className="animate-spin rounded-full h-8 w-8 border-b-2"
                        style={{ borderBottomColor: 'var(--accent-primary)' }}
                    ></div>
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
                    {canCreateProject && (
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
                watchedOnly={watchedOnly}
                onWatchedOnlyChange={setWatchedOnly}
                extraOptionGroups={[
                    {
                        label: 'Project Ownership',
                        options: [
                            { id: 'owner', label: 'Owned Projects' },
                            { id: 'shared', label: 'Shared Projects' }
                        ],
                        selectedValues: ownershipFilter,
                        onChange: setOwnershipFilter
                    }
                ]}
                countLabel={hasActiveFilters
                    ? `${displayProjects.length} of ${filteredPagination?.total || displayProjects.length} project(s)`
                    : `${displayProjects.length} project(s)`
                }
            >
                <div className="project-lifecycle-toggle" style={{ display: 'inline-flex', gap: '0.35rem' }}>
                    {[
                        { id: 'active', label: 'Active' },
                        { id: 'archived', label: 'Archived' },
                        { id: 'all', label: 'All' }
                    ].map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            className={`btn-secondary btn-sm ${projectLifecycleFilter === option.id ? 'active' : ''}`}
                            onClick={() => setProjectLifecycleFilter(option.id)}
                            title={`Show ${option.label.toLowerCase()} projects`}
                        >
                            <Archive size={14} />
                            {option.label}
                        </button>
                    ))}
                </div>
                {exactProjectFilterId && (
                    <button
                        className="btn-secondary btn-sm shared-clear-btn"
                        onClick={() => {
                            setExactProjectFilterId('');
                            localStorage.removeItem('dha_project_filter_id');
                            localStorage.removeItem('dha_project_filter_payload');
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

            {filterError && !filterLoading && (
                <div className="filter-loading-indicator" style={{ textAlign: 'center', padding: '0 1rem 1rem', color: 'var(--warning)' }}>
                    {filterError}
                </div>
            )}

            {displayProjects.length === 0 && !filterLoading ? (
                <EmptyState
                    title={getEmptyStateConfig().title}
                    message={getEmptyStateConfig().message}
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
                                            <div className="project-cell-title-row">
                                                <button
                                                    type="button"
                                                    className={`project-watch-btn ${project.isWatched ? 'active' : ''}`}
                                                    onClick={(event) => handleToggleWatch(event, project)}
                                                    title={project.isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                                                    aria-label={project.isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                                                >
                                                    <Star size={15} fill={project.isWatched ? 'currentColor' : 'none'} />
                                                </button>
                                                <span className="project-cell-title">{project.title}</span>
                                                {project.lifecycleState === 'archived' && (
                                                    <span className="project-goal-chip project-goal-chip-more">Archived</span>
                                                )}
                                            </div>
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
                                <div className="project-card-header-actions">
                                    <button
                                        type="button"
                                        className={`project-watch-btn ${project.isWatched ? 'active' : ''}`}
                                        onClick={(event) => handleToggleWatch(event, project)}
                                        title={project.isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                                        aria-label={project.isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                                    >
                                        <Star size={16} fill={project.isWatched ? 'currentColor' : 'none'} />
                                    </button>
                                    <span className="project-task-count">
                                        {project.taskCount || project.tasks?.length || 0} Tasks
                                    </span>
                                </div>
                            </div>

                            <h3 className="project-title">{project.title}</h3>
                            {project.lifecycleState === 'archived' && (
                                <div style={{ marginBottom: '0.5rem' }}>
                                    <span className="project-goal-chip project-goal-chip-more">Archived</span>
                                </div>
                            )}
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

