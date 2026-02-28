import { describe, it, expect, vi } from 'vitest';
import { EventBus, Events } from '../eventBus.js';

describe('EventBus', () => {
  it('emits events to subscribed listeners', () => {
    const bus = new EventBus();
    const spy = vi.fn();

    bus.on(Events.SCHEDULER_RUN, spy);
    bus.emit(Events.SCHEDULER_RUN);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('supports multiple listeners on the same event', () => {
    const bus = new EventBus();
    const spy1 = vi.fn();
    const spy2 = vi.fn();

    bus.on(Events.SCHEDULER_RUN, spy1);
    bus.on(Events.SCHEDULER_RUN, spy2);
    bus.emit(Events.SCHEDULER_RUN);

    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);
  });

  it('does not call removed listeners', () => {
    const bus = new EventBus();
    const spy = vi.fn();

    bus.on(Events.SCHEDULER_RUN, spy);
    bus.removeListener(Events.SCHEDULER_RUN, spy);
    bus.emit(Events.SCHEDULER_RUN);

    expect(spy).not.toHaveBeenCalled();
  });

  it('catches listener errors without propagating', () => {
    const bus = new EventBus();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const safeSpy = vi.fn();

    bus.on(Events.SCHEDULER_RUN, () => {
      throw new Error('boom');
    });
    bus.on(Events.SCHEDULER_RUN, safeSpy);
    bus.emit(Events.SCHEDULER_RUN);

    // Second listener should still be called
    expect(safeSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('returns false when no listeners exist', () => {
    const bus = new EventBus();
    const result = bus.emit('nonexistent');
    expect(result).toBe(false);
  });

  it('passes payload arguments to listeners', () => {
    const bus = new EventBus();
    const spy = vi.fn();

    bus.on(Events.CYCLE_COMPLETE, spy);
    bus.emit(Events.CYCLE_COMPLETE, { success: true, duration: 42 });

    expect(spy).toHaveBeenCalledWith({ success: true, duration: 42 });
  });
});
