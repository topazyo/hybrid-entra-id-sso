import { Logger } from '../utils/Logger';
import { AlertService } from './AlertService';
import { AuditLogger } from './AuditLogger';

interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  timestamp: Date;
}

interface ValidationIssue {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedAttributes: string[];
}

export class ProactiveIdentityValidator {
  private logger: Logger;
  private alertService: AlertService;
  private auditLogger: AuditLogger;

  constructor() {
    this.logger = new Logger('ProactiveIdentityValidator');
    this.alertService = new AlertService();
    this.auditLogger = new AuditLogger(
      process.env.LOG_ANALYTICS_WORKSPACE_ID,
      process.env.LOG_ANALYTICS_KEY
    );
  }

  async validateIdentity(userPrincipalName: string): Promise<ValidationResult> {
    try {
      const [
        upnConsistency,
        groupMembership,
        attributeSync,
        licenseAssignment
      ] = await Promise.all([
        this.checkUPNConsistency(userPrincipalName),
        this.checkGroupMembership(userPrincipalName),
        this.checkAttributeSync(userPrincipalName),
        this.checkLicenseAssignment(userPrincipalName)
      ]);

      const issues = [
        ...upnConsistency.issues,
        ...groupMembership.issues,
        ...attributeSync.issues,
        ...licenseAssignment.issues
      ];

      const result: ValidationResult = {
        valid: issues.length === 0,
        issues,
        timestamp: new Date()
      };

      await this.handleValidationResult(userPrincipalName, result);
      return result;
    } catch (error) {
      this.logger.error('Identity validation failed', { userPrincipalName, error });
      throw error;
    }
  }

  private async checkUPNConsistency(upn: string): Promise<ValidationResult> {
    try {
      const adUser = await this.getADUser(upn);
      const aadUser = await this.getAzureADUser(upn);

      const issues: ValidationIssue[] = [];

      if (adUser.userPrincipalName !== aadUser.userPrincipalName) {
        issues.push({
          type: 'upn_mismatch',
          severity: 'high',
          description: 'UPN mismatch between AD and Azure AD',
          affectedAttributes: ['userPrincipalName']
        });
      }

      return {
        valid: issues.length === 0,
        issues,
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error('UPN consistency check failed', { upn, error });
      throw error;
    }
  }

  private async checkGroupMembership(upn: string): Promise<ValidationResult> {
    try {
      const adGroups = await this.getADGroupMembership(upn);
      const aadGroups = await this.getAzureADGroupMembership(upn);

      const issues: ValidationIssue[] = [];
      const comparison = this.compareGroupMembership(adGroups, aadGroups);

      if (comparison.missing.length > 0) {
        issues.push({
          type: 'missing_groups',
          severity: 'medium',
          description: 'Missing group memberships in Azure AD',
          affectedAttributes: comparison.missing
        });
      }

      if (comparison.extra.length > 0) {
        issues.push({
          type: 'extra_groups',
          severity: 'medium',
          description: 'Extra group memberships in Azure AD',
          affectedAttributes: comparison.extra
        });
      }

      return {
        valid: issues.length === 0,
        issues,
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error('Group membership check failed', { upn, error });
      throw error;
    }
  }

  private async handleValidationResult(
    upn: string,
    result: ValidationResult
  ): Promise<void> {
    // Log validation result
    await this.auditLogger.logEvent({
      eventType: 'IdentityValidation',
      userId: upn,
      resourceId: 'identity_validator',
      action: 'validate',
      result: result.valid ? 'success' : 'failure',
      metadata: {
        issues: result.issues,
        timestamp: result.timestamp
      }
    });

    // Handle high severity issues
    const highSeverityIssues = result.issues.filter(
      issue => issue.severity === 'high'
    );

    if (highSeverityIssues.length > 0) {
      await this.alertService.sendAlert({
        severity: 'high',
        component: 'IdentityValidator',
        message: `High severity identity issues detected for ${upn}`,
        details: {
          issues: highSeverityIssues,
          timestamp: result.timestamp
        }
      });
    }
  }

  private compareGroupMembership(
    adGroups: string[],
    aadGroups: string[]
  ): { missing: string[]; extra: string[] } {
    const missing = adGroups.filter(group => !aadGroups.includes(group));
    const extra = aadGroups.filter(group => !adGroups.includes(group));
    return { missing, extra };
  }
}