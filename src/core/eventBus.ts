import { EventEmitter } from 'node:events';

export const Events = Object.freeze({
  SCHEDULER_RUN: 'scheduler:run',
  SCHEDULER_PAUSE: 'scheduler:pause',
  CYCLE_COMPLETE: 'cycle:complete',
});

export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20);
  }

  
  emit(event: string | symbol, ...args: any[]): boolean {
    const listeners = this.listeners(event);

    for (const listener of listeners) {
      try {
        listener(...args);
      } catch (err) {
        console.error(`[EventBus] Listener error on "${String(event)}":`, err);
      }
    }

    return listeners.length > 0;
  }
}
