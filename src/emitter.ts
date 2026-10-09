// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

export type Emitter<E extends { [K in keyof E]: Listener }> = {
  on<K extends keyof E>(type: K, listener: E[K]): () => void;
  emit<K extends keyof E>(type: K, ...args: Parameters<E[K]>): void;
  clear(): void;
};

/**
 * A small typed emitter. A listener that throws doesn't stop the others, nor
 * the controller: its error is rethrown on its own, out of the way.
 */
export function createEmitter<
  E extends { [K in keyof E]: Listener },
>(): Emitter<E> {
  const listeners = new Map<keyof E, Set<Listener>>();
  return {
    on(type, listener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    emit(type, ...args) {
      const set = listeners.get(type);
      if (!set) {
        return;
      }
      for (const listener of [...set]) {
        try {
          listener(...args);
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}
