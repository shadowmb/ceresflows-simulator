import { useState, useEffect } from 'react';

interface UdpLogEntry {
    type: 'incoming' | 'outgoing' | 'connected' | 'error';
    message?: string;
    from?: string;
    command?: string;
    response?: string;
    timestamp?: string;
}

export function useUdpLog() {
    const [logs, setLogs] = useState<UdpLogEntry[]>([]);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const eventSource = new EventSource('/api/udp-log');

        eventSource.onopen = () => {
            setIsConnected(true);
            setLogs(prev => [...prev, { type: 'connected', message: 'Connected to UDP Log Stream' }]);
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Limit logs to last 50 entries to prevent memory leak
                setLogs(prev => [data, ...prev].slice(0, 50));
            } catch (e) {
                console.error('Failed to parse SSE message', e);
            }
        };

        eventSource.onerror = () => {
            setIsConnected(false);
            eventSource.close();
            // Optional: Implement retry logic here
        };

        return () => {
            eventSource.close();
        };
    }, []);

    const clearLogs = () => setLogs([]);

    return { logs, isConnected, clearLogs };
}
