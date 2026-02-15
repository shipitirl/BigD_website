
import { createLead, Lead, PhotoFile } from './lead';
import { prepareForCloudflare, D1LeadRow, R2PhotoUpload } from './storage-cloudflare';
import assert from 'assert';

console.log("Running D1/R2 Conversion Test...");

// 1. Create a mock Lead matching the user's request
// Customer name: "John Smith"
// Phone: "555-1234"
// Chatbot conversation: JSON string
// Photo files: Binary JPEG/PNG
// Photo references: ["https://r2.../photo1.jpg"]

const lead = createLead('test-session-id');
lead.customer.name = "John Smith";
lead.customer.phone = "555-1234";

// Add some messages
lead.messages = [
  { role: 'assistant', content: 'Hello' },
  { role: 'user', content: 'I need a tree removed' }
];

// Add photos
const mockPhoto: PhotoFile = {
  url: 'https://r2.bigdtrees.com/leads/test-session-id/photos/photo1.jpg',
  name: 'photo1.jpg',
  content_type: 'image/jpeg'
};
lead.job.photos.files = [mockPhoto];
lead.job.photos.received = true;

// Mock binary data
const mockBinaryData = new TextEncoder().encode("fake-image-binary-data").buffer;
const rawPhotos = {
  'photo1.jpg': mockBinaryData
};

// 2. Run Conversion
const result = prepareForCloudflare(lead, { rawPhotos });

// 3. Verify D1 Row
console.log("\nVerifying D1 Row...");
const row = result.d1Row;

const expectedD1: Partial<D1LeadRow> = {
  id: 'test-session-id',
  customer_name: "John Smith",
  customer_phone: "555-1234",
};

assert.strictEqual(row.id, expectedD1.id);
assert.strictEqual(row.customer_name, expectedD1.customer_name);
assert.strictEqual(row.customer_phone, expectedD1.customer_phone);

// Verify JSON fields
const parsedMessages = JSON.parse(row.messages_json);
assert.strictEqual(parsedMessages.length, 2);
assert.strictEqual(parsedMessages[0].content, 'Hello');

const parsedPhotos = JSON.parse(row.photo_refs_json);
assert.strictEqual(parsedPhotos.length, 1);
assert.strictEqual(parsedPhotos[0].url, mockPhoto.url);

console.log("✅ D1 Row checks passed");

// 4. Verify R2 Uploads
console.log("\nVerifying R2 Uploads...");
const uploads = result.r2Uploads;

assert.strictEqual(uploads.length, 1);
assert.strictEqual(uploads[0].key, 'leads/test-session-id/photos/photo1.jpg');
assert.strictEqual(uploads[0].contentType, 'image/jpeg');
assert.deepStrictEqual(uploads[0].data, mockBinaryData);

console.log("✅ R2 Upload checks passed");

console.log("\nSample Output D1 Row:", row);
console.log("Sample Output R2 Key:", uploads[0].key);
