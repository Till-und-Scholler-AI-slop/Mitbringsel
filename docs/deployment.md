# Deployment und CI/CD

Die App läuft auf einem VPS mit Docker Compose in zwei Umgebungen: Staging und Production (siehe [ADR 0001](adr/0001-staging-und-production.md) und [ADR 0009](adr/0009-production-unter-tuolino-de.md)). GitHub Actions testet jeden Pull Request, deployt `main` automatisch auf Staging und einen veröffentlichten GitHub Release auf Production.

## Umgebungen

| | Staging | Production |
| --- | --- | --- |
| Domain | `mitbringsel-dev.tinowolter.com` | `tuolino.de` (ohne `www`) |
| Compose-Projekt | `mitbringsel-staging` | `tuolino-prod` |
| Datenbank (User und Name) | `mitbringsel` | `tuolino` |
| Auslöser | Push auf `main` (nach grüner CI) | Veröffentlichter GitHub Release `vX.Y.Z` |
| Image-Tag | Commit-SHA | Commit-SHA und Version (deployt wird per SHA) |
| `APP_ENV` (fest in den Compose-Dateien, nicht in der `.env`) | `staging` | `production` |
| Zugriff | Authelia (Traefik-ForwardAuth), dann Google-Login | Google-Login, vorerst nur für die Testnutzer der OAuth-App |
| Backups | keine | täglich um 03:00 UTC, 14 Tage (siehe [Backups](#backups)) |

Production-Images werden nie neu gebaut: Ein Release taggt das Image, das vorher auf Staging lief, zusätzlich mit der Version ("build once, promote"). Deshalb heißen die Images in beiden Umgebungen `mitbringsel-backend` und `mitbringsel-web`; Staging und die Images bekommen den neuen Namen erst mit [#195](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/195).

## Container

Je Umgebung ein Compose-Projekt (`mitbringsel-staging`, `tuolino-prod`) mit eigenem `web`, `backend` und `db`. Davor steht der auf dem VPS bereits laufende **Traefik**; er gehört nicht zu diesem Repo. `web` und `backend` hängen an Traefiks Docker-Netzwerk, das Routing steht als Labels in den Compose-Dateien:

- `Host(<domain>) && PathPrefix(/api)` → `backend` (REST und WebSocket)
- `Host(<domain>)` → `web`
- Staging zusätzlich mit der Authelia-ForwardAuth-Middleware; Manifest und Icons sind in Authelia per `bypass` ausgenommen.

Netzwerkname, Entrypoint, Cert-Resolver und Middleware-Name kommen aus der `.env`, weil sie von der Traefik-Konfiguration des Servers abhängen.

Der WebSocket (`/api/v1/ws`) braucht keine eigenen Labels: Traefik reicht den Upgrade am `/api`-Router durch. Das Timeout des Entrypoints (`respondingTimeouts.readTimeout`, bei Traefik v3 standardmäßig 60 Sekunden) kappt den WebSocket nicht: Auf Staging geprüft (November 2026), eine Verbindung bleibt mit den `ping`-Nachrichten über 3 Minuten offen. Im Backend darf eine Middleware, die den `ResponseWriter` umhüllt, den Upgrade nicht verbauen: Ein solcher Wrapper muss `Unwrap()` (oder `Hijack`) anbieten, sonst scheitert der Upgrade mit `501`.

### Compose-Dateien

Im Repo unter `deploy/`:

| Datei | Inhalt |
| --- | --- |
| `docker-compose.yml` | Basis für beide Umgebungen: `web`, `backend`, `db`, Traefik-Labels, Healthchecks |
| `docker-compose.staging.yml` | Nur der Unterschied für Staging: Authelia-Middleware an beiden Routern |
| `docker-compose.production.yml` | Nur der Unterschied für Production: Service `backup` (siehe [Backups](#backups)) |
| `.env.example` | Vorlage für die `.env` auf dem Server, Werte für Staging, Abweichungen für Production als Kommentar |
| `deploy.sh` | Läuft beim Deployment auf dem Server: Dateien installieren, Images ziehen, starten, bei Fehler zurückrollen |
| `docker-compose.dev.yml` | Nur lokale Entwicklung (Postgres), kommt nie auf den Server |

Auf dem VPS liegt je Umgebung ein Ordner (der Pfad steht als `DEPLOY_DIR` im GitHub Environment). Der Deploy-Workflow kopiert die Compose-Dateien aus dem deployten Commit dorthin und überschreibt sie dabei; auf dem Server wird nur die `.env` von Hand gepflegt.

```
/opt/personal-projects/slop/
├── mitbringsel/staging/   docker-compose.yml, docker-compose.staging.yml, .env, previous/
└── tuolino/prod/          docker-compose.yml, docker-compose.production.yml, .env, previous/, backups/
```

`previous/` hält die Compose-Dateien des vorherigen Deployments für den automatischen Rollback.

`COMPOSE_PROJECT_NAME` und `COMPOSE_FILE` stehen in der `.env`, deshalb reicht in beiden Ordnern ein schlichtes `docker compose up -d --wait`.

- **Eindeutige Namen:** Traefik-Router und -Services tragen den Projektnamen (`mitbringsel-staging-api`, `tuolino-prod-api`), weil beide Umgebungen am selben Traefik hängen. Die Datenbank ist über den Alias `<projekt>-db` erreichbar statt über `db`, weil im gemeinsamen `proxy`-Netz andere Projekte ebenfalls einen `db`-Container haben können.
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
- Tägliches Backup der Production-Datenbank per `pg_dump` mit Aufbewahrung von 14 Tagen (siehe [Backups](#backups)).
- Für lokale Entwicklung gibt es eine eigene `docker-compose.dev.yml` (nur Postgres) und ein `Makefile` mit `make dev`, `make test`, `make seed`, `make migrate`, `make docker-build`. Der Seed-Befehl (`backend/cmd/seed`) ist nicht im Backend-Image, weil das Dockerfile nur `./cmd/server` baut; auf Staging und Production lässt er sich damit nicht starten.

## CI/CD mit GitHub Actions

1. **Bei jedem Pull Request und Push auf `main`** (Workflow `.github/workflows/ci.yml`, auch manuell startbar): Lint (`golangci-lint`, ESLint, Prettier), Typprüfung (`vue-tsc`), Backend-Tests mit Postgres über `testcontainers-go`, Frontend-Tests, Build beider Teile. Dazu `docker compose config` für Staging und Production mit `deploy/.env.example` (Job `deploy-config`) und ein Build beider Container-Images ohne Push (Job `images`), damit kaputte Compose-Dateien oder Dockerfiles schon im PR auffallen. Feature-Branches ohne PR laufen nicht, damit ein PR nicht doppelt geprüft wird. Lokal entsprechen dem `make lint`, `make test`, `make frontend-lint`, `make frontend-test` und `make frontend-build`.
2. **Push auf `main`, CI grün:** Der Job `images` läuft erst nach den Backend- und Frontend-Jobs und pusht `ghcr.io/till-und-scholler-ai-slop/mitbringsel-backend` und `…-web`, getaggt mit dem vollen Commit-SHA (kein `latest`). Nur dieser Job hat `packages: write`; angemeldet wird mit dem automatischen `GITHUB_TOKEN`. Der Layer-Cache liegt im GitHub-Actions-Cache (je Image ein eigener Bereich), sodass unveränderte Abhängigkeiten nicht neu gebaut werden. Die Images sind privat, obwohl das Repo öffentlich ist: Ihre Sichtbarkeit wird in den Package-Settings von GHCR festgelegt, nicht vom Repo übernommen.
3. **Deploy Staging:** Der Job `deploy-staging` läuft nach `images` und `deploy-config` und ruft den wiederverwendbaren Workflow `.github/workflows/deploy.yml` auf (siehe [Deployment-Ablauf](#deployment-ablauf)). Läufe auf `main` werden nicht abgebrochen, damit kein Deployment mittendrin stoppt; bei PRs bricht ein neuer Push den alten Lauf weiterhin ab.
4. **GitHub Release veröffentlicht** (Workflow `.github/workflows/release.yml`): Der Job `promote` prüft, dass der Tag die Form `vX.Y.Z` hat, zu einem veröffentlichten Release gehört (kein Entwurf, kein Pre-Release) und sein Commit auf `main` liegt; nur dafür gibt es Images. Dann bekommen beide Images zusätzlich den Versions-Tag, per `docker buildx imagetools create`: Das schreibt nur einen weiteren Tag auf das vorhandene Image in GHCR, gebaut wird nichts. Nur dieser Job hat `packages: write`. Danach ruft `deploy-production` den Workflow `deploy.yml` mit `production` und dem Commit-SHA auf, also mit genau dem Image, das auf Staging lief. Releases laufen nacheinander, keiner wird mittendrin abgebrochen.
5. **E2E-Tests** laufen zunächst nur nightly oder manuell, um die Pipeline schnell zu halten.

**KI-Review** (Workflow `.github/workflows/claude-review.yml`): Claude Code prüft einen PR, sobald er geöffnet oder als fertig markiert wird, und kommentiert Funde inline auf Deutsch, mit einer Zusammenfassung am Ende. Ein erneutes Review fordert man mit dem Label `claude-review` an; der Workflow entfernt es danach wieder. Übersprungen werden Drafts, PRs aus Forks und PRs, die nur `docs/` ändern (außer per Label). Das Review ist nur beratend, kein Pflicht-Check. Es läuft mit Sonnet über das Claude-Pro-Abo eines Maintainers (Repo-Secret `CLAUDE_CODE_OAUTH_TOKEN`, erzeugt mit `claude setup-token`) und verbraucht dessen Kontingent; deshalb nicht bei jedem Push. Die Kommentare schreibt die Claude-GitHub-App, die für die Organisation installiert sein muss. Was geprüft wird, steht im Prompt des Workflows: Korrektheit, Sicherheit, Sync-Reihenfolgen und Abweichungen von `AGENTS.md` und `docs/`, nicht was die CI schon prüft.

**Schutz von `main`** (Ruleset `protection`, eine Einstellung auf GitHub, keine Datei im Repo): Änderungen kommen nur per PR mit Squash-Merge auf `main`, Force-Push und Löschen sind gesperrt. Pflicht-Checks sind die CI-Jobs `Backend`, `Frontend`, `Deploy config`, `Image (backend)` und `Image (web)`, und zwar von GitHub Actions; der Branch muss dafür nicht auf dem neuesten Stand von `main` sein. Approves sind auf 0 gestellt, weil derzeit nur eine Person am Projekt entwickelt und sich selbst nicht approven kann; arbeitet eine zweite Person mit, wieder auf 1 stellen. Umgehen dürfen die Regeln nur Admins (Bypass), etwa im Notfall. Wird ein CI-Job umbenannt, muss das Ruleset mitgeändert werden, sonst wartet jeder PR auf einen Check, den es nicht mehr gibt.

Secrets liegen ausschließlich in den GitHub Environments `staging` und `production` (SSH-Key), im Repo-Secret `CLAUDE_CODE_OAUTH_TOKEN` (KI-Review) und in der `.env` auf dem Server (Datenbank-Passwort, Google-Client-ID und -Secret je Umgebung, siehe [Authentifizierung](auth.md#einrichtung)).

## Deployment-Ablauf

`.github/workflows/deploy.yml` bekommt Umgebung und Image-Tag (voller Commit-SHA) und läuft im gleichnamigen GitHub Environment:

1. Eingaben prüfen: Tag muss ein voller SHA sein, `DEPLOY_DIR` ein gültiger Pfad.
2. Checkout genau dieses Commits, damit Compose-Dateien und `deploy.sh` zu den Images passen.
3. SSH einrichten: Host, privater Key und gepinnter Host-Key aus den Secrets, `StrictHostKeyChecking yes`. Keine fremden SSH-Actions.
4. `docker-compose.yml`, die Override-Datei der Umgebung (falls vorhanden) und `deploy.sh` per `scp` nach `<DEPLOY_DIR>/incoming/`.
5. Per `ssh` `deploy.sh <tag>` ausführen. Das `GITHUB_TOKEN` des Jobs (nur `packages: read`, läuft mit dem Job ab) geht per stdin mit.

`deploy.sh` auf dem Server:

- meldet sich mit einer temporären Docker-Konfiguration bei GHCR an, sodass kein Token liegen bleibt und Logins anderer Projekte desselben Users unberührt bleiben,
- sichert die aktiven Compose-Dateien nach `previous/` und merkt sich das bisherige `IMAGE_TAG`,
- installiert die neuen Dateien, setzt `IMAGE_TAG` in der `.env`, zieht nur `backend` und `web` (PostgreSQL wird bewusst nicht bei jedem Deployment aktualisiert, weil das die Datenbank neu startet),
- startet mit `docker compose up --wait` und wartet bis zu 120 Sekunden auf gesunde Container,
- stellt bei einem Fehler Compose-Dateien und Tag wieder her, startet den alten Stand und beendet sich mit Fehler (der Job wird rot); die letzten Log-Zeilen von `backend` und `web` stehen im Job-Log,
- entfernt nach Erfolg alle Mitbringsel-Images, die kein Container mehr nutzt (Filter auf das Label `org.opencontainers.image.source`; Images anderer Projekte bleiben unberührt).

**Migrationen werden nicht zurückgerollt.** Nach einem fehlgeschlagenen Deployment läuft das alte Backend gegen das bereits migrierte Schema. Migrationen müssen deshalb abwärtskompatibel sein (siehe [Konventionen](conventions.md)).

**Staging manuell deployen oder zurückrollen:** Im Tab *Actions* den Workflow *Deploy* starten, Umgebung `staging` wählen und den vollen SHA eines Commits auf `main` angeben. Die Images aller Commits auf `main` liegen in GHCR.

**Production zurückrollen:** Im Tab *Actions* den Workflow *Release* starten und unter *Use workflow from* den Tag der gewünschten Version wählen (z.B. `v0.1.0`), nicht `main`. Version und Commit kommen aus dem Tag, eine Eingabe gibt es nicht. Das geht für jede Version, deren Tag `release.yml` schon enthält. Der Workflow *Deploy* mit `production` funktioniert auch, aber nur von einem Tag `v*` aus (Regel des Environments) und mit dem SHA von Hand.

## Backups

Nur Production. Der Service `backup` in `docker-compose.production.yml` nutzt dasselbe Image `postgres:18` wie `db`: `pg_dump` passt so immer zur Server-Version und bekommt dieselben Updates, ein fremdes Backup-Image ist nicht nötig. Ein kurzes Shell-Skript in der Compose-Datei wartet bis 03:00 UTC, schreibt den Dump und löscht Dumps, die 14 Tage oder älter sind.

- **Wo:** `BACKUP_DIR` aus der `.env`, standardmäßig `backups/` im Ordner der Umgebung, also `/opt/personal-projects/slop/tuolino/prod/backups/`. Ein Ordner auf dem Host statt eines Volumes, damit die Dumps `docker compose down -v` überstehen und sich einfach vom Server kopieren lassen.
- **Datei:** `<datenbank>-<UTC-Zeit>.dump` im Custom-Format von `pg_dump` (komprimiert, Wiederherstellung mit `pg_restore`). Geschrieben wird erst in eine `.tmp`-Datei, ein abgebrochener Lauf sieht also nie wie ein gültiger Dump aus.
- **Rechte:** Der Container läuft als `BACKUP_USER` (UID:GID von `deploy`), die Dumps gehören also `deploy`. Er hängt nur am Netz `internal` und läuft wie die anderen Services schreibgeschützt (außer `/backups`), ohne Capabilities und mit `no-new-privileges`.
- **Fehler** stehen im Log (`docker compose logs backup`); der nächste Versuch folgt einen Tag später. Eine Warnung, wenn ein Backup ausbleibt, gibt es noch nicht ([#204](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/204)).
- **Nur auf dem VPS:** Geht der Server verloren, sind die Dumps mit weg. Eine Kopie außerhalb fehlt noch ([#203](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/203)).

**Dump von Hand**, z.B. vor einer riskanten Migration (im Ordner der Umgebung):

```bash
docker compose run --rm backup now
```

**Wiederherstellen** (lokal ausprobiert, November 2026: Dump, `down -v`, Restore in die leere Datenbank, und Restore über bestehende Daten):

```bash
cd /opt/personal-projects/slop/tuolino/prod
docker compose stop backend        # keine Schreibzugriffe während des Restores
docker compose exec -T db sh -c 'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/tuolino-<zeit>.dump
docker compose start backend
```

`--clean --if-exists` löscht vorher alle Objekte, die im Dump vorkommen, und legt sie neu an; Daten, die nach dem Dump geschrieben wurden, sind danach weg. Nach einem kompletten Verlust der Datenbank (`down -v` oder neuer Server) zuerst nur `db` starten (`docker compose up -d --wait db`), dann wie oben zurückspielen und erst danach alles starten. Das Backend wendet beim Start nur Migrationen an, die im Dump noch fehlen.

## Einrichtung

Einmalig je Umgebung, hier am Beispiel Staging; die Unterschiede für Production stehen [darunter](#production).

**Auf dem Server** (User `deploy`, Mitglied der Gruppe `docker`; Docker Compose als System-Plugin, z.B. Paket `docker-compose-plugin`):

```bash
# Ordner anlegen und .env aus der Vorlage im Repo erstellen
sudo mkdir -p /opt/personal-projects/slop/mitbringsel/staging
sudo chown -R deploy: /opt/personal-projects/slop/mitbringsel
# deploy/.env.example als .env dorthin kopieren und anpassen,
# Passwort z.B. mit: openssl rand -hex 32
chmod 600 /opt/personal-projects/slop/mitbringsel/staging/.env
```

Mitglied der Gruppe `docker` zu sein ist praktisch Root-Zugriff. Der SSH-Key für GitHub ist deshalb so wertvoll wie ein Root-Zugang.

**SSH-Key nur für GitHub** (lokal erzeugen, nicht wiederverwenden):

```bash
ssh-keygen -t ed25519 -N '' -C github-actions-mitbringsel -f mitbringsel-deploy
# Inhalt von mitbringsel-deploy.pub auf dem Server an ~deploy/.ssh/authorized_keys anhängen
ssh-keyscan -p <port> <host>   # Ausgabe ist SSH_KNOWN_HOSTS
```

Danach die lokale Datei `mitbringsel-deploy` löschen, sobald sie in GitHub hinterlegt ist.

**GitHub Environment** `staging` (*Settings → Environments*):

| Art | Name | Inhalt |
| --- | --- | --- |
| Secret | `SSH_PRIVATE_KEY` | Inhalt von `mitbringsel-deploy` |
| Secret | `SSH_KNOWN_HOSTS` | Ausgabe von `ssh-keyscan` |
| Secret | `SSH_HOST` | Hostname oder IP des VPS |
| Secret | `SSH_PORT` | nur nötig, wenn nicht 22 |
| Variable | `SSH_USER` | `deploy` |
| Variable | `DEPLOY_DIR` | `/opt/personal-projects/slop/mitbringsel/staging` |
| Variable | `APP_URL` | optional, z.B. `https://mitbringsel-dev.tinowolter.com` |

`SSH_HOST` und `SSH_PORT` sind nicht wirklich geheim, liegen aber trotzdem als Secret: Das Repo ist öffentlich und damit auch die Actions-Logs, und GitHub schwärzt dort nur Secrets, Variablen erscheinen im Klartext.

Unter *Deployment branches and tags* nur `main` erlauben, damit kein anderer Branch an die Secrets kommt.

**Authelia:** eine `access_control`-Regel für `mitbringsel-dev.tinowolter.com` (siehe [ADR 0001](adr/0001-staging-und-production.md)).

### Production

Wie Staging, mit diesen Unterschieden (Checkliste: [#200](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/200)):

- **Server:** Ordner `/opt/personal-projects/slop/tuolino/prod` (Owner `deploy`), `.env` aus `deploy/.env.example` mit den Production-Werten aus den Kommentaren (`tuolino-prod`, `tuolino.de`, Datenbank `tuolino`, `COMPOSE_FILE` mit `docker-compose.production.yml`, `BACKUP_USER`) und einem eigenen Passwort, `chmod 600`. Den Ordner für die Dumps vorher als `deploy` anlegen (`mkdir backups`); sonst legt Docker ihn als root an, und der Backup-Container darf nicht hineinschreiben. Der SSH-Key und der Server-User können dieselben sein wie bei Staging.
- **Google:** eigener OAuth-Client für Production mit der Redirect-URI `https://tuolino.de/api/v1/auth/google/callback`. Solange die OAuth-App im Testmodus ist, können sich nur die dort eingetragenen Testnutzer anmelden. Vor dem öffentlichen Start: Datenschutzerklärung und Impressum ([#97](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/97)), dann die App veröffentlichen ([#98](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/98)).
- **GitHub Environment** `production` mit denselben Secrets und Variablen wie Staging; `DEPLOY_DIR` ist `/opt/personal-projects/slop/tuolino/prod`, `APP_URL` `https://tuolino.de`. Unter *Deployment branches and tags* nur Tags `v*` erlauben, nicht `main`.
- **DNS:** `A`- und `AAAA`-Eintrag von `tuolino.de` auf den VPS. Das TLS-Zertifikat holt Traefik beim ersten Request. `www.tuolino.de` gibt es vorerst nicht.
- **Authelia:** keine Regel nötig, Production ist öffentlich.
