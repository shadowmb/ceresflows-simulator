import { PinDefinition, PinAssignment } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
// import { Plus, X } from 'lucide-react'; // Unused in this version? Wait, we used Badge instead.
import { Badge } from '@/components/ui/badge';

interface PinGridProps {
    pins: PinDefinition[];
    assignments: PinAssignment[];
    onSelectPin: (pin: PinDefinition) => void;
}

export function PinGrid({ pins, assignments, onSelectPin }: PinGridProps) {
    if (!pins || pins.length === 0) return <div>No pins available</div>;

    // Helper to find assignment for a pin
    const findAssignment = (pinId: string) => {
        return assignments.find(a => a.pins.some(p => p === pinId));
    };

    return (
        <Card className="col-span-1">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="bg-primary h-4 w-1 rounded-full" />
                    Controller Pins
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-4 lg:grid-cols-5 gap-2">
                    {pins.map((pin) => {
                        // Compare as strings to be safe (backend sends number, assignments use strings)
                        const assignment = findAssignment(String(pin.pin));

                        // Handle type (can be string or string[])
                        const typeStr = Array.isArray(pin.type)
                            ? pin.type.join(',').toUpperCase()
                            : String(pin.type || '').toUpperCase();

                        const isDigital = typeStr.includes('DIGITAL');
                        const isAnalog = typeStr.includes('ANALOG');

                        // Use ID (e.g. "A0") if available, fallback to PIN number
                        const displayId = pin.id || String(pin.pin);
                        // Make sure we show GPIO number too if different
                        const showGpio = pin.id && pin.id !== String(pin.pin);

                        return (
                            <button
                                key={pin.pin}
                                onClick={() => onSelectPin(pin)}
                                disabled={!!assignment}
                                title={pin.label || `GPIO ${pin.pin}`}
                                className={cn(
                                    "relative flex flex-col items-center justify-center p-2 h-16 rounded-md border text-xs transition-all",
                                    assignment
                                        ? "bg-secondary/50 border-primary/20 text-muted-foreground cursor-not-allowed"
                                        : "bg-background hover:bg-accent hover:border-primary/50 cursor-pointer"
                                )}
                            >
                                <span className="font-bold text-sm mb-1">{displayId}</span>
                                {showGpio && (
                                    <span className="text-[10px] text-muted-foreground scale-75 -mt-1">GPIO {pin.pin}</span>
                                )}
                                <div className="flex gap-1 mt-1">
                                    {isDigital && <span className="text-[10px] text-muted-foreground font-mono">D</span>}
                                    {isAnalog && <span className="text-[10px] text-blue-400 font-mono">A</span>}
                                </div>
                                {assignment && (
                                    <div className="absolute top-1 right-1">
                                        <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
