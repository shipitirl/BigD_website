// backend/api/lib/hubspot.ts
// HubSpot CRM Integration - Creates contacts and deals on lead finalization

import type { SessionState } from "./session";

// ----------------------
// CONFIG
// ----------------------
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_API_BASE = "https://api.hubapi.com";

// ----------------------
// SERVICE LABELS
// ----------------------
const serviceLabels: Record<string, string> = {
  tree_removal: "Tree Removal",
  tree_trimming: "Tree Trimming",
  stump_grinding: "Stump Grinding",
  storm_prep: "Storm Preparation",
  emergency_storm: "Emergency Storm Cleanup",
  land_clearing: "Land Clearing",
  tree_health: "Tree Health",
  pest_management: "Pest Management",
  disease_management: "Disease Management",
  consulting: "Consulting",
  other: "Tree Service",
};

// ----------------------
// TYPES
// ----------------------
interface HubSpotContact {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
  };
}

interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
  };
}

interface HubSpotResult {
  success: boolean;
  contactId?: string;
  dealId?: string;
  error?: string;
}

// ----------------------
// API HELPERS
// ----------------------
async function hubspotFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${HUBSPOT_API_BASE}${endpoint}`;

  return fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// ----------------------
// SEARCH FOR EXISTING CONTACT
// ----------------------
async function findContactByEmail(email: string): Promise<string | null> {
  try {
    const response = await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "email",
            operator: "EQ",
            value: email,
          }],
        }],
        limit: 1,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.results?.[0]?.id || null;
  } catch (err) {
    console.error("[HubSpot] Search error:", err);
    return null;
  }
}

async function findContactByPhone(phone: string): Promise<string | null> {
  try {
    // Normalize phone for search
    const digits = phone.replace(/\D/g, "");

    const response = await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "phone",
            operator: "CONTAINS_TOKEN",
            value: digits.slice(-10), // Last 10 digits
          }],
        }],
        limit: 1,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.results?.[0]?.id || null;
  } catch (err) {
    console.error("[HubSpot] Phone search error:", err);
    return null;
  }
}

// ----------------------
// CREATE OR UPDATE CONTACT
// ----------------------
async function createOrUpdateContact(session: SessionState): Promise<string | null> {
  const { contact } = session;

  // Parse name into first/last
  const nameParts = (contact.name || "").trim().split(/\s+/);
  const firstname = nameParts[0] || "";
  const lastname = nameParts.slice(1).join(" ") || "";

  // Check if contact exists
  let existingId: string | null = null;

  if (contact.email) {
    existingId = await findContactByEmail(contact.email);
  }

  if (!existingId && contact.phone) {
    existingId = await findContactByPhone(contact.phone);
  }

  const properties: Record<string, string> = {};

  if (firstname) properties.firstname = firstname;
  if (lastname) properties.lastname = lastname;
  if (contact.email) properties.email = contact.email;
  if (contact.phone) properties.phone = contact.phone;
  if (contact.address) properties.address = contact.address;
  if (contact.city) properties.city = contact.city;
  if (session.zip) properties.zip = session.zip;

  try {
    if (existingId) {
      // Update existing contact
      const response = await hubspotFetch(`/crm/v3/objects/contacts/${existingId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("[HubSpot] Contact update failed:", error);
        return existingId; // Return existing ID even if update fails
      }

      console.log(`[HubSpot] Updated contact ${existingId}`);
      return existingId;
    } else {
      // Create new contact
      const response = await hubspotFetch("/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify({ properties }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("[HubSpot] Contact creation failed:", error);
        return null;
      }

      const data: HubSpotContact = await response.json();
      console.log(`[HubSpot] Created contact ${data.id}`);
      return data.id;
    }
  } catch (err) {
    console.error("[HubSpot] Contact error:", err);
    return null;
  }
}

