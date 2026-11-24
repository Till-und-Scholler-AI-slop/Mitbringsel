# 0009: Production unter `tuolino.de`

Status: akzeptiert

## Kontext

[ADR 0001](0001-staging-und-production.md) legt zwei Umgebungen auf dem VPS fest und nennt für Production `mitbringsel.tinowolter.com` mit dem Compose-Projekt `mitbringsel-prod`. Inzwischen heißt die App **Tuolino** (#196), und die Domain `tuolino.de` ist registriert (Zugriff steht noch aus, Stand 2026-11-24). Production ist noch nie gelaufen; es gibt also nichts umzuziehen.

Die internen Namen (IndexedDB- und `localStorage`-Schlüssel, Datenbank, Images, Repo, Staging-Domain) heißen noch `mitbringsel`. Sie umzubenennen ist ein eigener Schritt (#195).

## Entscheidung

- **Production läuft unter `tuolino.de`**, nicht unter `mitbringsel.tinowolter.com`. `www.tuolino.de` leitet dauerhaft (301) auf `tuolino.de` um, mit Pfad und Query: Viele tippen `www.` aus Gewohnheit und sähen sonst eine Zertifikatswarnung. Die App selbst, der Google-Login und die Cookies gibt es nur unter `tuolino.de`.
- **Production nutzt von Anfang an die neuen Namen:** Compose-Projekt `tuolino-prod`, Ordner `/opt/personal-projects/slop/tuolino/prod`, PostgreSQL-User und -Datenbank `tuolino`. Später umbenennen hieße, die Datenbank im laufenden Betrieb umzuziehen.
- **Staging bleibt vorerst bei den alten Namen:** `mitbringsel-dev.tinowolter.com`, Compose-Projekt `mitbringsel-staging`, Ordner `/opt/personal-projects/slop/mitbringsel/staging`. Die Umbenennung folgt mit #195.
- **Die Images bleiben `mitbringsel-backend` und `mitbringsel-web`.** Staging und Production nutzen dieselben Images ("build once, promote"); ein Release taggt nur um. Umbenennen gehört zu #195.
- **Start nur für Google-Testnutzer:** Die OAuth-App bleibt im Testmodus. Vor dem öffentlichen Start kommen Datenschutzerklärung und Impressum (#97) und die Veröffentlichung der OAuth-App (#98).

Alles andere aus ADR 0001 gilt unverändert: Release auf GitHub → Production, eigener OAuth-Client und eigene Datenbank pro Umgebung, Backups nur für Production.

Verworfene Alternativen:

- **Bei `mitbringsel.tinowolter.com` bleiben:** passt nicht mehr zum Namen der App, und ein späterer Domainwechsel trifft dann schon echte Nutzer (Sessions, installierte PWAs, OAuth-Client).
- **Production mit den alten Namen starten und mit #195 umbenennen:** spart jetzt nichts, macht aber später einen Umzug von Datenbank und Volume nötig.
- **Erst alles umbenennen (#195), dann Production:** blockiert Production durch einen großen Umbau, der für den Betrieb nichts ändert.

## Konsequenzen

- Bis #195 tragen die beiden Umgebungen unterschiedliche Namen (`mitbringsel-staging`, `tuolino-prod`). Die Compose-Dateien hängen davon nicht ab, weil Projektname, Domain und Datenbank aus der `.env` kommen.
- Traefik-Router heißen nach dem Projekt (`tuolino-prod-api`) und kollidieren nicht mit Staging.
- Die PWA unter `tuolino.de` ist eine andere Origin als Staging: eigene Installation, eigene IndexedDB, eigenes Session-Cookie.
- `tuolino.de` liegt nicht unter `tinowolter.com` und damit außerhalb von Authelias Cookie-Domain. Production braucht Authelia nicht (ADR 0001), daher ohne Folgen.
- DNS (`A`/`AAAA` auf den VPS) und der erste Release warten auf den Zugriff auf die Domain (#200).
