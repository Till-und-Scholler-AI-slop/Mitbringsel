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
2. **Auth:** Google Login, Sessions, Dev-Login, `GET /api/v1/me`, Logout. Abgelaufene Sessions werden zunächst nur abgewiesen; ein periodischer Aufräum-Job (`internal/cleanup`) löscht seit Phase 5 Sessions und Einladungen, seit Phase 6 auch Tombstones von Artikeln nach 30 Tagen.
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
6. **Offline und PWA:** IndexedDB, Outbox, HLC vom Client, Wiederverbinden mit Neuladen, Service Worker, Installierbarkeit. Die Outbox schreibt per REST, der WebSocket verteilt weiter nur (siehe [ADR 0006](adr/0006-offline-phase-6.md)). Schritte, je ein PR:
    1. Entscheidungen
    2. HLC vom Client über REST (`clock` bei `createItem` und `updateItem`)
    3. Artikel eines Haushalts (`GET /groups/{groupId}/items`)
    4. Aufräum-Job für Tombstones
    5. HLC im Frontend (`services/sync/hlc.ts`, Knoten-ID pro Gerät)
    6. Lokaler Speicher (`idb`): Stores starten aus IndexedDB, Vorladen aller aktiven Listen
    7. Outbox (Warteschlange, Senden, Wiederholen, Rollback, ein sendender Tab)
    8. Artikel-Store über die Outbox
    9. „Abgehakte entfernen“ über die Outbox
    10. Wiederverbinden: Outbox senden und neu laden
    11. UI: Sync-Chip „ausstehend“, Uhr-Symbol in der Artikelzeile, Offline-Texte, Hinweise bei Aktionen nur online
    12. PWA (`vite-plugin-pwa`, Manifest, Icons)
    13. Prüfung auf Staging mit echten Geräten
7. **Design-Umsetzung:** Tokens und Komponenten nach der gewählten Claude-Design-Richtung. Kann ab Phase 3 parallel laufen, sobald das Design steht.
8. **Deployment:** Compose für Staging und Production hinter dem bestehenden Traefik, Authelia-Schutz für Staging, Backups, automatisches Deployment: `main` auf Staging, GitHub Release auf Production (siehe [ADR 0001](adr/0001-staging-und-production.md)). Vorgezogen und parallel zu Phase 2, damit jeder weitere Stand früh unter echten Bedingungen auf Staging läuft. Schritte: Container-Images, Compose mit Traefik-Labels, Images nach GHCR, Deploy auf Staging, Promote nach Production, Backups.

## Später

Push-Benachrichtigungen, Kategorien, Sortieren per Drag & Drop, Autovervollständigung aus früheren Einkäufen, Offline-Bearbeitung auch für Listen und Gruppen, weitere Sprachen, [Anlass-Listen](#ausbaustufe-anlass-listen).

## Ausbaustufe: Anlass-Listen

Nur geplant, nicht umgesetzt. Listen für Anlässe, die anders funktionieren als normale Einkaufslisten, zum Beispiel Grillabend, Geburtstag, Party, Silvester, Weihnachten, Brunch mit Gästen, Picknick, Camping, Urlaub oder Umzug. Der App-Name „Mitbringsel“ passt genau zu diesem Fall; das Feature ist daher ein guter Kandidat für eine spätere Ausbaustufe.

**Unterschiede zur normalen Einkaufsliste**

- **Zeitlich begrenzt:** Eine Anlass-Liste hat ein Datum, etwa als Badge am Listen-Chip („Sa, 21.6.“), und ist nach dem Anlass erledigt. Sie sollte dann archiviert oder ausgeblendet werden können, statt dauerhaft in der Listenleiste zu stehen.
- **Wer bringt was mit:** Bei Feiern geht es weniger ums gemeinsame Einkaufen und mehr darum, Aufgaben zu verteilen. Mitglieder sollen Einträge übernehmen können („Ich bring den Salat“).
- **Bedeutung des Avatars am Eintrag:** Bei normalen Listen zeigt er, wer den Eintrag hinzugefügt hat. Bei Anlass-Listen sollte er zeigen, wer sich darum kümmert bzw. es mitbringt. Nicht übernommene Einträge brauchen einen eigenen Zustand („noch offen, wer übernimmt?“).

**Offene Fragen** (noch nicht entschieden)

- Können auch Personen außerhalb der Gruppe (in der Oberfläche: Haushalt), etwa Partygäste, zu einer Anlass-Liste eingeladen werden, ohne der Gruppe beizutreten?
- Ist „Anlass-Liste“ ein eigener Listentyp oder eine Option (Datum und Übernehmen-Modus) für jede Liste?
- Was passiert mit der Liste nach dem Datum: automatisch archivieren, nachfragen oder manuell?
