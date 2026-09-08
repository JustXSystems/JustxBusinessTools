# Quotation email webhook (`EMAIL_WEBHOOK_URL`)

When staff use **Quotation → Send Via → Email**, the API posts a JSON payload to
`EMAIL_WEBHOOK_URL` (or `NOTIFY_EMAIL_WEBHOOK_URL`) if set. Without it, the browser opens
`mailto:` with **plain text only** (HTML is not supported by mailto).

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
| `quoteNo` / `quotationId` | Audit / logging |

## Example SendGrid Personalization (conceptual)

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
# optional alias:
# NOTIFY_EMAIL_WEBHOOK_URL=
```

Also listed in [SETUP.md](SETUP.md)#optional and [`.env.example`](../.env.example).
