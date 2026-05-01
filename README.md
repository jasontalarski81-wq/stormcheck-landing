# Stormcheck — Trustman Roofing Lead Capture

TCPA-compliant landing page + SMS lead capture for Trustman Roofing.

Live at: https://stormchecktrustmanroofing.com

## What it does

1. Homeowner lands on `stormchecktrustmanroofing.com`
2. Submits form with explicit SMS opt-in checkbox
3. Server logs lead with full consent record (IP, UA, timestamp)
4. AI-generated welcome SMS to homeowner
5. Alert SMS to Jason with lead details

## Stack

- Node.js + Express
- Static HTML/CSS landing
- Twilio for SMS
- File-based JSONL log (TODO: postgres)

## Deploy

Deployed on Railway (`stormcheck` service in Trustman CRM project).

Required env vars:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM` (e.g. `+13143140245`)
- `JASON_PHONE` (e.g. `+16365417005`)
- `OPENAI_API_KEY` (optional, for AI replies later)
- `ADMIN_TOKEN` (for `/admin` endpoint protection)

## Routes

- `GET /` — landing page
- `GET /privacy.html` — TCPA-compliant privacy policy
- `GET /terms.html` — terms of service
- `POST /api/lead` — form submission
- `GET /admin?token=XXX` — lead viewer
- `GET /health` — uptime check
