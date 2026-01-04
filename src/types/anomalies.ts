import { AlertSeverity } from './alerts';

export interface AnomalyContext {
  type: string;
  data: unknown;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface Anomaly {
  id: string;
  type: string;
  score: number;
  details?: Record<string, any>;
}

export interface AnomalyResult {
  timestamp: Date;
  score: number;
  anomalies: Anomaly[];
  confidence: number;
}

export type AnomalySeverity = AlertSeverity;
