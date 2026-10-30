# Tech-Stack

Go im Backend, Vue 3 mit TypeScript im Frontend, PostgreSQL als Datenbank. Fest gesetzt sind die Einträge mit "Ja"; die übrigen sind Vorschläge, die beim ersten Architekturgespräch bestätigt werden (siehe [Offene Entscheidungen](roadmap.md)). Es gilt jeweils die aktuelle stabile Version.

| Bereich | Technologie | Zweck | Fest |
| --- | --- | --- | --- |
| Backend-Sprache | Go | API, WebSocket-Server, Sync-Logik | Ja |
| HTTP-Routing | Standardbibliothek `net/http` (ServeMux mit Methoden-Patterns) | REST-Endpunkte ohne Framework | Vorschlag |
| Datenbank | PostgreSQL | Persistenz | Ja |
| DB-Zugriff | `pgx` + `sqlc` | Typsichere Queries aus handgeschriebenem SQL | Ja |
| Migrationen | `goose` | Versionierte SQL-Migrationen | Vorschlag |
| API-Vertrag | OpenAPI 3.0 (`api/openapi.yaml`), `oapi-codegen` (Go-Typen), `openapi-typescript` (TS-Typen) | Eine Quelle für die JSON-Formen beider Seiten ([ADR 0002](adr/0002-openapi-als-api-vertrag.md)) | Ja |
| WebSocket | `github.com/coder/websocket` | Live-Sync | Vorschlag |
| Auth | `golang.org/x/oauth2` + `github.com/coreos/go-oidc/v3` | Google Login (OIDC) mit PKCE, Prüfung des ID-Tokens | Ja |
| Logging | `log/slog` | Strukturiertes Logging | Vorschlag |
| Frontend | Vue 3, Composition API, `<script setup>` | UI | Ja |
| Sprache Frontend | TypeScript im Strict Mode | Typsicherheit | Ja |
| Build | Vite | Dev-Server und Build | Ja |
| State | Pinia | Stores für Auth, Gruppen, Listen, Sync | Ja |
| Routing | Vue Router | Seiten | Vorschlag |
| i18n | `vue-i18n` | Mehrsprachigkeit | Vorschlag |
| PWA | `vite-plugin-pwa` (Workbox) | Installierbarkeit, Offline-Caching der App | Vorschlag |
| Offline-Speicher | IndexedDB über `Dexie` | Lokale Daten und Änderungs-Warteschlange | Vorschlag |
| Tests Frontend | Vitest + Vue Test Utils, Playwright für E2E | Unit-, Komponenten-, Sync-Tests | Vorschlag |
| Tests Backend | `testing` + `testcontainers-go` | Unit- und Integrationstests gegen echtes Postgres | Vorschlag |
| Code-Stil | ESLint, Prettier, `gofmt`, `golangci-lint` | Einheitlicher Stil | Vorschlag |
| Styling | Design-Tokens als CSS Custom Properties, Scoped Styles, kein CSS-Framework | Theming hell/dunkel ([ADR 0003](adr/0003-eigenes-css-mit-tokens.md)) | Ja |
| Infrastruktur | Docker Compose, Traefik (bereits auf dem VPS), GitHub Actions | Deployment, TLS, CI/CD | Ja |

## Grundsatz für Dependencies

Standardbibliothek und wenige, verbreitete, gepflegte Pakete. Keine Paketsammlung für Dinge, die in wenigen Zeilen selbst lösbar sind.
