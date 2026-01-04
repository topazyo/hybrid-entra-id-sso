import { EventBus } from '../../utils/EventBus';

describe('EventBus', () => {
  it('publishes payloads to subscribers', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.subscribe('topic', async payload => {
      received.push(payload);
    });

    await bus.publish('topic', 'hello');
    await bus.publish('topic', 'world');

    expect(received).toEqual(['hello', 'world']);
  });

  it('supports unsubscribe', async () => {
    const bus = new EventBus();
    const received: string[] = [];

    const handler = (payload: string) => {
      received.push(payload);
    };
    const unsubscribe = bus.subscribe('topic', handler);

    await bus.publish('topic', 'first');
    unsubscribe();
    await bus.publish('topic', 'second');

    expect(received).toEqual(['first']);
  });
});
