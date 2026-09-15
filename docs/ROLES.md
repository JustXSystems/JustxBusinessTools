# Role hierarchy & access (JBT)

Canonical rules for **Admin**, **Owner**, **Staff**, and **Viewer**. Other docs defer to this page for “who can open what.”

**Enforcement:** `web/lib/auth-access.ts` (nav + route guards) · `server/src/middleware/require-area-access.ts` (API) · `server/src/lib/roles/matrix.ts` (coarse capabilities)

---

## Summary

| Role | Shell | Default landing after login | Business Profile scope |
|------|-------|-----------------------------|------------------------|
| **Admin** | **Admin Console** (`/admin`) + full Operator access | **Admin Console** (`/admin`) | Full access (org Admin: all profiles in org; platform admin: all orgs) |
| **Owner** | Operator View only | Home (`/`) | Only Business Profiles they belong to |
| **Staff** | Operator View only | Home (`/`) | Only Business Profiles they belong to |
| **Viewer** | Operator View only | Home (`/`) | Only Business Profiles they belong to |

**Hard rules**

- Only **Admin** (org role `admin`) and **platform admins** may open **Admin Console**. Owner / Staff / Viewer are redirected away from `/admin`.
- After login, **Admin** and platform admins land on **Admin Console**, not Operator Home.
- Owner / Staff / Viewer never see Admin Console in the sidebar.

---

## Operator sidebar menus

| Menu | Admin | Owner | Staff | Viewer |
|------|-------|-------|-------|--------|
| **Home** | R/W | R/W | Read | Read |
| **Business Profile** | R/W | R/W | Read | — |
| **Sync Center** | R/W | R/W | — | — |
| **Email Outbox** | R/W | R/W | R/W | — |
| **Notifications** | R/W | R/W | Read | — |
| **My Tools** | R/W | R/W | R/W | R/W |
| **Admin Console** link | Yes | — | — | — |

Legend: **R/W** = read + write / actions · **Read** = view (and safe inbox actions such as mark-read) · **—** = menu hidden; deep links redirect away.

---

## Role details

### Admin

- Super-user for the org (and platform admins across the product).
- **Admin Console** only for this role (plus platform admin emails / `is_platform_admin`).
- Full Operator access when they open the operator app (all menus above).
- Login → **`/admin`**.

### Owner

- Operator View only — **no** Admin Console.
- Read/write: Home, Business Profile, Sync Center, Email Outbox, Notifications, My Tools.
- Configures **Company document delivery** and installs the **desktop sync agent** via Sync Center (for UNC and/or Email Outbox → Open in Outlook).
- Scoped to Business Profiles they belong to.

### Staff

- Operator View only — **no** Admin Console, **no** Sync Center.
- **Home** (read), **Business Profile** (read), **Email Outbox** (read/write/action), **Notifications** (read), **My Tools** (read/write/action).
- Generate quotations / surveys; send email via Outbox; do **not** configure Drive/UNC or download Sync Center setup.
- For Outlook Path C or UNC file sync on a PC: **Owner** (or Admin) must open Sync Center on that PC and install the agent once.
- Scoped to Business Profiles they belong to.

### Viewer

- Operator View only — **no** Admin Console.
- **Home** (read) and **My Tools** (read/write/action) only.
- No Business Profile, Sync Center, Email Outbox, or Notifications menus.
- Scoped to Business Profiles they belong to.

---

## Related product docs

| Topic | Doc |
|-------|-----|
| Sync Center (Owner/Admin) | [`SYNC_CENTER.md`](SYNC_CENTER.md) |
| Email Outbox (Owner/Staff) | [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) |
| Company delivery fields | [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md) |
| Product setup | [`SETUP.md`](SETUP.md) |
| Support / on-call matrix | [`PRODUCTION_SUPPORT.md`](PRODUCTION_SUPPORT.md) |
