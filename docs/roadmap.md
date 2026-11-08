# Offene Entscheidungen und Roadmap

## Offene Entscheidungen

Claude spricht sie an, sobald der betroffene Schritt ansteht, und hakt sie hier nach der Entscheidung ab.

- [x] LWW pro Feld für das erste Release (siehe [ADR 0004](adr/0004-lww-pro-feld.md))
- [x] Styling-Ansatz nach Claude Design: eigenes CSS mit Tokens, kein Tailwind (siehe [ADR 0003](adr/0003-eigenes-css-mit-tokens.md))
- [x] API-Vertrag: OpenAPI-Spezifikation (`api/openapi.yaml`), daraus generierte Typen für Go und TypeScript (siehe [ADR 0002](adr/0002-openapi-als-api-vertrag.md))
- [ ] Bestätigung der vorgeschlagenen Libraries aus dem [Tech-Stack](tech-stack.md)
- [x] Domain und VPS: bestehender eigener VPS hinter Traefik, `mitbringsel.tinowolter.com` und `mitbringsel-dev.tinowolter.com` (siehe [ADR 0001](adr/0001-staging-und-production.md))
- [ ] Datenschutzerklärung und Impressum, da die App öffentlich nutzbar ist und personenbezogene Daten (Google-Profil) verarbeitet

## Roadmap

Jede Phase endet mit einem lauffähigen, getesteten Stand.

1. **Fundament:** Monorepo, `Makefile`, lokales Postgres per Compose, Go-Server mit Health-Endpunkt, Vue-Projekt mit Router, Pinia, i18n und Platzhalter-Tokens, CI mit Lint und Tests.
2. **Auth:** Google Login, Sessions, Dev-Login, `GET /api/v1/me`, Logout. Abgelaufene Sessions werden zunächst nur abgewiesen; ein periodischer Aufräum-Job folgt, spätestens zusammen mit dem für `processed_ops` in Phase 5.
3. **Gruppen und Einladungen:** REST-Endpunkte, Rollen, Einladungslinks, zugehörige Views.
4. **Listen und Artikel online:** CRUD über REST, Seed-Daten, Basis-Komponenten.
5. **Live-Sync:** WebSocket-Hub, Protokoll, LWW-Merge, Broadcast an Gruppenmitglieder.
6. **Offline und PWA:** IndexedDB, Outbox, HLC, Wiederverbinden mit `sync`, Service Worker, Installierbarkeit.
7. **Design-Umsetzung:** Tokens und Komponenten nach der gewählten Claude-Design-Richtung. Kann ab Phase 3 parallel laufen, sobald das Design steht.
8. **Deployment:** Compose für Staging und Production hinter dem bestehenden Traefik, Authelia-Schutz für Staging, Backups, automatisches Deployment: `main` auf Staging, GitHub Release auf Production (siehe [ADR 0001](adr/0001-staging-und-production.md)). Vorgezogen und parallel zu Phase 2, damit jeder weitere Stand früh unter echten Bedingungen auf Staging läuft. Schritte: Container-Images, Compose mit Traefik-Labels, Images nach GHCR, Deploy auf Staging, Promote nach Production, Backups.

## Später

Push-Benachrichtigungen, Kategorien, Sortieren per Drag & Drop, Autovervollständigung aus früheren Einkäufen, Offline-Bearbeitung auch für Listen und Gruppen, weitere Sprachen.
