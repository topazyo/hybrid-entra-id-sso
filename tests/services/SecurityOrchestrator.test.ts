import { expect } from 'chai';
import { SecurityOrchestrator } from '../../../src/services/SecurityOrchestrator';
import { MockLogger } from '../../mocks/MockLogger';
import { MockEventBus } from '../../mocks/MockEventBus';

describe('SecurityOrchestrator', () => {
    let orchestrator: SecurityOrchestrator;
    let mockLogger: MockLogger;
    let mockEventBus: MockEventBus;

    beforeEach(() => {
        mockLogger = new MockLogger();
        mockEventBus = new MockEventBus();
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
            
            expect(result).to.have.property('status');
            expect(result.status).to.equal('completed');
            expect(mockLogger.logs).to.have.lengthOf.at.least(1);
        });

        it('should handle errors gracefully', async () => {
            const badIncident = {
                id: 'bad-incident',
                type: 'invalid_type',
                severity: 'unknown',
                timestamp: new Date(),
                source: 'test'
            };

            try {
                await orchestrator.orchestrateResponse(badIncident);
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).to.be.instanceof(Error);
                expect(mockLogger.errors).to.have.lengthOf.at.least(1);
            }
        });
    });
});