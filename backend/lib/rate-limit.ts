/**
 * Rate Limiting
 * 
 * Prevents abuse and controls costs:
 * - Per IP: 30 requests/minute
 * - Per session: 50 requests/session
 * - Per lead: LLM retry budget
 */

// In-memory stores (would be Redis in production)
const ipRequests = new Map<string, RequestWindow>();
const sessionRequests = new Map<string, number>();
const llmRetryBudget = new Map<string, LLMRetryState>();

interface RequestWindow {
  count: number;
  windowStart: number;
}

interface LLMRetryState {
  miniRetries: number;
  invalidJsonCount: number;
  lastReset: number;
}

// Configuration
const RATE_LIMITS = {
  perIpPerMinute: 30,
  perSession: 50,
  llmMiniRetries: 1,
  llmInvalidJsonMax: 3,
  windowMs: 60 * 1000, // 1 minute
  sessionTtlMs: 30 * 60 * 1000, // 30 minutes
};

// Cleanup interval
setInterval(() => {
  const now = Date.now();
  
  // Clean IP windows older than 2 minutes
  for (const [ip, window] of ipRequests.entries()) {
    if (now - window.windowStart > RATE_LIMITS.windowMs * 2) {
      ipRequests.delete(ip);
    }
  }
  
  // Clean old LLM retry budgets
  for (const [leadId, state] of llmRetryBudget.entries()) {
    if (now - state.lastReset > RATE_LIMITS.sessionTtlMs) {
      llmRetryBudget.delete(leadId);
    }
  }
}, 60 * 1000);

// ============================================================
// IP Rate Limiting
// ============================================================

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
  reason?: 'ip_limit' | 'session_limit' | 'llm_budget';
}

/**
 * Check if IP is rate limited
 */
export function checkIpRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const window = ipRequests.get(ip);
  
  if (!window || now - window.windowStart > RATE_LIMITS.windowMs) {
    // New window
    ipRequests.set(ip, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: RATE_LIMITS.perIpPerMinute - 1,
      resetIn: RATE_LIMITS.windowMs,
    };
  }
  
  if (window.count >= RATE_LIMITS.perIpPerMinute) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: RATE_LIMITS.windowMs - (now - window.windowStart),
      reason: 'ip_limit',
    };
  }
  
  window.count++;
  return {
    allowed: true,
    remaining: RATE_LIMITS.perIpPerMinute - window.count,
    resetIn: RATE_LIMITS.windowMs - (now - window.windowStart),
  };
}

// ============================================================
// Session Rate Limiting
// ============================================================

/**
 * Check if session has exceeded request limit
 */
export function checkSessionRateLimit(sessionId: string): RateLimitResult {
  const count = sessionRequests.get(sessionId) || 0;
  
  if (count >= RATE_LIMITS.perSession) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: 0,
      reason: 'session_limit',
    };
  }
  
  sessionRequests.set(sessionId, count + 1);
  return {
    allowed: true,
    remaining: RATE_LIMITS.perSession - count - 1,
    resetIn: 0,
  };
}

/**
 * Reset session counter (for testing)
 */
export function resetSessionLimit(sessionId: string): void {
  sessionRequests.delete(sessionId);
}

// ============================================================
// LLM Retry Budget
// ============================================================

export interface LLMBudgetResult {
  canRetryWithMini: boolean;
  canCallLLM: boolean;
  miniRetriesRemaining: number;
  invalidJsonRemaining: number;
  shouldFallbackToDeterministic: boolean;
}

/**
 * Get LLM retry budget for a lead
 */
export function getLLMBudget(leadId: string): LLMBudgetResult {
  const state = llmRetryBudget.get(leadId) || {
    miniRetries: 0,
    invalidJsonCount: 0,
    lastReset: Date.now(),
  };
  
  const miniRemaining = RATE_LIMITS.llmMiniRetries - state.miniRetries;
  const jsonRemaining = RATE_LIMITS.llmInvalidJsonMax - state.invalidJsonCount;
  
  return {
    canRetryWithMini: miniRemaining > 0,
    canCallLLM: jsonRemaining > 0,
    miniRetriesRemaining: Math.max(0, miniRemaining),
    invalidJsonRemaining: Math.max(0, jsonRemaining),
    shouldFallbackToDeterministic: jsonRemaining <= 0,
  };
}

/**
 * Record a Mini retry
 */
export function recordMiniRetry(leadId: string): void {
  const state = llmRetryBudget.get(leadId) || {
    miniRetries: 0,
    invalidJsonCount: 0,
    lastReset: Date.now(),
  };
  state.miniRetries++;
  llmRetryBudget.set(leadId, state);
}

/**
 * Record an invalid JSON response
 */
export function recordInvalidJson(leadId: string): void {
  const state = llmRetryBudget.get(leadId) || {
    miniRetries: 0,
    invalidJsonCount: 0,
    lastReset: Date.now(),
  };
  state.invalidJsonCount++;
  llmRetryBudget.set(leadId, state);
}

/**
 * Reset LLM budget (e.g., on new session)
 */
export function resetLLMBudget(leadId: string): void {
  llmRetryBudget.delete(leadId);
}

// ============================================================
// Combined Rate Limit Check
// ============================================================

export interface CombinedRateLimitResult {
  allowed: boolean;
  reason?: 'ip_limit' | 'session_limit' | 'llm_budget';
  headers: {
    'X-RateLimit-Remaining': string;
    'X-RateLimit-Reset': string;
  };
}

/**
 * Check all rate limits for a request
 */
export function checkAllRateLimits(
  ip: string,
  sessionId?: string
): CombinedRateLimitResult {
  // Check IP limit
  const ipResult = checkIpRateLimit(ip);
  if (!ipResult.allowed) {
    return {
      allowed: false,
      reason: 'ip_limit',
      headers: {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(ipResult.resetIn / 1000)),
      },
    };
  }
  
  // Check session limit if provided
  if (sessionId) {
    const sessionResult = checkSessionRateLimit(sessionId);
    if (!sessionResult.allowed) {
      return {
        allowed: false,
        reason: 'session_limit',
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '0',
        },
      };
    }
  }
  
  return {
    allowed: true,
    headers: {
      'X-RateLimit-Remaining': String(ipResult.remaining),
      'X-RateLimit-Reset': String(Math.ceil(ipResult.resetIn / 1000)),
    },
  };
}

/**
 * Get rate limit stats (for monitoring)
 */
export function getRateLimitStats(): {
  activeIps: number;
  activeSessions: number;
  leadsWithBudget: number;
} {
  return {
    activeIps: ipRequests.size,
    activeSessions: sessionRequests.size,
    leadsWithBudget: llmRetryBudget.size,
  };
}
