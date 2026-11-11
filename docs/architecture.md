# Architektur

Ein Monorepo mit `backend/` und `frontend/`, ein Go-Server für REST und WebSocket, eine PostgreSQL-Datenbank, davor der auf dem VPS bereits laufende Traefik als Reverse Proxy.

Verwandte Dokumente: [Live-Sync](sync.md), [Authentifizierung](auth.md), [Datenmodell](data-model.md), [Konventionen](conventions.md).

## Repo-Struktur

```
einkaufsliste/
├── api/openapi.yaml              # API-Vertrag, Quelle der generierten Typen
├── backend/
│   ├── cmd/server/main.go        # Einstieg, Dependency Injection von Hand
│   ├── cmd/seed/main.go          # Einstieg für `make seed`, nicht im Docker-Image
│   ├── internal/
│   │   ├── config/               # Konfiguration aus Umgebungsvariablen
│   │   ├── auth/                 # Google OIDC, Sessions (ohne HTTP)
│   │   ├── user/                 # Domäne: Nutzer
│   │   ├── group/                # Domäne: Gruppen, Mitgliedschaften, Einladungen
│   │   ├── list/                 # Domäne: Listen
│   │   ├── item/                 # Domäne: Artikel
│   │   ├── realtime/             # WebSocket-Hub, Räume pro Gruppe
│   │   ├── httpapi/              # Routing, Handler, Middleware, Fehlerformat
│   │   │   └── apigen/           # aus api/openapi.yaml generierte Typen
│   │   └── platform/db/          # pgx-Pool, sqlc-Code, Transaktionen
│   └── db/
│       ├── migrations/           # goose-Migrationen
│       ├── queries/              # SQL für sqlc
│       └── seed/                 # Dummy-Daten für Entwicklung (`make seed`)
├── frontend/
│   └── src/
│       ├── components/base/      # Wiederverwendbare Basis-Komponenten
│       ├── components/           # Fachliche Komponenten
│       ├── views/                # Seiten
│       ├── stores/               # Pinia-Stores
│       ├── composables/          # Wiederverwendbare Logik
│       ├── services/api/         # REST-Client
│       ├── services/sync/        # WebSocket, Outbox, IndexedDB
│       ├── i18n/locales/         # de.json, en.json
│       ├── styles/tokens.css     # Design-Tokens (hell/dunkel)
│       └── types/                # api.ts mit kurzen Namen, openapi.gen.ts generiert
├── deploy/                       # Compose-Dateien (dev, staging, prod)
├── .github/workflows/            # CI/CD
└── docs/                         # Dokumentation, ADRs unter docs/adr/
```

## Backend-Schichten

- **Package by Feature:** Jede Domäne (`group`, `list`, `item` …) hat ihr eigenes Package mit Modell, Service und Repository-Interface.
- **Handler → Service → Repository:** Handler übersetzen HTTP in Service-Aufrufe und zurück. Services enthalten die Geschäftslogik und Berechtigungsprüfungen. Repositories kapseln SQL.
- **Interfaces beim Konsumenten:** Der Service definiert das Repository-Interface, das er braucht (Go-Idiom, Dependency Inversion). So bleiben Services ohne Datenbank testbar.
- **Verkabelung in `main.go`:** Keine DI-Frameworks. Abhängigkeiten werden explizit per Konstruktor übergeben.
- **Fehler:** Fehler werden mit `fmt.Errorf("...: %w", err)` angereichert. Domänenfehler (`ErrNotFound`, `ErrForbidden`, `ErrConflict`) werden zentral auf HTTP-Statuscodes und ein einheitliches JSON-Fehlerformat abgebildet.
- **Context:** Jeder Request-Pfad reicht `context.Context` bis in die Datenbank durch.

## Frontend-Schichten

- **Views** setzen Seiten aus Komponenten zusammen und sprechen nur mit Stores.
- **Komponenten** bekommen Daten per Props und melden Aktionen per Events. Sie rufen nie direkt `fetch` oder den WebSocket auf.
- **Stores** halten den Zustand und rufen Services auf. Schreibende Aktionen laufen ab Phase 6 immer über den Sync-Service (siehe [Live-Sync](sync.md)); bis dahin schreiben die Stores per REST.
- **Services** kapseln REST-Client, WebSocket und IndexedDB.

## REST und WebSocket

- REST unter `/api/v1/...` für Auth, Profil, Gruppen, Einladungen, Listen und das initiale Laden von Daten.
- Der Vertrag steht in `api/openapi.yaml`. Eine API-Änderung beginnt dort, danach `make generate`; Handler und Frontend nutzen die generierten Typen (siehe [ADR 0002](adr/0002-openapi-als-api-vertrag.md)).
- WebSocket unter `/api/v1/ws`. In Phase 5 sendet der Server darüber nur Ereignisse (Artikel, Listen, Gruppen); geschrieben wird per REST. Die Nachrichtentypen stehen in `api/openapi.yaml` (siehe [ADR 0005](adr/0005-live-sync-phase-5.md)). Ab Phase 6 kommen Änderungen vom Client und das Nachsynchronisieren dazu.
- Wichtige Entscheidungen werden als kurzer ADR in [`adr/`](adr/README.md) festgehalten.
