// ============================================================
// Lead API Route - Get lead details for admin
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { SessionState } from '@/lib/session';
import { sendEstimateToCustomer, sendBookingConfirmation } from '@/lib/sms';
import { loadSession, saveSession } from '@/lib/utils';
import { verifyAdminToken } from '@/lib/tokens';
import { withIdempotency } from '@/lib/idempotency';
import { logger } from '@/lib/logger';

// ----------------------
// Token Validation Helper
// ----------------------
function validateToken(request: NextRequest, leadId: string): { valid: boolean; error?: string } {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  
  // In development, allow access without token
  if (process.env.NODE_ENV === 'development' && !token) {
    return { valid: true };
  }
  
  if (!token) {
    return { valid: false, error: 'Token required' };
  }
  
  const result = verifyAdminToken(token, leadId, 'lead_admin');
  if (!result.valid) {
    logger.tokenInvalid(leadId, result.error || 'Unknown error');
    return { valid: false, error: result.error };
  }
  
  return { valid: true };
}

// ----------------------
// GET /api/lead/[id]
// ----------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  // Validate token
  const tokenResult = validateToken(request, id);
  if (!tokenResult.valid) {
    return NextResponse.json(
      { error: tokenResult.error },
      { status: 403 }
    );
  }

  const session = await loadSession(id);
  if (!session) {
    return NextResponse.json(
      { error: 'Lead not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    lead: session,
  });
}

// ----------------------
// POST /api/lead/[id] - Approve or adjust
// ----------------------
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    
    // Validate token
    const tokenResult = validateToken(request, id);
    if (!tokenResult.valid) {
      return NextResponse.json(
        { error: tokenResult.error },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, adjusted_min, adjusted_max, approve_without_photos } = body;

    const session = await loadSession(id);
    if (!session) {
      return NextResponse.json(
        { error: 'Lead not found' },
        { status: 404 }
      );
    }

    // Check if owner approval is allowed
    const hasPhotos = session.photos.urls.length > 0;
    if (!hasPhotos && !approve_without_photos) {
      return NextResponse.json(
        { 
          error: 'Photos required',
          message: 'No photos uploaded. Check "Approve without photos" to proceed anyway.',
          requires_checkbox: true,
        },
        { status: 400 }
      );
    }

    // Check escalation flags
    const needsSiteVisit = (session as any).needsSiteVisit === true;
    const ownerMustConfirm = (session as any).ownerMustConfirm === true;
    
    if (action === 'approve') {
      // Use idempotency to prevent double-approval/SMS
      const { result, wasIdempotent } = await withIdempotency(
        { action: 'owner_approve', leadId: id },
        async () => {
          // Update status
          session.status = 'approved';
          
          // Mark owner override for photos if applicable
          if (!hasPhotos && approve_without_photos) {
            (session as any).ownerApprovedWithoutPhotos = true;
          }
          
          await saveSession(id, session);
          logger.ownerApproved(id);

          // Send SMS to customer (only if allowed)
          let smsSent = false;
          if (Boolean(session.contact?.phone) && !needsSiteVisit) {
            smsSent = await sendEstimateToCustomer(session);
            if (smsSent) {
              logger.smsSent(id, session.contact.phone || 'unknown');
            } else {
              logger.smsFailed(id, 'sendEstimateToCustomer returned false');
            }
          }

          return { status: 'approved', smsSent };
        }
      );

      if (wasIdempotent) {
        logger.idempotentSkip(id, 'owner_approve');
      }

      return NextResponse.json({
        success: true,
        status: result.status,
        sms_sent: result.smsSent,
        was_cached: wasIdempotent,
        needs_site_visit: needsSiteVisit,
      });

    } else if (action === 'adjust') {
      // Use idempotency to prevent double-adjustment
      const { result, wasIdempotent } = await withIdempotency(
        { action: 'owner_adjust', leadId: id },
        async () => {
          // Update estimate with adjusted values
          if (session.estimate && adjusted_min && adjusted_max) {
            session.estimate.min = adjusted_min;
            session.estimate.max = adjusted_max;
            session.estimate.confidence = 'high'; // Owner-adjusted = high confidence
            session.estimate.drivers.push('Owner adjusted');
          }
          
          // Mark owner override for photos if applicable
          if (!hasPhotos && approve_without_photos) {
            (session as any).ownerApprovedWithoutPhotos = true;
          }
          
          session.status = 'approved';
          await saveSession(id, session);
          logger.ownerApproved(id, adjusted_max);

          // Send SMS to customer (only if allowed)
          let smsSent = false;
          if (Boolean(session.contact?.phone) && !needsSiteVisit) {
            smsSent = await sendEstimateToCustomer(session);
            if (smsSent) {
              logger.smsSent(id, session.contact.phone || 'unknown');
            }
          }

          return { 
            status: 'approved', 
            estimate: session.estimate, 
            smsSent 
          };
        }
      );

      if (wasIdempotent) {
        logger.idempotentSkip(id, 'owner_adjust');
      }

      return NextResponse.json({
        success: true,
        status: result.status,
        estimate: result.estimate,
        sms_sent: result.smsSent,
        was_cached: wasIdempotent,
        needs_site_visit: needsSiteVisit,
      });

    } else {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Lead action error:', error);
    return NextResponse.json(
      { error: 'Action failed' },
      { status: 500 }
    );
  }
}

// ----------------------
// OPTIONS (CORS preflight)
// ----------------------
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
