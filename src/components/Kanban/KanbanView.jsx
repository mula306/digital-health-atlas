import { useState, useEffect, useCallback } from 'react';
import { useData } from '../../context/DataContext';
import { KanbanBoard } from './KanbanBoard';
import { Plus, Folder, Target, Search, X } from 'lucide-react';
import { Modal } from '../UI/Modal';
import { AddProjectForm } from './AddProjectForm';
import { getDescendantGoalIds } from '../../utils/goalHelpers';
import { FilterBar } from '../UI/FilterBar';
import { ProjectTagBadges } from '../UI/ProjectTagSelector';
import './KanbanView.css';

import { useAuth } from '../../hooks/useAuth';

import { EmptyState } from '../UI/EmptyState';
import { API_BASE } from '../../apiClient';

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
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);

    // Server-side filtered projects state
    const [filteredServerProjects, setFilteredServerProjects] = useState(null);
    const [filteredPagination, setFilteredPagination] = useState(null);
    const [filterLoading, setFilterLoading] = useState(false);
    const [filteredLoadingMore, setFilteredLoadingMore] = useState(false);

    const hasActiveFilters = !!(goalFilter || selectedTags.length > 0 || searchTerm.trim());

    // Sync with external filter changes
    useEffect(() => {
        if (initialGoalFilter) {
            setGoalFilter(initialGoalFilter);
        }
    }, [initialGoalFilter]);

    // Build filter query params (shared by initial fetch and load-more)
    const buildFilterParams = useCallback((page = 1) => {
        const params = new URLSearchParams({ page: String(page), limit: '100' });
        if (goalFilter) {
            const descendantIds = getDescendantGoalIds(goals, goalFilter);
            const allGoalIds = [String(goalFilter), ...descendantIds.map(String)];
            params.set('goalIds', allGoalIds.join(','));
        }
        if (selectedTags.length > 0) {
            params.set('tagIds', selectedTags.join(','));
        }
        if (searchTerm.trim()) {
            params.set('search', searchTerm.trim());
        }
        return params;
    }, [goalFilter, selectedTags, searchTerm, goals]);

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
    }, [goalFilter, selectedTags, searchTerm, goals, authFetch, buildFilterParams, hasActiveFilters]);

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
        if (selectedProjectId) {
            const project = projects.find(p => p.id == selectedProjectId);
            if (project && !project._detailsLoaded) {
                setIsLoadingDetails(true);
                loadProjectDetails(selectedProjectId).finally(() => {
                    setIsLoadingDetails(false);
                });
            }
        }
    }, [selectedProjectId, projects, loadProjectDetails]);

    const selectedProject = projects.find(p => p.id == selectedProjectId);

    // Use server-filtered projects when filters are active, otherwise global paginated projects
    const displayProjects = hasActiveFilters ? (filteredServerProjects || []) : projects;

    // Get goal title by ID
    const getGoalTitle = (goalId) => {
        const goal = goals.find(g => g.id === goalId);
        return goal ? goal.title : 'Unlinked';
    };

    const handleFilterChange = (newGoalId) => {
        setGoalFilter(newGoalId);
        if (!newGoalId && onClearFilter) onClearFilter();
    };

    // Show loading state if we have a selected ID but no project found yet (likely initial load)
    if (selectedProjectId && !selectedProject) {
        if (loading) {
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
                goalTitle={getGoalTitle(selectedProject.goalId)}
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
                countLabel={hasActiveFilters
                    ? `${displayProjects.length} of ${filteredPagination?.total || displayProjects.length} project(s)`
                    : `${displayProjects.length} project(s)`
                }
            >
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

            <div className="projects-grid">
                {displayProjects.length === 0 && !filterLoading ? (
                    <EmptyState
                        title="No projects found"
                        message={`No projects found${goalFilter ? ' for this goal' : ''}.`}
                    />
                ) : (
                    displayProjects.map(project => (
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

                            <div className="project-goal-link">
                                <Target size={14} />
                                <span>{getGoalTitle(project.goalId)}</span>
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
                    ))
                )}
            </div>

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

