import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from '../UI/Modal';
import './CalendarView.css';

export function CalendarView({ project, onTaskClick }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const getDaysInMonth = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const days = new Date(year, month + 1, 0).getDate();
        const firstDay = new Date(year, month, 1).getDay(); // 0 = Sunday
        return { days, firstDay };
    };

    const handlePrevMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    };

    const handleToday = () => {
        setCurrentDate(new Date());
    };

    const handleDayClick = (day) => {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
        setSelectedDate(date);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedDate(null);
    };

    const { days, firstDay } = getDaysInMonth(currentDate);
    const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Priority color mapping
    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'high': return '#ef4444';
            case 'medium': return '#f59e0b';
            case 'low': return '#3b82f6';
            default: return '#6b7280';
        }
    };

    // Prepare tasks with visual positioning
    const prepareCalendarTasks = () => {
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        const daysInMonth = days;

        const dayOccupancy = {}; // { day: { slot: boolean } }
        for (let i = 1; i <= daysInMonth; i++) dayOccupancy[i] = {};

        // Sort tasksLogic retained...
        const sortedTasks = [...(project.tasks || [])].filter(t => t.startDate || t.dueDate).sort((a, b) => {
            const startA = new Date(a.startDate || a.dueDate);
            const startB = new Date(b.startDate || b.dueDate);
            if (startA.getTime() !== startB.getTime()) return startA - startB;

            const endA = new Date(a.endDate || a.dueDate || a.startDate);
            const endB = new Date(b.endDate || b.dueDate || b.startDate);
            const durA = endA - startA;
            const durB = endB - startB;
            if (durA !== durB) return durB - durA;

            return a.title.localeCompare(b.title);
        });

        const positionedTasks = [];

        sortedTasks.forEach(task => {
            const dStart = new Date(task.startDate || task.dueDate);
            const dEnd = new Date(task.endDate || task.dueDate || task.startDate);

            const startDate = new Date(dStart.getUTCFullYear(), dStart.getUTCMonth(), dStart.getUTCDate());
            const endDate = new Date(dEnd.getUTCFullYear(), dEnd.getUTCMonth(), dEnd.getUTCDate());

            const monthStart = new Date(currentYear, currentMonth, 1);
            const monthEnd = new Date(currentYear, currentMonth + 1, 0);

            if (endDate < monthStart || startDate > monthEnd) return;

            const firstVisibleDay = Math.max(1, Math.ceil((startDate - monthStart) / (1000 * 60 * 60 * 24)) + 1);
            const lastVisibleDay = Math.min(daysInMonth, Math.ceil((endDate - monthStart) / (1000 * 60 * 60 * 24)) + 1);

            let slot = 0;
            while (true) {
                let overlap = false;
                for (let d = firstVisibleDay; d <= lastVisibleDay; d++) {
                    if (dayOccupancy[d] && dayOccupancy[d][slot]) {
                        overlap = true;
                        break;
                    }
                }
                if (!overlap) break;
                slot++;
            }

            for (let d = firstVisibleDay; d <= lastVisibleDay; d++) {
                if (dayOccupancy[d]) dayOccupancy[d][slot] = true;
            }

            positionedTasks.push({
                task,
                slot,
                startDay: new Date(startDate).getDate(),
                isStartThisMonth: startDate.getMonth() === currentMonth && startDate.getFullYear() === currentYear,
                startDayIndex: firstVisibleDay,
                spanDays: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1
            });
        });

        return { positionedTasks, dayOccupancy };
    };

    const { positionedTasks, dayOccupancy } = prepareCalendarTasks();

    // Get tasks for the selected date for the modal
    const getTasksForSelectedDate = () => {
        if (!selectedDate) return [];
        const targetDay = selectedDate.getDate();

        // Find all tasks that overlap with the selected date
        // Logic similar to positionedTasks but simplified for just checking overlap
        return (project.tasks || []).filter(task => {
            const dStart = new Date(task.startDate || task.dueDate);
            const dEnd = new Date(task.endDate || task.dueDate || task.startDate);

            // Normalize to local midnight matching UTC logic used above
            const startDate = new Date(dStart.getUTCFullYear(), dStart.getUTCMonth(), dStart.getUTCDate());
            const endDate = new Date(dEnd.getUTCFullYear(), dEnd.getUTCMonth(), dEnd.getUTCDate());

            // Check overlap with selectedDate (normalized)
            const checkDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), targetDay);

            return startDate <= checkDate && endDate >= checkDate;
        }).sort((a, b) => {
            // Sort by priority then title
            const prioOrder = { high: 0, medium: 1, low: 2, undefined: 3 };
            const pa = prioOrder[a.priority] ?? 3;
            const pb = prioOrder[b.priority] ?? 3;
            if (pa !== pb) return pa - pb;
            return a.title.localeCompare(b.title);
        });
    };

    const overflowLimit = 3; // Max visible items (tasks) before showing "+X more"

    return (
        <div className="calendar-view">
            <div className="calendar-header">
                <div className="calendar-nav">
                    <button className="nav-btn" onClick={handlePrevMonth}>
                        <ChevronLeft size={20} />
                    </button>
                    <h3 className="current-month">{monthName}</h3>
                    <button className="nav-btn" onClick={handleNextMonth}>
                        <ChevronRight size={20} />
                    </button>
                    <button className="today-btn" onClick={handleToday}>Today</button>
                </div>
            </div>

            <div className="calendar-grid">
                {/* Day Headers */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="calendar-day-header">{day}</div>
                ))}

                {/* Empty cells before month start */}
                {Array.from({ length: firstDay }).map((_, index) => (
                    <div key={`empty-${index}`} className="calendar-day empty"></div>
                ))}

                {/* Days of the month */}
                {Array.from({ length: days }).map((_, index) => {
                    const day = index + 1;
                    const isToday =
                        new Date().toDateString() ===
                        new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toDateString();

                    // Tasks starting on this day (for rendering logic)
                    const tasksStartingHere = positionedTasks.filter(pt => pt.isStartThisMonth && pt.startDayIndex === day);

                    // Determine max slot index for this day
                    const occupiedSlots = dayOccupancy[day] ? Object.keys(dayOccupancy[day]).map(Number) : [];
                    const maxSlot = occupiedSlots.length > 0 ? Math.max(...occupiedSlots) : -1;

                    // Check if we need to overflow
                    // If maxSlot (0-indexed) is >= 4, it means we have at least 5 items occupying slots 0-4
                    // We show items in slots 0, 1, 2, 3. At slot 4, we show "+X more".
                    const hasOverflow = maxSlot >= overflowLimit;
                    const renderLimit = hasOverflow ? overflowLimit : maxSlot + 1;

                    return (
                        <div
                            key={day}
                            className={`calendar-day ${isToday ? 'today' : ''}`}
                            style={{ zIndex: days - index }}
                        >
                            <span className="day-number">{day}</span>
                            <div className="day-tasks-container">
                                {Array.from({ length: renderLimit + (hasOverflow ? 1 : 0) }).map((_, loopIndex) => {
                                    const slotIndex = loopIndex;

                                    // Render Overflow Button at the last position if overflow exists
                                    if (hasOverflow && slotIndex === overflowLimit) {
                                        // Count total distinct tasks occupying this day
                                        // This is tricky because we track slots, not task count directly per day efficiently in standard logic
                                        // But `occupiedSlots.length` gives the count of occupied slots for this day.
                                        const totalCount = occupiedSlots.length;
                                        const hiddenCount = totalCount - overflowLimit;

                                        return (
                                            <div key={`more-${day}`} className="task-slot-wrapper">
                                                <div
                                                    className="calendar-more-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDayClick(day);
                                                    }}
                                                >
                                                    +{hiddenCount} more
                                                </div>
                                            </div>
                                        );
                                    }

                                    const taskHere = tasksStartingHere.find(pt => pt.slot === slotIndex);

                                    if (taskHere) {
                                        const { task, spanDays } = taskHere;
                                        const dayOfWeek = (firstDay + day - 1) % 7;
                                        const daysUntilWeekEnd = 7 - dayOfWeek;
                                        const visibleSpan = Math.min(spanDays, daysUntilWeekEnd);

                                        return (
                                            <div key={`task-wrapper-${task.id}`} className="task-slot-wrapper">
                                                <div
                                                    className={`spanning-task ${task.status === 'done' ? 'completed' : ''}`}
                                                    style={{
                                                        width: `calc(${visibleSpan * 100}% + ${(visibleSpan - 1) * 1}px)`,
                                                        backgroundColor: getPriorityColor(task.priority),
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onTaskClick(task);
                                                    }}
                                                    title={`${task.title} (${task.status})`}
                                                >
                                                    <span className="task-title">{task.title}</span>
                                                </div>
                                            </div>
                                        );
                                    } else if (dayOccupancy[day] && dayOccupancy[day][slotIndex]) {
                                        // Slot occupied by spanning task from previous day -> Spacer
                                        return <div key={`spacer-${slotIndex}`} className="calendar-spacer"></div>;
                                    } else {
                                        // Empty slot filler
                                        return <div key={`empty-${slotIndex}`} className="calendar-spacer"></div>;
                                    }
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Day View Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                title={`Tasks for ${selectedDate?.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                size="large" // Ensure we have enough width
            >
                <div className="day-modal-tasks">
                    {getTasksForSelectedDate().length > 0 ? (
                        getTasksForSelectedDate().map(task => (
                            <div
                                key={task.id}
                                className="modal-task-item"

                                onClick={() => {
                                    handleCloseModal();
                                    onTaskClick(task);
                                }}
                            >
                                <div className="modal-task-priority" style={{ backgroundColor: getPriorityColor(task.priority) }}></div>
                                <div className="modal-task-content">
                                    <div className="modal-task-title">{task.title}</div>
                                    <div className="modal-task-status badge" data-status={task.status}>{task.status}</div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="no-tasks-message">No tasks for this day.</div>
                    )}
                </div>
            </Modal>
        </div>
    );
}
