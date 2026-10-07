import type { SocketPort } from '../apps/field-guide/src/features/instructor/agent/agentClient';

export const AGENT_METADATA = {
  type: 'conversation_initiation_metadata',
  conversation_initiation_metadata_event: {
    conversation_id: 'conversation',
    user_input_audio_format: 'pcm_16000',
    agent_output_audio_format: 'pcm_24000',
  },
};

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
    ready() {
      sockets.at(-1)?.onopen?.();
      this.receive(AGENT_METADATA);
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
