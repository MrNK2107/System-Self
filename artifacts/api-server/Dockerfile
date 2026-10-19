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
# The notices generator (dist/THIRD_PARTY_NOTICES.txt) used by build.mjs.
COPY scripts/notices.mjs ./scripts/notices.mjs
RUN pnpm --filter @workspace/api-server run build
# build.mjs bundles every pure-JS dependency into dist; only RUNTIME_EXTERNALS stay outside, and of those only the
# native @node-rs/argon2 is required (the others are optional add-ons). Install the lockfile-pinned production deps,
# then keep just argon2 and its platform binary (dereferenced out of pnpm's symlinked layout) in /rt.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @workspace/api-server --prod deploy --legacy /out \
    && mkdir -p /rt/node_modules/@node-rs \
    && cp -rL /out/node_modules/@node-rs/argon2 /rt/node_modules/@node-rs/argon2 \
    && for d in /out/node_modules/.pnpm/@node-rs+argon2-linux-*/node_modules/@node-rs/argon2-linux-*; do cp -rL "$d" /rt/node_modules/@node-rs/; done \
    && ls /rt/node_modules/@node-rs/argon2-linux-* >/dev/null \
    && node -e "const v=require('/rt/node_modules/@node-rs/argon2/package.json').version;require('fs').writeFileSync('/rt/package.json',JSON.stringify({name:'system-self-api',private:true,dependencies:{'@node-rs/argon2':v}},null,2))"

# Slim the base: the runtime never needs npm, corepack or yarn (deleting in the final stage would
# only add a whiteout layer, so the filesystem is flattened below).
FROM node:22-alpine AS slim
RUN apk add --no-cache tini && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg /var/cache/apk /root/.npm \
    /usr/local/include /usr/local/share/doc /usr/local/share/man /usr/local/CHANGELOG.md /usr/local/README.md
WORKDIR /app
COPY --from=build --chown=node:node /rt/node_modules ./node_modules
COPY --from=build --chown=node:node /rt/package.json ./package.json
COPY --from=build --chown=node:node /repo/artifacts/api-server/dist ./dist
# Source maps are dropped: the image carries only the bundles, migrations and the licence notices: the full
# dist/THIRD_PARTY_NOTICES.txt (every shipped package with its licence text, from build.mjs) and dist/*.LEGAL.txt
# (esbuild legalComments). The build fails if any of them is missing or the notices file is empty.
RUN find dist -name '*.map' -delete \
    && ls dist/index.mjs.LEGAL.txt dist/worker.mjs.LEGAL.txt >/dev/null \
    && test -s dist/THIRD_PARTY_NOTICES.txt \
    && grep -q '^@node-rs/argon2@' dist/THIRD_PARTY_NOTICES.txt
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

FROM scratch AS runtime
COPY --from=slim / /
ENV NODE_ENV=production PORT=3001 PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /app
USER node
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
