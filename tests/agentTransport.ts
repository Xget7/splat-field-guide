import type { SocketPort } from '../apps/field-guide/src/features/instructor/agent/agentClient';

export function fakeAgentTransport() {
  const sockets: SocketPort[] = [];
  const closed = new Set<SocketPort>();
  const sent: unknown[] = [];
  return {
    connect() {
      const socket: SocketPort = {
        send: data => sent.push(JSON.parse(data)),
        close: () => {
          closed.add(socket);
        },
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
      };
      sockets.push(socket);
      return socket;
    },
    receive(message: unknown) {
      sockets.at(-1)?.onmessage?.({ data: JSON.stringify(message) });
    },
    get current() {
      return sockets.at(-1)!;
    },
    get connections() {
      return sockets.length;
    },
    get open() {
      return sockets.filter(socket => !closed.has(socket)).length;
    },
    sent,
  };
}
