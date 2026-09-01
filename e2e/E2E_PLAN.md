# E2E Test Plan — JustXSystems

Manual and automated scenarios for Playwright (`e2e/smoke.spec.ts`).

## Prerequisites

- MySQL running with `npm run db:setup`
- `npm run dev` (API on 4000, web on 3000)

## Smoke (automated)

Runs on **port 3100** (web) so it does not collide with `npm run dev` on 3000.

First-time setup: `npx playwright install chromium`

| ID | Scenario | Expected |
|----|----------|----------|
| S1 | Open home | Brand and tool grid visible |
| S2 | Open profile | Business profile form loads |
| S3 | Open settings | Settings sections visible |
| S4 | Open notifications | Feed or empty state loads |
| S5 | Login defaults | Username + password; no Phone OTP unless enabled |
| S6 | Public status | `/status` shows system status |
| S7 | Public quote token | Unknown `/q/:token` does not 500 (`public-quote.spec.ts`) |
| S8 | Drive panel | Profile delivery section visible when E2E creds set (`drive.spec.ts`) |

## Subscription & limits

| ID | Scenario | Expected |
|----|----------|----------|
| L1 | Free user at 28 records | `FREE_LIMIT_REACHED`, upgrade modal |
| L2 | Checkout with `PAYMENT_AUTO_COMPLETE=true` | Pro activated, unlimited counter |
| L3 | Delete record on free plan | Quota decreases, can create again |

## Documents

| ID | Scenario | Expected |
|----|----------|----------|
| D1 | New invoice | Doc number from sequence API |
| D2 | Save invoice | Appears in list; payment tracker sync for invoice |
| D3 | Print preview | Print styles hide chrome |

## Calculators & QR

| ID | Scenario | Expected |
|----|----------|----------|
| C1 | GST add mode 18% on 1000 | Base 1000, GST 180, total 1180 |
| Q1 | QR generate | Canvas renders code |
| Q2 | QR scan (browser) | Camera or file upload decodes |

## PWA / mobile

| ID | Scenario | Expected |
|----|----------|----------|
| P1 | Service worker registers | `sw.js` active in devtools |
| P2 | Offline navigate | Offline fallback page |
| P3 | Capacitor Android | Back button navigates history; safe-area padding |
| P4 | Native QR camera | Camera permission granted on Android |

## Future (Phase 7+)

- Export CSV/Excel from trackers and documents
- Notifications derived endpoint
- i18n locale switch
