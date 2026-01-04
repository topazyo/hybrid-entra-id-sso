export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AlertStatus = 'new' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  component: string;
  message: string;
  details: Record<string, any>;
  timestamp: Date;
  status: AlertStatus;
  acknowledgedBy?: string;
  resolvedBy?: string;
  resolution?: string;
}

export type AlertCreateInput = Omit<Alert, 'id' | 'timestamp' | 'status'>;
