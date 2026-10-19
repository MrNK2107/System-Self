# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f artifacts/api-server/Dockerfile .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /repo

FROM base AS build
# Manifests first: the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY lib/api-zod/package.json ./lib/api-zod/package.json
COPY lib/contracts/package.json ./lib/contracts/package.json
COPY lib/db/package.json ./lib/db/package.json
COPY lib/engine/package.json ./lib/engine/package.json
COPY lib/api-spec/package.json ./lib/api-spec/package.json
COPY lib/api-client-react/package.json ./lib/api-client-react/package.json
COPY scripts/package.json ./scripts/package.json
# artifacts/system-self is excluded from the context; install only what the API needs.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @workspace/api-server...
COPY tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
RUN pnpm --filter @workspace/api-server run build
# Production dependencies only (workspace libs are bundled into dist; externals like argon2 come from here).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @workspace/api-server --prod deploy --legacy /out \
    && rm -rf /out/src /out/dist /out/build.mjs /out/tsconfig.json

# Slim the base: the runtime never needs npm, corepack or yarn (deleting in the final stage would
# only add a whiteout layer, so the filesystem is flattened below).
FROM node:22-alpine AS slim
RUN apk add --no-cache tini && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg /var/cache/apk /root/.npm
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/artifacts/api-server/dist ./dist
# Source maps are dropped: the image carries only the bundles and migrations.
RUN find dist -name '*.map' -delete     && find node_modules -type d \( -name '@types' -o -name test -o -name tests \) -prune -exec rm -rf {} + 2>/dev/null; true
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

FROM scratch AS runtime
COPY --from=slim / /
ENV NODE_ENV=production PORT=3001 PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /app
USER node
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
