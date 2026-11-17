import { useState, useEffect, useRef } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { PinAssignment } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Trash2,
    Activity,
    GripVertical,
    ChevronDown,
    ChevronRight,
    Zap,
    Settings,
    Plus,
    ChevronsDown,
    ChevronsUp
} from 'lucide-react';
import { ApiClient } from '@/lib/api';
import { CalibrationModal } from './CalibrationModal'; // Keep imports as they were

// Mock CalibrationModal if not exported (it is imported in original)
// Assuming it exists relative to this file.

interface SensorListProps {
    assignments: PinAssignment[];
    onUpdate: () => void;
}

// --- Utils ---

function interpolate(
    input: number,
    points: { raw: number; value: number }[],
    inputKey: 'raw' | 'value',
    outputKey: 'raw' | 'value'
): number {
    if (points.length < 2) return input;

    // Sort by input key to find correct segment
    const sorted = [...points].sort((a, b) => a[inputKey] - b[inputKey]);

    // Handle Exact Matches & Boundaries
    if (input <= sorted[0][inputKey]) {
        const p1 = sorted[0];
        const p2 = sorted[1];
        const range = p2[inputKey] - p1[inputKey];
        if (Math.abs(range) < 0.0001) return p1[outputKey];
        const t = (input - p1[inputKey]) / range;
        return p1[outputKey] + t * (p2[outputKey] - p1[outputKey]);
    }

    if (input >= sorted[sorted.length - 1][inputKey]) {
        const p1 = sorted[sorted.length - 2];
        const p2 = sorted[sorted.length - 1];
        const range = p2[inputKey] - p1[inputKey];
        if (Math.abs(range) < 0.0001) return p2[outputKey];
        const t = (input - p1[inputKey]) / range;
        return p1[outputKey] + t * (p2[outputKey] - p1[outputKey]);
    }

    // Find segment
    for (let i = 0; i < sorted.length - 1; i++) {
        const p1 = sorted[i];
        const p2 = sorted[i + 1];
        if (input >= p1[inputKey] && input <= p2[inputKey]) {
            const range = p2[inputKey] - p1[inputKey];
            if (Math.abs(range) < 0.0001) return p1[outputKey];
            const t = (input - p1[inputKey]) / range;
            return p1[outputKey] + t * (p2[outputKey] - p1[outputKey]);
        }
    }

    return input;
}

// --- Internal Components ---

