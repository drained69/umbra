# Umbra relayer. Build from the repo root:
#   docker build -f relayer.Dockerfile -t umbra-relayer .
# Configure with environment variables, never baked into the image:
#   RELAYER_SEED  native Portaldot account (multi-asset pool + private swaps)
#   PRIVATE_KEY   EVM account (fixed pools + single-asset private pool), optional
#   NETWORK=testnet, RELAYER_CORS_ORIGIN=https://<app>, RELAYER_FEE_SHIELDED, ...
FROM node:20-alpine
WORKDIR /app
COPY sdk/package*.json sdk/
RUN cd sdk && npm ci --omit=dev
COPY relayer/package*.json relayer/
RUN cd relayer && npm ci --omit=optional
COPY sdk/src sdk/src
COPY sdk/artifacts sdk/artifacts
COPY deployments deployments
COPY relayer/index.js relayer/native.ts relayer/crossvm.js relayer/
ENV NODE_ENV=production RELAYER_PORT=8080
EXPOSE 8080
USER node
WORKDIR /app/relayer
CMD ["npx", "tsx", "index.js"]
