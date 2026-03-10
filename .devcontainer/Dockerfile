FROM ghcr.io/jasoncrawford/devcontainer-claude:latest

# Install Playwright Chromium system dependencies (must run as root)
# hadolint ignore=DL3016
RUN npx -y playwright install-deps chromium

# Install Vercel CLI
# hadolint ignore=DL3016
RUN npm install -g vercel
