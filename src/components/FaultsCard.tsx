import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiClient } from '@/lib/api';

export interface FaultsState {
  offline: boolean;
  responseDelaySec: number;
}

interface FaultsCardProps {
  faults: FaultsState;
  onChange: (faults: FaultsState) => void;
}

export function FaultsCard({ faults, onChange }: FaultsCardProps) {
  const [delayDraft, setDelayDraft] = useState(String(faults.responseDelaySec));
  const [error, setError] = useState<string | null>(null);

  const draftValue = Number(delayDraft);
  const draftValid = delayDraft.trim() !== '' && Number.isFinite(draftValue) && draftValue >= 0 && draftValue <= 120;
  const faultActive = faults.offline || faults.responseDelaySec > 0;

  const send = async (body: Partial<FaultsState>): Promise<FaultsState | null> => {
    try {
      const updated = await ApiClient.post<FaultsState>('/api/faults', body);
      onChange(updated);
      setError(null);
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const applyDelay = async () => {
    const updated = await send({ responseDelaySec: draftValue });
    if (updated) setDelayDraft(String(updated.responseDelaySec));
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Faults</CardTitle>
        {faultActive && <Badge variant="destructive">Fault active</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={faults.offline}
            onChange={(e) => send({ offline: e.target.checked })}
          />
          Simulate offline (no answers)
        </label>

        <div className="space-y-2">
          <label htmlFor="response-delay" className="text-sm">Response delay (s)</label>
          <div className="flex gap-2">
            <input
              id="response-delay"
              type="number"
              min={0}
              max={120}
              step="0.5"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={delayDraft}
              onChange={(e) => setDelayDraft(e.target.value)}
            />
            <Button size="sm" variant="outline" disabled={!draftValid} onClick={applyDelay}>Apply</Button>
          </div>
          {!draftValid && <p className="text-xs text-destructive">Enter a number from 0 to 120.</p>}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
