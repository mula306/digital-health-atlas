import { useState, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useData } from '../../context/DataContext';
import './Gantt.css';

const STATUS_COLORS = {
    'todo': '#6b7280',
    'in-progress': '#3b82f6',
    'review': '#8b5cf6',
    'done': '#059669'
};

const PRIORITY_COLORS = {
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#6b7280'
};

const VIEW_PERIODS = {
    week: { label: 'Week', days: 7, showDays: true },
    month: { label: 'Month', days: 28, showDays: true },
    quarter: { label: 'Quarter', days: 91, showDays: false },
    year: { label: 'Year', days: 365, showDays: false }
};

export function GanttView({ project, onTaskClick }) {
    const { moveTask } = useData();
    const [periodOffset, setPeriodOffset] = useState(0);
    const [viewPeriod, setViewPeriod] = useState('month');

    const periodConfig = VIEW_PERIODS[viewPeriod];
    const periodDays = periodConfig.days;
    const showDays = periodConfig.showDays;

    // Get date range for the view
    const dateRange = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        startOfWeek.setDate(startOfWeek.getDate() + (periodOffset * periodDays));

        const days = [];
        for (let i = 0; i < periodDays; i++) {
            const date = new Date(startOfWeek);
            date.setDate(startOfWeek.getDate() + i);
            days.push(date);
        }
        return days;
    }, [periodOffset, periodDays]);

    const rangeStart = dateRange[0];
    const rangeEnd = dateRange[dateRange.length - 1];

    // Group days by week for week/month views
    const weeks = useMemo(() => {
        if (!showDays) return [];
        const grouped = [];
        for (let i = 0; i < dateRange.length; i += 7) {
            grouped.push(dateRange.slice(i, Math.min(i + 7, dateRange.length)));
        }
        return grouped;
    }, [dateRange, showDays]);

    // Group days by month for quarter/year views
    const months = useMemo(() => {
        if (showDays) return [];
        const grouped = [];
        let currentMonth = null;
        let currentGroup = [];

        dateRange.forEach(date => {
            const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
            if (monthKey !== currentMonth) {
                if (currentGroup.length > 0) {
                    grouped.push(currentGroup);
                }
                currentMonth = monthKey;
                currentGroup = [date];
            } else {
                currentGroup.push(date);
            }
        });
        if (currentGroup.length > 0) {
            grouped.push(currentGroup);
        }
        return grouped;
    }, [dateRange, showDays]);

    const formatDay = (date) => date.getDate();
    const formatDayName = (date) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][date.getDay()];
    const formatMonth = (date) => date.toLocaleDateString('en-US', { month: 'short' });
    const formatMonthYear = (date) => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    const isToday = (date) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const compareDate = new Date(date);
        compareDate.setHours(0, 0, 0, 0);
        return compareDate.getTime() === today.getTime();
    };

    const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

    const normalizeDate = (date) => {
        const d = new Date(date);
        // FORCE the local date object to match the UTC date components
        // e.g. 2026-02-04 UTC -> 2026-02-04 Local representation
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    };

    const getTaskStartDate = (task) => {
        if (task.startDate) return normalizeDate(task.startDate);
        if (task.dueDate) return normalizeDate(task.dueDate);
        return null;
    };

    const getTaskEndDate = (task) => {
        if (task.endDate) return normalizeDate(task.endDate);
        if (task.dueDate) return normalizeDate(task.dueDate);
        return null;
    };

    const hasTaskDates = (task) => {
        return task.startDate || task.endDate || task.dueDate;
    };

    const isTaskVisible = (task) => {
        const startDate = getTaskStartDate(task);
        const endDate = getTaskEndDate(task);
        if (!startDate && !endDate) return false;
        const taskStart = startDate || endDate;
        const taskEnd = endDate || startDate;
        return taskEnd >= rangeStart && taskStart <= rangeEnd;
    };

    const getTaskBar = (task) => {
        const startDate = getTaskStartDate(task);
        const endDate = getTaskEndDate(task);
        if (!startDate && !endDate) return null;

        const taskStart = startDate || endDate;
        const taskEnd = endDate || startDate;

        if (taskEnd < rangeStart || taskStart > rangeEnd) return null;

        const visibleStart = taskStart < rangeStart ? rangeStart : taskStart;
        const visibleEnd = taskEnd > rangeEnd ? rangeEnd : taskEnd;

        // Calculate position based on days from start
        const totalDays = (rangeEnd - rangeStart) / (1000 * 60 * 60 * 24) + 1;
        const startDays = (visibleStart - rangeStart) / (1000 * 60 * 60 * 24);
        const durationDays = (visibleEnd - visibleStart) / (1000 * 60 * 60 * 24) + 1;

        const left = (startDays / totalDays) * 100;
        const width = (durationDays / totalDays) * 100;

        return {
            left: `${left}%`,
            width: `${Math.max(width, 1)}%`,
            overflowLeft: taskStart < rangeStart,
            overflowRight: taskEnd > rangeEnd
        };
    };

    const sortedTasks = useMemo(() => {
        const normalize = (date) => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            return d;
        };
        const getStart = (task) => {
            if (task.startDate) return normalize(task.startDate);
            if (task.dueDate) return normalize(task.dueDate);
            return null;
        };
        const getEnd = (task) => {
            if (task.endDate) return normalize(task.endDate);
            if (task.dueDate) return normalize(task.dueDate);
            return null;
        };
        return [...(project.tasks || [])].sort((a, b) => {
            const aDate = getStart(a) || getEnd(a);
            const bDate = getStart(b) || getEnd(b);
            if (!aDate && !bDate) return 0;
            if (!aDate) return 1;
            if (!bDate) return -1;
            return aDate - bDate;
        });
    }, [project.tasks]);

    // Memoize task filtering with proper dependencies
    const { visibleTasks, tasksWithDatesButNotVisible, tasksWithoutDates } = useMemo(() => {
        const hasDates = (task) => task.startDate || task.endDate || task.dueDate;
        const isVisible = (task) => {
            const startDate = getTaskStartDate(task);
            const endDate = getTaskEndDate(task);
            if (!startDate && !endDate) return false;
            const taskStart = startDate || endDate;
            const taskEnd = endDate || startDate;
            return taskEnd >= rangeStart && taskStart <= rangeEnd;
        };

        return {
            visibleTasks: sortedTasks.filter(t => hasDates(t) && isVisible(t)),
            tasksWithDatesButNotVisible: sortedTasks.filter(t => hasDates(t) && !isVisible(t)),
            tasksWithoutDates: sortedTasks.filter(t => !hasDates(t))
        };
    }, [sortedTasks, rangeStart, rangeEnd]);

    const handlePeriodChange = (newPeriod) => {
        setViewPeriod(newPeriod);
        setPeriodOffset(0);
    };

    // Render grid cells based on view type
    const renderGridCells = () => {
        if (showDays) {
            return dateRange.map((day, idx) => (
                <div
                    key={idx}
                    className={`gantt-cell ${isToday(day) ? 'today' : ''} ${isWeekend(day) ? 'weekend' : ''}`}
                />
            ));
        } else {
            // For quarter/year, use month-based cells
            return months.map((monthDays, idx) => (
                <div
                    key={idx}
                    className="gantt-cell gantt-month-cell"
                    style={{ flex: monthDays.length }}
                />
            ));
        }
    };

    return (
        <div className="gantt-container">
            {/* Timeline Navigation */}
            <div className="gantt-nav">
                <div className="gantt-nav-left">
                    <button className="gantt-nav-btn" onClick={() => setPeriodOffset(o => o - 1)}>
                        <ChevronLeft size={18} />
                    </button>
                    <button className="gantt-nav-btn today-btn" onClick={() => setPeriodOffset(0)}>
                        <Calendar size={16} />
                        Today
                    </button>
                    <button className="gantt-nav-btn" onClick={() => setPeriodOffset(o => o + 1)}>
                        <ChevronRight size={18} />
                    </button>
                </div>

                {/* View Period Selector */}
                <div className="gantt-period-selector">
                    {Object.entries(VIEW_PERIODS).map(([key, { label }]) => (
                        <button
                            key={key}
                            className={`gantt-period-btn ${viewPeriod === key ? 'active' : ''}`}
                            onClick={() => handlePeriodChange(key)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="gantt-chart">
                {/* Header */}
                <div className="gantt-header">
                    <div className="gantt-task-label">Task</div>
                    <div className="gantt-timeline-header">
                        {showDays ? (
                            // Week/Month view: show individual days
                            weeks.map((week, weekIdx) => (
                                <div key={weekIdx} className="gantt-week" style={{ flex: week.length }}>
                                    <div className="gantt-week-label">
                                        {formatMonth(week[0])} {formatDay(week[0])} - {formatDay(week[week.length - 1])}
                                    </div>
                                    <div className="gantt-days">
                                        {week.map((day, dayIdx) => (
                                            <div
                                                key={dayIdx}
                                                className={`gantt-day-header ${isToday(day) ? 'today' : ''} ${isWeekend(day) ? 'weekend' : ''}`}
                                            >
                                                <span className="day-name">{formatDayName(day)}</span>
                                                <span className="day-num">{formatDay(day)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        ) : (
                            // Quarter/Year view: show months only
                            months.map((monthDays, monthIdx) => (
                                <div key={monthIdx} className="gantt-month" style={{ flex: monthDays.length }}>
                                    <div className="gantt-month-label">
                                        {formatMonthYear(monthDays[0])}
                                    </div>
                                    <div className="gantt-month-days-count">
                                        {monthDays.length} days
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Tasks */}
                <div className="gantt-body">
                    {visibleTasks.map(task => {
                        const bar = getTaskBar(task);
                        return (
                            <div key={task.id} className="gantt-row" onClick={() => onTaskClick(task)}>
                                <div className="gantt-task-info">
                                    <span
                                        className="gantt-priority-dot"
                                        style={{ background: PRIORITY_COLORS[task.priority] }}
                                    />
                                    <span className="gantt-task-title">{task.title}</span>
                                    <span className="gantt-task-status" style={{ color: STATUS_COLORS[task.status] }}>
                                        {(task.status || 'todo').replace('-', ' ')}
                                    </span>
                                </div>
                                <div className="gantt-timeline">
                                    {renderGridCells()}
                                    {bar && (
                                        <div
                                            className={`gantt-bar ${task.status} ${bar.overflowLeft ? 'overflow-left' : ''} ${bar.overflowRight ? 'overflow-right' : ''}`}
                                            style={{
                                                left: bar.left,
                                                width: bar.width,
                                                background: STATUS_COLORS[task.status]
                                            }}
                                        >
                                            <span className="gantt-bar-label">{task.title}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Tasks outside visible range */}
                    {tasksWithDatesButNotVisible.length > 0 && (
                        <>
                            <div className="gantt-section-divider">Outside View Range</div>
                            {tasksWithDatesButNotVisible.map(task => (
                                <div key={task.id} className="gantt-row out-of-range" onClick={() => onTaskClick(task)}>
                                    <div className="gantt-task-info">
                                        <span
                                            className="gantt-priority-dot"
                                            style={{ background: PRIORITY_COLORS[task.priority] }}
                                        />
                                        <span className="gantt-task-title">{task.title}</span>
                                        <span className="gantt-task-status" style={{ color: STATUS_COLORS[task.status] }}>
                                            {(task.status || 'todo').replace('-', ' ')}
                                        </span>
                                    </div>
                                    <div className="gantt-timeline empty">
                                        <span className="no-date-label">
                                            {getTaskStartDate(task)?.toLocaleDateString()} - {getTaskEndDate(task)?.toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}

                    {/* Tasks without dates */}
                    {tasksWithoutDates.length > 0 && (
                        <>
                            <div className="gantt-section-divider">No Dates Set</div>
                            {tasksWithoutDates.map(task => (
                                <div key={task.id} className="gantt-row no-date" onClick={() => onTaskClick(task)}>
                                    <div className="gantt-task-info">
                                        <span
                                            className="gantt-priority-dot"
                                            style={{ background: PRIORITY_COLORS[task.priority] }}
                                        />
                                        <span className="gantt-task-title">{task.title}</span>
                                        <span className="gantt-task-status" style={{ color: STATUS_COLORS[task.status] }}>
                                            {(task.status || 'todo').replace('-', ' ')}
                                        </span>
                                    </div>
                                    <div className="gantt-timeline empty">
                                        <span className="no-date-label">Set start/end dates to show on timeline</span>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}

                    {project.tasks.length === 0 && (
                        <div className="gantt-empty">
                            <Calendar size={48} />
                            <p>No tasks yet. Add tasks to see them on the timeline.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
