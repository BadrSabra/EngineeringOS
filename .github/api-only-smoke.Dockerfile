FROM node:20.20.0-bookworm

ARG POSTGRES_PACKAGE_VERSION=16.10-1.pgdg120+1
ARG PNPM_VERSION=10.26.1
ARG SMOKE_UID=1001
ARG SMOKE_GID=1001

ENV PNPM_HOME=/opt/pnpm \
    PATH=/usr/lib/postgresql/16/bin:/opt/pnpm:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin \
    COREPACK_ENABLE_NETWORK=0 \
    PNPM_OFFLINE=1 \
    npm_config_offline=true \
    HOME=/tmp/home \
    TMPDIR=/tmp \
    npm_config_cache=/tmp/npm-cache

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d -m 0755 /usr/share/keyrings /etc/postgresql-common; \
    curl --fail --silent --show-error --location \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      --output /tmp/postgresql.asc; \
    fingerprint="$(gpg --show-keys --with-colons /tmp/postgresql.asc | awk -F: '$1 == \"fpr\" { print $10; exit }')"; \
    test "$fingerprint" = B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8; \
    gpg --dearmor --output /usr/share/keyrings/postgresql.gpg /tmp/postgresql.asc; \
    printf '%s\n' \
      'deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' \
      > /etc/apt/sources.list.d/pgdg.list; \
    printf '%s\n' '#!/bin/sh' 'exit 101' > /usr/sbin/policy-rc.d; \
    chmod 0755 /usr/sbin/policy-rc.d; \
    printf '%s\n' 'create_main_cluster = false' \
      > /etc/postgresql-common/createcluster.conf; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      "postgresql-16=${POSTGRES_PACKAGE_VERSION}" \
      "postgresql-client-16=${POSTGRES_PACKAGE_VERSION}"; \
    test "$(pg_ctl --version | awk '{ print $3 }')" = 16.10; \
    test "$(node -p 'process.versions.node')" = 20.20.0; \
    command -v git; \
    git --version; \
    rm -f /usr/sbin/policy-rc.d /tmp/postgresql.asc; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    npm install --global --ignore-scripts --no-audit --no-fund "pnpm@${PNPM_VERSION}"; \
    test -f /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs; \
    rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx; \
    printf '%s\n' \
      '#!/bin/sh' \
      'set -eu' \
      'exec node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs --store-dir=/opt/pnpm/store "$@"' \
      > /usr/local/bin/pnpm; \
    chmod 0755 /usr/local/bin/pnpm; \
    groupadd --gid "${SMOKE_GID}" smoke; \
    useradd --uid "${SMOKE_UID}" --gid "${SMOKE_GID}" --no-create-home --shell /usr/sbin/nologin smoke; \
    mkdir -p /opt/pnpm/store /seed; \
    chown -R "${SMOKE_UID}:${SMOKE_GID}" /opt/pnpm /seed

COPY --chown=${SMOKE_UID}:${SMOKE_GID} package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc /seed/
COPY --chown=${SMOKE_UID}:${SMOKE_GID} artifacts/ /seed/artifacts/
COPY --chown=${SMOKE_UID}:${SMOKE_GID} lib/ /seed/lib/
COPY --chown=${SMOKE_UID}:${SMOKE_GID} scripts/ /seed/scripts/

USER ${SMOKE_UID}:${SMOKE_GID}
WORKDIR /seed
RUN mkdir -p /tmp/home /tmp/npm-cache \
    && pnpm --version \
    && pg_ctl --version \
    && pnpm fetch --frozen-lockfile --ignore-scripts

WORKDIR /workspace
