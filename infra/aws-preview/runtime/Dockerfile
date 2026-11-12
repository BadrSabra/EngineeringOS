ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --chown=10001:10001 server.mjs /app/server.mjs
USER 10001:10001
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
