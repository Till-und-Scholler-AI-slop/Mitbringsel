COMPOSE := docker compose -f deploy/docker-compose.dev.yml

# A local .env overrides the defaults below (see .env.example).
-include .env
export

APP_ENV      ?= development
DATABASE_URL ?= postgres://mitbringsel:mitbringsel@localhost:5432/mitbringsel?sslmode=disable
HTTP_ADDR    ?= 127.0.0.1:8080
IMAGE_TAG    ?= dev

.PHONY: db-up db-down dev migrate seed test test-short lint generate \
	frontend-install frontend-dev frontend-test frontend-lint frontend-build \
	docker-build

## db-up: start the local PostgreSQL and wait until it accepts connections
db-up:
	$(COMPOSE) up -d --wait

## db-down: stop the local PostgreSQL (data is kept in a volume)
db-down:
	$(COMPOSE) down

## dev: start PostgreSQL and run the server
dev: db-up
	cd backend && go run ./cmd/server

## migrate: apply database migrations and exit
migrate: db-up
	cd backend && go run ./cmd/server -migrate-only

## seed: fill the local database with dummy data (replaces earlier seed data, development only)
seed: db-up
	cd backend && go run ./cmd/seed

## test: run all backend tests (integration tests need Docker)
test:
	cd backend && go test -race ./...

## test-short: run backend tests without integration tests
test-short:
	cd backend && go test -short -race ./...

## lint: run golangci-lint on the backend (same linters as CI)
lint:
	cd backend && golangci-lint run ./...

## generate: regenerate sqlc code and the API types from api/openapi.yaml (commit the result)
generate:
	cd backend && go tool sqlc generate
	cd backend && go tool oapi-codegen -config oapi-codegen.yaml ../api/openapi.yaml
	cd frontend && npm run generate:api

# The frontend targets need the Node version from frontend/.nvmrc.

## frontend-install: install frontend dependencies exactly as locked
frontend-install:
	cd frontend && npm ci

## frontend-dev: run the Vite dev server (proxies /api to the Go server on 8080)
frontend-dev:
	cd frontend && npm run dev

## frontend-test: run frontend unit and component tests
frontend-test:
	cd frontend && npm test

## frontend-lint: lint, type-check and check formatting
frontend-lint:
	cd frontend && npm run lint && npm run type-check && npm run format:check

## frontend-build: type-check and build the production bundle into frontend/dist
frontend-build:
	cd frontend && npm run build

## docker-build: build the backend and web container images (tag: IMAGE_TAG, default dev)
docker-build:
	docker build -t tuolino-backend:$(IMAGE_TAG) backend
	docker build -t tuolino-web:$(IMAGE_TAG) frontend
