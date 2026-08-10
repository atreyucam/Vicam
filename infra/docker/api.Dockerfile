# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

FROM ${NODE_IMAGE} AS pnpm-base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /workspace

FROM pnpm-base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @vicam/api build

FROM pnpm-base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /workspace /workspace
RUN mkdir -p /srv/vicam/documents /srv/vicam/operations \
    && chown -R node:node /srv/vicam
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
