# 0001: Staging und Production

Status: akzeptiert, Domain und Namen von Production geändert durch [0009](0009-production-unter-tuolino-de.md)

## Kontext

Bisher war geplant, jeden Merge auf `main` direkt in Production auszurollen. Damit fehlt eine Umgebung, in der Änderungen vorher unter echten Bedingungen laufen: mit HTTPS (PWA, Service Worker und `Secure`-Cookies brauchen es), mit echten Geräten für den Live-Sync und mit Migrationen gegen eine bestehende Datenbank. Gleichzeitig soll Production nur durch eine bewusste Entscheidung aktualisiert werden.

Auf dem VPS (Ubuntu) laufen bereits andere Dienste hinter **Traefik** (Docker-Container, belegt Port 80 und 443, holt die TLS-Zertifikate) und **Authelia** (`authelia.tinowolter.com`) als Login-Portal für nicht-öffentliche Dienste.

## Entscheidung

- **Zwei Umgebungen auf dem bestehenden VPS:** `staging` unter `mitbringsel-dev.tinowolter.com` und `production` unter `mitbringsel.tinowolter.com` (*Nachtrag: jetzt `tuolino.de`, siehe [ADR 0009](0009-production-unter-tuolino-de.md)*). Beide sind getrennte Compose-Projekte (`mitbringsel-staging`, `mitbringsel-prod`, *jetzt `tuolino-prod`*) mit je eigenem `web`, `backend`, eigener Datenbank (eigenes Volume) und eigener `.env`.
- **Push auf `main` → Staging:** Nach grüner CI wird das Image gebaut, mit dem Commit-SHA getaggt, in die GitHub Container Registry gepusht und auf Staging deployt.
- **Veröffentlichter GitHub Release → Production:** Das Image des Release-Commits wird zusätzlich mit der Version (`v1.2.0`) getaggt und auf Production deployt. Production-Images werden nie neu gebaut ("build once, promote"), Production bekommt also genau das, was auf Staging lief.
- **Der bestehende Traefik ist der Reverse Proxy:** Mitbringsel bringt keinen eigenen Proxy mit. Die Compose-Dateien hängen `web` und `backend` an Traefiks Docker-Netzwerk und beschreiben das Routing über Container-Labels: `/api` (inklusive WebSocket) an `backend`, alles andere an `web`. TLS-Zertifikate kommen von Traefik.
- **Staging ist per Authelia geschützt:** Traefik fragt über eine ForwardAuth-Middleware bei Authelia nach, bevor ein Request Staging erreicht. Manifest und Icons der PWA sind per `bypass`-Regel ausgenommen, weil Browser das Manifest ohne Cookies laden. Production ist öffentlich; dort schützt nur der Google-Login der App.
- **Auth der App ist auf beiden Umgebungen gleich:** Google-Login mit eigenem OAuth-Client pro Umgebung. Staging läuft mit `APP_ENV=staging`; Dev-Login und Seed-Daten bleiben auf `development` beschränkt.
- **GitHub Environments** `staging` und `production` mit getrennten Secrets.
- **Backups** nur für Production.

Verworfene Alternativen:

- **`main` direkt nach Production (ursprünglicher Plan):** einfacher, aber jede Änderung erreicht ungetestet alle Nutzer, und Migrationen laufen zum ersten Mal gegen echte Daten.
- **Eigener Caddy als Proxy:** Auf dem VPS belegt Traefik bereits Port 80 und 443. Ein zweiter Proxy davor oder dahinter brächte nur zusätzliche Konfiguration.
- **Basic Auth für Staging:** schwächer als Authelia (kein 2FA, kein Logout, kein Brute-Force-Schutz) und unsicher im Zusammenspiel mit WebSocket und Service Worker. Authelia arbeitet mit einem Cookie, das Browser auch dort mitschicken.
- **Staging auf eigenem VPS:** stärkere Trennung, aber doppelte Kosten und Pflege, für die erwartete Last unnötig.
- **Git-Tag `v*` statt GitHub Release als Auslöser:** weniger Klicks, aber ohne Release Notes und leichter versehentlich ausgelöst.

## Konsequenzen

- Die Compose-Dateien im Repo hängen von der Traefik-Konfiguration auf dem Server ab: Name des Docker-Netzwerks, Entrypoint für HTTPS, Name des Cert-Resolvers und der Authelia-Middleware. Diese Namen werden beim Bau als Variablen in die `.env` gezogen, nicht hart codiert.
- Authelia braucht eine `access_control`-Regel für `mitbringsel-dev.tinowolter.com`. Die Session-Cookie-Domain von Authelia (`tinowolter.com`) deckt die Subdomain bereits ab.
- Auf Staging meldet man sich zweimal an: erst bei Authelia, dann per Google in der App. Authelias Cookie und das Session-Cookie der App haben verschiedene Namen und stören sich nicht.
- Der Google-Rücksprung (`/api/v1/auth/google/callback`) ist eine normale Browser-Navigation, die Authelias Cookie mitbringt. Google ruft den Server nie selbst auf; das Backend fragt Google aktiv nach dem Token.
- Das Backend steht hinter Traefik und muss `X-Forwarded-For` nur von Traefik vertrauen, sonst lässt sich die Client-IP für das Rate Limiting fälschen.
- Welcher statische Webserver im `web`-Container läuft (oder ob das Backend das Frontend selbst ausliefert), wird in Phase 8 entschieden. *Nachtrag: entschieden für `nginx-unprivileged`, siehe [Deployment](../deployment.md).*
- Releasen kann man nur Commits, die auf `main` liegen, denn nur für sie existiert ein Image. Rollback in Production heißt: das vorherige Versions-Tag deployen.
- Auf dem VPS laufen zwei PostgreSQL-Instanzen. Für die erwartete Last reicht das; wird der Speicher knapp, können beide Umgebungen einen PostgreSQL-Server mit zwei getrennten Datenbanken teilen.
- CI/CD wächst um zwei Deploy-Workflows (Staging und Production).
