# Build stage: compiles a static binary. Only the binary leaves this stage,
# so the Go toolchain and module cache never end up in the final image.
FROM golang:1.27 AS build

WORKDIR /src

# Copy the module files first: as long as go.mod and go.sum do not change,
# Docker reuses the cached download layer even when the code changes.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

# CGO_ENABLED=0 links no C libraries, so the binary runs without libc in the
# distroless image. -trimpath drops local paths, -s -w drop debug symbols.
# The cache mounts keep Go's module and build caches between builds on the
# same machine; they are never part of an image layer.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# Runtime stage: distroless has no shell and no package manager, only CA
# certificates and timezone data. The :nonroot tag runs as UID 65532.
FROM gcr.io/distroless/static-debian13:nonroot

COPY --from=build /out/server /server

ENV HTTP_ADDR=:8080
EXPOSE 8080

# No curl in this image, so the server binary checks itself (see healthcheck.go).
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/server", "-healthcheck"]

ENTRYPOINT ["/server"]
