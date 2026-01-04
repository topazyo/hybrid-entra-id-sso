import { Logger } from '../utils/Logger';
import { RiskEngine } from '../security/RiskEngine';
import { generateId } from '../utils/IdGenerator';

interface AuthenticationContext {
  userId: string;
  deviceId: string;
  ipAddress: string;
  timestamp: Date;
  factors: string[];
}

interface FactorResult {
  factor: string;
  success: boolean;
  details?: any;
}

interface AuthenticationResult {
  success: boolean;
  completedFactors: string[];
  failedFactors: string[];
  timestamp: Date;
  sessionId?: string;
}

interface AuthenticationProvider {
  authenticate(context: AuthenticationContext): Promise<FactorResult>;
}

interface ChainConfiguration {
  baseFactors: string[];
  mediumRiskThreshold: number;
  highRiskThreshold: number;
  mediumRiskFactors: string[];
  highRiskFactors: string[];
  mandatoryFactors?: string[];
}

class AuthenticationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthenticationChain {
  private logger: Logger;
  private riskEngine: RiskEngine;
  private providers: Map<string, AuthenticationProvider>;
  private chainConfig: ChainConfiguration;

  constructor() {
    this.logger = new Logger('AuthenticationChain');
    this.riskEngine = new RiskEngine();
    this.providers = new Map();
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

  /** Configure default providers (placeholder for future provider injection). */
  private initializeProviders(): void {
    // In absence of concrete providers, keep map empty; callers are expected to register providers externally.
    // This method exists to prevent constructor failures and allow future extension.
  }

  /** Load default chain configuration thresholds and factors. */
  private loadChainConfiguration(): void {
    this.chainConfig = {
      baseFactors: ['password'],
      mediumRiskThreshold: 50,
      highRiskThreshold: 75,
      mediumRiskFactors: ['device'],
      highRiskFactors: ['mfa'],
      mandatoryFactors: ['password']
    };
  }

  private isFactorMandatory(factor: string): boolean {
    return (this.chainConfig.mandatoryFactors || []).includes(factor);
  }

  private generateSessionId(): string {
    return generateId('session');
  }
}