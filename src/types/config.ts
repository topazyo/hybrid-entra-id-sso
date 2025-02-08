export interface SystemConfig {
    monitoring: MonitoringConfig;
    authentication: AuthConfig;
    mainframe: MainframeConfig;
    security: SecurityConfig;
  }
  
  export interface MonitoringConfig {
    logAnalyticsWorkspaceId: string;
    logAnalyticsKey: string;
    alertThresholds: {
      highRiskSignIns: number;
      syncDelay: number;
      failedAuthentications: number;
    };
  }
  
  export interface AuthConfig {
    tokenLifetimeMinutes: number;
    maxRetries: number;
    mfaSettings: {
      enabled: boolean;
      gracePeriodMinutes: number;
      trustedLocations: string[];
    };
  }
  
  export interface MainframeConfig {
    endpoint: string;
    securityServer: string;
    connectionPool: {
      min: number;
      max: number;
      idleTimeoutMillis: number;
    };
  }
  
  export interface SecurityConfig {
    encryption: {
      algorithm: string;
      keySize: number;
    };
    session: {
      timeoutMinutes: number;
      renewalEnabled: boolean;
    };
  }