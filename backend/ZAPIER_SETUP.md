# Zapier-First Setup

This project now supports a Zapier-first lead pipeline with no required CRM sync.

## 1) Lead comes in -> saved + notified

Trigger source: `POST /api/finalize` from website submit flow.

Set:

```bash
ZAPIER_LEAD_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...
ENABLE_ZAPIER_LEAD_FLOW=true
ENABLE_NATIVE_NOTIFICATIONS=false
ENABLE_HUBSPOT_SYNC=false
```

Payload fields sent to Zapier include:

- `leadId`
- `name`, `firstName`, `lastName`
- `phone`, `email`
- `service`
- `address`, `zip`
- `notes`
- `urgency`, `treeCount`
- `estimateMin`, `estimateMax`, `estimateRange`
- `createCustomer`, `createEstimate`, `createInvoice`
- `estimateTitle`, `invoiceTitle`, `lineItemDescription`
- `ownerSmsMessage`
- `customerAutoReplyText`
- `customerAutoReplyEmailSubject`
- `customerAutoReplyEmailBody`

Recommended Zap actions:

1. Add row to Google Sheets (name, phone, service, address, notes)
2. Send owner SMS using `ownerSmsMessage`
3. Send customer text/email using auto-reply fields

## Yardbook mapping (chatbot + intake form)

If you're using Yardbook as CRM:

1. **Create/Update Customer** in Yardbook
   - Map `firstName`, `lastName`, `phone`, `email`, `address`, `zip`
2. **Create Estimate (draft/temporary)**
   - Map title to `estimateTitle`
   - Map amount/range from `estimateMin`, `estimateMax`, `estimateRange`
   - Map description to `lineItemDescription`
3. **Create Invoice (draft/temporary)**
   - Map title to `invoiceTitle`
   - Reuse customer + estimate/service fields

Tip: In Zapier, use **Filter** steps on `createCustomer`, `createEstimate`, and `createInvoice` so each path is explicit and easy to debug.

## 2) Missed call -> follow-up (optional)

Use endpoint:

```bash
POST /api/zapier/missed-call
```

Example:

```bash
curl -X POST http://localhost:3001/api/zapier/missed-call \
  -H "Content-Type: application/json" \
  -H "x-zapier-events-key: $ZAPIER_EVENTS_API_KEY" \
  -d '{
    "phone": "262-555-1212",
    "name": "John",
    "source": "phone_system",
    "notes": "No voicemail"
  }'
```

Zapier can then:

1. Log to Google Sheets
2. Send auto-text: `Sorry we missed you - how can we help?`

## 3) Simple follow-ups

Keep this in Zapier:

1. Delay 24 hours -> send follow-up
2. Delay 3 days -> send another nudge
3. Stop sequence when customer replies

No backend changes required for this logic.

## 4) Reviews without CRM

Use endpoint:

```bash
POST /api/zapier/review-request
```

Example:

```bash
curl -X POST http://localhost:3001/api/zapier/review-request \
  -H "Content-Type: application/json" \
  -H "x-zapier-events-key: $ZAPIER_EVENTS_API_KEY" \
  -d '{
    "leadId": "lead_123",
    "name": "John Doe",
    "phone": "262-555-1212",
    "email": "john@example.com",
    "service": "Tree Removal",
    "source": "manual_trigger"
  }'
```

Zapier action:

1. Send review link
2. Log review request date and customer
