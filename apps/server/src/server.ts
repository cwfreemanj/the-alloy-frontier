/** WebSocket transport for the Phase C proof. Local only; no paid infrastructure. */
import { WebSocketServer, type WebSocket } from 'ws';
import { Room } from './room';

export interface RunningServer {
  port: number;
  room: Room;
  close: () => Promise<void>;
}

export function startServer(port = 2567, tickHz = 10): Promise<RunningServer> {
  return new Promise((resolve) => {
    const room = new Room();
    const wss = new WebSocketServer({ port, host: '127.0.0.1', maxPayload: 64 * 1024 });
    wss.on('connection', (ws: WebSocket) => {
      let playerId: string | null = null;
      const send = (m: unknown) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      };
      ws.on('message', (data) => {
        playerId = room.handle(playerId, data.toString(), send);
      });
      ws.on('close', () => room.disconnect(playerId));
    });
    const timer = setInterval(() => room.broadcast(), 1000 / tickHz);
    wss.on('listening', () => {
      const addr = wss.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : port,
        room,
        close: () =>
          new Promise<void>((r) => {
            clearInterval(timer);
            for (const c of wss.clients) c.terminate();
            wss.close(() => r());
          }),
      });
    });
  });
}
