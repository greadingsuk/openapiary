# Open Apiary — UI/UX Style Guide

> One brand across the **mobile app** (iOS / Android) and the **cloud telemetry website**.
> Warm honey identity (Black Mountain Honey lineage) executed with a bright **paper-light /
> transparent-dial** aesthetic, anchored by the **OA bee + honeycomb** logo and aligned to
> Apple's Human Interface Guidelines. **Light theme only.**

**Tokens:** [`tokens/tokens.css`](tokens/tokens.css) · [`tokens/tokens.json`](tokens/tokens.json) · [`tokens/tailwind-theme.css`](tokens/tailwind-theme.css)
**Live preview:** [`preview/index.html`](preview/index.html)

---

## 1. Brand foundations

### 1.1 Personality
Open Apiary is **calm, precise, and trustworthy** — a quiet instrument for beekeepers. It feels
like a premium IoT product: glanceable data, soft warm glow, nothing shouting. Think *honey in
daylight*: bright, warm paper surfaces with amber light coming through frosted glass.

| We are | We are not |
| --- | --- |
| Warm, natural, organic | Cold, clinical, corporate-blue |
| Glanceable, calm, confident | Busy, alarmist, gamified |
| Precise & data-honest | Decorative for its own sake |
| Modern glass + soft glow | Flat, generic Material/Bootstrap |

### 1.2 Logo
The official mark is the **OA honeybee over a hexagon honeycomb field** (line-art bee, kraft-paper
texture, slab "OA" monogram). The master lives at `assets/logo/openapiary-logo.png`; the generated
icon set lives in `assets/logo/icons/` (run `assets/gen-icons.ps1` to regenerate).

- **Primary lockup** — full bee + honeycomb + OA, on light/kraft or transparent backgrounds.
- **App icon / favicon** — generated square set on a brand-cream (`honey-50 #fff8e6`) field:
  `favicon.ico` (16/32/48), `favicon-16/32/48.png`, `apple-touch-icon.png` (180),
  `icon-192/256/512/1024.png`, and `maskable-512.png` (Android adaptive, ~60% safe zone).
- **Monogram (OA)** — compact mark for the app icon, favicon, tab badge, and avatars.
- **Clear space** — keep padding ≥ the height of the "O" on all sides.
- **Minimum size** — 24 px (monogram) / 96 px (full lockup) on screen.

**Don't:** recolour the bee to honey-gold, stretch, add drop shadows, place the full lockup on busy
photography, or rebuild the OA letters in a UI font (the serif "OA" is **logo-only**).

### 1.3 The hexagon motif
The honeycomb hexagon is core brand DNA. Use it for: the weight/level **dials**, stat-card
silhouettes, empty-state art, loading skeletons, and section dividers. Reuse the existing
`.hex-cell` clip-path rather than inventing new shapes.

---

## 2. Colour

Honey-amber is the **interactive / data / glow** colour. Kraft-tan is the **brand neutral** —
text, borders, dividers, and marketing surfaces. Bright warm paper surfaces are the canvas.

### 2.1 Honey accent ramp
| Token | Hex | Use |
| --- | --- | --- |
| `honey-50` | `#fff8e6` | Light-mode paper, faint tints |
| `honey-100` | `#ffe9a8` | Subtle fills |
| `honey-200` | `#ffd76b` | Hover tints |
| `honey-300` | `#ffc233` | **Glow / dial highlight** |
| `honey-400` | `#f5a91f` | **Primary accent / CTAs** |
| `honey-500` | `#d98a0c` | Pressed / active |
| `honey-600` | `#a96809` | Deep accent on light |
| `honey-700` | `#774905` | Text on honey-50 |
| `honey-800` | `#4d2f03` | Deepest shade |

### 2.2 Kraft / parchment neutral ramp
| Token | Hex | Use |
| --- | --- | --- |
| `kraft-50` | `#f5efe2` | Surface 2 |
| `kraft-100` | `#e8dcc4` | Surface 3, dividers |
| `kraft-200` | `#d8c7a6` | Borders |
| `kraft-300` | `#c9b896` | Hairlines / disabled |
| `kraft-400` | `#a8966e` | Secondary icons |
| `kraft-500` | `#8a7b5e` | Decorative only (low contrast) |
| `kraft-600` | `#5e523c` | **Muted text** |
| `kraft-700` | `#3a3328` | Deep neutral |

### 2.3 Surfaces & text
| Role | Hex |
| --- | --- |
| Surface base | `#fffdf7` |
| Surface 1 (cards) | `#fff8e6` |
| Surface 2 (panels) | `#f5efe2` |
| Surface 3 (inputs/popovers) | `#e8dcc4` |
| Text primary | `#1a1410` |
| Text muted | `#5e523c` |
| Text subtle | `#6e6047` |
| Text on accent (honey button ink) | `#14100c` |

### 2.4 Glass
Translucent layers sit above surfaces with a backdrop blur — the signature look for cards, the tab
bar, sheets, and transparent dials.

