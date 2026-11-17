import { useEffect, useState } from 'react';
import { ControllerInfo, PinAssignment, PinDefinition, SimulatorState } from './types';
import { ApiClient } from './lib/api';
import { useUdpLog } from './hooks/useUdpLog';
import { ControllerCard } from './components/ControllerCard';
import { PinGrid } from './components/PinGrid';
import { SensorList } from './components/SensorList';
import { AssignmentModal } from './components/AssignmentModal';
import { ProfileSelector } from './components/ProfileSelector';
import { ScenarioStudio } from './components/ScenarioStudio';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Activity, Terminal, LayoutDashboard, PlayCircle } from 'lucide-react';

import { ControllerSettingsModal } from './components/ControllerSettingsModal';

function App() {
  const [controller, setController] = useState<ControllerInfo | null>(null);
  const [assignments, setAssignments] = useState<PinAssignment[]>([]);
  const [status, setStatus] = useState<any>({ configured: false });
  const [initialized, setInitialized] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [view, setView] = useState<'dashboard' | 'scenarios'>('dashboard');
  const [lastConfig, setLastConfig] = useState<any>(null);
  const { logs, isConnected } = useUdpLog();

  // Initial Load
  const loadData = async () => {
    try {
      const statusData = await ApiClient.get<any>('/api/status');
      setStatus(statusData);

      if (statusData.configured) {
        const [ctrlData, assignData] = await Promise.all([
          ApiClient.get<ControllerInfo>('/api/controller'),
          ApiClient.get<PinAssignment[]>('/api/assignments')
        ]);
        setController(ctrlData);
        setAssignments(assignData);
      }
    } catch (e) {
      console.error('Failed to load initial data', e);
    } finally {
      setInitialized(true);
    }
  };

  useEffect(() => {
    loadData();
    // Poll for status updates every 2s
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleExit = async () => {
    if (confirm("Stop simulation and return to profile list?")) {
      // Create a copy for 'lastConfig' in case they want to clone it immediately
      // setLastConfig(status); // Disabled: User doesn't want auto-open on exit
      setLastConfig(null);
      await ApiClient.post('/api/reconfigure', {});
      // Force reload to clear state and show selector
      setStatus({ configured: false });
      setController(null);
    }
  };

  const handleProfileSelected = async (profileId: string) => {
    try {
      await ApiClient.post('/api/setup', { profileId });
      setLastConfig(null); // Clear last config on success
      await loadData();
    } catch (e) {
      console.error(e);
      alert('Failed to load profile');
    }
  };

  if (!initialized) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">Initializing Simulator...</div>;
  }

  if (!status.configured) {
    return <ProfileSelector onSelect={handleProfileSelected} initialValues={lastConfig} />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header & Nav */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Hydroponics Sim</h1>
            <p className="text-muted-foreground text-sm">v4.0.0 (Scenarios & Calibration)</p>
          </div>

          <div className="flex bg-muted/50 p-1 rounded-lg">
            <button
              onClick={() => setView('dashboard')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${view === 'dashboard' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </button>
            <button
              onClick={() => setView('scenarios')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${view === 'scenarios' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <PlayCircle className="h-4 w-4" /> Scenarios
            </button>
          </div>
        </header>

        {/* Dashboard View */}
        {view === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* LEFT COLUMN: Controls & Status */}
            <div className="space-y-6 lg:col-span-1">
              <ControllerCard
                data={status}
                onExit={handleExit}
                onEdit={() => setShowEditModal(true)}
              />

              {controller && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <h3 className="text-sm font-medium text-muted-foreground">Controller Pins</h3>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddModal(true)}>
                      + Add Device
                    </Button>
                  </div>

                  <Card className="max-h-[500px] overflow-y-auto">
                    <CardContent className="p-0">
                      <PinGrid
                        pins={controller.pins}
                        assignments={assignments}
                        onSelectPin={() => setShowAddModal(true)}
                      />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* UDP Log */}
              <Card className="h-[300px] flex flex-col">
                <CardHeader className="p-3 pb-0">
                  <CardTitle className="text-sm font-mono flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" /> UDP Log
                    </span>
                    <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2 pt-2 flex-1 overflow-hidden font-mono text-[10px]">
                  <div className="h-full overflow-y-auto space-y-1 bg-black/90 text-green-400 p-2 rounded">
                    {logs.length === 0 && <span className="opacity-50 text-gray-500">Waiting for UDP traffic...</span>}
                    {logs.map((log: any, i) => {
                      let content = log.message;
                      if (!content) {
                        if (log.type === 'incoming') content = `← ${log.from} | ${log.command}`;
                        if (log.type === 'outgoing') content = `→ ${log.response}`;
                      }
                      const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';

                      return (
                        <div key={i} className="whitespace-pre-wrap break-all border-b border-white/10 pb-0.5 mb-0.5 last:border-0 font-mono text-[10px]">
                          <span className="text-gray-500">[{timeStr}]</span>
                          <span className={log.type === 'outgoing' ? 'text-blue-400 ml-1' : 'text-green-400 ml-1'}>
                            {content}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* RIGHT COLUMN: Sensor List */}
            <div className="lg:col-span-2 space-y-4">
              <SensorList assignments={assignments} onUpdate={loadData} />
            </div>
          </div>
        )}

        {/* Scenarios View */}
        {view === 'scenarios' && (
          <ScenarioStudio assignments={assignments} />
        )}

        {controller && showAddModal && (
          <AssignmentModal
            availablePins={controller.pins}
            assignments={assignments}
            onClose={() => setShowAddModal(false)}
            onAssign={loadData}
          />
        )}

        {showEditModal && status.configured && (
          <ControllerSettingsModal
            data={status}
            onClose={() => setShowEditModal(false)}
            onSave={loadData}
          />
        )}

      </div>
    </div>
  );
}

export default App;
