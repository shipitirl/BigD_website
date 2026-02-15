/**
 * Structured Logging
 * 
 * Logs key fields per request for debugging and monitoring:
 * - session_id
 * - lead_id
 * - state_before/state_after (or patch)
 * - estimate output
 * - errors
 */

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  action: string;
  session_id?: string;
  lead_id?: string;
  state_before?: Record<string, unknown>;
  state_after?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  estimate?: {
    low: number;
    high: number;
    confidence: number;
  };
  error?: string;
  details?: Record<string, unknown>;
  duration_ms?: number;
}

// Log storage (in production, this would write to file or external service)
const logBuffer: LogEntry[] = [];
const MAX_BUFFER_SIZE = 1000;

/**
 * Log a structured entry
 */
export function logRequest(entry: Omit<LogEntry, 'timestamp'>): void {
  const fullEntry: LogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  
  // Console output
  const prefix = `[${fullEntry.timestamp}] [${fullEntry.level.toUpperCase()}]`;
  const message = `${fullEntry.action} ${fullEntry.lead_id ? `lead=${fullEntry.lead_id}` : ''}`;
  
  switch (fullEntry.level) {
    case 'error':
      console.error(prefix, message, fullEntry.error || '', fullEntry.details || '');
      break;
    case 'warn':
      console.warn(prefix, message, fullEntry.details || '');
      break;
    case 'debug':
      if (process.env.DEBUG) {
        console.log(prefix, message, JSON.stringify(fullEntry, null, 2));
      }
      break;
    default:
      console.log(prefix, message);
  }
  
  // Buffer for retrieval
  logBuffer.push(fullEntry);
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer.shift();
  }
}

/**
 * Log helpers for common actions
 */
export const logger = {
  chatRequest: (leadId: string, message: string, sessionId?: string) => {
    logRequest({
      level: 'info',
      action: 'chat_request',
      lead_id: leadId,
      session_id: sessionId,
      details: { message_preview: message.substring(0, 100) },
    });
  },
  
  chatResponse: (leadId: string, patch: Record<string, unknown>, duration: number) => {
    logRequest({
      level: 'info',
      action: 'chat_response',
      lead_id: leadId,
      patch,
      duration_ms: duration,
    });
  },
  
  validationFailed: (leadId: string, reason: string, field?: string) => {
    logRequest({
      level: 'warn',
      action: 'validation_failed',
      lead_id: leadId,
      details: { reason, field },
    });
  },
  
  stateGateBlocked: (leadId: string, action: string, missing: string[]) => {
    logRequest({
      level: 'warn',
      action: 'state_gate_blocked',
      lead_id: leadId,
      details: { blocked_action: action, missing_fields: missing },
    });
  },
  
  estimateComputed: (leadId: string, estimate: { low: number; high: number; confidence: number }) => {
    logRequest({
      level: 'info',
      action: 'estimate_computed',
      lead_id: leadId,
      estimate,
    });
  },
  
  photoUploaded: (leadId: string, photoCount: number) => {
    logRequest({
      level: 'info',
      action: 'photo_uploaded',
      lead_id: leadId,
      details: { photo_count: photoCount },
    });
  },
  
  emailSent: (leadId: string, to: string) => {
    logRequest({
      level: 'info',
      action: 'email_sent',
      lead_id: leadId,
      details: { to },
    });
  },
  
  emailFailed: (leadId: string, error: string) => {
    logRequest({
      level: 'error',
      action: 'email_failed',
      lead_id: leadId,
      error,
    });
  },
  
  smsSent: (leadId: string, to: string) => {
    logRequest({
      level: 'info',
      action: 'sms_sent',
      lead_id: leadId,
      details: { to },
    });
  },
  
  smsFailed: (leadId: string, error: string) => {
    logRequest({
      level: 'error',
      action: 'sms_failed',
      lead_id: leadId,
      error,
    });
  },
  
  smsReceived: (leadId: string, from: string, body: string) => {
    logRequest({
      level: 'info',
      action: 'sms_received',
      lead_id: leadId,
      details: { from, body_preview: body.substring(0, 50) },
    });
  },
  
  llmError: (leadId: string, error: string, retried: boolean) => {
    logRequest({
      level: 'error',
      action: 'llm_error',
      lead_id: leadId,
      error,
      details: { retried },
    });
  },
  
  llmRetryBudgetExceeded: (leadId: string) => {
    logRequest({
      level: 'error',
      action: 'llm_retry_budget_exceeded',
      lead_id: leadId,
    });
  },
  
  rateLimited: (ip: string, sessionId?: string) => {
    logRequest({
      level: 'warn',
      action: 'rate_limited',
      session_id: sessionId,
      details: { ip },
    });
  },
  
  tokenInvalid: (leadId: string, reason: string) => {
    logRequest({
      level: 'warn',
      action: 'token_invalid',
      lead_id: leadId,
      details: { reason },
    });
  },
  
  idempotentSkip: (leadId: string, action: string) => {
    logRequest({
      level: 'info',
      action: 'idempotent_skip',
      lead_id: leadId,
      details: { skipped_action: action },
    });
  },
  
  ownerApproved: (leadId: string, adjustedEstimate?: number) => {
    logRequest({
      level: 'info',
      action: 'owner_approved',
      lead_id: leadId,
      details: adjustedEstimate ? { adjusted_estimate: adjustedEstimate } : undefined,
    });
  },
  
  customerApproved: (leadId: string) => {
    logRequest({
      level: 'info',
      action: 'customer_approved',
      lead_id: leadId,
    });
  },
};

/**
 * Get recent logs for debugging
 */
export function getRecentLogs(count: number = 100): LogEntry[] {
  return logBuffer.slice(-count);
}

/**
 * Get logs for a specific lead
 */
export function getLogsForLead(leadId: string): LogEntry[] {
  return logBuffer.filter(entry => entry.lead_id === leadId);
}

/**
 * Get error logs
 */
export function getErrorLogs(): LogEntry[] {
  return logBuffer.filter(entry => entry.level === 'error');
}