// ----------------------
// CREATE DEAL
// ----------------------
async function createDeal(
  session: SessionState,
  contactId: string
): Promise<string | null> {
  const serviceType = serviceLabels[session.service_type || "other"];
  const estimate = session.estimate;

  // Calculate midpoint of estimate for deal amount
  const amount = estimate
    ? Math.round((estimate.min + estimate.max) / 2).toString()
    : "";

  const dealname = `${serviceType} - ${session.zip || "No ZIP"} - ${session.contact.name || "Unknown"}`;

  // Map confidence to chatbot_confidence dropdown values
  const confidenceMap: Record<string, string> = {
    high: "high",
    medium: "needs_review",
    low: "flagged",
  };
  const chatbotConfidence = estimate?.confidence
    ? confidenceMap[estimate.confidence] || "needs_review"
    : "needs_review";

  // Build description with job details
  const descriptionParts: string[] = [];

  descriptionParts.push(`Service: ${serviceType}`);
  descriptionParts.push(`Trees/Stumps: ${session.tree_count || 1}`);

  if (estimate) {
    descriptionParts.push(`Estimate: $${estimate.min} - $${estimate.max} (${estimate.confidence} confidence)`);
    if (estimate.drivers.length > 0) {
      descriptionParts.push(`Price factors: ${estimate.drivers.join(", ")}`);
    }
  }

  descriptionParts.push(`Location: ${session.access.location || "Not specified"}`);
  descriptionParts.push(`Slope: ${session.access.slope || "Not specified"}`);
  descriptionParts.push(`Power lines: ${session.hazards.power_lines ? "Yes" : "No"}`);
  descriptionParts.push(`Near structures: ${session.hazards.structures_nearby ? "Yes" : "No"}`);
  descriptionParts.push(`Haul away: ${session.haul_away === true ? "Yes" : session.haul_away === false ? "No" : "Unsure"}`);
  descriptionParts.push(`Urgency: ${session.urgency || "normal"}`);

  if (session.photos?.urls?.length) {
    descriptionParts.push(`Photos: ${session.photos.urls.length} uploaded`);
  }

  descriptionParts.push(`Session ID: ${session.lead_id}`);

  const properties: Record<string, string> = {
    dealname,
    pipeline: "default",
    dealstage: "appointmentscheduled", // HubSpot Free default stage
    description: descriptionParts.join("\n"),
  };

  if (amount) {
    properties.amount = amount;
  }

  // Custom properties for estimate audit trail (optional)
  // These must be created in HubSpot first: Settings → Properties → Deal Properties
  // If not created, they'll be skipped and deal will still be created
  const customProperties: Record<string, string> = {};
  if (estimate) {
    customProperties.initial_estimate_min = estimate.min.toString();
    customProperties.initial_estimate_max = estimate.max.toString();
    customProperties.final_estimate_min = estimate.min.toString();
    customProperties.final_estimate_max = estimate.max.toString();
    customProperties.estimate_status = "chatbot_generated";
    customProperties.chatbot_confidence = chatbotConfidence;
  }

  try {
    // Try to create deal with custom properties first
    const allProperties = { ...properties, ...customProperties };
    let response = await hubspotFetch("/crm/v3/objects/deals", {
      method: "POST",
      body: JSON.stringify({ properties: allProperties }),
    });

    // If custom properties don't exist, retry without them
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes("PROPERTY_DOESNT_EXIST")) {
        console.log("[HubSpot] Custom properties not found, creating deal without audit trail");
        response = await hubspotFetch("/crm/v3/objects/deals", {
          method: "POST",
          body: JSON.stringify({ properties }),
        });
      }

      if (!response.ok) {
        const error = await response.text();
        console.error("[HubSpot] Deal creation failed:", error);
        return null;
      }
    }

    const data: HubSpotDeal = await response.json();
    console.log(`[HubSpot] Created deal ${data.id}`);

    // Associate deal with contact
    await hubspotFetch(
      `/crm/v3/objects/deals/${data.id}/associations/contacts/${contactId}/deal_to_contact`,
      { method: "PUT" }
    );

    console.log(`[HubSpot] Associated deal ${data.id} with contact ${contactId}`);
    return data.id;
  } catch (err) {
    console.error("[HubSpot] Deal error:", err);
    return null;
  }
}

// ----------------------
// ADD NOTE WITH CONVERSATION
// ----------------------
async function addConversationNote(
  session: SessionState,
  dealId: string
): Promise<boolean> {
  if (!session.messages || session.messages.length === 0) {
    return true; // Nothing to add
  }

  // Format conversation
  const conversationLines = session.messages.map(msg =>
    `${msg.role === "user" ? "Customer" : "Bot"}: ${msg.content}`
  );

  const noteBody = [
    "=== Chatbot Conversation ===",
    "",
    ...conversationLines,
    "",
    `--- End of conversation (${session.messages.length} messages) ---`,
  ].join("\n");

  try {
    // Create engagement (note)
    const response = await hubspotFetch("/crm/v3/objects/notes", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          hs_note_body: noteBody,
          hs_timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[HubSpot] Note creation failed:", error);
      return false;
    }

    const note = await response.json();

    // Associate note with deal
    await hubspotFetch(
      `/crm/v3/objects/notes/${note.id}/associations/deals/${dealId}/note_to_deal`,
      { method: "PUT" }
    );

    console.log(`[HubSpot] Added conversation note to deal ${dealId}`);
    return true;
  } catch (err) {
    console.error("[HubSpot] Note error:", err);
    return false;
  }
}

