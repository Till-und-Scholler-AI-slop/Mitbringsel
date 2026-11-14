# Offene Entscheidungen und Roadmap

## Offene Entscheidungen

Der Agent spricht sie an, sobald der betroffene Schritt ansteht, und hakt sie hier nach der Entscheidung ab.

- [x] LWW pro Feld für das erste Release (siehe [ADR 0004](adr/0004-lww-pro-feld.md))
- [x] Styling-Ansatz nach Claude Design: eigenes CSS mit Tokens, kein Tailwind (siehe [ADR 0003](adr/0003-eigenes-css-mit-tokens.md))
- [x] API-Vertrag: OpenAPI-Spezifikation (`api/openapi.yaml`), daraus generierte Typen für Go und TypeScript (siehe [ADR 0002](adr/0002-openapi-als-api-vertrag.md))
- [ ] Bestätigung der vorgeschlagenen Libraries aus dem [Tech-Stack](tech-stack.md); WebSocket: entschieden, [ADR 0005](adr/0005-live-sync-phase-5.md)
- [x] Domain und VPS: bestehender eigener VPS hinter Traefik, `mitbringsel.tinowolter.com` und `mitbringsel-dev.tinowolter.com` (siehe [ADR 0001](adr/0001-staging-und-production.md))
- [ ] Datenschutzerklärung und Impressum, da die App öffentlich nutzbar ist und personenbezogene Daten (Google-Profil) verarbeitet

## Roadmap

Jede Phase endet mit einem lauffähigen, getesteten Stand.

1. **Fundament:** Monorepo, `Makefile`, lokales Postgres per Compose, Go-Server mit Health-Endpunkt, Vue-Projekt mit Router, Pinia, i18n und Platzhalter-Tokens, CI mit Lint und Tests.
2. **Auth:** Google Login, Sessions, Dev-Login, `GET /api/v1/me`, Logout. Abgelaufene Sessions werden zunächst nur abgewiesen; ein periodischer Aufräum-Job (`internal/cleanup`) löscht seit Phase 5 Sessions und Einladungen, `processed_ops` und Tombstones folgen in Phase 6.
3. **Gruppen und Einladungen:** REST-Endpunkte, Rollen, Einladungslinks, zugehörige Views.
4. **Listen und Artikel online:** CRUD über REST, Seed-Daten, Basis-Komponenten.
5. **Live-Sync:** WebSocket-Hub, Protokoll, LWW-Merge (seit Phase 4 im Backend), Broadcast an Gruppenmitglieder. REST schreibt, der WebSocket verteilt nur Ereignisse (siehe [ADR 0005](adr/0005-live-sync-phase-5.md)). Schritte, je ein PR:
    1. Protokoll und Entscheidungen
    2. Hub ohne Netzwerk (`internal/realtime`)
    3. WS-Endpunkt (`GET /api/v1/ws`, neue Dependency `coder/websocket`, Vite-Proxy `ws: true`)
    4. Artikel-Ereignisse (`item.Publisher`, `httpapi.Broadcaster`)
    5. Listen-, Gruppen- und Mitgliedschafts-Ereignisse
    6. Frontend-WS-Client und Verbindungsstatus (`services/sync/socket.ts`, `stores/sync.ts`)
    7. Artikel-Store live (zwei Fenster zeigen Änderungen live)
    8. Listen- und Gruppen-Stores live; danach Prüfung auf Staging durch Traefik/Authelia
    9. Sync-Chip (`BaseSyncIndicator`) und Hervorhebung „gerade geändert“
    10. Aufräum-Job (Sessions, Einladungen)
    11. Abgehakte gesammelt entfernen
6. **Offline und PWA:** IndexedDB, Outbox, HLC, Wiederverbinden mit `sync`, Service Worker, Installierbarkeit.
7. **Design-Umsetzung:** Tokens und Komponenten nach der gewählten Claude-Design-Richtung. Kann ab Phase 3 parallel laufen, sobald das Design steht.
8. **Deployment:** Compose für Staging und Production hinter dem bestehenden Traefik, Authelia-Schutz für Staging, Backups, automatisches Deployment: `main` auf Staging, GitHub Release auf Production (siehe [ADR 0001](adr/0001-staging-und-production.md)). Vorgezogen und parallel zu Phase 2, damit jeder weitere Stand früh unter echten Bedingungen auf Staging läuft. Schritte: Container-Images, Compose mit Traefik-Labels, Images nach GHCR, Deploy auf Staging, Promote nach Production, Backups.

## Später

Push-Benachrichtigungen, Kategorien, Sortieren per Drag & Drop, Autovervollständigung aus früheren Einkäufen, Offline-Bearbeitung auch für Listen und Gruppen, weitere Sprachen.
