import { Logger } from '../utils/Logger';
import { EventBus } from '../utils/EventBus';
import { RiskEngine } from '../security/RiskEngine';
import { AlertService } from './AlertService';

interface SecurityEvent {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  data: Record<string, any>;
  metadata: {
    userId?: string;
    deviceId?: string;
    ipAddress?: string;
    location?: string;
  };
}

interface CorrelationRule {
  id: string;
  name: string;
  conditions: CorrelationCondition[];
  timeWindow: number; // in milliseconds
  minOccurrences: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class SecurityEventCorrelator {
  private logger: Logger;
  private eventBus: EventBus;
  private riskEngine: RiskEngine;
  private alertService: AlertService;
  private eventBuffer: Map<string, SecurityEvent[]>;
  private correlationRules: Map<string, CorrelationRule>;

  constructor() {
    this.logger = new Logger('SecurityEventCorrelator');
    this.eventBus = new EventBus();
    this.riskEngine = new RiskEngine();
    this.alertService = new AlertService();
    this.eventBuffer = new Map();
    this.initializeRules();
    this.setupEventListeners();
  }

  private initializeRules(): void {
    this.correlationRules = new Map([
      ['brute_force', {
        id: 'CORR_001',
        name: 'Brute Force Attack Detection',
        conditions: [{
          eventType: 'authentication_failure',
          field: 'ipAddress',
          operator: 'same',
          timeWindow: 300000 // 5 minutes
        }],
        timeWindow: 300000,
        minOccurrences: 5,
        severity: 'high'
      }],
      ['privilege_escalation', {
        id: 'CORR_002',
        name: 'Privilege Escalation Attempt',
        conditions: [
          {
            eventType: 'role_change',
            field: 'userId',
            operator: 'same',
            timeWindow: 3600000 // 1 hour
          },
          {
            eventType: 'sensitive_access',
            field: 'userId',
            operator: 'same',
            timeWindow: 3600000
          }
        ],
        timeWindow: 3600000,
        minOccurrences: 1,
        severity: 'critical'
      }]
    ]);
  }

  private setupEventListeners(): void {
    this.eventBus.subscribe('security.event', async (event: SecurityEvent) => {
      await this.processEvent(event);
    });
  }

  async processEvent(event: SecurityEvent): Promise<void> {
    try {
      // Add event to buffer
      await this.bufferEvent(event);

      // Check for correlations
      const correlations = await this.checkCorrelations(event);

      if (correlations.length > 0) {
        await this.handleCorrelations(correlations, event);
      }

      // Cleanup old events
      await this.cleanupEventBuffer();
    } catch (error) {
      this.logger.error('Event processing failed', { event, error });
      throw error;
    }
  }

  private async bufferEvent(event: SecurityEvent): Promise<void> {
    const key = this.getBufferKey(event);
    const events = this.eventBuffer.get(key) || [];
    events.push(event);
    this.eventBuffer.set(key, events);
  }

  private async checkCorrelations(
    event: SecurityEvent
  ): Promise<CorrelationMatch[]> {
    const matches: CorrelationMatch[] = [];

    for (const rule of this.correlationRules.values()) {
      const isMatch = await this.checkRule(rule, event);
      if (isMatch) {
        matches.push({
          rule,
          events: await this.getMatchingEvents(rule, event)
        });
      }
    }

    return matches;
  }

  private async checkRule(
    rule: CorrelationRule,
    event: SecurityEvent
  ): Promise<boolean> {
    const relevantEvents = await this.getRelevantEvents(rule, event);
    
    if (relevantEvents.length < rule.minOccurrences) {
      return false;
    }

    return rule.conditions.every(condition => 
      this.matchesCondition(condition, relevantEvents)
    );
  }

  private async getRelevantEvents(
    rule: CorrelationRule,
    event: SecurityEvent
  ): Promise<SecurityEvent[]> {
    const key = this.getBufferKey(event);
    const events = this.eventBuffer.get(key) || [];
    const timeThreshold = Date.now() - rule.timeWindow;

    return events.filter(e => 
      e.timestamp.getTime() > timeThreshold &&
      rule.conditions.some(c => c.eventType === e.type)
    );
  }

  private async handleCorrelations(
    correlations: CorrelationMatch[],
    triggerEvent: SecurityEvent
  ): Promise<void> {
    for (const correlation of correlations) {
      const riskScore = await this.calculateCorrelationRisk(correlation);

      if (riskScore > 0.7) {
        await this.createSecurityIncident(correlation, triggerEvent, riskScore);
      }

      await this.alertService.sendAlert({
        severity: correlation.rule.severity,
        component: 'SecurityCorrelation',
        message: `Security correlation detected: ${correlation.rule.name}`,
        details: {
          ruleId: correlation.rule.id,
          events: correlation.events,
          riskScore
        }
      });
    }
  }

  private async calculateCorrelationRisk(
    correlation: CorrelationMatch
  ): Promise<number> {
    const baseScore = this.getBaseSeverityScore(correlation.rule.severity);
    const eventRisk = await this.calculateEventSetRisk(correlation.events);
    
    return Math.min(1, baseScore * eventRisk);
  }

  private getBaseSeverityScore(severity: string): number {
    const severityScores = {
      'low': 0.3,
      'medium': 0.5,
      'high': 0.8,
      'critical': 1.0
    };
    return severityScores[severity] || 0.5;
  }

  private async createSecurityIncident(
    correlation: CorrelationMatch,
    triggerEvent: SecurityEvent,
    riskScore: number
  ): Promise<void> {
    const incident = {
      id: `INC-${Date.now()}`,
      correlationRuleId: correlation.rule.id,
      severity: correlation.rule.severity,
      events: correlation.events,
      riskScore,
      created: new Date(),
      status: 'open'
    };

    await this.eventBus.publish('security.incident', incident);
  }

  private async cleanupEventBuffer(): Promise<void> {
    const now = Date.now();
    const maxAge = Math.max(
      ...Array.from(this.correlationRules.values())
        .map(rule => rule.timeWindow)
    );

    for (const [key, events] of this.eventBuffer.entries()) {
      const filteredEvents = events.filter(
        event => (now - event.timestamp.getTime()) <= maxAge
      );

      if (filteredEvents.length === 0) {
        this.eventBuffer.delete(key);
      } else {
        this.eventBuffer.set(key, filteredEvents);
      }
    }
  }

  private getBufferKey(event: SecurityEvent): string {
    return `${event.metadata.userId || ''}-${event.metadata.ipAddress || ''}`;
  }
}

interface CorrelationMatch {
  rule: CorrelationRule;
  events: SecurityEvent[];
}

interface CorrelationCondition {
  eventType: string;
  field: string;
  operator: 'same' | 'different';
  timeWindow: number;
}