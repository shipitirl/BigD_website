// backend/scripts/cleanup-hubspot-test.ts
// Clean up test contact and deal from HubSpot

import "dotenv/config";

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_API_BASE = "https://api.hubapi.com";

// IDs from the test run - update these after each test
const TEST_CONTACT_ID = "397838994137";
const TEST_DEAL_ID = "273414136513";

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

async function cleanup() {
  console.log("Cleaning up HubSpot test data...\n");

  // Delete deal first (has association to contact)
  console.log(`Deleting deal ${TEST_DEAL_ID}...`);
  const dealRes = await hubspotFetch(`/crm/v3/objects/deals/${TEST_DEAL_ID}`, {
    method: "DELETE",
  });
  console.log(`  Deal: ${dealRes.ok ? "✓ Deleted" : `❌ Failed (${dealRes.status})`}`);

  // Delete contact
  console.log(`Deleting contact ${TEST_CONTACT_ID}...`);
  const contactRes = await hubspotFetch(`/crm/v3/objects/contacts/${TEST_CONTACT_ID}`, {
    method: "DELETE",
  });
  console.log(`  Contact: ${contactRes.ok ? "✓ Deleted" : `❌ Failed (${contactRes.status})`}`);

  console.log("\n✓ Cleanup complete");
}

cleanup().catch(console.error);
