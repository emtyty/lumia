---
name: release-lumia-page
description: Upload lumia-landing.html to GitHub Pages at haht-dev/lumia repo. Use when deploying the Lumia landing page.
allowed-tools: Bash Read
---

# Deploy Lumia Landing Page to GitHub Pages

Upload `resources/lumia-landing.html` to the `main` branch of `https://github.com/haht-dev/lumia` as `index.html`.

## Steps

1. **Read the landing page** from `resources/lumia-landing.html` to confirm it exists.

2. **Deploy to main** using this sequence:
   ```bash
   # Create a temp directory for the deploy
   DEPLOY_DIR=$(mktemp -d)
   
   # Copy the landing page as index.html and preserve CNAME
   cp resources/lumia-landing.html "$DEPLOY_DIR/index.html"
   echo -n "lumia.beer" > "$DEPLOY_DIR/CNAME"
   
   # Init a fresh git repo in the temp dir and push to main
   cd "$DEPLOY_DIR"
   git init
   git checkout -b main
   git add index.html CNAME
   git commit -m "deploy: update Lumia landing page"
   git remote add origin git@github.com:haht-dev/lumia.git
   git push origin main --force
   
   # Cleanup
   rm -rf "$DEPLOY_DIR"
   ```

3. **Confirm** the deploy succeeded and report the live URL: `https://lumia.beer`
