import { Logger } from '../utils/Logger';
import { RiskEngine } from '../security/RiskEngine';
import { AuthenticationProvider } from '../types/auth';

interface AuthenticationContext {
  userId: string;
  deviceId: string;
  ipAddress: string;
  timestamp: Date;
  factors: string[];
}

export class AuthenticationChain {
  private logger: Logger;
  private riskEngine: RiskEngine;
  private providers: Map<string, AuthenticationProvider>;
  private chainConfig: ChainConfiguration;

  constructor() {
    this.logger = new Logger('AuthenticationChain');
    this.riskEngine = new RiskEngine();
    this.initializeProviders();
    this.loadChainConfiguration();
  }

  async authenticate(
    context: AuthenticationContext
  ): Promise<AuthenticationResult> {
    try {
      const riskScore = await this.riskEngine.evaluateRisk(context);
      const requiredFactors = await this.determineRequiredFactors(
        context,
        riskScore
      );

      const results = await this.executeAuthenticationChain(
        context,
        requiredFactors
      );

      return this.evaluateResults(results, context);
    } catch (error) {
      this.logger.error('Authentication chain failed', { context, error });
      throw new AuthenticationError('Failed to complete authentication', error);
    }
  }

  private async executeAuthenticationChain(
    context: AuthenticationContext,
    factors: string[]
  ): Promise<FactorResult[]> {
    const results: FactorResult[] = [];

    for (const factor of factors) {
      const provider = this.providers.get(factor);
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

  private async determineRequiredFactors(
    context: AuthenticationContext,
    riskScore: number
  ): Promise<string[]> {
    const baseFactors = this.chainConfig.baseFactors;
    const additionalFactors = [];

    if (riskScore > this.chainConfig.highRiskThreshold) {
      additionalFactors.push(...this.chainConfig.highRiskFactors);
    } else if (riskScore > this.chainConfig.mediumRiskThreshold) {
      additionalFactors.push(...this.chainConfig.mediumRiskFactors);
    }

    return [...new Set([...baseFactors, ...additionalFactors])];
  }

  private evaluateResults(
    results: FactorResult[],
    context: AuthenticationContext
  ): AuthenticationResult {
    const success = results.every(
      r => r.success || !this.isFactorMandatory(r.factor)
    );

    return {
      success,
      completedFactors: results.filter(r => r.success).map(r => r.factor),
      failedFactors: results.filter(r => !r.success).map(r => r.factor),
      timestamp: new Date(),
      sessionId: success ? this.generateSessionId() : undefined
    };
  }
}