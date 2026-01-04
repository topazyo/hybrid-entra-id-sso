import { randomUUID } from 'crypto';

/**
 * Generate a unique identifier with optional prefix. Falls back to timestamp/random when randomUUID is unavailable.
 */
export function generateId(prefix?: string): string {
  const base = typeof randomUUID === 'function'
    ? randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}-${base}` : base;
}
