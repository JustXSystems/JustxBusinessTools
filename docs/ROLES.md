# Role hierarchy & access (JBT)

Canonical rules for **platform super users**, **Org Admin**, **Owner**, **Staff**, and **Viewer**. Other docs defer to this page for “who can open what.”

**Enforcement:** `web/lib/auth-access.ts` (nav + route guards) · `server/src/middleware/require-auth.ts` (`requireAdminRole`) · `server/src/middleware/require-area-access.ts` · `server/src/lib/roles/matrix.ts` (coarse capabilities)

---

## Summary

| Role | Shell | Default landing after login | Business Profile scope |
|------|-------|-----------------------------|------------------------|
| **Platform super user** (`is_platform_admin` / `PLATFORM_ADMIN_EMAIL`) | **JBT Admin Console** (`/admin`) + full Operator access | **Admin Console** (`/admin`) | All orgs / profiles (explicit pick in console; not operator selection) |
| **Org Admin** | Operator View only | Home (`/`) | Profiles they belong to (implicit all in org for reach) |
| **Owner** | Operator View only | Home (`/`) | Only Business Profiles they belong to |
| **Staff** | Operator View only | Home (`/`) | Only Business Profiles they belong to |
| **Viewer** | Operator View only | Home (`/`) | Only Business Profiles they belong to |

**Hard rules**

- Only **Justxsystems platform super users** may open **Admin Console** (`/admin`). Org Admin / Owner / Staff / Viewer are redirected away.
- **Tool licenses / Access Fabric** are platform-console only. Org roles never assign commercial licenses.
- Org **Owner** and org **Admin** manage company settings and team from **Business Profile** (operator app).
- After login, platform super users land on **Admin Console**; everyone else lands on Operator Home.

---

## Operator sidebar menus

| Menu | Platform | Org Admin | Owner | Staff | Viewer |
|------|----------|-----------|-------|-------|--------|
| **Home** | R/W | R/W | R/W | Read | Read |
| **Business Profile** | R/W | R/W | R/W | Read | — |
| **Business Profile → Team** | R/W | R/W | R/W | — | — |
| **Sync Center** | R/W | R/W | R/W | — | — |
| **Email Outbox** | R/W | R/W | R/W | R/W | — |
| **Notifications** | R/W | R/W | R/W | Read | — |
| **My Tools** | R/W | R/W | R/W | R/W | R/W |
| **Admin Console** link | Yes | — | — | — | — |

Legend: **R/W** = read + write / actions · **Read** = view · **—** = menu hidden; deep links redirect away.

---

## Role details

### Platform super user (JBT Admin)

- Opens **Admin Console** (`/admin`): Access Fabric, catalog, users, billing, integrations, etc.
- Admin Console is **global** — it does **not** follow the operator app’s selected Business Profile. Themes, gateways, payment desk, subscriptions, catalog placement, and Access Fabric all require an explicit org/profile pick in the console when scoped.
- **Access Fabric:** pick a Business Profile, readiness score, provision packs, lattice licenses, home surface, people reach.
- **Operator entry is gated:** from Admin Console use **Enter as…** (`/enter`, or **Enter as…** on a profile) to pick a Business Profile **and** a required org role (Owner / Org Admin / Staff / Viewer). Without that act-as context, Operator routes (including standalone **`/bos`** and **`/ims`**) redirect to `/enter` and Operator APIs return `403 NEED_ACT_AS`. This enacts menus and capability gates for troubleshooting — it is **not** password/MFA user impersonation.
- `/enter` lists approved non-archived profiles by default; pending/archived are view-only (server rejects act-as). Deep links with a missing `?profile=` show a warning.
- Opening **Admin Console** clears any active act-as. Admin org actions require an explicit organization (never the Operator session org).
- While acting as a role, Operator / BOS / IMS chrome shows an **Impersonating** banner (**Change** → `/enter`, **Exit to Admin** → clear act-as and return to `/admin`).
- Guest marketing preview while signed in: `/?preview=public` (Admin → Experience → Open public home).
- Login → **`/admin`**. Live org users never see `/enter` or act-as controls.

### Org Admin

- Operator View only — **no** Admin Console.
- Same Business Profile write access as Owner (company, brand, send, delivery, home tools).
- **Business Profile → Team:** invite / approve Staff & Viewer, roles, suspend, profile reach.
- Cannot assign commercial tool licenses (platform Access Fabric only).
- Login → **Home**.

### Owner

- Operator View only — **no** Admin Console.
- Read/write: Home, Business Profile, Sync Center, Email Outbox, Notifications, My Tools.
- **Business Profile → Team:** invite Staff/Viewer, approve join requests, change roles, suspend/reactivate, grant/revoke access to the active Business Profile.
- Configures **Company document delivery** and installs the **desktop sync agent** via Sync Center.
- Scoped to Business Profiles they belong to. Tool commercial licenses are assigned by platform super users under Admin → Access Fabric.

### Staff

- Operator View only — **no** Admin Console, **no** Sync Center.
- **Home** (read), **Business Profile** (read), **Email Outbox** (read/write/action), **Notifications** (read), **My Tools** (read/write/action).
- Generate quotations / surveys; send email via Outbox; do **not** configure Drive/UNC or download Sync Center setup.
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
| Email Outbox | [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) |
