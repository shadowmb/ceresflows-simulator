import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2, Plus, X, Sparkles } from 'lucide-react';
import { PinAssignment, SensorDefinition } from '@/types';
import { ApiClient } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

interface CalibrationModalProps {
    assignment: PinAssignment;
    initialIndex?: number;
    onClose: () => void;
    onSave: () => void;
}

export function CalibrationModal({ assignment, initialIndex, onClose, onSave }: CalibrationModalProps) {
    const isMulti = initialIndex !== undefined;

    const [points, setPoints] = useState<{ raw: number; value: number }[]>(
        isMulti
            ? (assignment.multiCalibration?.[initialIndex] || [])
            : (assignment.calibrationPoints || [])
    );

    const rawLabel = isMulti
        ? (assignment.indexLabels?.[initialIndex] || `Channel ${initialIndex}`)
        : (assignment.userLabel || '');

    // Parse existing label for technical mapping [data[X]] or [reg[X]] or [i2c[X]]
    const dataMatch = rawLabel.match(/(data|i2c)\s*\[\s*([^\]\s]+)\s*\]/i);
    const regMatch = rawLabel.match(/reg\s*\[\s*([^\]\s]+)\s*\]/i);

    const [label, setLabel] = useState(rawLabel.replace(/(data|reg|i2c)\s*\[[^\]]+\]/i, '').trim());
    const [mappingType, setMappingType] = useState<'i2c' | 'reg' | 'data'>(dataMatch ? (dataMatch[1].toLowerCase() as any) : 'reg');

    let initialOffset = '';
    if (dataMatch) initialOffset = dataMatch[2];
    else if (regMatch) initialOffset = regMatch[1];
    else if (isMulti) initialOffset = initialIndex.toString();
    const [mappingOffset, setMappingOffset] = useState(initialOffset);

    // UI State
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [relatedSensors, setRelatedSensors] = useState<SensorDefinition[]>([]);
    const [activeTemplateId, setActiveTemplateId] = useState<string>("");

    const parseTemplateMapping = (details: any) => {
        const readCmd = details.commands?.READ;
        const vPath = readCmd?.valuePath || '';
        const hwInterface = details.hardware?.interface?.toLowerCase();
        const hwCmd = readCmd?.hwCmd;

        let mType: 'i2c' | 'reg' | 'data' = 'reg';
        const isI2C = hwInterface === 'i2c' || hwCmd?.includes('I2C');

        let offset = '0';
        const indexMatch = vPath.match(/\[\s*([^\]\s]+)\s*\]/);

        if (indexMatch) {
            offset = indexMatch[1];
            mType = isI2C ? 'i2c' : 'data';
        } else if (isI2C) {
            mType = 'reg';
            const writeParams = readCmd?.params?.write;
            if (Array.isArray(writeParams) && writeParams.length > 0) {
                offset = writeParams[0].toString();
            }
        } else {
            mType = 'data';
        }

        return { type: mType, offset, name: details.name };
    };

    const determineActiveTemplate = async (sensors: SensorDefinition[], currentType: string, currentOffset: string) => {
        for (const s of sensors) {
            try {
                const details = await ApiClient.get<any>(`/api/sensor/${s.id}`);
                const { type, offset } = parseTemplateMapping(details);
                if (type === currentType && offset === currentOffset) {
                    setActiveTemplateId(s.id);
                    break;
                }
            } catch (e) { /* ignore */ }
        }
    };

    useEffect(() => {
        if (assignment.parentTag) {
            ApiClient.get<SensorDefinition[]>('/api/sensors')
                .then(data => {
                    const related = data.filter(d => d.parentTag === assignment.parentTag);
                    setRelatedSensors(related);
                    // Match current state to a template
                    determineActiveTemplate(related, mappingType, mappingOffset);
                })
                .catch(console.error);
        }
    }, [assignment.parentTag]);

    const handleSelectTemplate = async (sensorId: string) => {
        try {
            const details = await ApiClient.get<any>(`/api/sensor/${sensorId}`);
            if (details) {
                const { type, offset, name } = parseTemplateMapping(details);
                setMappingType(type);
                setMappingOffset(offset);
                if (name) setLabel(name);
                setActiveTemplateId(sensorId);
                setShowAdvanced(false);
            }
        } catch (e) {
            console.error('Template loading failed', e);
        }
    };

    const handleAddPoint = () => {
        setPoints([...points, { raw: 0, value: 0 }]);
    };

    const handleRemovePoint = (index: number) => {
        const newPoints = points.filter((_, i) => i !== index);
        setPoints(newPoints);
    };

    const handleChange = (index: number, key: 'raw' | 'value', val: string) => {
        const newPoints = [...points];
        if (key === 'raw') newPoints[index].raw = parseFloat(val) || 0;
        else newPoints[index].value = parseFloat(val) || 0;
        setPoints(newPoints);
    };

    const handleSave = async () => {
        try {
            let finalLabel = label.trim() || (isMulti ? `Channel ${initialIndex}` : 'Sensor');
            if (isMulti && mappingOffset.trim() !== '') {
                finalLabel = `${label.trim()} ${mappingType}[${mappingOffset.trim()}]`.trim();
            }

            if (isMulti) {
                await Promise.all([
                    ApiClient.post(`/api/assign/${assignment.pins[0]}/multi-calibration`, { index: initialIndex, points }),
                    ApiClient.post(`/api/assign/${assignment.pins[0]}/multi-label`, { index: initialIndex, label: finalLabel })
                ]);
            } else {
                await Promise.all([
                    ApiClient.post(`/api/assign/${assignment.pins[0]}/calibration`, { points }),
                    ApiClient.post(`/api/assign/${assignment.pins[0]}/label`, { label: finalLabel })
                ]);
            }

            onSave();
            onClose();
        } catch (e) {
            console.error('Save failed:', e);
            alert('Failed to save settings');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <Card className="w-full max-w-md bg-background shadow-2xl text-foreground border-border overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between border-b pb-4 bg-muted/30">
                    <div>
                        <CardTitle className="text-lg">
                            {isMulti ? `${label || 'Channel ' + initialIndex} Settings` : 'Device Settings'}
                        </CardTitle>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Configuration & Calibration</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                        <X className="h-4 w-4" />
                    </Button>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">

                    {/* STEP 1: Template Selection (Primary UX) */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                <Sparkles className="h-3 w-3 text-primary" />
                                Measurement Type
                            </label>
                            {assignment.parentTag && (
                                <Badge variant="outline" className="text-[9px] py-0 h-4 border-primary/30 text-primary">
                                    Tag: {assignment.parentTag}
                                </Badge>
                            )}
                        </div>

                        <select
                            className="w-full bg-background border-2 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 ring-primary/20 border-muted hover:border-primary/50 transition-colors"
                            onChange={(e) => e.target.value && handleSelectTemplate(e.target.value)}
                            value={activeTemplateId}
                        >
                            <option value="" disabled>-- Select what this channel measures --</option>
                            {relatedSensors.length > 0 ? (
                                relatedSensors.map(s => (
                                    <option key={s.id} value={s.id}>
                                        {s.id === assignment.sensorId ? `⭐ ${s.name} (Primary)` : s.name}
                                    </option>
                                ))
                            ) : (
                                <option value={assignment.sensorId}>{assignment.sensorName || 'Current Device'}</option>
                            )}
                        </select>
                        <p className="text-[10px] text-muted-foreground italic px-1">
                            Selecting a template automatically configures the technical mapping and labels.
                        </p>
                    </div>

                    <div className="space-y-4 pt-2">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Display Name</label>
                            <input
                                type="text"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="Human readable name"
                                className="w-full p-2.5 text-sm border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                            />
                        </div>

                        {/* ADVANCED SECTIONS (Manual Overrides) */}
                        {isMulti && (
                            <div className="border-t pt-4">
                                <div className="flex justify-between items-center mb-4">
                                    <button
                                        onClick={() => setShowAdvanced(!showAdvanced)}
                                        className="text-[10px] font-bold uppercase text-primary hover:underline flex items-center gap-1"
                                    >
                                        {showAdvanced ? 'Hide Technical Details' : 'Show Technical Details (Manual Mode)'}
                                    </button>

                                    {!showAdvanced && (
                                        <div className="flex gap-2">
                                            <Badge variant="secondary" className="text-[9px] h-4">
                                                {mappingType.toUpperCase()}
                                            </Badge>
                                            <Badge variant="secondary" className="text-[9px] h-4">
                                                Idx: {mappingOffset}
                                            </Badge>
                                        </div>
                                    )}
                                </div>

                                {showAdvanced && (
                                    <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg animate-in fade-in slide-in-from-top-2 duration-200">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted-foreground uppercase">Mapping Type</label>
                                            <select
                                                value={mappingType}
                                                onChange={(e) => setMappingType(e.target.value as any)}
                                                className="w-full p-2 text-xs border rounded bg-background outline-none"
                                            >
                                                <option value="i2c">I2C Data (i2c[X])</option>
                                                <option value="reg">I2C Register (reg[X])</option>
                                                <option value="data">Data Offset (data[X])</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-muted-foreground uppercase">
                                                {mappingType === 'reg' ? 'Register Index' : 'Byte Offset'}
                                            </label>
                                            <input
                                                type="text"
                                                value={mappingOffset}
                                                onChange={(e) => setMappingOffset(e.target.value)}
                                                className="w-full p-2 text-xs border rounded bg-background outline-none"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* CALIBRATION SECTION */}
                    <div className="border-t pt-4">
                        <div className="flex justify-between items-center mb-3">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Calibration Table</label>
                            <Button variant="outline" size="sm" onClick={handleAddPoint} className="h-6 text-[10px] px-2 border-dashed">
                                <Plus className="h-3 w-3 mr-1" /> Add Point
                            </Button>
                        </div>

                        <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                            {points.map((point, index) => (
                                <div key={index} className="grid grid-cols-5 gap-2 items-center">
                                    <div className="col-span-2 relative">
                                        <input
                                            type="number"
                                            className="w-full p-2 text-xs border rounded bg-background"
                                            value={point.raw}
                                            onChange={(e) => handleChange(index, 'raw', e.target.value)}
                                        />
                                        <span className="absolute right-2 top-2 text-[9px] text-muted-foreground font-bold pointer-events-none">RAW</span>
                                    </div>
                                    <div className="col-span-2 relative">
                                        <input
                                            type="number"
                                            className="w-full p-2 text-xs border rounded bg-background"
                                            value={point.value}
                                            onChange={(e) => handleChange(index, 'value', e.target.value)}
                                        />
                                        <span className="absolute right-2 top-2 text-[9px] text-muted-foreground font-bold pointer-events-none">VAL</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-destructive h-8 w-8 hover:bg-destructive/10"
                                        onClick={() => handleRemovePoint(index)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            ))}

                            {points.length === 0 && (
                                <div className="text-center py-6 text-[10px] text-muted-foreground border border-dashed rounded-lg bg-muted/20">
                                    No calibration points. Raw values will be used directly.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-4 border-t flex gap-3">
                        <Button variant="ghost" onClick={onClose} className="flex-1 text-xs">Cancel</Button>
                        <Button onClick={handleSave} className="flex-1 text-xs shadow-lg shadow-primary/20">Save Configuration</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