- Fill `rgba(26,20,16,.04)` → `.06` · Border `rgba(26,20,16,.12)` · Highlight `rgba(245,169,31,.22)`
- Blur `18px` (`24px` for large hero glass), `saturate(120%)`.
- Always pair glass with a 1px border so it reads on light surfaces.

### 2.5 Data-viz palette
Warm and mutually distinguishable, darkened so series read on light surfaces.

| Series | Hex |
| --- | --- |
| Weight | `#b8780a` / `#8a5a06` |
| Battery | `#5f9145` (sage) |
| Temperature | `#d2581f` (terracotta) |
| Humidity | `#3f8a83` (teal) |
| Alert / spike | `#cf3a3f` (red) |

Grid lines `rgba(26,20,16,.10)`, axis labels `#6e6047`.

### 2.6 Semantic
Success `#5f9145` · Warning `#c47d0a` · Danger `#cf3a3f` · Info `#5e523c`.

### 2.7 Contrast (WCAG)
Verified on surface-1 `#fff8e6` unless noted. Target AA: 4.5:1 body, 3:1 large/UI.

| Pair | Ratio | Verdict |
| --- | --- | --- |
| Text primary `#1a1410` on `#fff8e6` | 17.2:1 | ✅ AAA |
| Text muted `#5e523c` on `#fff8e6` | 7.2:1 | ✅ AAA |
| Text subtle `#6e6047` on `#fff8e6` | 5.8:1 | ✅ AA (body) |
| Honey-700 `#774905` on `#fff8e6` | 7.2:1 | ✅ AAA (large), AA text |
| Honey-600 `#a96809` on `#fff8e6` | 4.2:1 | ✅ AA large / UI |
| Dark ink `#14100c` on honey-400 button | 9.5:1 | ✅ AAA |

> Rule: **never** use honey-400 as text on light surfaces (1.9:1, fails) — use honey-700 for honey
> text, or dark ink on a honey fill. Don't rely on colour alone for status; pair with icon or label.

---

## 3. Typography

| Role | Family | Notes |
| --- | --- | --- |
| Display / headings / **dial numerals** | **Sora** | Geometric, modern, warm |
| UI / body | **Inter** | Highly legible at small sizes |
| Raw telemetry values, code, IDs | **JetBrains Mono** | Always `font-variant-numeric: tabular-nums` |

**Platform note (HIG):** on-device, prefer the system body font (**SF Pro** on iOS, **Roboto** on
Android) for paragraphs and lists; reserve **Sora** for headings and big numerals so text feels
native and renders crisply. The serif "OA" is logo-only.

### Type scale
| Token | Size | Use |
| --- | --- | --- |
| `text-dial` | 56px | Hero dial value |
| `text-3xl` | 44px | Page hero |
| `text-2xl` | 32px | Screen title |
| `text-xl` | 24px | Section heading |
| `text-lg` | 20px | Card title |
| `text-md` | 16px | Body (base) |
| `text-sm` | 14px | Secondary / captions |
| `text-xs` | 12px | Labels / metadata |
| `text-2xs` | 11px | Axis ticks |

Weights: 400 / 500 / 600 / 700. Line-height: 1.15 tight (display), 1.3 snug (titles), 1.5 body.
**All numeric telemetry uses tabular figures** so values don't jitter as they update.

---

## 4. Spacing, layout & radii

- **4 / 8 grid.** Spacing tokens: 4, 8, 12, 16, 24, 32, 48, 64.
- **Radii:** sm 8 · md 14 · lg 22 · xl 32 · pill 999. Cards use `lg`; dials/hero use `xl`; chips use pill.
- **App:** single-column, safe-area aware, content max-width 640px on tablets. Tab bar bottom, FAB
  for the primary "scan / add hive" action.
- **Website (telemetry):** responsive grid of glass tiles; content max-width 1200px; data tables
  full-width within container. Denser than the app — built for monitoring many hives at once.

---

## 5. Elevation & glass

Three elevation steps via warm shadows (`shadow-oa-1/2/3`). Glow (`shadow-oa-glow`) is reserved for
**active dials and primary CTAs only** — overusing it kills the calm. Layer order:
`surface-base → surface-1 card → glass overlay → honey accent/glow`.

---

## 6. Texture

The logo's **paper/canvas grain** is a brand asset, used **sparingly**:

- ✅ Website hero / footer zones, brand splash, honeycomb backdrops.
- ❌ App data surfaces, cards behind charts, dense tables (keep these clean glass).
- Apply `--oa-texture-grain` as a low-opacity (`~0.06`) overlay via `::after`.
- **Disabled automatically** under `prefers-reduced-motion` / data-saver (token drops to 0).

---

## 7. Iconography

- **Line / outline** style (echoes the line-art bee), 1.75–2px stroke, rounded joins. Base set:
  **ionicons** (already in the app); add custom **hex** and **bee** glyphs as needed.
