# Deployment und CI/CD

Die App läuft auf einem VPS mit Docker Compose in zwei Umgebungen: Staging und Production (siehe [ADR 0001](adr/0001-staging-und-production.md)). GitHub Actions testet jeden Pull Request, deployt `main` automatisch auf Staging und einen veröffentlichten GitHub Release auf Production.

## Umgebungen

| | Staging | Production |
| --- | --- | --- |
| Domain | `mitbringsel-dev.tinowolter.com` | `mitbringsel.tinowolter.com` |
| Auslöser | Push auf `main` (nach grüner CI) | Veröffentlichter GitHub Release `vX.Y.Z` |
| Image-Tag | Commit-SHA | Commit-SHA und Version |
| `APP_ENV` | `staging` | `production` |
| Zugriff | Authelia (Traefik-ForwardAuth), dann Google-Login | Google-Login |
| Backups | keine | täglich |

Production-Images werden nie neu gebaut: Ein Release taggt das Image, das vorher auf Staging lief, zusätzlich mit der Version ("build once, promote").

## Container

Je Umgebung ein Compose-Projekt (`mitbringsel-staging`, `mitbringsel-prod`) mit eigenem `web`, `backend` und `db`. Davor steht der auf dem VPS bereits laufende **Traefik**; er gehört nicht zu diesem Repo. `web` und `backend` hängen an Traefiks Docker-Netzwerk, das Routing steht als Labels in den Compose-Dateien:

- `Host(<domain>) && PathPrefix(/api)` → `backend` (REST und WebSocket)
- `Host(<domain>)` → `web`
- Staging zusätzlich mit der Authelia-ForwardAuth-Middleware; Manifest und Icons sind in Authelia per `bypass` ausgenommen.

Netzwerkname, Entrypoint, Cert-Resolver und Middleware-Name kommen aus der `.env`, weil sie von der Traefik-Konfiguration des Servers abhängen.

### Compose-Dateien

Im Repo unter `deploy/`:

| Datei | Inhalt |
| --- | --- |
| `docker-compose.yml` | Basis für beide Umgebungen: `web`, `backend`, `db`, Traefik-Labels, Healthchecks |
| `docker-compose.staging.yml` | Nur der Unterschied für Staging: Authelia-Middleware an beiden Routern |
| `.env.example` | Vorlage für die `.env` auf dem Server, Werte für Staging, Abweichungen für Production als Kommentar |
| `docker-compose.dev.yml` | Nur lokale Entwicklung (Postgres), kommt nie auf den Server |

Auf dem VPS liegt je Umgebung ein Ordner. Der Deploy-Workflow kopiert die Compose-Dateien aus dem deployten Commit dorthin und überschreibt sie dabei; auf dem Server wird nur die `.env` von Hand gepflegt.

```
/opt/mitbringsel/
├── staging/   docker-compose.yml, docker-compose.staging.yml, .env
└── prod/      docker-compose.yml, .env
```

`COMPOSE_PROJECT_NAME` und `COMPOSE_FILE` stehen in der `.env`, deshalb reicht in beiden Ordnern ein schlichtes `docker compose up -d --wait`.

- **Eindeutige Namen:** Traefik-Router und -Services tragen den Projektnamen (`mitbringsel-staging-api`), weil beide Umgebungen am selben Traefik hängen. Die Datenbank ist über den Alias `<projekt>-db` erreichbar statt über `db`, weil im gemeinsamen `proxy`-Netz andere Projekte ebenfalls einen `db`-Container haben können.
- **Netze:** `db` hängt nur am projekteigenen Netz `internal` (`internal: true`, also auch ohne Internetzugang). `backend` hängt an `internal` und `proxy`, `web` nur an `proxy`.
- **Härtung:** `backend` und `web` laufen mit schreibgeschütztem Dateisystem (`web` mit `tmpfs` für `/tmp`), ohne Linux-Capabilities und mit `no-new-privileges`.
- **Logs** werden rotiert (3 × 10 MB je Container).
- **Pflichtwerte** sind mit `${VAR:?…}` markiert: Fehlt einer in der `.env`, verweigert Compose den Start mit einer klaren Meldung.

