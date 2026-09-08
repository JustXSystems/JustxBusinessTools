# Quotation email webhook (`EMAIL_WEBHOOK_URL`)

When staff use **Quotation → Send Via → Email**, the API posts a JSON payload to
`EMAIL_WEBHOOK_URL` (or `NOTIFY_EMAIL_WEBHOOK_URL`) if set. Without it, the browser opens
`mailto:` with **plain text only** (HTML is not supported by mailto), downloads the PDF,
and saves a row in **Email Outbox** for retry / Outlook.

Full setup for webhook vs mailto vs Outlook agent: [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md).

---

## Where do these env values come from?

**JustX does not issue `EMAIL_WEBHOOK_URL` or `NOTIFY_EMAIL_WEBHOOK_URL`.**  
They are the **public HTTPS URL of a webhook you create** in an external tool. JustX’s API will `POST` application/json to that URL when someone sends (or retries) an email.

| Variable | Role |
|----------|------|
| `EMAIL_WEBHOOK_URL` | **Preferred.** Inbound webhook URL for quotation / site-survey / Email Outbox delivery. |
| `NOTIFY_EMAIL_WEBHOOK_URL` | **Fallback alias** if `EMAIL_WEBHOOK_URL` is empty. Same purpose (also used by older UPI notify email posts). Set **one** of the two — prefer `EMAIL_WEBHOOK_URL`. |

### How to get a value (step by step)

1. Choose a tool that can **receive HTTP POST** and then **send email** (n8n, Make.com, Zapier, Power Automate, Logic Apps, or your own HTTPS endpoint).
2. Create a workflow whose trigger is **Webhook / Catch Hook / When an HTTP request is received**.
3. Copy the **production webhook URL** the tool displays (must start with `https://`).
4. Paste it into the API host’s **`server/.env`**:

```env
EMAIL_WEBHOOK_URL=https://n8n.example.com/webhook/jbt-email
```

5. Reload the API (`pm2 reload … --update-env` or restart) so the new env is loaded.
6. Map the JSON body fields (especially **`html`** and `pdfBase64`) to your “Send Email” action.
7. Send a test quotation from JustX and confirm the customer inbox.

Provider-specific clicks (n8n / Make / Zapier / Power Automate / webhook.site test): see **Variant A** in [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md).

### What it is *not*

- Not a SendGrid API key, SMTP password, or Gmail app password (those go **inside** your automation, not in `EMAIL_WEBHOOK_URL`).
- Not a URL on the JustX server like `/api/email-outbox` — JustX is the **caller**, your tool is the **receiver**.

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

## Env

```env
EMAIL_WEBHOOK_URL=https://your-automation.example/hooks/jbt-email
# optional alias (only if EMAIL_WEBHOOK_URL is unset):
# NOTIFY_EMAIL_WEBHOOK_URL=
```

Also listed in [SETUP.md](SETUP.md) and [`.env.example`](../.env.example).
