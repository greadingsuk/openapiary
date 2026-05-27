# OpenApiary App (Ionic React + Capacitor)

This folder is **deliberately left as a stub** so you can complete the interactive
Ionic scaffold when you're ready. The CLI prompts can't be answered safely from
an automated agent.

## Finishing the scaffold

From a PowerShell terminal **at this folder** (`openapiary/app`):

```powershell
# Step out one level — the create command makes its own folder.
cd ..

# Remove the placeholder app/ folder first
Remove-Item -Recurse -Force .\app

# Run the official creator. Choose:
#   framework: react
#   starter:   blank   (or "tabs" if you want a 3-tab shell)
#   capacitor: yes
npm create ionic-app@latest app -- --type react --capacitor --name openapiary --no-git

cd .\app
npm install @capacitor-community/bluetooth-le @capacitor-community/sqlite
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npx cap add ios       # only on macOS
npx cap add android
```

## Planned screens (see `docs/migration-plan.md` §5.2)

- `HiveListPage` — paired hives, last seen, current weight, battery icon
- `HiveDetailPage` — weight chart, battery trend, raw advert log
- `AddHivePage` — scan nearby BTHome adverts, name + save
- `SettingsPage` — Cloudflare sync URL, API key, sync interval, export CSV
- `CalibrationHelperPage` — explains the USB serial CLI / magnet trigger

## BLE flow

See §5.3 of the migration plan for the canonical scan code. Service UUID:
`0000fcd2-0000-1000-8000-00805f9b34fb`.

## Local SQLite schema

See §5.5 of the migration plan.