function SimSlider({
    value,
    min,
    max,
    onChange,
    disabled
}: {
    value: number;
    min: number;
    max: number;
    onChange: (val: number) => void;
    disabled?: boolean;
}) {
    const [localValue, setLocalValue] = useState(value);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        if (!isDragging) {
            setLocalValue(value);
        }
    }, [value, isDragging]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalValue(parseFloat(e.target.value));
    };

    const handleCommit = () => {
        setIsDragging(false);
        if (localValue !== value) {
            onChange(localValue);
        }
    };

    return (
        <input
            type="range"
            min={min}
            max={max}
            step={(max - min) / 100 > 1 ? 1 : 0.01}
            disabled={disabled}
            className={`w-full h-2 bg-secondary rounded-lg appearance-none ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            value={localValue}
            // Add title for hover info
            title={`Raw: ${localValue.toFixed(0)}`}
            onMouseDown={() => setIsDragging(true)}
            onTouchStart={() => setIsDragging(true)}
            onChange={handleChange}
            onMouseUp={handleCommit}
            onTouchEnd={handleCommit}
        />
    );
}

function GeneratorPanel({
    assignment,
    onSave
}: {
    assignment: PinAssignment,
    onSave: (config: any) => void
}) {
    const serverConfig = assignment.simConfig || { enabled: false, mode: 'random', min: 0, max: 100 };

    // Local state
    const [enabled, setEnabled] = useState(serverConfig.enabled);
    const [mode, setMode] = useState(serverConfig.mode);
    const [min, setMin] = useState(serverConfig.min);
    const [max, setMax] = useState(serverConfig.max);

    const prevServerConfig = useRef(serverConfig);

    useEffect(() => {
        const prev = prevServerConfig.current;
        const curr = assignment.simConfig || { enabled: false, mode: 'random', min: 0, max: 100 };

        // Only update local state if SERVER value changed significantly to avoid overwriting edits
        if (curr.enabled !== prev.enabled) setEnabled(curr.enabled);
        if (curr.mode !== prev.mode) setMode(curr.mode);
        // Numbers might float slightly, check epsilon if needed, but strict equal fine for now
        if (curr.min !== prev.min) setMin(curr.min);
        if (curr.max !== prev.max) setMax(curr.max);

        prevServerConfig.current = curr;
    }, [assignment.simConfig]);

    const handleSave = () => {
        onSave({ enabled, mode, min, max });
    };

    return (
        <div className="mt-4 border p-3 rounded-md bg-secondary/10 space-y-3">
            <div className="flex justify-between items-center text-xs text-muted-foreground pb-2 border-b border-border/50">
                <span className="font-semibold uppercase tracking-wider flex items-center gap-1">
                    <Zap className="h-3 w-3" /> Signal Generator
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer select-none font-medium hover:text-foreground transition-colors">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={e => setEnabled(e.target.checked)}
                        className="rounded border-gray-300 text-primary shadow-sm"
                    />
                    Enable
                </label>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="col-span-2 space-y-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold">Mode</label>
                    <select
                        className="w-full text-xs p-1.5 rounded border border-input bg-background outline-none"
                        value={mode}
                        onChange={e => setMode(e.target.value)}
                    >
                        <option value="random">Random Noise</option>
                        <option value="wave">Sine Wave</option>
                        <option value="spike">Spike (Random Glitches)</option>
                    </select>
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold">Min Value</label>
                    <input
                        type="number"
                        value={min}
                        onChange={e => setMin(Number(e.target.value))}
                        className="w-full text-xs p-1.5 rounded border border-input bg-background"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] uppercase text-muted-foreground font-semibold">Max Value</label>
                    <input
                        type="number"
                        value={max}
                        onChange={e => setMax(Number(e.target.value))}
                        className="w-full text-xs p-1.5 rounded border border-input bg-background"
                    />
                </div>
            </div>

            <Button
                size="sm"
                variant={enabled ? "default" : "secondary"}
                className="w-full h-8 text-xs mt-2"
                onClick={handleSave}
            >
                {enabled ? 'Update Active Generator' : 'Save Configuration'}
            </Button>
        </div>
    );
}

function SortableSensorCard({
    assignment,
    onValueChange,
    onMultiValueChange,
    onUnassign,
    onUpdate,
    isCollapsed,
    onToggle
}: {
    assignment: PinAssignment;
    onValueChange: (key: string, val: number) => void;
    onMultiValueChange: (index: number, val: number) => void;
    onUnassign: () => void;
    onUpdate: () => void;
    isCollapsed: boolean;
    onToggle: () => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: assignment.pins[0] });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 100 : 'auto',
        opacity: isDragging ? 0.5 : 1
    };

    // Lift specific state settings
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [multiSettingsIndex, setMultiSettingsIndex] = useState<number | null>(null);

    const getPrimaryValue = () => {
        if (assignment.sensorCategory === 'ACTUATOR') {
            const state = assignment.values['state'] ?? 0;
            return state ? 'ON' : 'OFF';
        }

        if (assignment.isParentTemplate && assignment.multiValues) {
            const count = Object.keys(assignment.multiValues).length;
            return `${count} Channels`;
        }

        const keys = Object.keys(assignment.values);
        if (keys.length === 0) return 'No Data';
        const key = keys[0];
        const val = assignment.values[key];
        return `${key}: ${typeof val === 'number' ? val.toFixed(2) : val}`;
    };

    const handleAddChannel = async () => {
        const existingIndices = Object.keys(assignment.multiValues || {}).map(Number);
        const nextIdx = existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 0;
        try {
            await ApiClient.post(`/api/assign/${assignment.pins[0]}/multi-value`, { index: nextIdx, value: 0 });
            await ApiClient.post(`/api/assign/${assignment.pins[0]}/multi-label`, { index: nextIdx, label: `Channel ${nextIdx}` });
            onUpdate();
        } catch (e) {
            console.error(e);
        }
    };

    const handleRemoveChannel = async (index: number) => {
        if (confirm(`Remove channel at index ${index}?`)) {
            try {
                await ApiClient.delete(`/api/assign/${assignment.pins[0]}/multi-value/${index}`);
                onUpdate();
            } catch (e) { console.error(e); }
        }
    };

    const handleSaveGenerator = async (config: any) => {
        try {
            await ApiClient.post(`/api/assign/${assignment.pins[0]}/simulation`, config);
            onUpdate();
        } catch (e) {
            console.error(e);
        }
    };

    const toggleActuator = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (assignment.sensorCategory !== 'ACTUATOR') return;
        const currentState = getPrimaryValue() === 'ON' ? 1 : 0;
        const newState = currentState === 1 ? 0 : 1;
        try {
            await ApiClient.post(`/api/value/${assignment.pins[0]}`, { key: 'state', value: newState });
            if (onUpdate) onUpdate();
        } catch (e) { console.error(e); }
    };

    const isSimulated = assignment.simConfig?.enabled;
    const points = assignment.calibrationPoints || [];
    const hasCalibration = points.length >= 2;

    return (
        <div ref={setNodeRef} style={style} className="mb-4 touch-none">
            <Card className={isCollapsed ? 'bg-muted/40' : ''}>
                <CardHeader className="p-3 flex flex-row items-center space-y-0 gap-2">
                    <div {...attributes} {...listeners} className="cursor-grab hover:text-foreground text-muted-foreground">
                        <GripVertical className="h-5 w-5" />
                    </div>

                    {assignment.sensorCategory !== 'ACTUATOR' && (
                        <button
                            onClick={onToggle}
                            className="hover:bg-accent rounded-sm p-1"
                        >
                            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                    )}

                    <div className="flex-1 flex items-center gap-2 overflow-hidden">
                        <CardTitle className="text-sm font-medium truncate flex items-center gap-2 overflow-hidden">
                            {assignment.userLabel ? (
                                <div className="flex flex-col overflow-hidden leading-tight">
                                    <span className="truncate font-semibold" title={assignment.userLabel}>{assignment.userLabel}</span>
                                    <span className="truncate text-[10px] text-muted-foreground font-normal" title={assignment.sensorName}>{assignment.sensorName || assignment.sensorId}</span>
                                </div>
                            ) : (
                                <span className="truncate" title={assignment.sensorName}>{assignment.sensorName || assignment.sensorId}</span>
                            )}
                            {isSimulated && <Zap className="h-3 w-3 text-yellow-500 fill-yellow-500 animate-pulse shrink-0" />}
                        </CardTitle>
                        <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                            {assignment.pins.join(', ')}
                        </Badge>
                        {assignment.isParentTemplate && (
                            <Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-tighter bg-blue-500/10 text-blue-500 border-blue-500/20">
                                Mother
                            </Badge>
                        )}
                        {assignment.sensorCategory === 'ACTUATOR' ? (
                            <div className="ml-auto flex items-center gap-2">
                                {assignment.values['pwm_speed'] > 0 && getPrimaryValue() === 'ON' && (
                                    <Badge variant="outline" className="text-[10px] font-mono border-amber-500/30 text-amber-500 bg-amber-500/10 px-1.5 py-0">
                                       <Zap className="h-2.5 w-2.5 mr-1" />
                                       {Math.round((assignment.values['pwm_speed'] / 255) * 100)}% ({assignment.values['pwm_speed']})
                                    </Badge>
                                )}
                                <button
                                    onClick={toggleActuator}
                                    className={`px-3 py-1 rounded text-[10px] font-bold border transition-all active:scale-95 select-none flex-shrink-0 ${getPrimaryValue() == 'ON' ? 'bg-green-500/20 text-green-600 border-green-500/50 hover:bg-green-500/30' : 'bg-muted text-muted-foreground border-border hover:bg-accent'}`}
                                >
                                    {getPrimaryValue()}
                                </button>
                            </div>
                        ) : (
                            isCollapsed && (
                                <span className="ml-auto text-xs font-mono text-muted-foreground">
                                    {getPrimaryValue()}
                                </span>
                            )
                        )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => setIsSettingsOpen(true)}
                        >
                            <Settings className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={onUnassign}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </CardHeader>

                {!isCollapsed && assignment.sensorCategory !== 'ACTUATOR' && (
                    <CardContent className="p-3 pt-0">
                        {/* Mother Mode: Multi-Channel UI */}
                        {assignment.isParentTemplate && (
                            <div className="space-y-4 border-b pb-4 mb-4">
                                <div className="flex justify-between items-center bg-muted/30 px-2 py-1.5 rounded-sm">
                                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Multi-Channel Output</h4>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-[10px] hover:bg-primary/10 hover:text-primary"
                                        onClick={handleAddChannel}
                                    >
                                        <Plus className="h-3 w-3 mr-1" /> Add Channel
                                    </Button>
                                </div>

                                {Object.keys(assignment.multiValues || {}).sort((a, b) => Number(a) - Number(b)).map(indexStr => {
                                    const index = Number(indexStr);
                                    const rawValue = assignment.multiValues?.[index] ?? 0;
                                    const points = assignment.multiCalibration?.[index] || [];
                                    const hasCal = points.length >= 2;
                                    const rawLabel = assignment.indexLabels?.[index] || `Channel ${index}`;

                                    // Parse label for mapping display
                                    const dataMatch = rawLabel.match(/(data|i2c)\[(\d+)\]/i);
                                    const regMatch = rawLabel.match(/reg\[([^\]]+)\]/i);
                                    const displayLabel = rawLabel.replace(/(data|reg|i2c)\[[^\]]+\]/i, '').trim();
                                    const mapVal = dataMatch ? dataMatch[2] : (regMatch ? regMatch[1] : index);

                                    const hwCmd = assignment.hardwareCmd?.toUpperCase() || '';
                                    const isTrueUart = hwCmd.includes('UART');
                                    const mappingPrefix = isTrueUart ? 'UART' : 'I2C';

                                    const mappingInfo = dataMatch ? `${mappingPrefix} [${dataMatch[2]}]` : (regMatch ? `I2C [${regMatch[1]}]` : `I2C [${index}]`);

                                    let displayValue = rawValue;
                                    if (hasCal) {
                                        displayValue = interpolate(rawValue, points, 'raw', 'value');
                                    }

                                    displayValue = parseFloat(displayValue.toFixed(4));

                                    return (
                                        <div key={index} className="bg-muted/30 p-2 rounded-lg border border-border/50 hover:border-primary/30 transition-all group">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-1.5 overflow-hidden">
                                                    <span className="text-[10px] font-mono font-bold bg-muted px-1.5 py-0.5 rounded text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                                                        {mapVal}
                                                    </span>
                                                    <span className="text-[10px] font-semibold truncate text-muted-foreground group-hover:text-foreground" title={displayLabel}>
                                                        {displayLabel}
                                                    </span>
                                                    <span className="text-[8px] opacity-40 font-mono hidden sm:inline">{mappingInfo}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={() => handleRemoveChannel(index)}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-5 w-5 opacity-50 group-hover:opacity-100 transition-all"
                                                        onClick={() => setMultiSettingsIndex(index)}
                                                    >
                                                        <Settings className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <div className="flex justify-between items-center text-[10px] font-mono">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-muted-foreground opacity-50">VAL:</span>
                                                        <input
                                                            type="number"
                                                            className="w-16 h-5 p-0 bg-transparent border-0 border-b border-primary/20 text-primary text-[10px] font-bold outline-none focus:border-primary transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                            value={displayValue}
                                                            step="any"
                                                            disabled={isSimulated}
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                if (!isNaN(val)) {
                                                                    if (hasCal) {
                                                                        const raw = interpolate(val, points, 'value', 'raw');
                                                                        onMultiValueChange(index, raw);
                                                                    } else {
                                                                        onMultiValueChange(index, val);
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="text-[9px] text-muted-foreground opacity-50">RAW: {Math.round(rawValue)}</span>
                                                </div>
                                                <SimSlider
                                                    value={rawValue}
                                                    min={0}
                                                    max={hasCal ? Math.max(...points.map(p => p.raw), 1024) : 1024}
                                                    onChange={(val) => onMultiValueChange(index, val)}
                                                    disabled={isSimulated}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}

                                {Object.keys(assignment.multiValues || {}).length === 0 && (
                                    <div className="text-center py-4 text-[10px] text-muted-foreground border border-dashed rounded-md bg-muted/10">
                                        No channels added. Click "Add Channel" to start.
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Standard mode: Single value sliders */}
                        {!assignment.isParentTemplate && Object.entries(assignment.values).map(([key, value]) => {
                            const limit = assignment.perKeyLimits?.[key] || assignment.limits;
                            let sliderMin = limit?.min ?? 0;
                            let sliderMax = limit?.max ?? 1024;

                            let rawValue = typeof value === 'number' ? value : 0;
                            let displayValue = rawValue;

                            if (hasCalibration) {
                                const maxRaw = Math.max(...points.map(p => p.raw), 1024);
                                sliderMin = 0;
                                sliderMax = maxRaw;
                                displayValue = interpolate(rawValue, points, 'raw', 'value');
                            }

                            displayValue = parseFloat(displayValue.toFixed(4));

                            return (
                                <div key={key} className={`space-y-2 mb-3 last:mb-0 ${isSimulated ? 'opacity-80' : ''}`}>
                                    <div className="flex justify-between items-center gap-2 text-xs">
                                        <div className="flex flex-col">
                                            <span className="text-muted-foreground capitalize font-semibold">{key.replace(/_/g, ' ')}</span>
                                            {hasCalibration && (
                                                <span className="text-[9px] text-muted-foreground/60 font-mono">Raw: {rawValue.toFixed(1)}</span>
                                            )}
                                        </div>

                                        <div className="flex-1 flex items-center gap-2 justify-end">
                                            {isSimulated ? (
                                                <span className="font-mono font-bold text-primary">
                                                    {displayValue.toFixed(2)}
                                                </span>
                                            ) : (
                                                <div className="relative group/input">
                                                    <input
                                                        type="number"
                                                        className="w-24 text-right pr-7 p-1 rounded border font-mono font-bold bg-background focus:ring-1 focus:ring-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        value={displayValue}
                                                        step="any"
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value);
                                                            if (!isNaN(val)) {
                                                                if (hasCalibration) {
                                                                    const raw = interpolate(val, points, 'value', 'raw');
                                                                    onValueChange(key, raw);
                                                                } else {
                                                                    onValueChange(key, val);
                                                                }
                                                            }
                                                        }}
                                                    />
                                                    {assignment.units && assignment.units[key] && (
                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-bold opacity-50">
                                                            {assignment.units[key]}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <SimSlider
                                        value={rawValue}
                                        min={sliderMin}
                                        max={sliderMax}
                                        onChange={(val) => {
                                            onValueChange(key, val);
                                        }}
                                        disabled={isSimulated}
                                    />

                                    <div className="flex justify-between text-[10px] text-muted-foreground px-1 opacity-50">
                                        <span>{sliderMin.toFixed(0)} {hasCalibration && '(Raw)'}</span>
                                        <span>{sliderMax.toFixed(0)} {hasCalibration && '(Raw)'}</span>
                                    </div>
                                </div>
                            );
                        })}

                        <GeneratorPanel assignment={assignment} onSave={handleSaveGenerator} />
                    </CardContent>
                )}
            </Card>

            {isSettingsOpen && (
                <CalibrationModal
                    assignment={assignment}
                    onClose={() => setIsSettingsOpen(false)}
                    onSave={onUpdate}
                />
            )}

            {multiSettingsIndex !== null && (
                <CalibrationModal
                    assignment={assignment}
                    initialIndex={multiSettingsIndex}
                    onClose={() => setMultiSettingsIndex(null)}
                    onSave={onUpdate}
                />
            )}
        </div>
    );
}

// ... SensorList component ...
export function SensorList({ assignments, onUpdate }: SensorListProps) {
    const [items, setItems] = useState(assignments);

    // Collapsed State Logic (Persistent)
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
        try {
            const saved = localStorage.getItem('sensor_collapsed_state');
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.error('Failed to parse collapsed state', e);
            return {};
        }
    });

    useEffect(() => {
        localStorage.setItem('sensor_collapsed_state', JSON.stringify(collapsed));
    }, [collapsed]);

    useEffect(() => { setItems(assignments); }, [assignments]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setItems((items) => {
                const oldIndex = items.findIndex((i) => i.pins[0] === active.id);
                const newIndex = items.findIndex((i) => i.pins[0] === over.id);
                const newItems = arrayMove(items, oldIndex, newIndex);
                ApiClient.post('/api/assignments/reorder', { order: newItems.map(i => i.pins[0]) });
                return newItems;
            });
        }
    };

    const handleUnassign = async (pinId: string) => {
        if (confirm('Are you sure you want to remove this sensor?')) {
            try {
                await ApiClient.delete(`/api/assign/${pinId}`);
                onUpdate();
            } catch (e) { console.error(e); }
        }
    };

    const handleValueChange = async (pinId: string, key: string, value: number) => {
        try {
            await ApiClient.post(`/api/value/${pinId}`, { key, value });
            onUpdate();
        } catch (e) { console.error(e); }
    };

    const handleMultiValueChange = async (pinId: string, index: number, value: number) => {
        try {
            await ApiClient.post(`/api/assign/${pinId}/multi-value`, { index, value });
            onUpdate();
        } catch (e) { console.error(e); }
    };

    const toggleCollapse = (id: string) => {
        setCollapsed(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const expandAll = () => setCollapsed({});
    const collapseAll = () => {
        const all: Record<string, boolean> = {};
        assignments.forEach(a => all[a.pins[0]] = true);
        setCollapsed(all);
    };

    if (assignments.length === 0) {
        return (
            <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center p-10 text-muted-foreground">
                    <Activity className="h-10 w-10 mb-2 opacity-20" />
                    <p>No active sensors</p>
                    <p className="text-xs">Click a pin above to add one.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 text-xs gap-1">
                    <ChevronsDown className="h-3.5 w-3.5" /> Expand All
                </Button>
                <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 text-xs gap-1">
                    <ChevronsUp className="h-3.5 w-3.5" /> Collapse All
                </Button>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map(a => a.pins[0])} strategy={verticalListSortingStrategy}>
                    {items.map((assignment) => (
                        <SortableSensorCard
                            key={assignment.pins[0]}
                            assignment={assignment}
                            onValueChange={(key, val) => handleValueChange(assignment.pins[0], key, val)}
                            onMultiValueChange={(index, val) => handleMultiValueChange(assignment.pins[0], index, val)}
                            onUnassign={() => handleUnassign(assignment.pins[0])}
                            onUpdate={onUpdate}
                            isCollapsed={!!collapsed[assignment.pins[0]]}
                            onToggle={() => toggleCollapse(assignment.pins[0])}
                        />
                    ))}
                </SortableContext>
            </DndContext>
        </div>
    );
}
