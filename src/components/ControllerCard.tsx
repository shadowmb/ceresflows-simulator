import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Cpu, Settings, LogOut } from 'lucide-react';

interface ControllerCardProps {
    data: {
        activeController: string;
        configured: boolean;
        udpPort?: number;
        mac?: string;
        mqttUrl?: string;
        mqttTopicId?: string;
        profileName?: string;
        profileId?: string;
    };
    onExit: () => void;
    onEdit: () => void;
}

export function ControllerCard({ data, onExit, onEdit }: ControllerCardProps) {
    return (
        <Card className="w-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    Controller Status
                    {data.configured && (
                        <button onClick={onEdit} className="text-muted-foreground hover:text-foreground transition-colors" title="Edit Settings">
                            <Settings className="h-3.5 w-3.5" />
                        </button>
                    )}
                </CardTitle>
                {data.configured ? (
                    <Badge variant="default" className="bg-green-600"><Wifi className="mr-1 h-3 w-3" /> Online</Badge>
                ) : (
                    <Badge variant="destructive"><WifiOff className="mr-1 h-3 w-3" /> Offline</Badge>
                )}
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold flex items-center gap-2">
                    <Cpu className="h-6 w-6 text-muted-foreground" />
                    {data.profileName || data.activeController}
                </div>
                <div className="text-xs text-muted-foreground mt-1 space-y-1">
                    <div>PORT: {data.udpPort || 'N/A'} | MAC: {data.mac || 'N/A'}</div>
                    {data.mqttUrl && (
                        <div className="flex flex-col gap-0.5 pt-1 border-t mt-1">
                            <span className="font-semibold text-[10px] uppercase">MQTT Broker</span>
                            <span className="font-mono text-[10px] truncate" title={data.mqttUrl}>{data.mqttUrl}</span>
                            {data.mqttTopicId && <span className="font-mono text-[10px] text-muted-foreground">Topic: {data.mqttTopicId}</span>}
                        </div>
                    )}
                </div>
                {data.configured && (
                    <div className="flex justify-between items-center mt-4 border-t pt-2">
                        <button
                            onClick={onExit}
                            className="text-xs text-red-400 hover:text-red-300 underline flex items-center gap-1"
                        >
                            <LogOut className="h-3 w-3" /> Exit Session
                        </button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
