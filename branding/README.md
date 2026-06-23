# Open Apiary — UI/UX & Branding

The single source of truth for how the **Open Apiary mobile app** (iOS / Android) and the
**cloud telemetry website** look and behave. One brand, two surfaces.

**Aesthetic:** warm honey identity (Black Mountain Honey lineage) + kraft/parchment neutrals
(from the OA bee-and-honeycomb logo), rendered as a bright **paper-light UI with transparent
honeycomb dials**. Light theme only. Apple-HIG aligned.

## Contents

| File | What it is |
| --- | --- |
| [`style-guide.md`](style-guide.md) | Full written guide: brand, colour, type, spacing, glass, texture, icons, components, motion, UX principles, accessibility. |
| [`tokens/tokens.css`](tokens/tokens.css) | Framework-agnostic CSS custom properties (`--oa-*`), light `:root`. The dashboard can `@import` this directly. |
| [`tokens/tokens.json`](tokens/tokens.json) | The same tokens in W3C design-token JSON for tooling. |
| [`tokens/tailwind-theme.css`](tokens/tailwind-theme.css) | Tailwind v4 `@theme` map for the app. Backwards-compatible with the existing `honey-*` / `comb-*` tokens. |
| [`preview/index.html`](preview/index.html) | Self-contained interactive showcase — palette + contrast, type scale, animated transparent dial, controls, telemetry tiles, texture demo. |
| [`assets/gen-icons.ps1`](assets/gen-icons.ps1) | Generates the full app-icon / favicon set from the logo (System.Drawing, no installs). |
| `assets/logo/` | The OA logo master + generated `icons/` set (see below). |

## Quick start

- **See it:** open [`preview/index.html`](preview/index.html) in a browser.
- **Fonts:** Sora (display + dial numerals), Inter (UI/body), JetBrains Mono (telemetry). System
  fonts (SF Pro / Roboto) are the on-device body fallback.
- **Colour roles:** honey-amber = interactive / data / glow · kraft-tan = neutral text & borders ·
  warm paper = surfaces.

## Logo & icons

The official mark (line-art honeybee over a hexagon honeycomb field + slab **OA** monogram) lives in
`assets/logo/`. Run [`assets/gen-icons.ps1`](assets/gen-icons.ps1) to (re)generate the full icon set:

```
assets/logo/
  openapiary-logo.png          # original wide master
  openapiary-icon-source.png   # 1024² transparent square master (for @capacitor/assets)
  icons/
    favicon.ico                # 16/32/48 multi-res
    favicon-16x16.png  favicon-32x32.png  favicon-48x48.png
    apple-touch-icon.png       # 180²
    icon-64/192/256/512/1024.png
    maskable-512.png           # Android adaptive, ~60% safe zone
```

Square icons sit on a brand-cream (`honey-50 #fff8e6`) field so the black line-art stays visible on
any browser chrome. Usage rules (clear space, min size, don'ts) are in
[`style-guide.md`](style-guide.md#12-logo). Web `<head>` wiring is in `preview/index.html`.

## Adopting these tokens (separate follow-up — not done yet)

- **App:** import `tokens/tailwind-theme.css` from `app/src/theme/tailwind.css` (or merge its
  `@theme` block). Existing classes keep working; legacy `comb-bg`/`comb-fg` now map to the light
  palette. App icon source: `assets/logo/openapiary-icon-source.png`.
- **Dashboard:** `@import "../branding/tokens/tokens.css"` in `cloud/dashboard/index.html` and
  replace hard-coded hexes with `var(--oa-*)`; copy `assets/logo/icons/` for favicons.

Change tokens **here first**, then propagate — this folder is the source of truth.
