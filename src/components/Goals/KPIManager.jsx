import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useToast } from '../../context/ToastContext';
import { Plus, Trash2, TrendingUp } from 'lucide-react';
import './KPI.css';

export function KPIManager({ goalId, kpis = [] }) {
    const { addKpi, updateKpi, deleteKpi } = useData();
    const { success } = useToast();
    const [showAddForm, setShowAddForm] = useState(false);
    const [newKpi, setNewKpi] = useState({ name: '', target: '', current: '', unit: '' });

    const handleAddKpi = (e) => {
        e.preventDefault();
        if (!newKpi.name || !newKpi.target) return;
        addKpi(goalId, {
            name: newKpi.name,
            target: parseFloat(newKpi.target),
            current: parseFloat(newKpi.current) || 0,
            unit: newKpi.unit
        });
        success('KPI added successfully');
        setNewKpi({ name: '', target: '', current: '', unit: '' });
        setShowAddForm(false);
    };

    const handleUpdateCurrent = (kpiId, value) => {
        updateKpi(goalId, kpiId, { current: parseFloat(value) || 0 });
    };

    const handleDeleteKpi = (kpiId) => {
        deleteKpi(goalId, kpiId);
        success('KPI removed');
    };


    const calcProgress = (current, target) => {
        if (!target) return 0;
        return Math.min(100, Math.round((current / target) * 100));
    };

    const formatKpiValue = (val, unit) => {
        if (!val && val !== 0) return '-';
        if (unit === '$') return `$${val.toLocaleString()}`;
        if (unit === '%') return `${val.toLocaleString()}%`;
        if (unit) return `${val.toLocaleString()} ${unit}`;
        return val.toLocaleString();
    };

    return (
        <div className="kpi-manager">
            <div className="kpi-header">
                <h4><TrendingUp size={18} /> Key Performance Indicators</h4>
                <button className="icon-btn" onClick={() => setShowAddForm(!showAddForm)}>
                    <Plus size={18} />
                </button>
            </div>

            {showAddForm && (
                <form className="kpi-add-form" onSubmit={handleAddKpi}>
                    <input
                        type="text"
                        placeholder="KPI Name (e.g., Revenue)"
                        value={newKpi.name}
                        onChange={e => setNewKpi({ ...newKpi, name: e.target.value })}
                        className="form-input"
                        required
                    />
                    <div className="kpi-form-row">
                        <input
                            type="number"
                            placeholder="Target"
                            value={newKpi.target}
                            onChange={e => setNewKpi({ ...newKpi, target: e.target.value })}
                            className="form-input"
                            required
                        />
                        <input
                            type="number"
                            placeholder="Current"
                            value={newKpi.current}
                            onChange={e => setNewKpi({ ...newKpi, current: e.target.value })}
                            className="form-input"
                        />
                        <input
                            type="text"
                            placeholder="Unit"
                            value={newKpi.unit}
                            onChange={e => setNewKpi({ ...newKpi, unit: e.target.value })}
                            className="form-input unit-input"
                        />
                    </div>
                    <div className="kpi-form-actions">
                        <button type="button" onClick={() => setShowAddForm(false)} className="btn-secondary">Cancel</button>
                        <button type="submit" className="btn-primary">Add KPI</button>
                    </div>
                </form>
            )}

            {kpis.length === 0 && !showAddForm && (
                <p className="kpi-empty">No KPIs defined. Click + to add metrics.</p>
            )}

            <div className="kpi-list">
                {kpis.map(kpi => {
                    const progress = calcProgress(kpi.current, kpi.target);
                    const isOnTrack = progress >= 50;
                    return (
                        <div key={kpi.id} className="kpi-item">
                            <div className="kpi-item-header">
                                <span className="kpi-name">{kpi.name}</span>
                                <button className="icon-btn danger" onClick={() => handleDeleteKpi(kpi.id)}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <div className="kpi-values">
                                <span className="kpi-unit-prefix">{kpi.unit === '$' ? '$' : ''}</span>
                                <input
                                    type="number"
                                    value={kpi.current}
                                    onChange={e => handleUpdateCurrent(kpi.id, e.target.value)}
                                    className="kpi-current-input"
                                />
                                {kpi.unit && kpi.unit !== '$' && kpi.unit !== '%' && <span className="kpi-unit-suffix">{kpi.unit}</span>}
                                <span className="kpi-separator">/</span>
                                <span className="kpi-target">
                                    {formatKpiValue(kpi.target, kpi.unit)}
                                </span>
                            </div>
                            <div className="kpi-progress-bar">
                                <div
                                    className={`kpi-progress-fill ${isOnTrack ? 'on-track' : 'behind'}`}
                                    style={{ width: `${progress}%` }}
                                ></div>
                            </div>
                            <span className={`kpi-percent ${isOnTrack ? 'on-track' : 'behind'}`}>{progress}%</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
