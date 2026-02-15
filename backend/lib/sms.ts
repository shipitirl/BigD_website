// ============================================================
// SMS Service - Twilio integration for customer messaging
// ============================================================

import { SessionState } from './session';

// ----------------------
// CONFIG
// ----------------------
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const APP_URL = process.env.APP_URL || 'http://localhost:3001';

// ----------------------
// SMS TYPES
// ----------------------
export interface SMSData {
  to: string;
  body: string;
}

// ----------------------
// SEND SMS (Twilio)
// ----------------------
export async function sendSMS(sms: SMSData): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log('=== SMS (Mock - No Twilio Config) ===');
    console.log('To:', sms.to);
    console.log('Body:', sms.body);
    console.log('=====================================');
    return true; // Mock success for development
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: sms.to,
        From: TWILIO_PHONE_NUMBER,
        Body: sms.body,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Twilio error:', error);
      return false;
    }

    console.log('SMS sent successfully to', sms.to);
    return true;

  } catch (error) {
    console.error('SMS send error:', error);
    return false;
  }
}

// ----------------------
// FORMAT PHONE NUMBER
// ----------------------
function formatPhone(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // Add US country code if needed
  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  return `+${digits}`;
}

// ----------------------
// SEND ESTIMATE APPROVAL REQUEST
// ----------------------
export async function sendEstimateToCustomer(session: SessionState): Promise<boolean> {
  if (!session.contact.phone) {
    console.error('No phone number for customer');
    return false;
  }

  const estimate = session.estimate;
  if (!estimate) {
    console.error('No estimate available');
    return false;
  }

  const serviceLabels: Record<string, string> = {
    stump_grinding: 'stump grinding',
    tree_removal: 'tree removal',
    trimming: 'tree trimming',
    cleanup: 'debris cleanup',
  };

  const serviceType = session.service_type 
    ? serviceLabels[session.service_type] 
    : 'tree service';

  const body = `Big D's Tree Service estimate:

$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()} for ${serviceType}

Reply YES to approve and schedule, or NO to discuss.

Questions? Call (262) 215-0497`;

  return sendSMS({
    to: formatPhone(session.contact.phone),
    body,
  });
}

// ----------------------
// SEND BOOKING CONFIRMATION
// ----------------------
export async function sendBookingConfirmation(
  session: SessionState, 
  bookingLink: string
): Promise<boolean> {
  if (!session.contact.phone) {
    return false;
  }

  const body = `Thanks for choosing Big D's Tree Service! 🌳

Schedule your appointment here:
${bookingLink}

We'll see you soon!
- Corey and the Big D's team`;

  return sendSMS({
    to: formatPhone(session.contact.phone),
    body,
  });
}

// ----------------------
// SEND REMINDER
// ----------------------
export async function sendReminder(
  phone: string,
  appointmentDate: string,
  serviceType: string
): Promise<boolean> {
  const body = `Reminder: Your ${serviceType} appointment with Big D's Tree Service is tomorrow (${appointmentDate}).

We'll arrive between 8-10am. Please ensure access to the work area.

Questions? Call (262) 215-0497`;

  return sendSMS({
    to: formatPhone(phone),
    body,
  });
}
