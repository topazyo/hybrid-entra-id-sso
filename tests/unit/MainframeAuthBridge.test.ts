import { MainframeAuthBridge } from '../../src/middleware/MainframeAuthBridge';
import { expect } from 'chai';

describe('MainframeAuthBridge', () => {
  let bridge: MainframeAuthBridge;
  
  beforeEach(() => {
    bridge = new MainframeAuthBridge({
      endpoint: 'test-endpoint',
      securityServer: 'test-server',
      connectionPool: {
        min: 1,
        max: 5,
        idleTimeoutMillis: 1000
      }
    });
  });

  describe('translateToken', () => {
    it('should successfully translate a valid token', async () => {
      const mockToken = 'valid-token';
      const result = await bridge.translateToken(mockToken);
      
      expect(result).to.have.property('racfId');
      expect(result.racfId).to.match(/^[A-Z0-9]{1,8}$/);
    });

    it('should throw on invalid token', async () => {
      const mockToken = 'invalid-token';
      
      await expect(bridge.translateToken(mockToken))
        .to.be.rejectedWith(AuthenticationError);
    });
  });
});