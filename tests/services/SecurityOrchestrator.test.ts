import { SecurityOrchestrator } from '../../src/services/SecurityOrchestrator';
import { EventBus } from '../../utils/EventBus';

class TestLogger {
    public logs: any[] = [];
    public errors: any[] = [];
    async info(message: string, meta?: any) { this.logs.push({ level: 'info', message, meta }); }
    async warn(message: string, meta?: any) { this.logs.push({ level: 'warn', message, meta }); }
    async error(message: string, meta?: any) { this.errors.push({ level: 'error', message, meta }); }
}

describe('SecurityOrchestrator', () => {
    let orchestrator: SecurityOrchestrator;
    let mockLogger: TestLogger;
    let mockEventBus: EventBus;

    beforeEach(() => {
        mockLogger = new TestLogger();
        mockEventBus = new EventBus();
        orchestrator = new SecurityOrchestrator(mockLogger, mockEventBus);
    });

    describe('orchestrateResponse', () => {
        it('should handle security incidents correctly', async () => {
            const incident = {
                id: 'test-incident',
                type: 'unauthorized_access',
                severity: 'high',
                timestamp: new Date(),
                source: 'test'
            };

            const result = await orchestrator.orchestrateResponse(incident);

            expect(result).toHaveProperty('status');
            expect(result.status).toBe('completed');
            expect(mockLogger.logs.length).toBeGreaterThanOrEqual(1);
        });

        it('should handle errors gracefully', async () => {
            const badIncident = {
                id: 'bad-incident',
                type: 'invalid_type',
                severity: 'unknown',
                timestamp: new Date(),
                source: 'test'
            };

            await expect(orchestrator.orchestrateResponse(badIncident)).rejects.toBeInstanceOf(Error);
            expect(mockLogger.errors.length).toBeGreaterThanOrEqual(1);
        });
    });
});