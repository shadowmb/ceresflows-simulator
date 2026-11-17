import { useState } from 'react';
import { ApiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Server, Wifi, Monitor, Tag, X, AlertTriangle } from 'lucide-react';

interface ControllerSettingsModalProps {
    data: {
        profileId?: string;
        profileName?: string;
        activeController?: string;
        udpPort?: number;
        mac?: string;
        mqttUrl?: string;
        mqttTopicId?: string;
    };
    onClose: () => void;
    onSave: () => void;
}

export function ControllerSettingsModal({ data, onClose, onSave }: ControllerSettingsModalProps) {
    const [network, setNetwork] = useState({
        udpPort: data.udpPort || 8888,
        mac: data.mac || '',
        mqttUrl: data.mqttUrl || '',
        mqttTopicId: data.mqttTopicId || ''
    });
    const [name, setName] = useState(data.profileName || '');
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Update Profile
            if (data.profileId) {
                await ApiClient.put(`/api/profiles/${data.profileId}`, {
                    name,
                    ...network
                });

                // Close UI immediately
                onClose();

                // Restart Session with updated profile (background)
                await ApiClient.post('/api/setup', { profileId: data.profileId });
                onSave();
            } else {
                alert('Cannot update manual session. Please create a profile first.');
                setIsSaving(false);
            }
        } catch (e) {
            console.error(e);
            alert('Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-slate-900 rounded-xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                    <div>
                        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                            <SettingsIcon className="h-5 w-5 text-blue-400" /> Controller Settings
                        </h2>
                        <p className="text-xs text-slate-400">Modify hardware configuration</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-5">

                    {/* Name */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                            <Tag className="h-3.5 w-3.5" /> Profile Name
                        </label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="flex h-9 w-full rounded border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>

                    {/* Network */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                                <Server className="h-3.5 w-3.5" /> UDP Port
                            </label>
                            <input
                                type="number"
                                value={network.udpPort}
                                onChange={e => setNetwork({ ...network, udpPort: parseInt(e.target.value) || 8888 })}
                                className="flex h-9 w-full rounded border border-slate-700 bg-slate-800 px-3 py-1 text-sm font-mono text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                                <Wifi className="h-3.5 w-3.5" /> MAC Address
                            </label>
                            <input
                                value={network.mac}
                                onChange={e => setNetwork({ ...network, mac: e.target.value })}
                                className="flex h-9 w-full rounded border border-slate-700 bg-slate-800 px-3 py-1 text-[10px] font-mono text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>

                    {/* MQTT */}
                    <div className="space-y-3 pt-2 border-t border-slate-800/50">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                                <Monitor className="h-3.5 w-3.5" /> MQTT Broker URL
                            </label>
                            <input
                                value={network.mqttUrl}
                                onChange={e => setNetwork({ ...network, mqttUrl: e.target.value })}
                                className="flex h-9 w-full rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                                <Tag className="h-3.5 w-3.5" /> Device ID (Topic)
                            </label>
                            <div className="flex gap-2">
                                <input
                                    value={network.mqttTopicId}
                                    placeholder="Leave empty for auto-generated"
                                    onChange={e => setNetwork({ ...network, mqttTopicId: e.target.value })}
                                    className="flex h-9 w-full rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-9 border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
                                    onClick={() => setNetwork({ ...network, mqttTopicId: network.mac.replace(/[^0-9A-F]/g, '') })}
                                >
                                    MAC
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-yellow-500 text-[10px]">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <p>Changing network settings will restart the simulated controller connection.</p>
                    </div>

                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-900/50 border-t border-slate-800 flex justify-end gap-3">
                    <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white">
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-blue-600 hover:bg-blue-500 text-white min-w-[100px]"
                    >
                        {isSaving ? 'Saving...' : 'Save & Restart'}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function SettingsIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    )
}
