import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { KanbanBoard } from './KanbanBoard';
import { Plus, Folder, Target } from 'lucide-react';
import { Modal } from '../UI/Modal';
import { AddProjectForm } from './AddProjectForm';
import { CascadingGoalFilter, getDescendantGoalIds } from '../UI/CascadingGoalFilter';
import { ProjectTagBadges } from '../UI/ProjectTagSelector';
import './KanbanView.css';

import { useAuth } from '../../hooks/useAuth';

export default function KanbanView({ initialGoalFilter, onClearFilter }) {
    const { projects, goals, loadProjectDetails, loading } = useData();
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
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);

    // Sync with external filter changes
    useEffect(() => {
        if (initialGoalFilter) {
            setGoalFilter(initialGoalFilter);
        }
    }, [initialGoalFilter]);

    // Load full details when a project is selected
    useEffect(() => {
        if (selectedProjectId) {
            // Use loose equality to handle string/number mismatch
            const project = projects.find(p => p.id == selectedProjectId);
            // Only load if not already loaded (check for a flag or missing tasks)
            if (project && !project._detailsLoaded) {
                setIsLoadingDetails(true);
                loadProjectDetails(selectedProjectId).finally(() => {
                    setIsLoadingDetails(false);
                });
            }
        }
    }, [selectedProjectId, projects, loadProjectDetails]);

    // Use loose equality
    const selectedProject = projects.find(p => p.id == selectedProjectId);

    // Filter projects by selected goal AND its descendants
    const filteredProjects = goalFilter
        ? projects.filter(p => {
            if (p.goalId === goalFilter) return true;
            // Also include projects from descendant goals
            const descendantIds = getDescendantGoalIds(goals, goalFilter);
            return descendantIds.includes(p.goalId);
        })
        : projects;

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
            <div className="view-header">
                <div>
                    <h2>Projects</h2>
                    <p className="view-subtitle">Manage tasks across your initiatives.</p>
                </div>
                {canEdit && (
                    <button className="btn-primary" onClick={() => setShowProjectModal(true)}>
                        <Plus size={18} />
                        New Project
                    </button>
                )}
            </div>

            {/* Cascading Goal Filter */}
            <div className="filter-bar">
                <CascadingGoalFilter value={goalFilter} onChange={handleFilterChange} />
                <span className="filter-count">{filteredProjects.length} project(s)</span>
            </div>

            <div className="projects-grid">
                {filteredProjects.length === 0 ? (
                    <div className="empty-state glass">
                        <p>No projects found{goalFilter ? ' for this goal' : ''}.</p>
                    </div>
                ) : (
                    filteredProjects.map(project => (
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
                                        style={{ width: `${project.completion}%` }}
                                    ></div>
                                </div>
                                <span className="progress-label">{project.completion}% Complete</span>
                            </div>
                        </div>
                    ))
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

