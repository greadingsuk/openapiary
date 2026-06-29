#!/usr/bin/env bash
# Open Apiary — one-command iOS build for the Mac.
# Usage:  ./build-ios.sh            (pull, install, build web, icons, sync, open Xcode)
#         ./build-ios.sh --no-pull  (skip git pull — build what's on disk)
#
# After it opens Xcode: pick your iPhone as the run target and press ▶ (Cmd+R).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

step() { printf "\n\033[1;33m▸ %s\033[0m\n" "$1"; }

if [[ "${1:-}" != "--no-pull" ]]; then
  step "Pulling latest from GitHub"
  git pull origin main
fi

cd app

step "Installing dependencies (npm install)"
npm install

step "Building web bundle (npm run build)"
npm run build

step "Generating app icon + splash (npm run icons)"
npm run icons || echo "  (icons step skipped — non-fatal)"

step "Syncing into the iOS project (npx cap sync ios)"
npx cap sync ios

# The Bluetooth privacy keys live in App/Info.plist. Xcode's "update settings"
# migration sometimes strips them, which silently kills the BLE prompt. If the
# file got modified, revert ONLY it (keeps signing/bundle-id edits intact).
if git -C "$REPO_ROOT" status --porcelain app/ios/App/App/Info.plist | grep -q '^ M'; then
  step "Restoring Bluetooth keys in Info.plist (git checkout)"
  git -C "$REPO_ROOT" checkout -- app/ios/App/App/Info.plist
fi

step "Opening the project in Xcode"
open ios/App/App.xcodeproj

cat <<'DONE'

✅ Done. In Xcode:
   1. Select your iPhone as the run destination (top bar).
   2. Press ▶ (Cmd+R) to build & run.
   3. First run on the phone: Settings → General → VPN & Device Management → trust your Apple ID.
   If Xcode complains about packages: File → Packages → Reset Package Caches, then Resolve.
DONE
