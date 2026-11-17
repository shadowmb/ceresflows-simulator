import { useEffect, useState } from 'react';
import { ApiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Play, Dices, X, Monitor, Server, Wifi, Cpu, Tag } from 'lucide-react';

interface Profile {
    id: string;
    name: string;
    controllerType: string;
    udpPort: number;
    mac: string;
    mqttUrl?: string;
    mqttTopicId?: string;
    lastUsed: string;
}

interface ControllerOption {
    key: string;
    label: string;
}

interface ProfileSelectorProps {
    onSelect: (profileId: string) => void;
    initialValues?: any;
}

export function ProfileSelector({ onSelect, initialValues }: ProfileSelectorProps) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [controllers, setControllers] = useState<ControllerOption[]>([]);

    // Create Modal State
    const [isCreateOpen, setIsCreateOpen] = useState(!!initialValues);
    const [newProfile, setNewProfile] = useState<{
        name: string;
        controllerType: string;
        udpPort: number;
        mac: string;
        mqttUrl: string;
        mqttTopicId: string;
    }>({
        name: initialValues?.profileName || '',
        controllerType: initialValues?.activeController || 'Arduino_Uno_R4_WiFi',
        udpPort: initialValues?.udpPort || 8888,
        mac: initialValues?.mac || '',
        mqttUrl: initialValues?.mqttUrl || 'mqtt://127.0.0.1:1883',
        mqttTopicId: initialValues?.mqttTopicId || ''
    });

    const loadData = () => {
        setLoading(true);
        Promise.all([
            ApiClient.get<Profile[]>('/api/profiles'),
            ApiClient.get<ControllerOption[]>('/api/controllers')
        ])
            .then(([p, c]) => {
                setProfiles(p);
                setControllers(c);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadData();
    }, []);

    // Generate random MAC on mount or request
    const generateMac = () => {
        const hex = () => Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0');
        return `SIM:02:${hex()}:${hex()}:${hex()}:${hex()}`;
    };

    useEffect(() => {
        if (isCreateOpen && !newProfile.mac) {
            setNewProfile(prev => ({ ...prev, mac: generateMac() }));
        }
    }, [isCreateOpen]);

    const handleCreate = async () => {
        if (!newProfile.name) return alert('Profile Name is required');

        try {
            // Send create request
            const created = await ApiClient.post<Profile>('/api/profiles', newProfile);

            // Close modal and select the new profile
            setIsCreateOpen(false);
            await loadData();

            // Auto-start
            if (created && created.id) {
                onSelect(created.id);
            }
        } catch (e) {
            console.error(e);
            alert('Failed to create profile');
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this profile? All sensor assignments will be lost.')) return;

        try {
            await ApiClient.delete(`/api/profiles/${id}`);
            loadData();
        } catch (e) {
            console.error(e);
            alert('Failed to delete profile');
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-lg space-y-8">
                <div className="text-center">
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
                        🌱 Hydroponics Hardware Simulator v2
                    </h1>
                    <p className="text-slate-400">Select a simulator profile to begin</p>
                </div>

                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 max-h-[60vh] overflow-y-auto space-y-3 shadow-inner">
                    {loading ? (
                        <div className="text-center py-8 text-slate-500">Loading profiles...</div>
                    ) : profiles.length === 0 ? (
                        <div className="text-center py-8 text-slate-500">No profiles found. Create one to start.</div>
                    ) : (
                        profiles.map(profile => (
                            <div
                                key={profile.id}
                                onClick={() => onSelect(profile.id)}
                                className="group relative flex items-center justify-between p-4 bg-slate-800 hover:bg-slate-700/80 border border-slate-700 hover:border-blue-500/50 rounded-lg cursor-pointer transition-all"
                            >
                                <div>
                                    <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">
                                        {profile.name}
                                    </h3>
                                    <div className="text-xs text-slate-400 mt-1 flex gap-2">
                                        <Badge variant="outline" className="text-[10px] h-4 border-slate-600 bg-slate-900/50">
                                            {controllers.find(c => c.key === profile.controllerType)?.label || profile.controllerType}
                                        </Badge>
                                        <span className="flex items-center gap-1 font-mono text-[10px] bg-black/20 px-1 rounded">
                                            UDP {profile.udpPort}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 mt-1 font-mono">
                                        Last: {new Date(profile.lastUsed).toLocaleDateString()}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={(e) => handleDelete(e, profile.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                    <Button size="icon" className="h-8 w-8 bg-blue-600 hover:bg-blue-500">
                                        <Play className="h-4 w-4 fill-current" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <Button
                    variant="default"
                    size="lg"
                    className="w-full h-12 text-lg font-medium bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all border-0 shadow-lg shadow-blue-900/20"
                    onClick={() => setIsCreateOpen(true)}
                >
                    <Plus className="mr-2 h-5 w-5" />
                    New Simulator Profile
                </Button>
            </div>

            {/* CUSTOM MODAL */}
            {isCreateOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md bg-slate-900 rounded-xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
                            <div>
                                <h2 className="text-lg font-semibold text-white">New Simulator Profile</h2>
                                <p className="text-xs text-slate-400">Configure virtual hardware settings</p>
                            </div>
                            <button onClick={() => setIsCreateOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-4">
                            {/* Profile Name */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                                    <Tag className="h-3 w-3" /> Profile Name
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Tomatoes Tank 1"
                                    value={newProfile.name}
                                    onChange={e => setNewProfile({ ...newProfile, name: e.target.value })}
                                    className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm ring-offset-background placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 text-white"
                                />
                            </div>

                            {/* Controller */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                                    <Cpu className="h-3 w-3" /> Controller Model
                                </label>
                                <select
                                    value={newProfile.controllerType}
                                    onChange={e => setNewProfile({ ...newProfile, controllerType: e.target.value })}
                                    className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {controllers.map(c => (
                                        <option key={c.key} value={c.key}>{c.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {/* UDP Port */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                                        <Server className="h-3 w-3" /> UDP Port
                                    </label>
                                    <input
                                        type="number"
                                        value={newProfile.udpPort}
                                        onChange={e => setNewProfile({ ...newProfile, udpPort: parseInt(e.target.value) || 8888 })}
                                        className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                {/* MAC Address */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                                        <Wifi className="h-3 w-3" /> MAC Address
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            value={newProfile.mac}
                                            onChange={e => setNewProfile({ ...newProfile, mac: e.target.value })}
                                            className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-[10px] font-mono text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <Button
                                            variant="outline" size="icon"
                                            className="h-10 w-10 border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300"
                                            onClick={() => setNewProfile({ ...newProfile, mac: generateMac() })}
                                            title="Generate Random MAC"
                                        >
                                            <Dices className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* MQTT */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                                    <Monitor className="h-3 w-3" /> MQTT Broker URL
                                </label>
                                <input
                                    value={newProfile.mqttUrl}
                                    onChange={e => setNewProfile({ ...newProfile, mqttUrl: e.target.value })}
                                    className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                                    <Tag className="h-3 w-3" /> Device ID (Topic)
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        placeholder="Leave empty to auto-generate from MAC"
                                        value={newProfile.mqttTopicId}
                                        onChange={e => setNewProfile({ ...newProfile, mqttTopicId: e.target.value })}
                                        className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <Button
                                        variant="outline"
                                        className="h-10 px-3 border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                                        onClick={() => setNewProfile({
                                            ...newProfile,
                                            mqttTopicId: newProfile.mac.replace(/[^0-9A-F]/g, '')
                                        })}
                                    >
                                        Use MAC
                                    </Button>
                                </div>
                            </div>

                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-slate-900/50 border-t border-slate-800 flex justify-end gap-3">
                            <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => setIsCreateOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreate}
                                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-900/20"
                            >
                                <Play className="mr-2 h-4 w-4" />
                                Create & Start
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
