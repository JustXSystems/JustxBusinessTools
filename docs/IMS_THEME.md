# Justx IMS theme

The IMS theme is the visual language of the IMS Distributor template
(blue → cyan gradient actions, frosted-glass surfaces on a periwinkle canvas,
24px rounding, Inter). It ships in two layers so any JBT tool can use it.

| Layer | File | Scope | How to turn it on |
|---|---|---|---|
| Kit skin | `web/components/bos/styles/bos.skin-ims.css` | Every component of the BOS kit (`components/bos/*`) | `<BosRoot skin="ims">`, or automatically when the org's design pack is `ims` |
| Design pack | `web/styles/ims-pack.css` | Shared JBT chrome: operator shell, admin, Quotation, Site Survey, calculators | Admin → Theme → preset "JustX IMS (Light)" / "JustX IMS (Dark)" (sets `<html data-pack="ims">`) |

Both layers only re-map tokens and restyle classes. Markup and component APIs
are unchanged, so a tool switches look with one prop or one preset.

## Visual language

- **Actions:** `linear-gradient(90deg, #4854EB, #32C7F6)` with an indigo glow
  (`0 10px 26px -8px rgba(72, 84, 235, .45)`); hover darkens both stops.
- **Surfaces:** white at 74% with `blur(24px) saturate(1.15)` on the canvas
  `radial-gradient(...) + linear-gradient(#E4EAF8 → #CFDCF7)`. Dialogs,
  palettes and option lists use the opaque `--bos-ims-surface-solid`.
- **Shape:** 24px cards, pills and nav items; 16px chips; 12px inputs.
- **Type:** Inter (`--font-inter`, loaded in `app/layout.tsx`), medium-weight
  labels, tabular figures for numbers.
- **Status:** soft tint plus a dot (emerald `#1FA679`, amber `#D98A1F`, red
  `#E1483F`); never a filled block.
- **Aging colours:** `IMS_AGING_COLORS` in `components/bos/tokens.ts`
  (0-15 / 16-30 / 31-60 / 61-90 / 90+).

## Tokens

The kit skin overrides the standard `--bos-*` tokens (same names, new values),
so kit components need no changes. The values live in `IMS_SKIN_COLOR_TOKENS`
in `components/bos/tokens.ts`; `lib/bos/tokens-sync.test.ts` fails if the CSS
and the TypeScript drift apart.

IMS-only tokens, available inside `.bos[data-bos-skin="ims"]`:

| Token | Use |
|---|---|
| `--bos-ims-canvas` | Page background |
| `--bos-ims-surface-solid` | Opaque sheets (dialogs, palettes, menus) |
| `--bos-ims-well` | Recessed fills: secondary buttons, segmented tracks |
| `--bos-ims-grad` / `--bos-ims-grad-hover` | Primary action, active nav |
| `--bos-ims-grad-soft` | Soft banners, bulk bars |
| `--bos-ims-grad-success` / `--bos-ims-grad-danger` | Success fill / destructive hover |
| `--bos-ims-glow` | Glow under gradient actions |
| `--bos-ims-cyan`, `--bos-ims-orange` | Secondary accent, 61-90 day aging |
| `--bos-ims-glass-blur` | Backdrop filter for glass surfaces |

The design pack declares its variables (`--ims-grad`, `--ims-glass`,
`--ims-canvas`, …) on `<body>` because `applyThemeTokens()` writes the generic
surface variables inline on `<html>`, and only a descendant can out-rank them.

## Skin resolution

`resolveBosSkin()` in `lib/bos/theme.ts`:

1. an explicit `skin` prop on `BosRoot` wins;
2. otherwise the org's design pack decides (`ims` → IMS skin, anything else →
   BOS skin).

Light/dark follows the same rules as BOS (`resolveInitialBosTheme`): the
user's stored choice, then the host scheme when the pack is `bos` or `ims`,
then light. `ThemeToggle` works unchanged.

## Using it in a new tool

```tsx
import { BosRoot } from "@/components/bos/BosRoot";

export default function MyTool() {
  return (
    <BosRoot skin="ims" canvas className="bos-bleed">
      {/* AppShell, Card, DataTable, Dialog… from components/bos */}
    </BosRoot>
  );
}
```

- Use kit components; don't hard-code colours. If a value is missing, add a
  token to both `bos.skin-ims.css` and `tokens.ts`.
- For tool-specific layout, scope classes under `.bos` (see
  `components/ims/ims-app.css`) and read `--bos-*` tokens so the tool still
  works under the plain BOS skin.
- Leave `skin` unset if the tool should follow the org's pack instead of
  always looking like IMS.