- Icons inherit `currentColor`; default to text-muted, honey-400 when active/selected.
- Transparent backgrounds; never filled bitmap icons. Minimum tap target 44×44 px (icon ~24px).

---

## 8. App components (iOS / Android)

| Component | Spec |
| --- | --- |
| **Glass card** | `.oa-glass`, radius lg, 16px padding, shadow-oa-2. Title in Sora 20, value in mono. |
| **Transparent dial / gauge** | SVG honeycomb ring; track at glass-border, fill honey-300→400 gradient, value in Sora `text-dial` tabular. Animate fill over `--oa-duration-dial` with `ease-decelerate`. Add `shadow-oa-glow` only when live. See preview + `HiveVisual.tsx`. |
| **Charts** | Chart.js themed: line `data-weight #b8780a`, fill honey-400 @ 12% alpha, grid `data-grid`, ticks `text-subtle`, tooltip on surface-3 glass. Battery uses sage `#5f9145`. |
| **List rows** | Surface-1, 1px `glass-border` divider, 56px min height, chevron in kraft-400. |
| **Primary button** | honey-400 fill, `text-on-accent` ink, radius md, pressed honey-500. |
| **Secondary button** | Transparent, 1px honey-400 border, honey-700 text. |
| **Input / toggle** | Surface-3 fill, glass border, focus ring honey-400 @ 50%. Toggle "on" = honey-400. |
| **Tab bar** | Bottom, `.oa-glass`, active icon+label honey-400, inactive kraft-400. |
| **FAB** | honey-400 circle, dark ink icon, shadow-oa-3 — primary "scan / add hive". |

---

## 9. Website components (telemetry-focused)

| Component | Spec |
| --- | --- |
| **Stat tile** | Glass card, hex accent corner, big mono value + Sora label + delta (success/danger). |
| **Hive table** | Surface-1, sticky header in Sora 14 uppercase kraft-500, rows zebra via surface-2 @ 50%, status dot + label. |
| **Trend chart** | Wide line chart, multi-series from data-viz palette, legend chips (pill, glass), brushable time range. |
| **Region doughnut** | Honey ramp segments, centre total in mono. |
| **Fleet map** | Light map, honey hex markers, glow on selected. |
| **Hero** | Texture grain + honeycomb backdrop, OA logo, headline in Sora 44. |

The website is denser and more analytical than the app, but uses the **same tokens, type, glass, and
honey/kraft palette** so the two read as one product.

---

## 10. Motion

- Durations: fast 150 / base 250 / slow 400 / dial 800 ms. Easing: standard, decelerate (entrances),
  spring (playful confirmations only).
- **Dial fill:** animate from 0 to value on mount/update with decelerate easing + a brief glow pulse.
- Charts: animate draw on first load only, not on every refresh (avoid distraction).
- **Respect `prefers-reduced-motion`:** durations collapse to 0 and texture disables (see tokens).

---

## 11. UX principles

Grounded in Apple HIG (clarity, deference, depth) plus IoT telemetry realities:

1. **Glanceability first.** The latest weight/health of a hive must be readable in under a second —
   big tabular numeral, dial, trend arrow. Detail is progressive.
2. **Offline-first & honest state.** The app passively receives BLE adverts; there is no live
   request. Always show **last-seen timestamp** and a clear "stale / no recent reading" state rather
   than implying real-time when it isn't.
3. **Touch targets ≥ 44×44 px.** Honour safe areas and one-handed reach (primary actions low).
4. **Every screen has 4 states:** loading (hex skeleton), empty (honeycomb illustration + clear CTA),
   error (calm, actionable — never alarmist red walls), and content.
5. **Calm alerting.** Reserve danger red and glow for genuine alerts (e.g. sudden weight drop =
   possible swarm/theft). Routine data stays neutral honey/kraft.
6. **Accessibility:** AA contrast minimum, never colour-alone status, Dynamic Type / scalable text,
   VoiceOver/TalkBack labels on dials and charts, reduced-motion respected.
7. **Consistency app ↔ web.** Same tokens, same component language, same words for the same things.

---

## 12. How to adopt (later)

- **App:** point `app/src/theme/tailwind.css` at `tokens/tailwind-theme.css` (or merge its `@theme`
  block). Existing `honey-*` classes keep working; legacy `comb-bg`/`comb-fg` are remapped to the
  light palette (`#fff8e6` / `#1a1410`) — migrate them to `surface-*` / `ink` tokens then remove.
- **App icon:** use `assets/logo/icons/icon-1024.png` (or the transparent
  `assets/logo/openapiary-icon-source.png`) as the source for `@capacitor/assets`.
- **Dashboard:** `@import "../branding/tokens/tokens.css"` in `cloud/dashboard/index.html` and swap
  hard-coded hexes for `var(--oa-*)`.
- **Fonts:** load Sora, Inter, JetBrains Mono (self-host or Google Fonts), with system fallbacks.
- This guide and the preview are the source of truth; change tokens here first, then propagate.
