/**
 * Signed Token Utilities for Admin Links
 * 
 * Tokens are bound to:
 * - lead_id
 * - issued_at (iat)
 * - purpose
 * - optional nonce for revocation
 */

import jwt from 'jsonwebtoken';

const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'dev-secret-change-in-production';
const TOKEN_EXPIRY_HOURS = 72;

export type TokenPurpose = 'lead_admin' | 'lead_view' | 'customer_approve';

interface TokenPayload {
  lead_id: string;
  purpose: TokenPurpose;
  nonce?: string;
  iat: number;
  exp: number;
}

interface TokenVerifyResult {
  valid: boolean;
  expired?: boolean;
  mismatch?: boolean;
  payload?: TokenPayload;
  error?: string;
}

// In-memory revocation list (would be Redis/DB in production)
const revokedNonces = new Set<string>();

/**
 * Create a signed admin token for a lead
 * 
 * @param leadId - The lead ID to bind the token to
 * @param purpose - What this token is for ('lead_admin', 'lead_view', 'customer_approve')
 * @param nonce - Optional nonce for revocation capability
 */
export function createAdminToken(
  leadId: string,
  purpose: TokenPurpose = 'lead_admin',
  nonce?: string
): string {
  const payload = {
    lead_id: leadId,
    purpose,
    ...(nonce && { nonce }),
  };
  
  return jwt.sign(payload, ADMIN_TOKEN_SECRET, {
    expiresIn: `${TOKEN_EXPIRY_HOURS}h`,
  });
}

/**
 * Create a customer approval token (shorter expiry)
 */
export function createCustomerToken(leadId: string): string {
  return jwt.sign(
    { lead_id: leadId, purpose: 'customer_approve' },
    ADMIN_TOKEN_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Verify a token and check it matches the expected lead_id
 * 
 * @param token - The JWT token from query param
 * @param expectedLeadId - The lead_id from the URL path
 * @param expectedPurpose - Optional purpose to validate
 */
export function verifyAdminToken(
  token: string,
  expectedLeadId: string,
  expectedPurpose?: TokenPurpose
): TokenVerifyResult {
  try {
    const payload = jwt.verify(token, ADMIN_TOKEN_SECRET) as TokenPayload;
    
    // Check lead_id matches
    if (payload.lead_id !== expectedLeadId) {
      return {
        valid: false,
        mismatch: true,
        error: 'Token lead_id does not match',
      };
    }
    
    // Check purpose if specified
    if (expectedPurpose && payload.purpose !== expectedPurpose) {
      return {
        valid: false,
        mismatch: true,
        error: `Token purpose mismatch: expected ${expectedPurpose}, got ${payload.purpose}`,
      };
    }
    
    // Check if nonce is revoked
    if (payload.nonce && revokedNonces.has(payload.nonce)) {
      return {
        valid: false,
        error: 'Token has been revoked',
      };
    }
    
    // Check age (additional check beyond JWT expiry)
    const ageHours = (Date.now() / 1000 - payload.iat) / 3600;
    if (ageHours > TOKEN_EXPIRY_HOURS) {
      return {
        valid: false,
        expired: true,
        error: 'Token is too old',
      };
    }
    
    return {
      valid: true,
      payload,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return {
        valid: false,
        expired: true,
        error: 'Token has expired',
      };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return {
        valid: false,
        error: 'Invalid token',
      };
    }
    return {
      valid: false,
      error: 'Token verification failed',
    };
  }
}

/**
 * Revoke a token by its nonce
 * 
 * @param nonce - The nonce to revoke
 */
export function revokeToken(nonce: string): void {
  revokedNonces.add(nonce);
}

/**
 * Generate a random nonce for token revocation capability
 */
export function generateNonce(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Build a signed admin URL for a lead
 * 
 * @param baseUrl - The base URL of the application
 * @param leadId - The lead ID
 * @param purpose - Token purpose
 */
export function buildSignedAdminUrl(
  baseUrl: string,
  leadId: string,
  purpose: TokenPurpose = 'lead_admin'
): string {
  const nonce = generateNonce();
  const token = createAdminToken(leadId, purpose, nonce);
  return `${baseUrl}/admin/lead/${leadId}?t=${token}`;
}
