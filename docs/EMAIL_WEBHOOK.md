# Quotation email webhook (`EMAIL_WEBHOOK_URL` / Profile)

When staff use **Quotation → Send Via → Email**, the API posts a JSON payload to the resolved email webhook:

1. **Business Profile → Send Via → Email → Email webhook URL** (per company / GSTIN) — **preferred**
2. Else **Admin → Integrations → Email webhook**
3. Else `EMAIL_WEBHOOK_URL` / `NOTIFY_EMAIL_WEBHOOK_URL`

Without any of these, JustX saves a row in **Email Outbox** and prefers **Open in Outlook** (desktop agent, agent ≥ 1.1.3 for Corporate HTML + PDF) when available; otherwise **`mailto:`** with **plain text only** (HTML is not supported by mailto) and a PDF download for manual attach.

Full setup for webhook vs mailto vs Outlook agent: [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md).  
**Any-device send with Microsoft 365 / Graph (Power Automate) — paste on Business Profile:** [`MICROSOFT_GRAPH_EMAIL.md`](MICROSOFT_GRAPH_EMAIL.md).

---

## Where do these values come from?

**JustX does not issue the webhook URL.**  
It is the **public HTTPS URL of a webhook you create** in an external tool (usually one flow **per company mailbox**). JustX’s API will `POST` application/json to that URL when someone sends (or retries) an email.

| Location | Role |
|----------|------|
| **Business Profile `emailWebhookUrl`** | **Preferred.** Per GSTIN / company Power Automate URL |
| Admin Integrations `email_webhook` | Platform-wide fallback |
| `EMAIL_WEBHOOK_URL` | Env fallback |
| `NOTIFY_EMAIL_WEBHOOK_URL` | Last-resort env alias |

### How to get a value (step by step)

1. Choose a tool that can **receive HTTP POST** and then **send email** (n8n, Make.com, Zapier, Power Automate, Logic Apps, or your own HTTPS endpoint).
2. Create a workflow whose trigger is **Webhook / Catch Hook / When an HTTP request is received**.
3. Copy the **production webhook URL** the tool displays (must start with `https://`).
4. Paste it into **Business Profile → Send Via → Email → Email webhook URL** for that company (Owner/Admin) → **Save**.

Optional fallback — **Admin → Integrations → Email webhook**, or API host **`server/.env`**:

```env
EMAIL_WEBHOOK_URL=https://n8n.example.com/webhook/jbt-email
```

5. If using `.env`, reload the API (`pm2 reload … --update-env` or restart) so the new env is loaded.
6. Map the JSON body fields (especially **`html`** and `pdfBase64`) to your “Send Email” action.
7. Send a test quotation from JustX on that Business Profile and confirm the customer inbox.

Provider-specific clicks:

- **Power Automate + Office 365 Outlook / Graph (recommended for any device):** [`MICROSOFT_GRAPH_EMAIL.md`](MICROSOFT_GRAPH_EMAIL.md)#part-1--blind-follow-path-a-via-power-automate--microsoft-365-outlook  
- n8n / Make / Zapier / webhook.site: see **Variant A** in [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md).

### What it is *not*

- Not a SendGrid API key, SMTP password, or Gmail app password (those go **inside** your automation, not in the webhook URL field).
- Not a URL on the JustX server like `/api/email-outbox` — JustX is the **caller**, your tool is the **receiver**.
- Not the Business Profile **artifact** webhook (Company document delivery / PDF files to SharePoint).
---

## Required mapping for corporate HTML

Your automation (SendGrid / n8n / Power Automate / custom SMTP) **must** use the `html`
field as the HTML body. If you only map `body`, recipients see plain text and lose branding.

| Field | Use |
|-------|-----|
| `to` | Recipient |
| `cc` | Optional CC (comma-separated) |
| `subject` | Subject line |
| `body` | Plain-text alternative / multipart text part |
| **`html`** | **Corporate HTML body** (when template is Corporate) |
| `replyTo` | Reply-To (branch sales/email or profile override) |
| `from` / `fromName` / `fromEmail` | Display From when your provider allows |
| `pdfBase64` / `filename` | Quotation PDF attachment |
| `templateId` | `corporate` or `plain` |
| `quoteNo` / `quotationId` / `outboxId` | Audit / logging |

## Example SendGrid Personalization (conceptual)

Your webhook handler builds something like:

```json
{
  "personalizations": [{ "to": [{ "email": "{{to}}" }] }],
  "from": { "email": "{{fromEmail}}", "name": "{{fromName}}" },
  "reply_to": { "email": "{{replyTo}}" },
  "subject": "{{subject}}",
  "content": [
    { "type": "text/plain", "value": "{{body}}" },
    { "type": "text/html", "value": "{{html}}" }
  ]
}
```

Attach `pdfBase64` as a standard base64 attachment named `filename`.

## Logo URLs

Corporate emails only embed **absolute `http(s)`** logo URLs. Uploaded logos served under
`/api/files/...` are rewritten with the current app origin. Data-URL logos are omitted
(many clients block them); the company name is shown instead.

## Env (platform fallback only)

```env
EMAIL_WEBHOOK_URL=https://your-automation.example/hooks/jbt-email
# optional alias (only if EMAIL_WEBHOOK_URL is unset):
# NOTIFY_EMAIL_WEBHOOK_URL=
```

Prefer **Business Profile → Email webhook URL** per company. Env / Admin Integrations apply only when the profile field is empty.

Also listed in [SETUP.md](SETUP.md) and [`.env.example`](../.env.example).
