import { useState, useEffect } from 'react';
import { PinDefinition, SensorDefinition, PinAssignment } from '@/types';
import { X, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiClient } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

interface AssignmentModalProps {
    availablePins: PinDefinition[];
    assignments: PinAssignment[]; // To check used pins
    onClose: () => void;
    onAssign: () => void;
}

export function AssignmentModal({ availablePins, assignments, onClose, onAssign }: AssignmentModalProps) {
    const [devices, setDevices] = useState<SensorDefinition[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<SensorDefinition | null>(null);
    const [selectedPins, setSelectedPins] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [addr, setAddr] = useState('');
    const [slaveId, setSlaveId] = useState<number>(0);

    // Helper to get consistent ID for a pin (GPIO or unique string ID)
    const getPinId = (p: PinDefinition) => p.pin !== undefined ? String(p.pin) : p.id;

    // Helper to normalize pin types
    const getPinTypes = (type: string | string[]): string[] => {
        if (Array.isArray(type)) return type.map(t => String(t).trim().toUpperCase());
        if (typeof type === 'string') return [type.trim().toUpperCase()];
        return [];
    };

    // Filter used pins (those already assigned to other devices)
    const freePins = availablePins.filter(p =>
        !assignments.some(a => a.pins.includes(getPinId(p)))
    );

    useEffect(() => {
        ApiClient.get<SensorDefinition[]>('/api/sensors')
            .then(setDevices)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const isBusType = (type: string) => {
        const t = String(type || '').trim().toUpperCase();
        return t.includes('I2C') || t.includes('UART') || t.includes('RS485') || t.includes('BUS');
    };

    const isPinCompatible = (pinDef: PinDefinition, reqType?: string) => {
        if (!reqType) return true;
        const rt = reqType.trim().toUpperCase();
        const pt = getPinTypes(pinDef.type);

        if (isBusType(rt)) {
            const iface = rt.replace('_BUS', '').replace('BUS', '').trim();
            // Check for literal type match first (important for virtual buses)
            if (pt.includes(rt) || pt.includes(iface)) return true;
            // Then check for interface match (hardware)
            if (pinDef.interface?.toUpperCase() === iface) return true;
            // Then check for partial matches in types
            return pt.some(t => t.includes(iface));
        }

        if (rt.includes('ANALOG')) {
            return pt.some(t => t.includes('ANALOG'));
        }

        return pt.some(t => t.includes('DIGITAL'));
    };

    // Robust bus check
    const deviceHasBus = !!selectedDevice?.pins?.some(p => isBusType(p.type));

    // Auto-select Bus Pins for I2C/UART/Modbus
    useEffect(() => {
        if (!selectedDevice) return;

        const busPins: string[] = [];
        let anyBusInReq = false;

        selectedDevice.pins.forEach((p) => {
            const rt = (p.type || '').toUpperCase();
            if (isBusType(rt)) {
                anyBusInReq = true;
                // Prefer exact type match (e.g. i2c_bus for i2c_bus req)
                // This ensures we pick I2C_BUS_1 instead of just A4 if both exist
                let found = availablePins.find(ap => getPinTypes(ap.type).includes(rt));
                if (!found) found = availablePins.find(ap => isPinCompatible(ap, rt));

                if (found) {
                    const pid = getPinId(found);
                    if (!busPins.includes(pid)) busPins.push(pid);
                }
            }
        });

        if (anyBusInReq && busPins.length > 0) {
            setSelectedPins(busPins);
        } else if (anyBusInReq) {
            setSelectedPins([]);
        }
    }, [selectedDevice, availablePins]);

    const handleAssign = async () => {
        if (!selectedDevice || selectedPins.length !== selectedDevice.pinCount) return;

        try {
            await ApiClient.post('/api/assign', {
                sensorId: selectedDevice.id,
                pins: selectedPins,
                addr: addr || undefined,
                slaveId: slaveId || undefined
            });
            onAssign();
            onClose();
        } catch (e) {
            alert('Failed to assign device');
            console.error(e);
        }
    };

    const togglePinSelection = (pinId: string) => {
        if (!selectedDevice) return;

        // Prevent manual selection for bus-based pins that are auto-assigned
        const currentSlot = selectedPins.length;
        const requiredType = selectedDevice.pins[currentSlot]?.type;
        if (requiredType && isBusType(requiredType)) {
            return;
        }

        // Find the pin definition to check its type
        const pinDef = availablePins.find(p => getPinId(p) === pinId);
        if (!pinDef) return;

        setSelectedPins(prev => {
            const isSelected = prev.includes(pinId);

            if (isSelected) {
                return prev.filter(p => p !== pinId);
            } else {
                const currentSlotIndex = prev.length;
                if (currentSlotIndex >= selectedDevice.pinCount) return prev;

                const reqType = selectedDevice.pins[currentSlotIndex]?.type;
                if (!isPinCompatible(pinDef, reqType)) return prev;

                return [...prev, pinId];
            }
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl bg-card rounded-xl border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

                {/* HEADER */}
                <div className="p-6 border-b flex justify-between items-center bg-muted/40">
                    <div>
                        <h2 className="text-xl font-semibold">Attach Device</h2>
                        <p className="text-sm text-muted-foreground">Select a sensor or actuator to attach to the controller.</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* LEFT: Device List */}
                    <div className="w-1/2 border-r overflow-y-auto p-2 space-y-1 bg-muted/10">
                        {loading && <div className="p-4 text-center text-sm text-muted-foreground">Loading devices...</div>}

                        {/* Group by Category */}
                        {['SENSOR', 'ACTUATOR'].map(cat => {
                            const catDevices = devices.filter(d => d.category === cat);
                            if (catDevices.length === 0) return null;

                            return (
                                <div key={cat} className="mb-4">
                                    <div className="px-3 py-2 text-xs font-bold text-muted-foreground bg-muted/20 rounded mb-1">
                                        {cat}S
                                    </div>
                                    {catDevices.map(device => (
                                        <button
                                            key={device.id}
                                            onClick={() => {
                                                setSelectedDevice(device);
                                                setSelectedPins([]); // Reset pins on device change
                                                setAddr(''); // Clear address when device changes
                                                setSlaveId(0); // Clear slave ID when device changes
                                            }}
                                            className={`w-full text-left p-3 rounded-lg text-sm transition-all border
                                                ${selectedDevice?.id === device.id
                                                    ? 'bg-primary text-primary-foreground border-primary'
                                                    : 'hover:bg-accent border-transparent hover:border-border'}
                                            `}
                                        >
                                            <div className="font-medium">{device.name}</div>
                                            <div className="text-[10px] opacity-70 mt-1 flex justify-between">
                                                <span>{device.id}</span>
                                                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                                                    {device.pinCount} Pin{device.pinCount > 1 ? 's' : ''}
                                                </Badge>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            );
                        })}
                    </div>

                    {/* RIGHT: Pin Selection */}
                    <div className="w-1/2 p-6 flex flex-col">
                        {!selectedDevice ? (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                                <Cpu className="h-16 w-16 mb-4" />
                                <p>Select a device from the left</p>
                            </div>
                        ) : (
                            <>
                                <div className="mb-4">
                                    <h3 className="font-medium flex items-center gap-2">
                                        {deviceHasBus
                                            ? 'Bus Configuration'
                                            : `Select Pin ${selectedPins.length + 1} of ${selectedDevice.pinCount}`
                                        }
                                    </h3>
                                    {!deviceHasBus && (
                                        <p className="text-xs text-muted-foreground">
                                            Required: <Badge variant="outline" className="text-[10px] ml-1">{selectedDevice.pins[selectedPins.length]?.type || 'ANY'}</Badge>
                                        </p>
                                    )}
                                </div>

                                <div className="flex-1 overflow-y-auto">
                                    {/* BUS UI - Shown only if ANY pin is a bus type */}
                                    {deviceHasBus ? (
                                        <div className="space-y-4">
                                            {selectedDevice.pins.some(p => isBusType(p.type) && String(p.type).toUpperCase().includes('I2C')) && (
                                                <div className="space-y-4">
                                                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
                                                        I2C Bus detected. Provide the device address.
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold uppercase text-muted-foreground">I2C Address</label>
                                                        <input
                                                            type="text"
                                                            value={addr}
                                                            onChange={e => setAddr(e.target.value)}
                                                            placeholder="e.g. 0x44"
                                                            className="w-full bg-background border rounded px-3 py-2 text-sm focus:ring-1 ring-primary outline-none"
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            {selectedDevice.pins.some(p => isBusType(p.type) && (String(p.type).toUpperCase().includes('UART') || String(p.type).toUpperCase().includes('RS485'))) && (
                                                <div className="space-y-4">
                                                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400">
                                                        UART/Modbus detected. Provide Slave ID.
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold uppercase text-muted-foreground">Slave ID</label>
                                                        <input
                                                            type="number"
                                                            value={slaveId}
                                                            onChange={e => setSlaveId(parseInt(e.target.value))}
                                                            className="w-full bg-background border rounded px-3 py-2 text-sm focus:ring-1 ring-primary outline-none"
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            <div className="mt-4 border-t pt-4">
                                                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-2">Automated Pin Mapping</p>
                                                <div className="flex flex-col gap-2">
                                                    {selectedPins.length > 0 ? (
                                                        selectedPins.map(p => {
                                                            const pinDef = availablePins.find(ap => getPinId(ap) === p);
                                                            return (
                                                                <div key={p} className="flex flex-col gap-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/30">
                                                                            {pinDef?.id || p}
                                                                        </Badge>
                                                                        <span className="text-[10px] text-muted-foreground italic">{pinDef?.label}</span>
                                                                    </div>
                                                                    {pinDef?.mappedPins && pinDef.mappedPins.length > 0 && (
                                                                        <div className="flex gap-1 pl-4">
                                                                            {pinDef.mappedPins.map(mp => (
                                                                                <Badge key={mp} variant="outline" className="text-[9px] py-0 h-4 border-dashed opacity-70">
                                                                                    {mp}
                                                                                </Badge>
                                                                            ))}
                                                                            <span className="text-[9px] text-muted-foreground self-center opacity-60 ml-1">(Hardwired Pair)</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <div className="text-xs text-red-400">No compatible bus pins found on controller!</div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-4 gap-2">
                                            {freePins.map(pin => {
                                                const pinIdStr = getPinId(pin);
                                                const currentSlot = selectedPins.length;
                                                const reqType = selectedDevice.pins[currentSlot]?.type;

                                                const isCompatible = isPinCompatible(pin, reqType);
                                                const isSelected = selectedPins.includes(pinIdStr);
                                                const isDisabled = !isSelected && (!isCompatible || selectedPins.length >= selectedDevice.pinCount);
                                                const label = pin.id || pinIdStr;

                                                return (
                                                    <button
                                                        key={pinIdStr}
                                                        onClick={() => togglePinSelection(pinIdStr)}
                                                        disabled={isDisabled}
                                                        className={`
                                                            h-10 rounded border text-xs font-mono font-bold transition-all relative overflow-hidden flex flex-col items-center justify-center
                                                            ${isSelected ? 'bg-green-500 text-white border-green-600' : isDisabled ? 'bg-muted/50 opacity-40' : 'hover:bg-accent'}
                                                        `}
                                                    >
                                                        <span>{label}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                    {freePins.length === 0 && !deviceHasBus && (
                                        <div className="text-center text-red-400 text-sm mt-4">
                                            No free pins available!
                                        </div>
                                    )}
                                </div>

                                <div className="mt-4 pt-4 border-t">
                                    <Button
                                        className="w-full"
                                        onClick={handleAssign}
                                        disabled={selectedPins.length !== selectedDevice.pinCount}
                                    >
                                        Confirm Connection
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
