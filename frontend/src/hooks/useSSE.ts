import { useEffect, useRef, useCallback, useState } from 'react';

export function useSSE(url: string, onEvent: (event: string, data: unknown) => void) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const cbRef = useRef(onEvent);

  useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();

    const token = localStorage.getItem('kap_token');
    const es = new EventSource(`${url}?token=${token}`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const events = ['state', 'batch_start', 'progress', 'company_done', 'company_error', 'company_skip', 'batch_done', 'batch_stopped'];
    for (const evt of events) {
      es.addEventListener(evt, (e: MessageEvent) => {
        let payload: unknown;
        try {
          payload = JSON.parse(e.data);
        } catch {
          payload = e.data;
        }
        cbRef.current(evt, payload);
      });
    }

    return es;
  }, [url]);

  const disconnect = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setConnected(false);
  }, []);

  useEffect(() => () => { esRef.current?.close(); }, []);

  return { connect, disconnect, connected };
}
