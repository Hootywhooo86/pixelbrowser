# Bit Browser sync server. Stores encrypted blobs it cannot read; no dependencies.
#   docker build -t bit-sync packages/sync-server
#   docker run -p 8787:8787 -v bit-sync-data:/data bit-sync
FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY src ./src
# Run as the image's unprivileged "node" user; /data is where the blobs live.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "src/cli.js"]
