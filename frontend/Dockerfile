# Build stage: type-checks and bundles the app into dist/.
FROM node:24-alpine AS build

WORKDIR /src

# Install dependencies in their own layer, reused until the lockfile changes.
# The cache mount keeps npm's download cache between builds on this machine.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
RUN npm run build

# Runtime stage: nginx-unprivileged runs as a non-root user and therefore
# listens on 8080 instead of 80.
FROM nginxinc/nginx-unprivileged:1.30-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/"]
