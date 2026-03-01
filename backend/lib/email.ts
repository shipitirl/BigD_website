// ============================================================
// Email Service - Owner notification emails
// ============================================================

import { SessionState, Estimate } from './session';
import { buildSignedAdminUrl } from './tokens';

// ----------------------
// CONFIG
// ----------------------
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'shipithon@gmail.com,bigdstrees33@gmail.com';
const APP_URL = process.env.APP_URL || 'http://localhost:3001';

// ----------------------
// EMAIL TYPES
// ----------------------
export interface EmailData {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// ----------------------
// SERVICE LABELS
// ----------------------
const serviceLabels: Record<string, string> = {
  tree_removal: 'Tree Removal',
  tree_trimming: 'Tree Trimming & Pruning',
  tree_health: 'Tree Health Inspection & Treatment',
  stump_grinding: 'Stump Grinding/Removal',
  tree_planting: 'Tree Planting & Transplanting',
  shrub_care: 'Shrub Pruning & Care',
  fertilization: 'Tree/Shrub Fertilization',
  soil_care: 'Soil Care & Analysis',
  pest_management: 'Pest & Insect Management',
  disease_management: 'Disease Management',
  storm_prep: 'Storm Prep & Support Systems',
  emergency_storm: 'Emergency Storm Response',
  utility_vegetation: 'Utility Vegetation Management',
  land_clearing: 'Land/Lot Clearing',
  mulching: 'Mulching & Brush Chipping',
  lawn_care: 'Lawn Care',
  consulting: 'Consulting & Arborist Reports',
  plant_health_care: 'Plant Health Care Program',
  airspading: 'Airspading',
  fire_abatement: 'Fire Abatement',
  herbicide: 'Herbicide Application',
  substation: 'Substation Restoration',
  weather_protection: 'Weather/Animal Protection',
  municipal: 'Municipal Tree Management',
  work_planning: 'Work Planning & Vegetation Management',
  tree_preservation: 'Tree Preservation',
  other: 'Tree Service',
};

// ----------------------
// BUILD STRUCTURED SUMMARY (Plain-text copy/paste block)
// ----------------------
function buildConversationHistory(session: SessionState): string {
  if (!session.messages || session.messages.length === 0) {
    return 'No conversation recorded';
  }

  return session.messages.map(msg => {
    const role = msg.role === 'user' ? 'CUSTOMER' : 'BOT';
    return `${role}: ${msg.content}`;
  }).join('\n');
}

function buildStructuredSummary(session: SessionState): string {
  const estimate = session.estimate;
  const contact = session.contact;
  const serviceType = session.service_type
    ? serviceLabels[session.service_type]
    : 'Tree Service';

  const estimateRange = estimate
    ? `$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()}`
    : 'Pending review';

  const confidenceLabel = estimate?.confidence || 'low';

  const hazards = [];
  if (session.hazards.power_lines) hazards.push('Power lines');
  if (session.hazards.structures_nearby) hazards.push('Near structure');

  const access = [];
  if (session.access.location) access.push(session.access.location);
  if (session.access.gate_width_ft) access.push(`Gate: ${session.access.gate_width_ft}ft`);
  if (session.access.slope) access.push(`Slope: ${session.access.slope}`);

  const photoLinks = session.photos.urls.length > 0
    ? session.photos.urls.map(url => `${APP_URL}${url}`).join('\n  ')
    : 'No photos';

  return `
=== LEAD SUMMARY ===
Name/Phone: ${contact.name || 'Unknown'} / ${contact.phone || 'No phone'}
Email: ${contact.email || 'No email'}
Zip: ${session.zip || 'Unknown'}

Service: ${serviceType}
Count: ${session.tree_count || 1} item(s)
${session.dimensions?.diameter_ft ? `Diameter: ${session.dimensions.diameter_ft}ft` : ''}
${session.dimensions?.height_ft ? `Height: ${session.dimensions.height_ft}ft` : ''}

Access: ${access.join(', ') || 'Not specified'}
Hazards: ${hazards.join(', ') || 'None noted'}
Haul Away: ${session.haul_away === true ? 'Yes' : session.haul_away === false ? 'No' : 'Not sure'}
${session.urgency === 'emergency' ? '⚠️ EMERGENCY REQUEST' : ''}

Estimate: ${estimateRange} (${confidenceLabel} confidence)
${estimate?.drivers.length ? `Drivers:\n  - ${estimate.drivers.join('\n  - ')}` : ''}

Photos:
  ${photoLinks}

=== FULL CONVERSATION ===
${buildConversationHistory(session)}
====================
  `.trim();
}

// ----------------------
// BUILD OWNER NOTIFICATION
// ----------------------
export function buildOwnerNotificationEmail(session: SessionState): EmailData {
  const estimate = session.estimate;
  const contact = session.contact;

  const serviceType = session.service_type 
    ? serviceLabels[session.service_type] 
    : 'Tree Service';

  const estimateRange = estimate 
    ? `$${estimate.min.toLocaleString()} - $${estimate.max.toLocaleString()}`
    : 'Pending review';

  const confidenceEmoji = {
    high: '🎯',
    medium: '📊',
    low: '📐',
  }[estimate?.confidence || 'low'];

  const driversHtml = estimate?.drivers.length 
    ? `<ul>${estimate.drivers.map(d => `<li>${d}</li>`).join('')}</ul>`
    : '<p>No modifiers</p>';

  const photosHtml = session.photos.count > 0
    ? session.photos.urls.map(url => 
        `<a href="${APP_URL}${url}" target="_blank"><img src="${APP_URL}${url}" width="150" style="margin: 4px; border-radius: 8px;"></a>`
      ).join('')
    : '<p>No photos uploaded</p>';

  // Build signed URLs
  const finalizeUrl = buildSignedAdminUrl(APP_URL, session.lead_id, 'lead_admin');
  const adjustUrl = `${finalizeUrl}&adjust=true`;

  // Check for escalation flags
  const needsSiteVisit = (session as any).needsSiteVisit === true;
  const ownerMustConfirm = (session as any).ownerMustConfirm === true;
  
  const warningHtml = (needsSiteVisit || ownerMustConfirm) 
    ? `<div style="background: #fff3cd; padding: 12px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #ffc107;">
        ⚠️ <strong>Human Override Required</strong><br>
        ${needsSiteVisit ? 'Site visit recommended before final pricing.' : ''}
        ${ownerMustConfirm ? 'Owner must confirm before customer SMS is sent.' : ''}
       </div>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2d5016 0%, #4a7c23 100%); color: white; padding: 20px; border-radius: 12px 12px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border-radius: 0 0 12px 12px; }
    .estimate-box { background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #4a7c23; }
    .estimate-range { font-size: 24px; font-weight: bold; color: #2d5016; }
    .btn { display: inline-block; padding: 12px 24px; background: #4a7c23; color: white; text-decoration: none; border-radius: 8px; margin: 8px 8px 8px 0; }
    .btn-secondary { background: #6c757d; }
    .section { margin: 20px 0; }
    .label { font-weight: bold; color: #666; font-size: 12px; text-transform: uppercase; }
    .photos { display: flex; flex-wrap: wrap; gap: 8px; }
    pre { background: #e9ecef; padding: 12px; border-radius: 8px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">🌳 New Estimate Ready</h1>
    <p style="margin: 8px 0 0 0; opacity: 0.9;">Big D's Tree Service — ${session.zip || 'Unknown ZIP'}</p>
  </div>
  
  <div class="content">
    ${warningHtml}
    
    <div class="estimate-box">
      <div class="label">Estimated Range ${confidenceEmoji}</div>
      <div class="estimate-range">${estimateRange}</div>
      <div style="color: #666; font-size: 14px;">${estimate?.confidence || 'low'} confidence</div>
    </div>

    <div class="section">
      <div class="label">Service Details</div>
      <p><strong>${serviceType}</strong> — ${session.tree_count || 1} tree(s)/stump(s)</p>
      <p>
        ${session.access.location === 'backyard' ? '🏠 Backyard' : '🏡 Front yard'}
        ${session.access.gate_width_ft ? ` • Gate: ${session.access.gate_width_ft}ft` : ''}
        ${session.access.slope === 'steep' ? ' • ⚠️ Steep slope' : ''}
      </p>
      <p>
        ${session.hazards.power_lines ? '⚡ Power lines nearby' : '✓ No power lines'}
        ${session.hazards.structures_nearby ? ' • 🏗️ Near structure' : ''}
      </p>
      ${session.urgency === 'emergency' ? '<p style="color: #dc3545; font-weight: bold;">🚨 EMERGENCY REQUEST</p>' : ''}
    </div>

    <div class="section">
      <div class="label">Price Drivers</div>
      ${driversHtml}
    </div>

    <div class="section">
      <div class="label">Customer Contact</div>
      <p>
        <strong>${contact.name || 'Unknown'}</strong><br>
        📞 <a href="tel:${contact.phone}">${contact.phone || 'No phone'}</a><br>
        ${contact.email ? `✉️ ${contact.email}` : ''}
      </p>
    </div>

    <div class="section">
      <div class="label">Photos (${session.photos.count})</div>
      <div class="photos">
        ${photosHtml}
      </div>
    </div>

    <div class="section" style="margin-top: 30px;">
      <a href="${finalizeUrl}" class="btn">✅ Approve & Send to Customer</a>
      <a href="${adjustUrl}" class="btn btn-secondary">✏️ Adjust Estimate</a>
    </div>

    <div class="section" style="margin-top: 30px;">
      <div class="label">Full Conversation</div>
      <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; max-height: 400px; overflow-y: auto;">
        ${session.messages.map(msg => `
          <div style="margin-bottom: 12px; ${msg.role === 'user' ? 'text-align: right;' : ''}">
            <span style="display: inline-block; padding: 8px 12px; border-radius: 12px; max-width: 80%; ${
              msg.role === 'user'
                ? 'background: #4a7c23; color: white;'
                : 'background: #e9ecef; color: #333;'
            }">
              ${msg.content}
            </span>
            <div style="font-size: 10px; color: #999; margin-top: 2px;">${msg.role === 'user' ? 'Customer' : 'Bot'}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section" style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd;">
      <div class="label">Copy/Paste Summary</div>
      <pre>${buildStructuredSummary(session)}</pre>
    </div>
  </div>
</body>
</html>
  `.trim();

  // Plain-text version with full details
  const text = `
New Estimate Ready - Big D's Tree Service
==========================================

${session.urgency === 'emergency' ? '⚠️ EMERGENCY REQUEST\n' : ''}
Service: ${serviceType}
Count: ${session.tree_count || 1}
ZIP: ${session.zip || 'Unknown'}

ESTIMATE: ${estimateRange} (${estimate?.confidence || 'low'} confidence)
${estimate?.drivers.length ? `\nPrice Drivers:\n  - ${estimate.drivers.join('\n  - ')}` : ''}

CUSTOMER:
  Name: ${contact.name || 'Unknown'}
  Phone: ${contact.phone || 'No phone'}
  Email: ${contact.email || 'No email'}

ACCESS:
  Location: ${session.access.location || 'Not specified'}
  Gate Width: ${session.access.gate_width_ft ? `${session.access.gate_width_ft}ft` : 'N/A'}
  Slope: ${session.access.slope || 'Not specified'}

HAZARDS:
  Power Lines: ${session.hazards.power_lines ? 'YES' : 'No'}
  Near Structure: ${session.hazards.structures_nearby ? 'YES' : 'No'}

PHOTOS (${session.photos.count}):
${session.photos.urls.length > 0 
  ? session.photos.urls.map(url => `  ${APP_URL}${url}`).join('\n')
  : '  No photos uploaded'}

-------------------------------------------
APPROVE: ${finalizeUrl}
ADJUST:  ${adjustUrl}
-------------------------------------------

${buildStructuredSummary(session)}
  `.trim();

  return {
    to: OWNER_EMAIL,
    subject: `🌳 New Estimate: ${serviceType} — ${session.zip || 'ZIP?'} — ${estimateRange}`,
    html,
    text,
  };
}

// ----------------------
// SEND EMAIL (placeholder - integrate with SendGrid/Resend/etc)
// ----------------------
// ----------------------
// SEND EMAIL (Gmail Implementation)
// ----------------------
import nodemailer from 'nodemailer';

export async function sendEmail(email: EmailData): Promise<boolean> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  // Log intent (always helpful for debugging)
  console.log(`[Email] Sending to ${email.to}: ${email.subject}`);

  if (!gmailUser || !gmailPass) {
    console.warn('[Email] Skipped: GMAIL_USER or GMAIL_APP_PASSWORD not set in .env');
    console.log('--- Email Content ---');
    console.log(email.text);
    console.log('---------------------');
    return true; // Return true so we don't break the flow in dev
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  });

  try {
    await transporter.sendMail({
      from: `"Big D's Tree Service" <${gmailUser}>`,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    console.log('[Email] Sent successfully via Gmail');
    return true;
  } catch (err) {
    console.error('[Email] Failed to send:', err);
    return false;
  }
}

// ----------------------
// SEND OWNER NOTIFICATION
// ----------------------
export async function notifyOwner(session: SessionState): Promise<boolean> {
  const email = buildOwnerNotificationEmail(session);
  return sendEmail(email);
}
