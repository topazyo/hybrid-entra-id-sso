import { Logger } from '../utils/Logger';
import { KeyVaultClient } from '@azure/keyvault-certificates';
import { DefaultAzureCredential } from '@azure/identity';
import { AlertService } from './AlertService';
import { AuditLogger } from './AuditLogger';

interface CertificateMetadata {
  name: string;
  thumbprint: string;
  notBefore: Date;
  notAfter: Date;
  issuer: string;
  subject: string;
  keyUsage: string[];
}

export class CertificateManager {
  private logger: Logger;
  private keyVaultClient: KeyVaultClient;
  private alertService: AlertService;
  private auditLogger: AuditLogger;
  private certificateCache: Map<string, CertificateMetadata>;

  constructor(private keyVaultUrl: string) {
    this.logger = new Logger('CertificateManager');
    this.alertService = new AlertService();
    this.auditLogger = new AuditLogger(
      process.env.LOG_ANALYTICS_WORKSPACE_ID,
      process.env.LOG_ANALYTICS_KEY
    );
    this.certificateCache = new Map();
    this.initializeKeyVaultClient();
  }

  private async initializeKeyVaultClient(): Promise<void> {
    try {
      const credential = new DefaultAzureCredential();
      this.keyVaultClient = new KeyVaultClient(this.keyVaultUrl, credential);
    } catch (error) {
      this.logger.error('Failed to initialize Key Vault client', { error });
      throw error;
    }
  }

  async getCertificate(certName: string): Promise<CertificateMetadata> {
    try {
      // Check cache first
      if (this.certificateCache.has(certName)) {
        const cachedCert = this.certificateCache.get(certName);
        if (!this.isCertificateExpiringSoon(cachedCert)) {
          return cachedCert;
        }
      }

      const certificate = await this.keyVaultClient.getCertificate(certName);
      const metadata = this.processCertificateMetadata(certificate);
      
      this.certificateCache.set(certName, metadata);

      if (this.isCertificateExpiringSoon(metadata)) {
        await this.handleExpiringCertificate(metadata);
      }

      return metadata;
    } catch (error) {
      this.logger.error('Failed to get certificate', { certName, error });
      throw error;
    }
  }

  async rotateCertificate(certName: string): Promise<CertificateMetadata> {
    try {
      this.logger.info('Starting certificate rotation', { certName });

      // Create new version
      const newCert = await this.keyVaultClient.createCertificate(certName, {
        policy: await this.getCertificatePolicy(certName)
      });

      // Wait for completion
      const completedCert = await this.waitForCertificateOperation(newCert.name);

      // Update cache
      const metadata = this.processCertificateMetadata(completedCert);
      this.certificateCache.set(certName, metadata);

      await this.auditLogger.logEvent({
        eventType: 'CertificateRotation',
        resourceId: certName,
        action: 'rotate',
        result: 'success',
        metadata: {
          thumbprint: metadata.thumbprint,
          notAfter: metadata.notAfter
        }
      });

      return metadata;
    } catch (error) {
      this.logger.error('Certificate rotation failed', { certName, error });
      throw error;
    }
  }

  private isCertificateExpiringSoon(cert: CertificateMetadata): boolean {
    const warningThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days
    const timeUntilExpiry = cert.notAfter.getTime() - Date.now();
    return timeUntilExpiry < warningThreshold;
  }

  private async handleExpiringCertificate(cert: CertificateMetadata): Promise<void> {
    await this.alertService.sendAlert({
      severity: 'high',
      component: 'CertificateManager',
      message: `Certificate ${cert.name} is expiring soon`,
      details: {
        expiryDate: cert.notAfter,
        daysRemaining: Math.floor((cert.notAfter.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      }
    });

    // Schedule automatic rotation if configured
    if (process.env.AUTO_ROTATE_CERTIFICATES === 'true') {
      await this.scheduleRotation(cert);
    }
  }

  private async scheduleRotation(cert: CertificateMetadata): Promise<void> {
    // Implement rotation scheduling logic
  }

  private processCertificateMetadata(cert: any): CertificateMetadata {
    return {
      name: cert.name,
      thumbprint: cert.properties.x509Thumbprint,
      notBefore: new Date(cert.properties.notBefore),
      notAfter: new Date(cert.properties.notAfter),
      issuer: cert.properties.issuer,
      subject: cert.properties.subject,
      keyUsage: cert.policy.keyUsage || []
    };
  }
}