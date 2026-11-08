'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { api, setCsrfToken } from '@/lib/api-client';
import type { Me } from '@/lib/types';

/* ── Toasts ──────────────────────────────────────────────────────────────── */
type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; kind: ToastKind }

const ToastContext = createContext<{ toast: (message: string, kind?: ToastKind) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, message, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(360px,calc(100vw-40px))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind} animate-slide-up`} role="status">
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${t.kind === 'error' ? 'bg-rose' : t.kind === 'info' ? 'bg-violet' : 'bg-cyan'}`} />
            <span className="text-sm leading-snug">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ── Auth ────────────────────────────────────────────────────────────────── */
interface AuthState {
  me: Me | null;
  loading: boolean;
  setMe: (me: Me | null) => void;
  refreshMe: () => Promise<Me | null>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState>({ me: null, loading: true, setMe: () => {}, refreshMe: async () => null, logout: async () => {} });
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshMe = useCallback(async (): Promise<Me | null> => {
    try {
      const result = await api<{ me: Me | null; csrfToken: string | null }>('/auth/me');
      if (result.csrfToken) setCsrfToken(result.csrfToken);
      setMe(result.me);
      return result.me;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refreshMe(); }, [refreshMe]);
  useEffect(() => {
    if (me?.settings?.theme) document.documentElement.dataset.theme = me.settings.theme;
  }, [me?.settings?.theme]);
  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    setMe(null);
    window.location.href = '/login';
  }, []);
  const value = useMemo(() => ({ me, loading, setMe, refreshMe, logout }), [me, loading, refreshMe, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ── One shared WebSocket connection (single source of realtime events) ──── */
export interface SocketFrame { type: string; [key: string]: unknown }
interface SocketState {
  status: 'connecting' | 'open' | 'closed';
  send: (frame: Record<string, unknown>) => void;
  subscribe: (listener: (frame: SocketFrame) => void) => () => void;
  online: string[];
}
const SocketContext = createContext<SocketState>({ status: 'closed', send: () => {}, subscribe: () => () => {}, online: [] });
export const useSocket = () => useContext(SocketContext);

function SocketProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<(frame: SocketFrame) => void>());
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SocketState['status']>('closed');
  const [online, setOnline] = useState<string[]>([]);

  useEffect(() => {
    if (!me) { setStatus('closed'); return; }
    let disposed = false;
    const connect = async (): Promise<void> => {
      if (disposed) return;
      setStatus('connecting');
      try {
        const { ticket } = await api<{ ticket: string }>('/auth/ws-ticket', { method: 'POST' });
        if (disposed) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
        wsRef.current = ws;
        ws.onopen = () => setStatus('open');
        ws.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data as string) as SocketFrame;
            if ((frame.type === 'presence' || frame.type === 'connected') && Array.isArray(frame.online)) setOnline(frame.online as string[]);
            for (const listener of listeners.current) listener(frame);
          } catch { /* ignore malformed frames */ }
        };
        ws.onclose = () => {
          setStatus('closed');
          if (!disposed) retryRef.current = setTimeout(() => void connect(), 2500);
        };
        ws.onerror = () => ws.close();
      } catch {
        if (!disposed) retryRef.current = setTimeout(() => void connect(), 4000);
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setOnline([]);
    };
  }, [me?.id]);
  const value = useMemo<SocketState>(() => ({
    status, online,
    send: (frame) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    },
    subscribe: (listener) => {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
  }), [status, online]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

/* ── Global notification + PWA registration ─────────────────────────────── */
function GlobalEffects() {
  const { me } = useAuth();
  const { subscribe } = useSocket();
  const { toast } = useToast();
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ });
    }
  }, []);
  useEffect(() => subscribe((frame) => {
    if (frame.type === 'notification:new') {
      const n = frame.notification as { title?: string; body?: string } | undefined;
      if (n?.title) {
        window.dispatchEvent(new Event('tp:notifications'));
        toast(`${n.title}${n.body ? ` — ${n.body}` : ''}`, 'info');
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
          new Notification(n.title, { body: n.body ?? '', icon: '/icon.svg' });
        }
      }
    }
    if (frame.type === 'team:update') toast('Your team was updated. Check Collaborate.', 'info');
  }), [subscribe, toast]);
  useEffect(() => {
    if (me && typeof Notification !== 'undefined' && Notification.permission === 'default' && me.settings.notifyPush) {
      void Notification.requestPermission();
    }
  }, [me?.id, me?.settings.notifyPush]);  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <SocketProvider>
          <GlobalEffects />
          {children}
        </SocketProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
