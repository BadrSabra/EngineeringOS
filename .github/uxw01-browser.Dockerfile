FROM mcr.microsoft.com/playwright:v1.62.1-noble

ARG UXW_UID=1001
ARG UXW_GID=1001
ARG PNPM_VERSION=10.26.1
ARG SOURCE_SHA=unknown

ENV PNPM_HOME=/opt/pnpm \
    PATH=/opt/pnpm:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOME=/tmp/home \
    TMPDIR=/tmp \
    npm_config_cache=/tmp/npm-cache

LABEL org.opencontainers.image.revision="${SOURCE_SHA}"

WORKDIR /workspace

USER root
RUN npm install --global --ignore-scripts --no-audit --no-fund "pnpm@${PNPM_VERSION}" \
    && if ! getent group "${UXW_GID}" >/dev/null; then groupadd --gid "${UXW_GID}" uxw; fi \
    && if ! getent passwd "${UXW_UID}" >/dev/null; then useradd --uid "${UXW_UID}" --gid "${UXW_GID}" --no-create-home --shell /usr/sbin/nologin uxw; fi \
    && mkdir -p /opt/pnpm /workspace/test-results/dashboard-protected-visual /tmp/home /tmp/npm-cache \
    && chown -R "${UXW_UID}:${UXW_GID}" /opt/pnpm /workspace /tmp/home /tmp/npm-cache

COPY --chown=${UXW_UID}:${UXW_GID} package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.base.json /workspace/
COPY --chown=${UXW_UID}:${UXW_GID} artifacts/ /workspace/artifacts/
COPY --chown=${UXW_UID}:${UXW_GID} lib/ /workspace/lib/
COPY --chown=${UXW_UID}:${UXW_GID} scripts/ /workspace/scripts/

USER ${UXW_UID}:${UXW_GID}

RUN pnpm install --frozen-lockfile --filter @workspace/dashboard... \
    && pnpm --filter @workspace/dashboard exec node -e 'const fs = require("node:fs"); const { chromium } = require("@playwright/test"); const version = require("@playwright/test/package.json").version; if (version !== "1.62.1") throw new Error(`Unexpected Playwright version: ${version}`); if (!fs.existsSync(chromium.executablePath())) throw new Error("The pinned Playwright Chromium binary is missing.");'

ENTRYPOINT ["/bin/bash", "/workspace/scripts/run-uxw01-browser-container.sh"]

