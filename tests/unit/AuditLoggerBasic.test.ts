import { AuditLogger, LogProvider } from '../../src/services/AuditLogger';

describe('AuditLogger', () => {
  it('merges global context into eventDetails', () => {
    const calls: any[] = [];
    const mockProvider: LogProvider = {
      info: (_msg, meta) => calls.push(meta),
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };

    const logger = new AuditLogger(mockProvider);
    logger.setGlobalContext('app', 'test-app');
    logger.logEvent('TEST_EVENT', { custom: 'value' }, 'user1', '127.0.0.1', 'SUCCESS', 'corr-1');

    expect(calls).toHaveLength(1);
    const entry = calls[0];
    expect(entry.eventDetails).toMatchObject({ custom: 'value', app: 'test-app' });
    expect(entry.eventType).toBe('TEST_EVENT');
    expect(entry.userId).toBe('user1');
    expect(entry.correlationId).toBe('corr-1');
  });
});
