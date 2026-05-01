/**
 * Stormcheck — Trustman Roofing TCPA-compliant lead capture
 *
 * Routes:
 *   GET  /              → landing page
 *   GET  /privacy.html  → privacy policy
 *   GET  /terms.html    → terms of service
 *   POST /api/lead      → form submission, sends AI-generated SMS
 *   GET  /admin         → simple lead viewer (basic auth)
 *
 * Env required:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 *   OPENAI_API_KEY
 *   JASON_PHONE
 *   ADMIN_TOKEN (optional, for /admin)
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const twilio = require('twilio');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname, { extensions: ['html'] }));

// ---- Persistence (simple JSON log; swap for postgres later) ----
const LEAD_LOG = path.join(__dirname, 'leads.log.jsonl');
function appendLead(record) {
  try {
    fs.appendFileSync(LEAD_LOG, JSON.stringify(record) + '\n');
  } catch (e) {
    console.error('appendLead error:', e.message);
  }
}

// ---- Twilio ----
const tw = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

function normalizePhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function sendSMS(to, body) {
  if (!tw || !process.env.TWILIO_FROM) {
    console.log(`[DRY] → ${to}: ${body}`);
    return { sid: 'DRY' };
  }
  return tw.messages.create({ from: process.env.TWILIO_FROM, to, body });
}

// ---- Welcome SMS templates ----
const WELCOME_VARIATIONS = [
  (n) => `Hey ${n} — got your storm check request. We'll reach out shortly to set a time. Reply STOP to opt out. — Trustman Roofing Team`,
  (n) => `Thanks ${n}! We received your free roof check request. A team member will text you to schedule. Reply STOP to opt out. — Trustman Roofing`,
  (n) => `Hi ${n}, this is Trustman Roofing — got your free roof check request. We'll text shortly with available times. STOP to opt out.`,
];

function welcomeSMS(firstName) {
  const fn = firstName || 'there';
  const pick = WELCOME_VARIATIONS[Math.floor(Math.random() * WELCOME_VARIATIONS.length)];
  return pick(fn);
}

// ---- Routes ----
app.post('/api/lead', async (req, res) => {
  const {
    first_name, last_name, phone, address, email, notes,
    sms_consent, consent_timestamp, page_url, user_agent, source,
  } = req.body || {};

  if (!sms_consent) {
    return res.status(400).json({ error: 'SMS consent required' });
  }
  if (!first_name || !phone || !address) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const ua = user_agent || req.headers['user-agent'] || '';

  const lead = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    received_at: new Date().toISOString(),
    first_name, last_name,
    phone: normalizedPhone, raw_phone: phone,
    address, email, notes,
    source: source || 'stormcheck-direct',
    consent: {
      sms: !!sms_consent,
      timestamp: consent_timestamp || new Date().toISOString(),
      ip,
      user_agent: ua,
      page_url: page_url || '',
      consent_text: 'I agree to receive text messages from Trustman Roofing about my roof inspection. Message and data rates may apply. Reply STOP to opt out.',
    },
  };

  appendLead(lead);
  console.log(`📥 New lead: ${lead.first_name} ${lead.last_name} | ${lead.phone} | ${lead.address}`);

  // Fire-and-forget welcome SMS to homeowner + alert to Jason
  Promise.allSettled([
    sendSMS(normalizedPhone, welcomeSMS(first_name))
      .then(r => console.log(`  ✓ welcome SMS sent: ${r.sid}`))
      .catch(e => console.error(`  ✗ welcome SMS failed: ${e.message}`)),
    process.env.JASON_PHONE
      ? sendSMS(process.env.JASON_PHONE,
          `🚨 NEW LEAD: ${first_name} ${last_name || ''}\n📞 ${normalizedPhone}\n🏠 ${address}${email ? '\n✉️ ' + email : ''}${notes ? '\n📝 ' + notes : ''}`)
        .catch(e => console.error(`  ✗ jason alert failed: ${e.message}`))
      : Promise.resolve(),
  ]);

  return res.json({ ok: true, lead_id: lead.id });
});

// Simple admin viewer (token-protected)
app.get('/admin', (req, res) => {
  const token = req.query.token || req.headers['x-admin-token'];
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send('Unauthorized — append ?token=YOUR_TOKEN');
  }
  let leads = [];
  try {
    if (fs.existsSync(LEAD_LOG)) {
      leads = fs.readFileSync(LEAD_LOG, 'utf8').trim().split('\n')
        .filter(Boolean).map(l => JSON.parse(l));
    }
  } catch (e) { /* ignore */ }

  const rows = leads.slice().reverse().map(l => `
    <tr>
      <td>${(l.received_at || '').slice(0, 16).replace('T', ' ')}</td>
      <td>${l.first_name || ''} ${l.last_name || ''}</td>
      <td><a href="tel:${l.phone}">${l.phone}</a></td>
      <td>${l.address || ''}</td>
      <td>${l.email || ''}</td>
      <td>${(l.notes || '').slice(0, 80)}</td>
    </tr>`).join('');

  res.send(`<!doctype html><html><head><title>Stormcheck Leads</title>
<style>body{font-family:system-ui;background:#0f0f10;color:#eee;padding:30px;max-width:1200px;margin:auto}
h1{color:#ff6b1a}
table{width:100%;border-collapse:collapse;margin-top:20px;font-size:14px}
td,th{text-align:left;padding:10px;border-bottom:1px solid #333}
th{color:#888;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.5px}
a{color:#ff6b1a}
.count{color:#22c55e;font-weight:700}
</style></head><body>
<h1>🛡️ Stormcheck Leads <span class="count">(${leads.length})</span></h1>
<table>
<tr><th>Received</th><th>Name</th><th>Phone</th><th>Address</th><th>Email</th><th>Notes</th></tr>
${rows}
</table>
</body></html>`);
});

app.get('/health', (req, res) => res.json({ ok: true, leads_logged: fs.existsSync(LEAD_LOG) }));

app.listen(PORT, () => {
  console.log(`🚀 Stormcheck running on :${PORT}`);
});
