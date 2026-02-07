// ============================================================
// SMS Webhook Route - Handle Twilio incoming messages
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { SessionState } from '@/api/lib/session';
import { sendBookingConfirmation } from '@/api/lib/sms';
import { withIdempotency, wasSmsProcessed } from '@/api/lib/idempotency';
import { logger } from '@/api/lib/logger';
import { findSessionByPhone, saveSession } from '@/api/lib/utils';

// ----------------------
// CONFIG
// ----------------------
const CALENDLY_LINK = process.env.CALENDLY_LINK || 'https://calendly.com/bigdstrees/appointment';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

// ----------------------
// TWILIO SIGNATURE VALIDATION
// ----------------------
function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  // In development without auth token, skip validation
  if (!TWILIO_AUTH_TOKEN) {
    console.warn('TWILIO_AUTH_TOKEN not set - skipping signature validation');
    return true;
  }
  
  if (!signature) {
    return false;
  }
  
  // Build the validation string
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(key => `${key}${params[key]}`).join('');
  const dataToSign = url + paramString;
  
  // Compute expected signature
  const expectedSignature = crypto
    .createHmac('sha1', TWILIO_AUTH_TOKEN)
    .update(dataToSign)
    .digest('base64');
  
  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// ----------------------
// YES/NO PARSING (loose matching)
// ----------------------
type ResponseType = 'yes' | 'no' | 'stop' | 'unknown';

function parseResponse(body: string): ResponseType {
  const normalized = body.trim().toLowerCase();
  
  // STOP/UNSUBSCRIBE handling (Twilio compliance)
  if (['stop', 'unsubscribe', 'cancel', 'quit', 'end'].includes(normalized)) {
    return 'stop';
  }
  
  // YES variants
  if (['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'confirm', 'approved', 'approve', 'accept'].includes(normalized)) {
    return 'yes';
  }
  
  // NO variants
  if (['no', 'n', 'nah', 'nope', 'decline', 'declined', 'reject', 'pass'].includes(normalized)) {
    return 'no';
  }
  
  return 'unknown';
}

// ----------------------
// IN-MEMORY OPT-OUT LIST (would be DB in production)
// ----------------------
const optedOutPhones = new Set<string>();

function isOptedOut(phone: string): boolean {
  return optedOutPhones.has(phone);
}

function optOut(phone: string): void {
  optedOutPhones.add(phone);
  console.log(`Phone ${phone} opted out of SMS`);
}

// ----------------------
// FIND SESSION BY PHONE
// ----------------------
// (Uses persistent storage via utils.ts)

// ----------------------
// TwiML RESPONSE HELPER
// ----------------------
function twimlResponse(message: string): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message}</Message>
</Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

// ----------------------
// POST /api/sms-webhook
// ----------------------
export async function POST(request: NextRequest) {
  try {
    // Parse Twilio webhook data
    const formData = await request.formData();
    const from = formData.get('From') as string;
    const body = (formData.get('Body') as string || '').trim();
    const messageSid = formData.get('MessageSid') as string;
    
    // Build params object for signature validation
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = value.toString();
    });
    
    // Validate Twilio signature
    const signature = request.headers.get('X-Twilio-Signature');
    const webhookUrl = request.url;
    
    if (!validateTwilioSignature(signature, webhookUrl, params)) {
      console.error('Invalid Twilio signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    // Normalize phone
    const phone = from.replace(/\D/g, '').slice(-10);
    const leadId = phone; // Use phone as lead ID for now
    
    // Log the incoming message
    logger.smsReceived(leadId, from, body);

    console.log('=== SMS WEBHOOK ===');
    console.log('From:', from);
    console.log('Body:', body);
    console.log('MessageSid:', messageSid);
    console.log('==================');

    // Check if phone is opted out
    if (isOptedOut(phone)) {
      // Don't respond to opted-out users
      return new NextResponse('', { status: 200 });
    }

    // Parse response type
    const responseType = parseResponse(body);

    // Handle STOP (compliance)
    if (responseType === 'stop') {
      optOut(phone);
      logger.smsReceived(leadId, from, 'STOP - opted out');
      return twimlResponse('You have been unsubscribed and will not receive further messages.');
    }

    // Handle YES
    if (responseType === 'yes') {
      // Check idempotency - don't process same message twice
      if (wasSmsProcessed(leadId, messageSid)) {
        logger.idempotentSkip(leadId, 'sms_yes');
        return twimlResponse('We already received your approval! Check your messages for the booking link.');
      }
      
      // Use idempotency wrapper
      const { wasIdempotent } = await withIdempotency(
        { action: 'customer_approve', leadId, extra: messageSid },
        async () => {
          // Customer approved - send booking link
          logger.customerApproved(leadId);
          
          await sendBookingConfirmation(
            { contact: { phone, name: null, email: null } } as SessionState,
            CALENDLY_LINK
          );
          
          // Find and update session status
          const session = await findSessionByPhone(phone);
          if (session) {
            // Prevent double-scheduling
            if (session.status === 'scheduled') {
              return { alreadyScheduled: true };
            }
            session.status = 'scheduled';
            await saveSession(session.lead_id, session);
          }
          
          return { success: true };
        }
      );
      
      if (wasIdempotent) {
        return twimlResponse('We already received your approval! Check your messages for the booking link.');
      }
      
      return twimlResponse('Great! Click the link we just sent to pick your preferred time. We look forward to helping you!');
    }
    
    // Handle NO
    if (responseType === 'no') {
      logger.smsReceived(leadId, from, 'NO - declined');
      
      // Find and update session for follow-up
      const session = await findSessionByPhone(phone);
      if (session) {
        (session as any).declined = true;
        (session as any).declinedAt = new Date().toISOString();
        await saveSession(session.lead_id, session);
      }
      
      return twimlResponse("No problem! Corey will call you to discuss. If you have questions, call us at (262) 215-0497.");
    }
    
    // Unknown response
    return twimlResponse("Hi! Reply YES to approve the estimate and schedule, or NO to speak with us. Reply STOP to unsubscribe. Questions? Call (262) 215-0497.");

  } catch (error) {
    console.error('SMS webhook error:', error);
    return twimlResponse("Sorry, something went wrong. Please call us at (262) 215-0497.");
  }
}

// ----------------------
// GET for Twilio validation
// ----------------------
export async function GET() {
  return NextResponse.json({ status: 'SMS webhook active' });
}