// ----------------------
// MAIN: SYNC TO HUBSPOT
// ----------------------
export async function syncToHubSpot(session: SessionState): Promise<HubSpotResult> {
  if (!HUBSPOT_ACCESS_TOKEN) {
    console.log("[HubSpot] Skipped: HUBSPOT_ACCESS_TOKEN not set");
    return { success: true }; // Don't fail if not configured
  }

  console.log(`[HubSpot] Syncing session ${session.lead_id}...`);

  try {
    // 1. Create or update contact
    const contactId = await createOrUpdateContact(session);
    if (!contactId) {
      return { success: false, error: "Failed to create contact" };
    }

    // 2. Create deal
    const dealId = await createDeal(session, contactId);
    if (!dealId) {
      return { success: false, contactId, error: "Failed to create deal" };
    }

    // 3. Add conversation as note
    await addConversationNote(session, dealId);

    console.log(`[HubSpot] Sync complete: Contact ${contactId}, Deal ${dealId}`);

    return {
      success: true,
      contactId,
      dealId,
    };
  } catch (err) {
    console.error("[HubSpot] Sync error:", err);
    return {
      success: false,
      error: String(err),
    };
  }
}

// ----------------------
// UPDATE DEAL ESTIMATE (Owner Adjustment)
// ----------------------
export async function updateDealEstimate(
  dealId: string,
  newMin: number,
  newMax: number,
  reason?: string
): Promise<boolean> {
  if (!HUBSPOT_ACCESS_TOKEN) return false;

  try {
    // Custom properties (may not exist)
    const customProperties: Record<string, string> = {
      final_estimate_min: newMin.toString(),
      final_estimate_max: newMax.toString(),
      estimate_status: "owner_adjusted",
    };

    if (reason) {
      customProperties.estimate_adjustment_reason = reason;
    }

    // Base properties (always exist)
    const baseProperties: Record<string, string> = {
      amount: Math.round((newMin + newMax) / 2).toString(),
    };

    // Try with custom properties first
    let response = await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: { ...baseProperties, ...customProperties } }),
    });

    // If custom properties don't exist, update just the amount
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes("PROPERTY_DOESNT_EXIST")) {
        console.log("[HubSpot] Custom properties not found, updating amount only");
        response = await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: baseProperties }),
        });
      }
    }

    if (response.ok) {
      console.log(`[HubSpot] Updated deal ${dealId} estimate: $${newMin}-$${newMax}`);
    }

    return response.ok;
  } catch (err) {
    console.error("[HubSpot] Update estimate error:", err);
    return false;
  }
}

// ----------------------
// MARK ESTIMATE AS CUSTOMER APPROVED
// ----------------------
export async function markEstimateApproved(dealId: string): Promise<boolean> {
  if (!HUBSPOT_ACCESS_TOKEN) return false;

  try {
    // Try with custom property first
    let response = await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          estimate_status: "customer_approved",
          dealstage: "qualifiedtobuy",
        },
      }),
    });

    // If custom property doesn't exist, just update the stage
    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes("PROPERTY_DOESNT_EXIST")) {
        console.log("[HubSpot] Custom properties not found, updating stage only");
        response = await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
          method: "PATCH",
          body: JSON.stringify({
            properties: {
              dealstage: "qualifiedtobuy",
            },
          }),
        });
      }
    }

    return response.ok;
  } catch (err) {
    console.error("[HubSpot] Mark approved error:", err);
    return false;
  }
}

// ----------------------
// UPDATE DEAL STAGE
// ----------------------
export async function updateDealStage(
  dealId: string,
  stage: "appointmentscheduled" | "qualifiedtobuy" | "presentationscheduled" | "decisionmakerboughtin" | "contractsent" | "closedwon" | "closedlost"
): Promise<boolean> {
  if (!HUBSPOT_ACCESS_TOKEN) {
    return false;
  }

  try {
    const response = await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          dealstage: stage,
        },
      }),
    });

    return response.ok;
  } catch (err) {
    console.error("[HubSpot] Update stage error:", err);
    return false;
  }
}

// ----------------------
// MARK AS WON/LOST
// ----------------------
export async function markDealWon(dealId: string, actualAmount?: number): Promise<boolean> {
  if (!HUBSPOT_ACCESS_TOKEN) return false;

  try {
    const properties: Record<string, string> = {
      dealstage: "closedwon",
    };

    if (actualAmount !== undefined) {
      properties.amount = actualAmount.toString();
    }

    const response = await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });

    return response.ok;
  } catch (err) {
    console.error("[HubSpot] Mark won error:", err);
    return false;
  }
}

export async function markDealLost(dealId: string, reason?: string): Promise<boolean> {
  if (!HUBSPOT_ACCESS_TOKEN) return false;

  try {
    const properties: Record<string, string> = {
      dealstage: "closedlost",
    };

    // Note: HubSpot Free doesn't have closed_lost_reason by default
    // You'd need to create a custom property for this

    const response = await hubspotFetch(`/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });

    return response.ok;
  } catch (err) {
    console.error("[HubSpot] Mark lost error:", err);
    return false;
  }
}
