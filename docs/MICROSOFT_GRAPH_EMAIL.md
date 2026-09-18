# Microsoft Graph email — send from anywhere (any device)

**Goal:** Admin / Owner / Staff send **Corporate HTML + PDF** quotations from **any device** (laptop, phone, tablet) — **no** desktop Sync Agent, **no** classic Outlook COM.

**Roles:** Email Outbox — Owner / Staff / Admin — see [`ROLES.md`](ROLES.md).  
**Related:** [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) · [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md) · [`SETUP.md`](SETUP.md)#email-delivery-configuration

---

## Status in JustX (read this first)

| Path | What it is | Works from any device? | In product today? |
|------|------------|------------------------|-------------------|
| **A — Email webhook** | JustX POSTs JSON → your automation sends mail | **Yes** | **Yes** |
| **A + Microsoft 365 (this guide Part 1)** | Same Path A; Power Automate uses **Outlook / Graph** to send as company mailbox | **Yes** | **Yes** (config only — no new JustX code) |
| **B — Mailto** | Opens mail app; plain text only | Partial | Yes |
| **C — Open in Outlook (agent)** | Local Windows agent + classic Outlook | **No** (this PC only) | Yes |
| **D — Native Graph in JustX** | App calls Graph `sendMail` directly (no Power Automate) | **Yes** | **Not shipped yet** — see [Part 2](#part-2--entra-id-app-registration-for-native-path-d-or-custom-graph-caller) |

**Blind-follow recommendation for production customers (Zigma, etc.): use Part 1 now.**  
Part 2 is the Entra checklist when you build native Path D or a custom Graph caller behind the webhook.

---

## What you need before starting (Part 1)

| Need | Who has it | Why |
|------|------------|-----|
| Microsoft 365 / Exchange Online mailbox that will **send** (e.g. `quotations@zigma.example` or Owner’s work mailbox) | Customer IT / M365 admin | Graph/Outlook connector sends *as* this mailbox |
| License that includes Outlook / Exchange Online | Same | Unlicensed mailbox cannot send |
| Access to [Power Automate](https://make.powerautomate.com) with that work account | Owner or M365 admin | Creates the webhook + Send email action |
| JustX **Owner or Admin** on that company’s Business Profile | Customer | Pastes webhook URL on **Business Profile → Send Via → Email** |
| Staff/Owner account on the correct Business Profile | Customer | Tests Send Via → Email |

**You do not need:** Sync Center, desktop agent, classic Outlook, or Staff to open Admin Console.  
**Platform Admin → Integrations → Email webhook** is only an optional **fallback** when a profile has no URL of its own.

---

## Part 1 — Blind follow: Path A via Power Automate + Microsoft 365 Outlook

JustX never talks to Graph in this path. JustX only POSTs to your **HTTP webhook URL**. Power Automate receives the JSON and sends mail with the **Office 365 Outlook** connector (Microsoft Graph under the hood).

### Config values cheat sheet (Part 1)

| Value | Where you get it | Where you paste it |
|-------|------------------|--------------------|
| **HTTP POST URL** (webhook) | Power Automate trigger after first **Save** | JustX **Business Profile → Send Via → Email → Email webhook URL** (this company / GSTIN only) |
| **From / send-as mailbox** | The M365 account that owns the flow, or “Send as” if configured | Power Automate **Send an email (V2)** — usually the connection’s mailbox |
| `to`, `subject`, `html`, `pdfBase64`, `filename` | JustX POST body — see [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md) | Power Automate dynamic content / expressions |

**Why Business Profile (not Admin Integrations)?**  
Each company (e.g. Zigma `29AAAFZ4321M1ZU` vs another GSTIN) has its **own** Power Automate flow and **own** From mailbox. The URL is therefore **per Business Profile**, same idea as Company document delivery → artifact webhook (files). Admin Integrations / `EMAIL_WEBHOOK_URL` remain a **platform fallback** only.

---

### Step 1 — Create the Power Automate flow (customer M365)

1. Open [https://make.powerautomate.com](https://make.powerautomate.com) signed in with the **company** work account that should send mail (or an account allowed to Send As that mailbox).
2. **Create** → **Automated cloud flow** (or **Instant cloud flow**).
3. Name: e.g. `JustX JBT quotation email`.
4. Trigger: search **When an HTTP request is received** → select it → **Create**.
5. Open the trigger. Under **Request Body JSON Schema**, paste:

```json
{
  "type": "object",
  "properties": {
    "channel": { "type": "string" },
    "to": { "type": "string" },
    "cc": { "type": "string" },
    "subject": { "type": "string" },
    "body": { "type": "string" },
    "html": { "type": "string" },
    "replyTo": { "type": "string" },
    "fromName": { "type": "string" },
    "fromEmail": { "type": "string" },
    "from": { "type": "string" },
    "kind": { "type": "string" },
    "outboxId": { "type": "string" },
    "quotationId": { "type": "string" },
    "quoteNo": { "type": "string" },
    "pdfBase64": { "type": "string" },
    "filename": { "type": "string" },
    "templateId": { "type": "string" }
  }
}
```

6. **Save** the flow once (required before the HTTP URL appears).
7. Re-open the trigger → copy **HTTP POST URL**.  
   - Looks like:  
     `https://prod-xx.region.logic.azure.com:443/workflows/…/triggers/manual/paths/invoke?api-version=…&sp=…&sv=…&sig=…`  
   - That **full URL** is your JustX **Email webhook** value.  
   - **Who:** keep this secret (anyone with the URL can POST).

---

### Step 2 — Add “Send an email” (Outlook / Graph)

1. **+ New step** → search **Office 365 Outlook** → **Send an email (V2)**  
   (Alternative advanced: **HTTP with Microsoft Entra ID** → Graph `sendMail` — see [Part 2 § Test sendMail](#part-2-test-token--sendmail-optional); Outlook V2 is enough for most customers.)
2. First time: **Sign in** with the company mailbox that should appear as **From**.
3. Map fields (click dynamic content from the HTTP trigger):

| Send an email (V2) field | Map from JustX JSON | Notes |
|--------------------------|---------------------|--------|
| **To** | `to` | Required |
| **CC** | `cc` | Optional; may need expression if empty |
| **Subject** | `subject` | |
| **Body** | Prefer **`html`** | Switch body to **HTML** (Code view / “Create HTML table” off). If `html` empty, fall back to `body` (plain). |
| **Importance** | Normal | Optional |

4. **Attachment** (PDF):

   - Add **Attachments Name - 1** = `filename` (dynamic), or expression:  
     `coalesce(triggerBody()?['filename'], 'quotation.pdf')`
   - **Attachments Content - 1** = expression that decodes base64:  
     `base64ToBinary(triggerBody()?['pdfBase64'])`  
   - If `pdfBase64` can be empty, wrap with a **Condition**: if `pdfBase64` is not empty → send with attachment; else send without.

5. Optional **Reply To**: if the connector exposes it, map `replyTo`. Otherwise set a fixed company reply address in the connector or leave default.

6. **Save** → turn the flow **On**.

---

### Step 3 — Paste webhook into JustX (Owner / Admin on that company)

**Preferred — per Business Profile (each GSTIN / company):**

1. Sign in at https://justxsystems.com/jbt/ as **Owner or Admin**.
2. Branch switcher → select the correct company (e.g. Zigma / `29AAAFZ4321M1ZU`).
3. Sidebar → **Business Profile** → panel **Send Via → Email**.
4. Find **Company email webhook (Path A — any device)** → **Email webhook URL**.
5. Paste the Power Automate **HTTP POST URL**.
6. Click profile **Save**.

Staff and Viewer cannot edit this field (Staff can still send once it is saved). See [`ROLES.md`](ROLES.md).

**Optional platform fallback** (only if this profile’s field is empty):

1. Platform admin → **Admin → Integrations → Email webhook** → paste URL → Enable → Save, **or**
2. VPS `server/.env`:

```env
EMAIL_WEBHOOK_URL=https://prod-xx....logic.azure.com:443/workflows/.../invoke?...
```

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

**Resolve order:** Profile URL → Admin Integrations → `EMAIL_WEBHOOK_URL` env.  
Full contract: [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md).  
Do **not** confuse with **Company document delivery → Webhook URL** (artifact / PDF files).
---

### Step 4 — Test from any device

1. Sign in as **Owner or Staff** on the customer Business Profile (e.g. Zigma `29AAAFZ4321M1ZU`).
2. Phone or laptop browser — no Sync Center needed.
3. **My Tools → Quotation** → create/save → **Send Via → Email**.
4. Choose **Corporate** template if you need HTML.
5. Send.
6. **Email Outbox**: status should become **`sent`** when the webhook succeeds (may skip Pending).
7. Check the **customer inbox** and the **sender mailbox Sent Items**.

### Part 1 checklist

- [ ] Flow **On**; HTTP POST URL copied after Save  
- [ ] Send an email (V2) uses **`html`** as HTML body (not only `body`)  
- [ ] PDF: `base64ToBinary(pdfBase64)` + `filename`  
- [ ] URL on **Business Profile → Send Via → Email → Email webhook URL** for **this** GSTIN → **Save**  
- [ ] Test send from phone/laptop on that branch → Outbox **`sent`** → mail arrives  

### Part 1 troubleshooting

| Symptom | Fix |
|---------|-----|
| Outbox stays **pending** / **failed** | Flow Off; wrong URL; trigger 401/403; check Power Automate **run history** |
| Mail is plain text | Body mapped to `body` only — map **`html`** and set HTML body |
| No PDF | `pdfBase64` empty on row, or expression wrong; Condition skipping attach |
| Wrong From address | Re-auth Outlook connection with the correct mailbox; or configure Send As in Exchange |
| Works for one GSTIN, not another | Each profile needs **its own** Email webhook URL (and usually its own flow/mailbox). Switch branch and check Profile field |
| Staff still see “Corporate HTML needs Open in Outlook…” | They clicked **Open HTML in Outlook** (Path C). Use Send Via Email / **Send via webhook** when Profile webhook is set |
| Confused with file delivery | Profile **artifact** webhook ≠ **email** webhook — different panels |
---

## Part 2 — Entra ID app registration (for native Path D or custom Graph caller)

Use this when:

- JustX adds **native Microsoft Graph send** (Path D), or  
- Your webhook is a **custom API** that calls Graph `sendMail` with client credentials (instead of Outlook V2 connector).

### Architecture (application permission)

```text
Staff (any device) → JustX API → (future) Graph sendMail
                              ↘ today: webhook → your code → Graph sendMail

Auth: OAuth2 client credentials
  POST https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token
  scope=https://graph.microsoft.com/.default

Send:
  POST https://graph.microsoft.com/v1.0/users/{sender-upn}/sendMail
```

**Permission type:** **Application** `Mail.Send` (not Delegated). No interactive user login at send time.

### Config values cheat sheet (Part 2)

| Value | Example shape | Where you get it | Used for |
|-------|---------------|------------------|----------|
| **Directory (tenant) ID** | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | Entra → App registration → Overview | Token URL `{tenant-id}` |
| **Application (client) ID** | `yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy` | Same Overview | `client_id` |
| **Client secret Value** | Long string (shown **once**) | Certificates & secrets → New client secret | `client_secret` |
| **Sender mailbox UPN** | `quotations@contoso.com` | Exchange / M365 admin center | Graph path `/users/{upn}/sendMail` |
| **Token URL** | `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token` | Fixed pattern | Client credentials |
| **Scope** | `https://graph.microsoft.com/.default` | Fixed | Must end with `/.default` for app-only |
| **Graph sendMail URL** | `https://graph.microsoft.com/v1.0/users/{upn}/sendMail` | Fixed pattern | Send |

**Do not** put the client secret in JustX Email webhook URL. Secret belongs in your secure store / future Admin Integrations fields / `server/.env` (never commit).

---

### Part 2 Step A — Register the app (Entra ID)

1. Open [Microsoft Entra admin center](https://entra.microsoft.com) as **Global Administrator** or **Application Administrator**.
2. **Identity** → **Applications** → **App registrations** → **New registration**.
3. Fill exactly:

| Field | Value to enter |
|-------|----------------|
| **Name** | e.g. `JustX JBT Graph Mail` |
| **Supported account types** | **Accounts in this organizational directory only** (single tenant) — usual for one customer; or multitenant if JustX hosts one app for many customers |
| **Redirect URI** | **Leave empty** for client-credentials / app-only send |

4. Click **Register**.
5. On **Overview**, copy and store:

| Copy this label | Store as |
|-----------------|----------|
| **Application (client) ID** | `AZURE_CLIENT_ID` / Graph Client ID |
| **Directory (tenant) ID** | `AZURE_TENANT_ID` / Graph Tenant ID |

---

### Part 2 Step B — Create a client secret

1. App → **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Description: e.g. `jbt-mail-prod`.
3. Expires: choose policy (e.g. 12–24 months) — set a calendar reminder to rotate.
4. **Add**.
5. Copy **Value** immediately (not Secret ID). This is `AZURE_CLIENT_SECRET`.  
   If you leave the page, the Value is gone — create a new secret.

---

### Part 2 Step C — API permission Mail.Send (Application)

1. App → **API permissions** → **Add a permission**.
2. **Microsoft Graph**.
3. **Application permissions** (not Delegated).
4. Search **`Mail.Send`** → check **Mail.Send**.
5. **Add permissions**.
6. Click **Grant admin consent for \<Your Tenant\>** → **Yes**.
7. Status must show **Granted for \<tenant\>** with a green check.

| Wrong | Right |
|-------|-------|
| Delegated `Mail.Send` only | **Application** `Mail.Send` + admin consent |
| Consent not granted | Token works; `sendMail` returns **403** |

---

### Part 2 Step D — Choose sender mailbox

1. M365 admin center → **Users** → Active users → open the mailbox (e.g. `quotations@contoso.com`).
2. Copy **User principal name (UPN)** — this is `{sender-upn}` in Graph URLs.
3. Confirm mailbox has an Exchange Online license.
4. Optional: create a shared mailbox and grant Send As; for app-only Graph, you typically call `/users/{shared-mailbox-upn}/sendMail` with Application `Mail.Send` (and restrict with Application Access Policy — next section).

---

### Part 2 Step E — Restrict app to one mailbox (strongly recommended)

Application `Mail.Send` can send as **any** mailbox in the tenant unless restricted.

1. Create a **mail-enabled security group** containing only the allowed sender mailbox(es).
2. In **Exchange Online PowerShell**:

```powershell
Connect-ExchangeOnline

New-ApplicationAccessPolicy `
  -AppId "<Application-client-ID>" `
  -PolicyScopeGroupId "jbt-mail-senders@contoso.com" `
  -AccessRight RestrictAccess `
  -Description "JustX JBT Graph Mail — send only as group members"

Test-ApplicationAccessPolicy `
  -Identity "quotations@contoso.com" `
  -AppId "<Application-client-ID>"
```

Expect the test to allow the intended mailbox and deny others. Propagation can take **~30–60+ minutes**.

Docs: [Application Access Policy](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access).

---

### Part 2 Step F — Test token + sendMail (optional)

**Get token** (PowerShell example):

```powershell
$tenantId = "<Directory-tenant-ID>"
$clientId = "<Application-client-ID>"
$clientSecret = "<Client-secret-Value>"
$uri = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"
$body = @{
  client_id     = $clientId
  client_secret = $clientSecret
  scope         = "https://graph.microsoft.com/.default"
  grant_type    = "client_credentials"
}
$token = (Invoke-RestMethod -Method POST -Uri $uri -Body $body).access_token
```

**Send test mail:**

```powershell
$sender = "quotations@contoso.com"
$payload = @{
  message = @{
    subject = "JustX Graph test"
    body = @{ contentType = "HTML"; content = "<p>Hello from Graph</p>" }
    toRecipients = @(@{ emailAddress = @{ address = "you@example.com" } })
  }
  saveToSentItems = $true
} | ConvertTo-Json -Depth 6

Invoke-RestMethod `
  -Method POST `
  -Uri "https://graph.microsoft.com/v1.0/users/$sender/sendMail" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body $payload
```

Success: HTTP **202 Accepted** (often empty body).

**With PDF attachment** (Graph JSON): add `attachments` array with `@odata.type` `#microsoft.graph.fileAttachment`, `name`, `contentBytes` (raw base64 from JustX `pdfBase64`).

Official API: [user: sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail).

---

### Part 2 Step G — Where these values go in JustX (when Path D ships)

Until native Path D exists, store secrets only in your automation host / Key Vault.

**Planned product mapping for native Graph credentials (Path D):**

| Entra value | JustX home |
|-------------|-------------------|
| Tenant ID + Client ID + Secret | Prefer per-profile or platform Integrations (TBD when Path D ships) |
| Sender UPN | Per **Business Profile** (each GSTIN / company mailbox) |
| Enable Graph send | Profile toggle; Email Outbox “Send” uses Graph before mailto/agent |

**Email webhook URL (Path A today)** is already on **Business Profile → Send Via → Email**.  
Do **not** store Graph client secrets in the webhook URL field.

---

### Part 2 checklist

- [ ] App registration created; Tenant ID + Client ID copied  
- [ ] Client secret Value saved once  
- [ ] Application permission **Mail.Send** + **admin consent Granted**  
- [ ] Sender UPN licensed  
- [ ] Application Access Policy restricts to that mailbox (recommended)  
- [ ] Token with scope `https://graph.microsoft.com/.default`  
- [ ] `POST .../users/{upn}/sendMail` returns **202**  
- [ ] (Today) Wire send into Power Automate HTTP / custom webhook, **or** wait for native Path D  

---

## Path comparison (ops)

| Requirement | Part 1 Power Automate | Native Path D (future) | Path C agent |
|-------------|----------------------|-------------------------|--------------|
| Any device | Yes | Yes | No |
| Corporate HTML + PDF | Yes | Yes | Yes (Windows only) |
| Customer Azure skills | Low–medium (flow) | Higher (Entra + secret ops) | Low (Sync Center zip) |
| JustX code change | None | Required | None |
| Per-PC install | No | No | Yes |

---

## Related docs

- [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) — Paths A/B/C UI and Outbox actions  
- [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md) — JSON fields JustX POSTs  
- [`SETUP.md`](SETUP.md)#email-delivery-configuration — short path table  
- [`ROLES.md`](ROLES.md) — who can open Email Outbox / Admin Integrations  
- [`SYNC_CENTER.md`](SYNC_CENTER.md) — Path C agent only (not required for Graph/Path A)  
