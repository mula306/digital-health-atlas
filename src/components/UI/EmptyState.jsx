import { TrendingUp } from 'lucide-react';
import './EmptyState.css';

export function EmptyState({
    title = 'No data found',
    message = 'No items match your criteria.',
    icon: Icon = TrendingUp,
    action
}) {
    return (
        <div className="empty-state-container">
            <Icon size={48} className="empty-state-icon" />
            <h3 className="empty-state-title">{title}</h3>
            <p className="empty-state-message">{message}</p>
            {action && <div className="empty-state-action">{action}</div>}
        </div>
    );
}
