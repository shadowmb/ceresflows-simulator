import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Play, Square, Save, RotateCcw } from 'lucide-react';
import { ApiClient } from '@/lib/api';
import { PinAssignment } from '@/types';

// Hardcoded defaults to match Backend ScenarioEngine
const SENSOR_DEFAULTS: Record<string, string> = {
    'dfrobot_a02yyuw': 'distance',
    'dfrobot_ph_pro': 'raw_voltage',
    'dfrobot_ec_k1': 'raw_voltage',
    'dfrobot_tds_sen0244': 'tds_value',
    'ds18b20': 'temperature',
    'dht22': 'temperature'
};

interface ScenarioStep {
    id: string; // internal FE id for key
    pin: string;
    key?: string;
    startDelay: number;
    startValue: number;
    endValue: number;
    stepSize: number;
    stepInterval: number;
}

interface Scenario {
    id: string;
    name: string;
    description?: string;
    steps: ScenarioStep[];
}

interface ScenarioStudioProps {
    assignments: PinAssignment[];
}

export function ScenarioStudio({ assignments }: ScenarioStudioProps) {
    const [scenarios, setScenarios] = useState<Scenario[]>([]);
    const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
    const [status, setStatus] = useState<{ running: boolean; scenarioId?: string; elapsed: number }>({ running: false, elapsed: 0 });

    // Editor State
    const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);

    // Initial Load
    useEffect(() => {
        loadScenarios();
        const interval = setInterval(checkStatus, 1000);
        return () => clearInterval(interval);
    }, []);

    const loadScenarios = async () => {
        try {
            const data = await ApiClient.get<Scenario[]>('/api/scenarios');
            setScenarios(data || []);
        } catch (e) {
            console.error('Failed to load scenarios', e);
        }
    };

    const checkStatus = async () => {
        try {
            const s = await ApiClient.get<any>('/api/scenarios/status');
            setStatus(s);
        } catch (e) { }
    };

    const handleNewScenario = () => {
        const newScenario: Scenario = {
            id: crypto.randomUUID(),
            name: 'New Scenario',
            steps: []
        };
        setEditingScenario(newScenario);
    };

    const handleSelectScenario = (s: Scenario) => {
        setEditingScenario({ ...s }); // Clone to edit
    };

    const handleSave = async () => {
        if (!editingScenario) return;
        try {
            await ApiClient.post('/api/scenarios', editingScenario);
            await loadScenarios();
            alert('Scenario saved!');
        } catch (e) {
            console.error(e);
            alert('Failed to save');
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Delete scenario?')) {
            await ApiClient.delete(`/api/scenarios/${id}`);
            if (editingScenario?.id === id) setEditingScenario(null);
            await loadScenarios();
        }
    };

    const handleStart = async () => {
        if (!editingScenario) return;
        try {
            // Save first?
            await ApiClient.post('/api/scenarios', editingScenario);
            await ApiClient.post(`/api/scenarios/${editingScenario.id}/start`, {});
            await checkStatus();
        } catch (e) {
            console.error(e);
            alert('Failed to start');
        }
    };

    const handleStop = async () => {
        await ApiClient.post('/api/scenarios/stop', {});
        await checkStatus();
    };

    // --- Step Editor Helpers ---

    const getSensorDefaultKey = (assignment: PinAssignment | undefined) => {
        if (!assignment) return 'value';

        // 1. Check hardcoded defaults
        if (assignment.sensorId && SENSOR_DEFAULTS[assignment.sensorId]) {
            return SENSOR_DEFAULTS[assignment.sensorId];
        }

        // 2. Check existing keys
        const keys = Object.keys(assignment.values);
        if (keys.length > 0) return keys[0];

        // 3. Fallback
        return 'value';
    };

    const addStep = () => {
        if (!editingScenario) return;
        if (assignments.length === 0) {
            alert('No sensors available. Please add sensors in Dashboard first.');
            return;
        }
        const firstPin = assignments[0];
        const defaultKey = getSensorDefaultKey(firstPin);

        const newStep: ScenarioStep = {
            id: crypto.randomUUID(),
            pin: firstPin.pins[0],
            key: defaultKey,
            startDelay: 0,
            startValue: 0,
            endValue: 100,
            stepSize: 1,
            stepInterval: 1000
        };
        setEditingScenario({
            ...editingScenario,
            steps: [...editingScenario.steps, newStep]
        });
    };

    const updateStep = (index: number, field: keyof ScenarioStep, value: any) => {
        if (!editingScenario) return;
        const newSteps = [...editingScenario.steps];
        newSteps[index] = { ...newSteps[index], [field]: value };

        // If pin changed, update key default
        if (field === 'pin') {
            const assign = assignments.find(a => String(a.pins[0]) === String(value));
            if (assign) {
                newSteps[index].key = getSensorDefaultKey(assign);
            }
        }

        setEditingScenario({ ...editingScenario, steps: newSteps });
    };

    const removeStep = (index: number) => {
        if (!editingScenario) return;
        setEditingScenario({
            ...editingScenario,
            steps: editingScenario.steps.filter((_, i) => i !== index)
        });
    };

    // Interpolate helper (Raw -> Real)
    const getRealValue = (raw: number, points: { raw: number; value: number }[]) => {
        if (!points || points.length < 2) return raw;
        const sorted = [...points].sort((a, b) => a.raw - b.raw);
        if (raw <= sorted[0].raw) return sorted[0].value;
        if (raw >= sorted[sorted.length - 1].raw) return sorted[sorted.length - 1].value;

        for (let i = 0; i < sorted.length - 1; i++) {
            if (raw >= sorted[i].raw && raw <= sorted[i + 1].raw) {
                const t = (raw - sorted[i].raw) / (sorted[i + 1].raw - sorted[i].raw);
                return sorted[i].value + t * (sorted[i + 1].value - sorted[i].value);
            }
        }
        return raw;
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[calc(100vh-100px)]">
            {/* Sidebar: List */}
            <Card className="md:col-span-1 flex flex-col">
                <CardHeader className="p-4 border-b">
                    <CardTitle className="text-lg flex justify-between items-center">
                        Scenarios
                        <Button size="sm" variant="outline" onClick={handleNewScenario}><Plus className="h-4 w-4" /></Button>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-2 flex-1 overflow-y-auto space-y-2">
                    {scenarios.map(s => (
                        <div
                            key={s.id}
                            className={`p-3 rounded-md border cursor-pointer hover:bg-accent transition-colors ${editingScenario?.id === s.id ? 'bg-accent border-primary' : 'bg-card'}`}
                            onClick={() => handleSelectScenario(s)}
                        >
                            <div className="flex justify-between items-start">
                                <span className="font-medium truncate">{s.name}</span>
                                <Button variant="ghost" size="icon" className="h-5 w-5 hover:text-destructive" onClick={(e) => handleDelete(s.id, e)}>
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1">
                                {s.steps.length} steps
                            </div>
                            {status.running && status.scenarioId === s.id && (
                                <Badge variant="default" className="mt-2 text-[10px] bg-green-600">Running</Badge>
                            )}
                        </div>
                    ))}
                    {scenarios.length === 0 && (
                        <div className="text-center text-muted-foreground text-sm p-4 italic">No scenarios saved.</div>
                    )}
                </CardContent>
            </Card>

            {/* Main: Editor */}
            <div className="md:col-span-3 flex flex-col h-full gap-4">
                {editingScenario ? (
                    <Card className="flex-1 flex flex-col overflow-hidden">
                        <CardHeader className="p-4 border-b flex flex-row justify-between items-center bg-muted/20">
                            <div className="flex gap-4 items-center flex-1">
                                <input
                                    className="text-xl font-bold bg-transparent border-none focus:ring-0 outline-none w-full"
                                    value={editingScenario.name}
                                    onChange={(e) => setEditingScenario({ ...editingScenario, name: e.target.value })}
                                    placeholder="Scenario Name (Click to Edit)"
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" onClick={handleSave} variant="outline" className="gap-2">
                                    <Save className="h-4 w-4" /> Save
                                </Button>
                                <div className="w-px h-6 bg-border mx-2"></div>
                                {!status.running ? (
                                    <Button size="sm" onClick={handleStart} className="gap-2 bg-green-600 hover:bg-green-700">
                                        <Play className="h-4 w-4" /> Start
                                    </Button>
                                ) : (
                                    <Button size="sm" onClick={handleStop} variant="destructive" className="gap-2">
                                        <Square className="h-4 w-4 fill-current" /> Stop
                                    </Button>
                                )}
                            </div>
                        </CardHeader>

                        {/* Status Bar */}
                        {status.running && status.scenarioId === editingScenario.id && (
                            <div className="bg-green-600/10 text-green-600 px-4 py-2 text-xs font-mono border-b flex justify-between items-center">
                                <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-600 animate-pulse"></div> EXECUTION RUNNING</span>
                                <span>Elapsed: {status.elapsed.toFixed(1)}s</span>
                            </div>
                        )}

                        <CardContent className="p-0 flex-1 overflow-y-auto">
                            <div className="p-4 space-y-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Sensor Actions</h3>
                                    <Button size="sm" variant="ghost" onClick={addStep} className="text-xs gap-1 border border-dashed">
                                        <Plus className="h-3 w-3" /> Add Step
                                    </Button>
                                </div>

                                <div className="space-y-2">
                                    {editingScenario.steps.length === 0 && (
                                        <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg bg-muted/20">
                                            No actions defined. Click "Add Step" to configure sensors.
                                        </div>
                                    )}

                                    {editingScenario.steps.map((step, idx) => {
                                        const assign = assignments.find(a => String(a.pins[0]) === String(step.pin));

                                        // Get available keys
                                        let availableKeys = assign ? Object.keys(assign.values) : [];
                                        const defaultKey = getSensorDefaultKey(assign);

                                        // Should we show dropdown?
                                        // Filter out Keys we know are duplicates if we want clean UI?
                                        // For now, if keys are empty, assume default.
                                        if (availableKeys.length === 0) availableKeys = [defaultKey];

                                        // If currentKey is not in available, but is default, fine.
                                        const currentKey = step.key || defaultKey;

                                        // Live Value Calculation
                                        const raw = assign ? (assign.values[currentKey] || 0) : 0;
                                        const real = assign ? getRealValue(raw, assign.calibrationPoints || []) : 0;

                                        return (
                                            <div key={idx} className="flex flex-wrap items-center gap-3 p-3 rounded border bg-card hover:shadow-sm transition-shadow">
                                                <div className="flex flex-col gap-1 w-48">
                                                    <label className="text-[10px] uppercase text-muted-foreground font-bold">Sensor / Metric</label>
                                                    <div className="flex gap-1">
                                                        <select
                                                            className="text-xs p-1.5 rounded-l border bg-background w-2/3 truncate"
                                                            value={step.pin}
                                                            onChange={(e) => updateStep(idx, 'pin', e.target.value)}
                                                            title={assign?.sensorName || step.pin}
                                                        >
                                                            {assignments.map(a => (
                                                                <option key={a.pins[0]} value={a.pins[0]}>
                                                                    {a.sensorName || a.sensorId} ({a.pins.join(',')})
                                                                </option>
                                                            ))}
                                                        </select>

                                                        {availableKeys.length > 1 ? (
                                                            <select
                                                                className="text-xs p-1.5 rounded-r border-y border-r bg-muted/50 w-1/3"
                                                                value={currentKey}
                                                                onChange={(e) => updateStep(idx, 'key', e.target.value)}
                                                                title="Parameter Key"
                                                            >
                                                                {availableKeys.map(k => (
                                                                    <option key={k} value={k}>{k}</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <div className="text-xs p-1.5 rounded-r border-y border-r bg-muted/20 w-1/3 text-muted-foreground truncate" title={currentKey}>
                                                                {currentKey}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-1 w-20">
                                                    <label className="text-[10px] uppercase text-muted-foreground font-bold">Start (T+)</label>
                                                    <div className="relative">
                                                        <input
                                                            type="number" min="0" className="w-full text-xs p-1.5 rounded border bg-background pr-6"
                                                            value={step.startDelay} onChange={(e) => updateStep(idx, 'startDelay', parseFloat(e.target.value))}
                                                        />
                                                        <span className="absolute right-1.5 top-1.5 text-[10px] text-muted-foreground">s</span>
                                                    </div>
                                                </div>

                                                <div className="w-px h-8 bg-border"></div>

                                                <div className="flex flex-col gap-1 w-20">
                                                    <label className="text-[10px] uppercase text-muted-foreground font-bold">From Val</label>
                                                    <input
                                                        type="number" className="w-full text-xs p-1.5 rounded border bg-background"
                                                        value={step.startValue} onChange={(e) => updateStep(idx, 'startValue', parseFloat(e.target.value))}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1 w-20">
                                                    <label className="text-[10px] uppercase text-muted-foreground font-bold">To Val</label>
                                                    <input
                                                        type="number" className="w-full text-xs p-1.5 rounded border bg-background"
                                                        value={step.endValue} onChange={(e) => updateStep(idx, 'endValue', parseFloat(e.target.value))}
                                                    />
                                                </div>

                                                <div className="w-px h-8 bg-border"></div>

                                                <div className="flex flex-col gap-1 w-20">
                                                    <label className="text-[10px] uppercase text-muted-foreground font-bold">Step</label>
                                                    <input
                                                        type="number" min="0" step="0.1" className="w-full text-xs p-1.5 rounded border bg-background"
                                                        value={step.stepSize} onChange={(e) => updateStep(idx, 'stepSize', parseFloat(e.target.value))}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1 w-24">
                                                    <label className="text-[10px] uppercase text-muted-foreground font-bold">Interval</label>
                                                    <div className="relative">
                                                        <input
                                                            type="number" min="100" step="100" className="w-full text-xs p-1.5 rounded border bg-background pr-7"
                                                            value={step.stepInterval} onChange={(e) => updateStep(idx, 'stepInterval', parseFloat(e.target.value))}
                                                        />
                                                        <span className="absolute right-1.5 top-1.5 text-[10px] text-muted-foreground">ms</span>
                                                    </div>
                                                </div>

                                                <div className="w-px h-8 bg-border"></div>

                                                {/* LIVE VALUE */}
                                                <div className="flex flex-col gap-1 w-28">
                                                    <label className="text-[10px] uppercase text-muted-foreground font-bold text-primary">Live Out</label>
                                                    <div className="text-xs font-mono bg-muted p-1.5 rounded flex flex-col leading-tight border border-border/50">
                                                        <div className="flex justify-between items-center">
                                                            <span className="font-bold">{real.toFixed(1)}</span>
                                                            <span className="text-[9px] text-muted-foreground uppercase opacity-70">Val</span>
                                                        </div>
                                                        <div className="flex justify-between items-center border-t border-border/10 mt-0.5 pt-0.5">
                                                            <span>{raw.toFixed(0)}</span>
                                                            <span className="text-[9px] text-muted-foreground uppercase opacity-70">{currentKey}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex-1"></div>

                                                <Button variant="ghost" size="icon" onClick={() => removeStep(idx)} className="text-muted-foreground hover:text-destructive self-end mb-0.5">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl bg-muted/10">
                        <Play className="h-12 w-12 mb-4 opacity-20" />
                        <h3 className="text-xl font-medium mb-1">Scenario Studio</h3>
                        <p className="text-sm max-w-sm text-center">Select a scenario from the left or create a new one to automate sensor behaviors.</p>
                        <Button className="mt-6" onClick={handleNewScenario}> Create New Scenario</Button>
                    </div>
                )}
            </div>
        </div>
    );
}
