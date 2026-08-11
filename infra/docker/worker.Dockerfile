# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

FROM ${NODE_IMAGE} AS pnpm-base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /workspace

FROM pnpm-base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @vicam/worker build
RUN pnpm --filter @vicam/worker deploy --prod /prod/apps/worker \
    && pnpm --filter @vicam/db deploy --prod /prod/packages/db

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
RUN rm -rf /opt/yarn-* /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /prod /workspace
RUN mkdir -p /srv/vicam/documents /srv/vicam/operations \
    && chown -R node:node /srv/vicam
USER node
EXPOSE 3001
CMD ["node", "apps/worker/dist/main.js"]
