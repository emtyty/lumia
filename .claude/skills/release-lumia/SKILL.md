---
name: release-lumia
description: >
  Build, sign, publish, and deploy a new Lumia release. Use when the user says
  "release", "publish build", "release mac/win", "deploy new version", or similar.
  Covers: preflight checks, electron-builder publish, GitHub Release creation,
  landing page download-link update, and GitHub Pages deploy.
allowed-tools: Bash Read Edit Grep Glob Write
---

# Release Lumia

End-to-end release workflow for Lumia desktop app (macOS + Windows).
Both platforms are built and published in every release. macOS requires code-signing + notarization (must run on a Mac). Windows is cross-compiled from macOS via electron-builder.

---

## Phase 0 — Preflight Checks

Run ALL of the following checks before building. **Stop and report** if any fail.

### 0-1. Platform gate

```bash
[[ "$(uname)" == "Darwin" ]] && echo "OK: macOS" || echo "FAIL: release only supported on macOS"
```

If not macOS, stop immediately and inform the user.

### 0-2. Read version from package.json

```bash
VERSION=$(node -p "require('./package.json').version")
echo "Version: $VERSION"
```

Store `$VERSION` — it is used everywhere below.

### 0-3. Signing & notarization secrets (.env)

Read `.env` and verify **all four** variables are non-empty:

| Variable | Purpose |
|----------|---------|
| `APPLE_ID` | Apple developer email |
| `APPLE_APP_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-char team identifier |
| `KEYCHAIN_PASSWORD` | Login keychain password |

```bash
source .env
for v in APPLE_ID APPLE_APP_PASSWORD APPLE_TEAM_ID KEYCHAIN_PASSWORD; do
  [[ -z "${!v}" ]] && echo "FAIL: $v is empty in .env" || echo "OK: $v"
done
```

If any variable is empty, stop and tell the user to fill in `.env` (reference `.env.example`).

### 0-4. GitHub CLI access

Verify `gh` is installed AND has write access to **both** repos:

```bash
gh auth status
gh repo view haht-dev/lumia-releases --json name -q '.name'
gh repo view haht-dev/lumia --json name -q '.name'
```

All three commands must succeed. If not, ask the user to run `gh auth login`.

### 0-5. Git state

Ensure working tree is clean and current branch is `master`:

```bash
git status --porcelain
git branch --show-current
```

If dirty or not on master, warn the user before proceeding.

---

## Phase 1 — Build & Publish

### 1-1. macOS release build

```bash
npm run release:mac
```

This runs: `export GH_TOKEN=$(gh auth token) && node scripts/unlock-keychain.js && npm run build && electron-builder --mac --publish always -c.afterSign=scripts/notarize.js`

electron-builder publishes artifacts to **haht-dev/lumia-releases** via the `publish` config in `electron-builder.yml`.

**Expected macOS artifacts** (in `dist/`):

| File pattern | Description |
|---|---|
| `Lumia.dmg` | macOS installer |
| `Lumia-{VERSION}-mac.zip` | macOS auto-update zip |
| `latest-mac.yml` | Auto-update manifest |

After the command completes, verify the artifacts exist:

```bash
ls -lh dist/Lumia.dmg dist/Lumia-*-mac.zip dist/latest-mac.yml
```

### 1-2. Windows release build

Run immediately after the macOS build succeeds. This cross-compiles from macOS using electron-builder + NSIS.

```bash
npm run release:win
```

This runs: `export GH_TOKEN=$(gh auth token) && npm run build && electron-builder --win --publish always`

**Expected Windows artifacts** (in `dist/`):

| File pattern | Description |
|---|---|
| `Lumia-Setup-{VERSION}.exe` | Windows NSIS installer |
| `latest.yml` | Windows auto-update manifest |

After the command completes, verify the artifacts exist:

```bash
ls -lh dist/Lumia-Setup-*.exe dist/latest.yml
```

> **Note:** If `npm run release:win` fails due to missing Wine or mono, install via `brew install --cask wine-stable` and retry. NSIS cross-compilation on macOS typically works without Wine for simple installers.

---

## Phase 2 — Verify GitHub Release

### 2-1. Check release exists on GitHub

```bash
gh release view "v${VERSION}" --repo haht-dev/lumia-releases --json tagName,assets
```

Confirm:
- Tag name matches `v{VERSION}`
- **macOS assets:** `Lumia.dmg`, `Lumia-{VERSION}-mac.zip`, `latest-mac.yml`
- **Windows assets:** `Lumia-Setup-{VERSION}.exe`, `latest.yml`

### 2-2. Publish release if draft

electron-builder creates releases in **draft** state. Publish it so download links work:

```bash
gh release edit "v${VERSION}" --repo haht-dev/lumia-releases --draft=false
```

### 2-3. If the release does not exist or is missing assets, report the error and stop.

---

## Phase 3 — Update Landing Page Download Links

### 3-1. Read the current landing page

Read `resources/lumia-landing.html`.

### 3-2. Replace all download URLs

The landing page contains versioned download links pointing to `haht-dev/lumia-releases`. Update **every occurrence** of the old version to `v{VERSION}`:

**macOS links** (pattern: `Lumia.dmg` — version is in the path segment):
```
https://github.com/haht-dev/lumia-releases/releases/download/v{OLD}/Lumia.dmg
→
https://github.com/haht-dev/lumia-releases/releases/download/v{VERSION}/Lumia.dmg
```

**Windows links** (pattern: `Lumia-Setup-{OLD}.exe`):
```
https://github.com/haht-dev/lumia-releases/releases/download/v{OLD}/Lumia-Setup-{OLD}.exe
→
https://github.com/haht-dev/lumia-releases/releases/download/v{VERSION}/Lumia-Setup-{VERSION}.exe
```

Use `replace_all` to catch all occurrences (header nav CTA, hero section, footer CTA, and JS platform-detection block).

### 3-3. Verify links

After editing, grep for the old version to make sure nothing was missed:

```bash
grep -c "v{OLD_VERSION}" resources/lumia-landing.html
# Should be 0
grep -c "v${VERSION}" resources/lumia-landing.html
# Should be > 0 (expect 5-7 occurrences)
```

---

## Phase 4 — Deploy Landing Page to GitHub Pages

### 4-1. Deploy to haht-dev/lumia (main branch)

```bash
DEPLOY_DIR=$(mktemp -d)

