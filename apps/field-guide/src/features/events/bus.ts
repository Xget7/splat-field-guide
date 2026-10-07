import type { AppEvents } from './types';

export interface EventBus<E> {
  emit<K extends keyof E>(type: K, payload: E[K]): void;
  on<K extends keyof E>(type: K, listener: (payload: E[K]) => void): () => void;
  latest<K extends keyof E>(type: K): E[K] | undefined;
}

const LISTENER_FAILED = 'App event listener failed';

export function createEventBus<E>(): EventBus<E> {
  const values: Partial<E> = {};
  const listeners: { [K in keyof E]?: Set<(payload: E[K]) => void> } = {};
  return {
    emit(type, payload) {
      values[type] = payload;
      for (const listener of [...(listeners[type] ?? [])]) {
        try {
          listener(payload);
        } catch (error) {
          console.warn(LISTENER_FAILED, error);
        }
      }
    },
    on(type, listener) {
      const group = listeners[type] ?? new Set();
      listeners[type] = group;
      group.add(listener);
      return () => {
        group.delete(listener);
      };
    },
    latest: type => values[type],
  };
}

export const appEvents: EventBus<AppEvents> = createEventBus<AppEvents>();
