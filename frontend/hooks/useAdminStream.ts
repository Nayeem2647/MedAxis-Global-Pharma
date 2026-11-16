'use client';

import { useEffect, useRef, useState } from 'react';
import { AdminStreamConnection, type AdminStreamEvent, type StreamState } from '../lib/admin-stream';

export function useAdminStream({ enabled, onEvent, onReconnect, onUnauthorized }: { enabled: boolean; onEvent(event: AdminStreamEvent): void; onReconnect(): void; onUnauthorized(): void }) {
  const [state, setState] = useState<StreamState>('connecting');
  const callbacks = useRef({ onEvent, onReconnect, onUnauthorized });
  useEffect(() => { callbacks.current = { onEvent, onReconnect, onUnauthorized }; }, [onEvent, onReconnect, onUnauthorized]);
  useEffect(() => {
    if (!enabled) return;
    const connection = new AdminStreamConnection({ event: (event) => callbacks.current.onEvent(event), reconnect: () => callbacks.current.onReconnect(), unauthorized: () => callbacks.current.onUnauthorized(), state: setState });
    connection.start(); return () => connection.stop();
  }, [enabled]);
  return state;
}
