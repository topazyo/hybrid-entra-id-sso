import { Logger } from '../utils/Logger';
import { RiskEngine } from '../security/RiskEngine';
import { DeviceTrustService } from '../services/DeviceTrustService';

interface AuthenticationContext {
  userId: string;
  deviceId: string;
  ipAddress: string;
  factors: AuthenticationFactor[];
}

interface AuthenticationFactor {
  type: 'password' | 'mfa' | 'certificate' | 'biometric';
  value: any;
}

export class AuthenticationChain {
  private logger: Logger;
  private riskEngine: RiskEngine;
  private deviceTrust: DeviceTrustService;
  private authProviders: Map<string, AuthenticationProvider>;

  constructor() {
    this.logger = new Logger('AuthenticationChain');
    this.riskEngine = new RiskEngine();
    this.deviceTrust = new DeviceTrustService();
    this.initializeProviders();
  }

  private initializeProviders(): void {
    this.authProviders = new Map([
      ['password', new PasswordAuthProvider()],
      ['mfa', new MFAAuthProvider()],
      ['certificate', new CertificateAuthProvider()],
      ['biometric', new BiometricAuthProvider()]
    ]);
  }

  async authenticate(context: AuthenticationContext): Promise<AuthenticationResult> {
    try {
      // Evaluate risk and determine required factors
      const riskScore = await this.riskEngine.evaluateRisk(context);
      const requiredFactors = await this.determineRequiredFactors(context, riskScore);

      // Execute authentication chain
      const results = await this.executeAuthenticationChain(context, requiredFactors);

      // Evaluate final result
      const finalResult = this.evaluateResults(results, requiredFactors);

      await this.logAuthenticationAttempt(context, finalResult);
      return finalResult;
    } catch (error) {
      this.logger.error('Authentication chain failed', { error });
      throw new AuthenticationError('Authentication chain failed', error);
    }
  }

  private async determineRequiredFactors(
    context: AuthenticationContext,
    riskScore: number
  ): Promise<string[]> {
    const factors = ['password']; // Base factor

    if (riskScore > 0.5) {
      factors.push('mfa');
    }

    if (riskScore > 0.8) {
      factors.push('certificate');
    }

    const deviceTrustLevel = await this.deviceTrust.evaluateDevice(context.deviceId);
    if (deviceTrustLevel < 0.5) {
      factors.push('biometric');
    }

    return factors;
  }

  private async executeAuthenticationChain(
    context: AuthenticationContext,
    requiredFactors: string[]
  ): Promise<AuthenticationStepResult[]> {
    const results: AuthenticationStepResult[] = [];

    for (const factor of requiredFactors) {
      const provider = this.authProviders.get(factor);
      if (!provider) {
        throw new Error(`No provider found for factor: ${factor}`);
      }

      const result = await provider.authenticate(context);
      results.push(result);

      if (!result.success && this.isFactorMandatory(factor)) {
        break;
      }
    }

    return results;
  }

  private isFactorMandatory(factor: string): boolean {
    return ['password', 'mfa'].includes(factor);
  }

  private evaluateResults(
    results: AuthenticationStepResult[],
    requiredFactors: string[]
  ): AuthenticationResult {
    const success = results.every(r => 
      r.success || !this.isFactorMandatory(r.factor)
    );

    return {
      success,
      completedFactors: results.filter(r => r.success).map(r => r.factor),
      failedFactors: results.filter(r => !r.success).map(r => r.factor),
      timestamp: new Date(),
      sessionId: success ? crypto.randomUUID() : undefined
    };
  }
}