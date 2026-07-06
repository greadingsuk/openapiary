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

START_EPOCH="$(date +%s)"
CURRENT_STEP="init"
PULL_STASH_NAME=""

restore_pull_stash() {
  if [[ -n "$PULL_STASH_NAME" ]]; then
    git -C "$REPO_ROOT" stash list | grep -q "$PULL_STASH_NAME" || return 0
    step "Restoring local changes after pull"
    if ! git -C "$REPO_ROOT" stash pop --index >/dev/null 2>&1; then
      echo "⚠️  Could not auto-apply stashed local changes."
      echo "   Run: git stash list"
      echo "   Then: git stash pop"
    fi
  fi
}

on_exit() {
  local exit_code=$?
  trap - EXIT

  local end_epoch duration status run_ts host user_name branch head
  end_epoch="$(date +%s)"
  duration="$((end_epoch - START_EPOCH))"
  status="success"
  if [[ "$exit_code" -ne 0 ]]; then status="failed"; fi

  run_ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  host="$(hostname 2>/dev/null || echo unknown-host)"
  user_name="${USER:-$(whoami 2>/dev/null || echo unknown-user)}"
  branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown-branch)"
  head="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown-head)"

  local log_dir="$REPO_ROOT/logs"
  local log_file="$log_dir/ios-build-runs.tsv"
  mkdir -p "$log_dir"
  if [[ ! -f "$log_file" ]]; then
    printf "timestamp_utc\tstatus\tduration_s\tstep\tbranch\thead\thost\tuser\n" > "$log_file"
  fi
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
    "$run_ts" "$status" "$duration" "$CURRENT_STEP" "$branch" "$head" "$host" "$user_name" >> "$log_file"

  # Loop-closing telemetry: by default, push the log row to origin/main.
  # Disable with OA_LOG_TO_GIT=0 if needed.
  if [[ "${OA_LOG_TO_GIT:-1}" == "1" ]]; then
    if git -C "$REPO_ROOT" add "$log_file" 2>/dev/null && \
      ! git -C "$REPO_ROOT" diff --cached --quiet -- "$log_file"; then
      local msg="chore(log): ios run ${status} ${run_ts}"
      if git -C "$REPO_ROOT" commit -m "$msg" "$log_file" >/dev/null 2>&1; then
        git -C "$REPO_ROOT" push origin main >/dev/null 2>&1 || \
          echo "⚠️  Build log commit created but push failed (check git auth/network)."
      fi
    fi
  fi

  exit "$exit_code"
}
trap on_exit EXIT

if [[ "${1:-}" != "--no-pull" ]]; then
  if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
    CURRENT_STEP="stash local changes"
    step "Stashing local changes before pull"
    PULL_STASH_NAME="ios-build-autostash-$(date +%s)"
    git -C "$REPO_ROOT" stash push --include-untracked -m "$PULL_STASH_NAME" >/dev/null 2>&1 || true
  fi

  CURRENT_STEP="git pull"
  step "Pulling latest from GitHub"
  git pull --rebase origin main
  restore_pull_stash
fi

cd app

CURRENT_STEP="npm install"
step "Installing dependencies (npm install)"
npm install

CURRENT_STEP="npm run build"
step "Building web bundle (npm run build)"
npm run build

CURRENT_STEP="npm run icons"
step "Generating app icon + splash (npm run icons)"
npm run icons || echo "  (icons step skipped — non-fatal)"

CURRENT_STEP="npx cap sync ios"
step "Syncing into the iOS project (npx cap sync ios)"
npx cap sync ios

# The Bluetooth privacy keys live in App/Info.plist. Xcode's "update settings"
# migration sometimes strips them, which silently kills the BLE prompt. If the
# file got modified, revert ONLY it (keeps signing/bundle-id edits intact).
if git -C "$REPO_ROOT" status --porcelain app/ios/App/App/Info.plist | grep -q '^ M'; then
  CURRENT_STEP="restore Info.plist"
  step "Restoring Bluetooth keys in Info.plist (git checkout)"
  git -C "$REPO_ROOT" checkout -- app/ios/App/App/Info.plist
fi

CURRENT_STEP="open Xcode"
step "Opening the project in Xcode"
open ios/App/App.xcodeproj

cat <<'DONE'

✅ Done. In Xcode:
   1. Select your iPhone as the run destination (top bar).
   2. Press ▶ (Cmd+R) to build & run.
   3. First run on the phone: Settings → General → VPN & Device Management → trust your Apple ID.
   If Xcode complains about packages: File → Packages → Reset Package Caches, then Resolve.
DONE
