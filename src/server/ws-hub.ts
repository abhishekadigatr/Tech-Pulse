import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { consumeWsTicket } from './auth.ts';
import { all, get, run } from './db.ts';
import { storeCipherMessage } from './messages.ts';

export interface Hub {
  broadcast(userId: string, type: string, payload: Record<string, unknown>): void;
  broadcastAll(type: string, payload: Record<string, unknown>): void;
  conversationOnline(conversationId: string): number;
  disconnectUser(userId: string): void;
  close(): void;
}

declare global {
  var __techPulseHub: Hub | undefined;
}

export function getHub(): Hub | null {
  return globalThis.__techPulseHub ?? null;
}

interface Client {
  ws: WebSocket;
  userId: string;
  rooms: Set<string>;
  hits: number[];
  alive: boolean;
}

const memberIds = (conversationId: string): string[] =>
  all<{ user_id: string }>('SELECT user_id FROM conversation_members WHERE conversation_id=?', conversationId)
    .map((r) => r.user_id);

export function attachWebSocketHub(httpServer: HttpServer): Hub {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 });
  const clients = new Set<Client>();
  const byUser = new Map<string, Set<Client>>();

  const onlineUserIds = (): string[] => [...byUser.entries()].filter(([, set]) => set.size > 0).map(([id]) => id);
  const frame = (type: string, payload: Record<string, unknown>): string =>
    JSON.stringify({ type, ...payload, at: Date.now() });

  const send = (client: Client, type: string, payload: Record<string, unknown> = {}): void => {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(frame(type, payload));
  };

  const broadcastAll = (type: string, payload: Record<string, unknown>): void => {
    const data = frame(type, payload);
    for (const client of clients) if (client.ws.readyState === WebSocket.OPEN) client.ws.send(data);
  };

  const broadcast = (userId: string, type: string, payload: Record<string, unknown>): void => {
    const data = frame(type, payload);
    for (const client of byUser.get(userId) ?? []) if (client.ws.readyState === WebSocket.OPEN) client.ws.send(data);
  };

  const broadcastRoom = (conversationId: string, type: string, payload: Record<string, unknown>, except?: Client): void => {
    const data = frame(type, payload);
    for (const client of clients) {
      if (client !== except && client.rooms.has(conversationId) && client.ws.readyState === WebSocket.OPEN) client.ws.send(data);
    }
  };

  const isMember = (conversationId: string, userId: string): boolean =>
    Boolean(get('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?', conversationId, userId));

  wss.on('connection', (ws: WebSocket, _request: IncomingMessage, userId: string) => {
    const client: Client = { ws, userId, rooms: new Set(), hits: [], alive: true };
    clients.add(client);
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId)!.add(client);
    send(client, 'connected', { userId, online: onlineUserIds() });
    broadcastAll('presence', { online: onlineUserIds() });

    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (raw) => {
      const now = Date.now();
      client.hits = client.hits.filter((t) => t > now - 10_000);
      if (client.hits.length > 45) { send(client, 'error', { error: 'Rate limit exceeded' }); return; }
      client.hits.push(now);

      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (typeof msg.type !== 'string' || msg.type.length > 40) return;
      const conversationId = typeof msg.conversationId === 'string' ? msg.conversationId : '';
      if (!conversationId || conversationId.length > 80 || !isMember(conversationId, userId)) {
        send(client, 'error', { error: 'Not a member of this conversation' });
        return;
      }

      switch (msg.type) {
        case 'join': {
          client.rooms.add(conversationId);
          const members = new Set(memberIds(conversationId));
          send(client, 'joined', { conversationId, online: onlineUserIds().filter((id) => members.has(id)) });
          break;
        }
        case 'leave': {
          client.rooms.delete(conversationId);
          break;
        }
        case 'typing': {
          broadcastRoom(conversationId, 'typing', { conversationId, userId, typing: Boolean(msg.typing) }, client);
          break;
        }
        case 'read': {
          run('UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?', now, conversationId, userId);
          broadcastRoom(conversationId, 'read', { conversationId, userId, at: now }, client);
          break;
        }
        case 'message:send': {
          // The server never sees plaintext, keys, or anything it can decrypt.
          if (!storeCipherMessage(conversationId, userId, msg.ciphertext, msg.nonce)) {
            send(client, 'error', { error: 'Invalid encrypted payload' });
          }
          break;
        }
        case 'ping': {
          send(client, 'pong');
          break;
        }
        default:
          send(client, 'error', { error: 'Unknown event' });
      }
    });

    ws.on('close', () => {
      clients.delete(client);
      const set = byUser.get(userId);
      set?.delete(client);
      if (set?.size === 0) byUser.delete(userId);
      broadcastAll('presence', { online: onlineUserIds() });
    });
    ws.on('error', () => { /* close handler performs cleanup */ });
  });

  /** Only handle /ws upgrades; Next.js keeps its own HMR websocket handler. */
  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/ws') return;
    // CSWSH protection: a browser cannot open an authenticated socket cross-origin.
    if (request.headers.origin) {
      try {
        if (new URL(request.headers.origin).host !== request.headers.host) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
        }
      } catch { socket.destroy(); return; }
    }
    const userId = consumeWsTicket(url.searchParams.get('ticket') ?? '');
    if (!userId) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, userId));
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) { client.ws.terminate(); continue; }
      client.alive = false;
      if (client.ws.readyState === WebSocket.OPEN) client.ws.ping();
    }
  }, 30_000);
  heartbeat.unref?.();

  const hub: Hub = {
    broadcast,
    broadcastAll,
    disconnectUser(userId: string): void {
      for (const client of byUser.get(userId) ?? []) client.ws.close(1008, 'session revoked');
    },
    conversationOnline(conversationId: string): number {
      const members = new Set(memberIds(conversationId));
      return onlineUserIds().filter((id) => members.has(id)).length;
    },
    close(): void {
      clearInterval(heartbeat);
      for (const client of clients) client.ws.close(1001, 'server shutdown');
      wss.close();
    },
  };
  globalThis.__techPulseHub = hub;
  return hub;
}