cp resources/lumia-landing.html "$DEPLOY_DIR/index.html"
echo -n "lumia.beer" > "$DEPLOY_DIR/CNAME"

cd "$DEPLOY_DIR"
git init
git checkout -b main
git add index.html CNAME
git commit -m "deploy: update Lumia landing page v${VERSION}"
git remote add origin git@github.com:haht-dev/lumia.git
git push origin main --force

rm -rf "$DEPLOY_DIR"
```

### 4-2. Verify GitHub Pages deployment

```bash
gh api repos/haht-dev/lumia/pages --jq '.status'
```

Status should be `"built"`. If it shows `"building"`, wait a moment and check again.

### 4-3. Verify live download links

Check that the download URLs on the landing page return valid redirects (HTTP 302):

```bash
curl -sI "https://github.com/haht-dev/lumia-releases/releases/download/v${VERSION}/Lumia.dmg" | head -3
curl -sI "https://github.com/haht-dev/lumia-releases/releases/download/v${VERSION}/Lumia-Setup-${VERSION}.exe" | head -3
```

Both should return `HTTP/2 302` (redirect to the actual download).

### 4-4. Final verification

Report to user:
- Release page: `https://github.com/haht-dev/lumia-releases/releases/tag/v{VERSION}`
- Landing page: `https://lumia.beer`
- macOS download: `https://github.com/haht-dev/lumia-releases/releases/download/v{VERSION}/Lumia.dmg`
- Windows download: `https://github.com/haht-dev/lumia-releases/releases/download/v{VERSION}/Lumia-Setup-{VERSION}.exe`

Suggest the user open `https://lumia.beer` in a browser to visually confirm the download buttons work.

---

## Error Handling

| Situation | Action |
|---|---|
| Not on macOS | Stop immediately — release requires macOS for code signing |
| `.env` missing variables | Stop — list which vars are empty, reference `.env.example` |
| `gh` not authenticated | Ask user to run `gh auth login` |
| `gh` lacks repo access | Ask user to check permissions on haht-dev/lumia-releases and haht-dev/lumia |
| `npm run release:mac` fails | Show the last 50 lines of output, check common issues (keychain locked, cert expired, network) |
| `npm run release:win` fails | Show the last 50 lines of output; common fix: `brew install --cask wine-stable` for NSIS cross-compilation |
| GitHub Release still draft | Run `gh release edit "v${VERSION}" --repo haht-dev/lumia-releases --draft=false` |
| GitHub Release missing | Check if electron-builder errored silently; suggest manual `gh release create` as fallback |
| Download links 404 after publish | GitHub CDN propagation delay — wait 2-3 minutes and retry; verify with `gh release download` as alternative |
| Landing page still has old version | Re-run the replace step, grep to confirm |
| GitHub Pages not building | Check `gh api repos/haht-dev/lumia/pages` for error details |
