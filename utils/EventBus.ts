export type EventHandler<T = any> = (payload: T) => void | Promise<void>;

/**
 * Minimal async-capable pub/sub event bus used across services.
 */
export class EventBus {
  private subscribers: Map<string, Set<EventHandler>> = new Map();

  /** Subscribe a handler to a topic. Returns an unsubscribe function. */
  subscribe<T = any>(topic: string, handler: EventHandler<T>): () => void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }
    this.subscribers.get(topic)!.add(handler as EventHandler);
    return () => this.unsubscribe(topic, handler as EventHandler);
  }

  /** Publish an event to a topic; awaits async handlers sequentially. */
  async publish<T = any>(topic: string, payload: T): Promise<void> {
    const handlers = this.subscribers.get(topic);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      await handler(payload);
    }
  }

  /** Remove a handler from a topic. */
  unsubscribe<T = any>(topic: string, handler: EventHandler<T>): void {
    const handlers = this.subscribers.get(topic);
    if (!handlers) return;
    handlers.delete(handler as EventHandler);
    if (handlers.size === 0) {
      this.subscribers.delete(topic);
    }
  }

  /** Remove all subscribers (useful in tests). */
  clear(): void {
    this.subscribers.clear();
  }
}
