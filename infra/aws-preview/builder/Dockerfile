ARG NODE_BASE_IMAGE
ARG PNPM_VERSION=10.26.1

FROM ${NODE_BASE_IMAGE} AS dependencies
ARG PNPM_VERSION
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY . .
RUN pnpm --filter @workspace/preview-builder deploy --prod --legacy --frozen-lockfile /bundle

FROM ${NODE_BASE_IMAGE}
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=768
ENV TMPDIR=/tmp
WORKDIR /app
COPY --from=dependencies --chown=1000:1000 /bundle ./
USER 1000:1000
ENTRYPOINT ["node", "/app/build.mjs"]
