# Big D's Tree Service - Deployment Checklist

## Pre-Deployment Checks

### Secrets & Environment Variables

- [ ] `.env` file is NOT committed to git (check `.gitignore`)
- [ ] `OPENAI_API_KEY` is set and NOT exposed to frontend
- [ ] `ADMIN_TOKEN_SECRET` is set to a strong random value (not `dev-secret-change-in-production`)
- [ ] `ZAPIER_LEAD_WEBHOOK_URL` is set (recommended for lead intake automation)
- [ ] `OWNER_EMAIL` is set to correct email address
- [ ] `APP_URL` is set to production URL (e.g., `https://bigdtrees.com`)

### CORS Configuration

- [ ] Update CORS headers in all route files to restrict to frontend domain:
  ```typescript
  'Access-Control-Allow-Origin': 'https://bigdtrees.com'
  ```
- [ ] Remove `*` wildcard from production CORS headers

### Storage Migration

- [ ] Switch from local disk (`./uploads`) to object storage (S3, Cloudflare R2, etc.)
- [ ] Update `UPLOAD_DIR` to point to production storage
- [ ] Ensure photo URLs are publicly accessible

### Database Persistence

- [ ] Leads currently stored in-memory (lost on restart!)
- [ ] Migrate to persistent database:
  - Option A: SQLite (simple, single-file)
  - Option B: PostgreSQL (recommended for production)
- [ ] Update `session.ts` to use database instead of `Map`

### Security Hardening

- [ ] HTTPS enforced (redirect HTTP → HTTPS)
- [ ] Rate limiting enabled and tested
- [ ] Signed admin tokens required (not just development bypass)
- [ ] Twilio signature validation enabled (`TWILIO_AUTH_TOKEN` set)

---

## Environment Variables Reference

```bash
# Required
OPENAI_API_KEY=sk-...                    # OpenAI API key (GPT-5)
ADMIN_TOKEN_SECRET=random-32-char-key    # JWT signing secret

# Twilio (optional - mock mode if not set)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1234567890

# Zapier-first lead flow
ZAPIER_LEAD_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...
ENABLE_ZAPIER_LEAD_FLOW=true
ENABLE_NATIVE_NOTIFICATIONS=false   # prevent duplicate SMS/email when Zapier sends them
ENABLE_HUBSPOT_SYNC=false           # CRM sync optional, disabled by default
ZAPIER_TIMEOUT_MS=10000

# Optional Zapier event endpoints
ZAPIER_MISSED_CALL_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...
ZAPIER_REVIEW_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...
ZAPIER_EVENTS_API_KEY=change-me      # required in x-zapier-events-key for /api/zapier/*

# Business Config
OWNER_EMAIL=
# Optional: multiple recipients (comma/semicolon separated)
# OWNER_EMAILS=owner1@example.com,owner2@example.com
OWNER_PHONE=
CALENDLY_LINK=
APP_URL=https://bigdtrees.com

# Email (Gmail - Optional)
# 1. Enable 2FA on Google Account
# 2. Go to Security > App Passwords > Generate for "Mail"
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

# Storage
UPLOAD_DIR=/var/uploads  # or S3 bucket path

# Optional
DEBUG=false              # Enable verbose logging
NODE_ENV=production
```

---

## Build & Deploy Commands

```bash
# Install dependencies
npm install

# Build production bundle
npm run build

# Start production server
npm run start
# Or with PM2:
pm2 start npm --name "bigd-backend" -- start

# Health check
curl https://your-domain.com/api/health
```

---

## Post-Deployment Verification

### API Health Checks

- [ ] `GET /api/lead/test` returns 404 (no session exists)
- [ ] `POST /api/chat` with test message returns lead_id
- [ ] Admin page with valid token loads correctly
- [ ] Admin page without token returns 403

### SMS Webhook

- [ ] Configure Twilio webhook URL: `https://your-domain.com/api/sms-webhook`
- [ ] Test with "YES" response → booking link sent
- [ ] Test with "STOP" → confirmed unsubscribe

### Zapier Lead Flow

- [ ] Configure `ZAPIER_LEAD_WEBHOOK_URL`
- [ ] Finalize a test lead and confirm the webhook receives:
  - `name`, `phone`, `service`, `address`, `notes`
  - `ownerSmsMessage`, `customerAutoReplyText`, `customerAutoReplyEmailSubject`, `customerAutoReplyEmailBody`
- [ ] In Zapier, map payload fields to:
  - Google Sheets row
  - owner SMS
  - customer auto-reply text/email

### Optional Zapier Event Endpoints

- [ ] `POST /api/zapier/missed-call` forwards missed call events to Zapier
- [ ] `POST /api/zapier/review-request` forwards manual review-request events to Zapier
- [ ] If `ZAPIER_EVENTS_API_KEY` is set, include header: `x-zapier-events-key`

### Email Notifications

- [ ] Test finalize flow → email sent to owner
- [ ] Verify signed admin links in email work

---

## Monitoring

### Logs to Watch

- `action: 'validation_failed'` - LLM returning bad data
- `action: 'llm_retry_budget_exceeded'` - Cost control triggered
- `action: 'rate_limited'` - Potential abuse
- `action: 'token_invalid'` - Unauthorized access attempts
- `action: 'email_failed'` - Notification failures
- `action: 'sms_failed'` - Customer communication failures

### Alerts to Set Up

- [ ] Error rate > 5% in 5 minutes
- [ ] Email send failures
- [ ] SMS send failures
- [ ] LLM API errors

---

## Rollback Plan

1. Keep previous production build/image available
2. Database migration should be reversible
3. Feature flags for new functionality
4. Test rollback procedure before going live

---

## Security Contacts

- Twilio: docs.twilio.com/console
- OpenAI: platform.openai.com
- Domain/SSL: (your provider)

---

_Last updated: January 2026_
