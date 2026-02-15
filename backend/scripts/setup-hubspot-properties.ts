// backend/scripts/setup-hubspot-properties.ts
// Create custom deal properties in HubSpot for estimate audit trail

import "dotenv/config";

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_API_BASE = "https://api.hubapi.com";

async function hubspotFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${HUBSPOT_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

interface PropertyDefinition {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  description: string;
  options?: { label: string; value: string }[];
}

const dealProperties: PropertyDefinition[] = [
  {
    name: "initial_estimate_min",
    label: "Initial Estimate Min",
    type: "number",
    fieldType: "number",
    groupName: "dealinformation",
    description: "Chatbot-generated minimum estimate",
  },
  {
    name: "initial_estimate_max",
    label: "Initial Estimate Max",
    type: "number",
    fieldType: "number",
    groupName: "dealinformation",
    description: "Chatbot-generated maximum estimate",
  },
  {
    name: "final_estimate_min",
    label: "Final Estimate Min",
    type: "number",
    fieldType: "number",
    groupName: "dealinformation",
    description: "Final minimum estimate (after owner adjustments)",
  },
  {
    name: "final_estimate_max",
    label: "Final Estimate Max",
    type: "number",
    fieldType: "number",
    groupName: "dealinformation",
    description: "Final maximum estimate (after owner adjustments)",
  },
  {
    name: "estimate_status",
    label: "Estimate Status",
    type: "enumeration",
    fieldType: "select",
    groupName: "dealinformation",
    description: "Current status of the estimate in the approval workflow",
    options: [
      { label: "Chatbot Generated", value: "chatbot_generated" },
      { label: "Owner Adjusted", value: "owner_adjusted" },
      { label: "Customer Approved", value: "customer_approved" },
    ],
  },
  {
    name: "estimate_adjustment_reason",
    label: "Estimate Adjustment Reason",
    type: "string",
    fieldType: "textarea",
    groupName: "dealinformation",
    description: "Reason for owner adjustment to the estimate",
  },
  {
    name: "chatbot_confidence",
    label: "Chatbot Confidence",
    type: "enumeration",
    fieldType: "select",
    groupName: "dealinformation",
    description: "Chatbot's confidence level in the estimate",
    options: [
      { label: "High", value: "high" },
      { label: "Needs Review", value: "needs_review" },
      { label: "Flagged", value: "flagged" },
    ],
  },
];

async function createProperty(property: PropertyDefinition): Promise<boolean> {
  const body: Record<string, unknown> = {
    name: property.name,
    label: property.label,
    type: property.type,
    fieldType: property.fieldType,
    groupName: property.groupName,
    description: property.description,
  };

  if (property.options) {
    body.options = property.options;
  }

  const response = await hubspotFetch("/crm/v3/properties/deals", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return true;
  }

  const error = await response.json();

  // Property might already exist
  if (error.category === "DUPLICATE_PROPERTY") {
    console.log(`   ⚠️  Already exists`);
    return true;
  }

  console.error(`   ❌ Failed:`, error.message || error);
  return false;
}

async function setup() {
  console.log("=".repeat(60));
  console.log("Setting up HubSpot Custom Deal Properties");
  console.log("=".repeat(60));

  if (!HUBSPOT_ACCESS_TOKEN) {
    console.error("\n❌ HUBSPOT_ACCESS_TOKEN not found");
    process.exit(1);
  }

  console.log("\nCreating properties...\n");

  let successCount = 0;
  for (const property of dealProperties) {
    process.stdout.write(`Creating "${property.label}"...`);
    const success = await createProperty(property);
    if (success) {
      console.log(" ✅");
      successCount++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`✅ ${successCount}/${dealProperties.length} properties ready`);
  console.log("=".repeat(60));

  if (successCount === dealProperties.length) {
    console.log("\n🎉 All properties created! You can now run the audit test:");
    console.log("   npx tsx scripts/test-estimate-audit.ts\n");
  }
}

setup().catch(console.error);
