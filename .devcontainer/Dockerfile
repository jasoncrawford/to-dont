FROM ghcr.io/jasoncrawford/devcontainer-claude:latest

# Install Playwright Chromium system dependencies (must run as root)
USER root
# hadolint ignore=DL3016
RUN npx -y playwright install-deps chromium
USER node

# Install Vercel CLI
# hadolint ignore=DL3016
RUN npm install -g vercel
