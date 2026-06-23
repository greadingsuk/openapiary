# Logo assets

- `openapiary-logo.png` — the supplied master mark (line-art bee + honeycomb + OA), 2164×1952.
- `openapiary-icon-source.png` — 1024² transparent square master, padded for square icons.
  Use this as the source for `@capacitor/assets` to generate native app icons.
- `icons/` — generated favicon / app-icon set (see below).

## Generated icon set (`icons/`)

Produced by [`../gen-icons.ps1`](../gen-icons.ps1) using .NET System.Drawing (no installs needed).
Square icons sit on a brand-cream `honey-50 #fff8e6` field so the black line-art stays visible on
any browser chrome.

| File | Size | Use |
| --- | --- | --- |
| `favicon.ico` | 16/32/48 | Classic browser tab favicon |
| `favicon-16x16.png` / `favicon-32x32.png` / `favicon-48x48.png` | 16–48 | Modern PNG favicons |
| `apple-touch-icon.png` | 180 | iOS home-screen / Safari |
| `icon-192.png` / `icon-512.png` | 192 / 512 | PWA manifest icons |
| `icon-256.png` / `icon-1024.png` | 256 / 1024 | Stores / high-DPI |
| `icon-64.png` | 64 | Misc / Windows tiles |
| `maskable-512.png` | 512 | Android adaptive (purpose `maskable`, ~60% safe zone) |

To regenerate after the logo changes:

```powershell
powershell -ExecutionPolicy Bypass -File branding/assets/gen-icons.ps1
```

## Web `<head>` snippet

```html
<link rel="icon" href="/icons/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16x16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
<meta name="theme-color" content="#f5a91f" />
```

## PWA manifest entries

```json
"icons": [
  { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
  { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

Usage rules (clear space, minimum size, do/don't) live in
[`../../style-guide.md`](../../style-guide.md#12-logo).