| Service | Image | Aufgabe |
| --- | --- | --- |
| `web` | eigenes Multi-Stage-Image (`frontend/Dockerfile`): Node baut das Frontend, `nginx-unprivileged` liefert es als Non-Root-User aus | Liefert die statischen Frontend-Dateien aus |
| `backend` | eigenes Multi-Stage-Image (`backend/Dockerfile`): statisches Go-Binary in `distroless/static:nonroot` | REST, WebSocket, Migrationen beim Start |
| `db` | offizielles PostgreSQL-Image | Datenbank mit eigenem persistentem Volume, nicht nach außen erreichbar |

- Das Frontend wird in der CI gebaut und als statische Dateien in das `web`-Image kopiert.
- Konfiguration nur über Umgebungsvariablen und je Umgebung eine `.env` auf dem Server, die nie ins Repo kommt. Eine `.env.example` dokumentiert alle Variablen.
- Healthcheck-Endpunkt `GET /api/v1/health` für Compose und das Deployment. Das distroless-Image hat kein `curl`, deshalb prüft der Container sich mit `/server -healthcheck` selbst; der Befehl ruft den Endpunkt auf und endet mit Exit-Code 0 oder 1. Beide Images bringen ihren `HEALTHCHECK` mit, sodass `docker compose up --wait` erst bei gesunden Containern zurückkehrt.
- nginx im `web`-Image: SPA-Fallback auf `index.html` für Deep-Links, gehashte Dateien unter `/assets/` mit `Cache-Control: immutable`, alles andere mit `no-cache` (wichtig für den späteren Service Worker), gzip.
- `make docker-build` baut beide Images lokal (Tag `dev`, änderbar per `IMAGE_TAG`).
- Tägliches Backup der Production-Datenbank per `pg_dump` mit Aufbewahrung von 14 Tagen.
- Für lokale Entwicklung gibt es eine eigene `docker-compose.dev.yml` (nur Postgres) und ein `Makefile` mit `make dev`, `make test`, `make seed`, `make migrate`, `make docker-build`.

## CI/CD mit GitHub Actions

1. **Bei jedem Pull Request und Push auf `main`** (Workflow `.github/workflows/ci.yml`, auch manuell startbar): Lint (`golangci-lint`, ESLint, Prettier), Typprüfung (`vue-tsc`), Backend-Tests mit Postgres über `testcontainers-go`, Frontend-Tests, Build beider Teile. Dazu `docker compose config` für Staging und Production mit `deploy/.env.example` (Job `deploy-config`) und ein Build beider Container-Images ohne Push (Job `images`), damit kaputte Compose-Dateien oder Dockerfiles schon im PR auffallen. Feature-Branches ohne PR laufen nicht, damit ein PR nicht doppelt geprüft wird. Lokal entsprechen dem `make lint`, `make test`, `make frontend-lint`, `make frontend-test` und `make frontend-build`.
2. **Push auf `main`, CI grün:** Der Job `images` läuft erst nach den Backend- und Frontend-Jobs und pusht `ghcr.io/till-und-scholler-ai-slop/mitbringsel-backend` und `…-web`, getaggt mit dem vollen Commit-SHA (kein `latest`). Nur dieser Job hat `packages: write`; angemeldet wird mit dem automatischen `GITHUB_TOKEN`. Der Layer-Cache liegt im GitHub-Actions-Cache (je Image ein eigener Bereich), sodass unveränderte Abhängigkeiten nicht neu gebaut werden. Da das Repo privat ist, sind auch die Images privat.
3. **Deploy Staging:** Per SSH auf dem VPS im Projekt `mitbringsel-staging` `docker compose pull` und `docker compose up -d` ausführen; danach Healthcheck. Schlägt er fehl, wird auf das vorherige Image zurückgesetzt.
4. **GitHub Release veröffentlicht:** Die Images des Release-Commits zusätzlich mit der Version taggen und genauso in `mitbringsel-prod` deployen. Rollback heißt: die vorherige Version deployen.
5. **E2E-Tests** laufen zunächst nur nightly oder manuell, um die Pipeline schnell zu halten.

Secrets (SSH-Key, Google-Client-Secret je Umgebung) liegen ausschließlich in den GitHub Environments `staging` und `production` und auf dem Server.
