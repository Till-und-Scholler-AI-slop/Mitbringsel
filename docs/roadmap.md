# Offene Entscheidungen und Roadmap

## Offene Entscheidungen

Der Agent spricht sie an, sobald der betroffene Schritt ansteht, und hakt sie hier nach der Entscheidung ab.

- [x] LWW pro Feld für das erste Release (siehe [ADR 0004](adr/0004-lww-pro-feld.md))
- [x] Styling-Ansatz nach Claude Design: eigenes CSS mit Tokens, kein Tailwind (siehe [ADR 0003](adr/0003-eigenes-css-mit-tokens.md))
- [x] API-Vertrag: OpenAPI-Spezifikation (`api/openapi.yaml`), daraus generierte Typen für Go und TypeScript (siehe [ADR 0002](adr/0002-openapi-als-api-vertrag.md))
- [ ] Bestätigung der vorgeschlagenen Libraries aus dem [Tech-Stack](tech-stack.md); WebSocket: entschieden, [ADR 0005](adr/0005-live-sync-phase-5.md)
- [x] Domain und VPS: bestehender eigener VPS hinter Traefik, Production unter `tuolino.de`, Staging unter `mitbringsel-dev.tinowolter.com` (siehe [ADR 0001](adr/0001-staging-und-production.md) und [ADR 0009](adr/0009-production-unter-tuolino-de.md))
- [x] Große Bildschirme: Breakpoints, Aktivität auf dem Server, Verschieben per `listId` (siehe [ADR 0008](adr/0008-grosse-bildschirme.md))
- [ ] Datenschutzerklärung und Impressum, da die App öffentlich nutzbar ist und personenbezogene Daten (Google-Profil) verarbeitet ([#97](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/97))

## Roadmap

Jede Phase endet mit einem lauffähigen, getesteten Stand. Offene Schritte haben ein Issue mit den Labels `roadmap` und `priority:high` (siehe [Issues und Project](issues.md)); erledigte Schritte bleiben hier als Überblick stehen.

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
    5. HLC im Frontend (`services/sync/hlc.ts`, Knoten-ID pro Tab)
    6. Lokaler Speicher (`idb`), in vier PRs:
        1. Speicher-Service (`services/storage/localData.ts`), gehört immer einem Nutzer
        2. Start ohne Netz: letzter Nutzer aus dem Speicher, Logout löscht ihn
        3. Stores starten aus IndexedDB und schreiben ihren Stand zurück ([#129](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/129))
        4. Vorladen der Listen und Artikel aller Haushalte ([#130](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/130))
    7. Outbox (Warteschlange, Senden, Wiederholen, Rollback, ein sendender Tab; [#131](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/131))
    8. Artikel-Store über die Outbox ([#132](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/132))
    9. „Abgehakte entfernen“ über die Outbox ([#133](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/133))
    10. Wiederverbinden: Outbox senden und neu laden ([#134](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/134))
    11. UI: Sync-Chip „ausstehend“, Uhr-Symbol in der Artikelzeile, Offline-Texte, Hinweise bei Aktionen nur online ([#135](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/135))
    12. PWA (`vite-plugin-pwa`, Manifest, Icons; [#136](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/136))
    13. Prüfung auf Staging mit echten Geräten ([#137](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/137))
7. **Design-Umsetzung und große Bildschirme:** Tokens und Komponenten nach der gewählten Claude-Design-Richtung, ab Phase 3 parallel umgesetzt. Danach die Listenansicht für Full HD und WQHD mit einer Kontextspalte neben der Liste ([#171](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/171), siehe [Design](design.md#große-bildschirme) und [ADR 0008](adr/0008-grosse-bildschirme.md)). Vorher empfohlen: `ListView` aufteilen ([#122](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/122)). Schritte, je ein PR:
    1. Entscheidungen ([#172](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/172))
    2. Seitenleiste mit offenen Artikeln und Listen-Icons ([#173](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/173))
    3. Kontextspalte: Layout, Kartenstapel und Formular-Karte ([#174](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/174))
    4. Listenspalte auf großen Bildschirmen ([#175](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/175))
    5. Zweite Liste anpinnen ([#176](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/176))
    6. API: wer einen Artikel zuletzt geändert hat ([#177](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/177))
    7. Bearbeiten-Karte mit Details, Löschen und Wechsel zu „Neu“ ([#178](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/178))
    8. Artikel in eine andere Liste verschieben ([#179](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/179)), in zwei PRs:
        1. API und Backend: `listId` in `updateItem` ([#180](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/180))
        2. Frontend: Verschieben in der Bearbeiten-Karte ([#181](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/181))
    9. Aktivität im Haushalt ([#182](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/182)), in drei PRs:
        1. Protokoll und Endpunkt ([#183](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/183))
        2. Live-Ereignis ([#184](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/184))
        3. Tab „Aktivität“ in der Kontextspalte ([#185](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/185))
    10. Prüfung auf echten Monitoren ([#186](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/186))

    Die Schritte 2, 4 und 5 brauchen kein Backend und können nach Schritt 3 in beliebiger Reihenfolge laufen; 6, 8.1 und 9.1 parallel zu den Frontend-Schritten.
8. **Deployment:** Compose für Staging und Production hinter dem bestehenden Traefik, Authelia-Schutz für Staging, Backups, automatisches Deployment: `main` auf Staging, GitHub Release auf Production (siehe [ADR 0001](adr/0001-staging-und-production.md)). Vorgezogen und parallel zu Phase 2, damit jeder weitere Stand früh unter echten Bedingungen auf Staging läuft. Erledigt: Container-Images, Compose mit Traefik-Labels, Images nach GHCR, Deploy auf Staging. Production unter `tuolino.de` (siehe [ADR 0009](adr/0009-production-unter-tuolino-de.md)), Schritte, je ein PR:
    1. Production-Namen dokumentieren ([#197](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/197))
    2. Release-Workflow: Images mit der Version taggen und nach Production deployen ([#198](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/198))
    3. Tägliche Backups der Production-Datenbank ([#199](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/199))
    4. Einrichtung auf dem VPS, bei Google und GitHub, erster Release `v0.1.0` ([#200](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/200))

    2 und 3 können parallel laufen; 4 braucht alle drei und den Zugriff auf die Domain. Production startet nur für Google-Testnutzer; vor dem öffentlichen Start kommen [#97](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/97) und [#98](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/98).

## Später

Ideen ohne festen Zeitpunkt, je ein Issue mit dem Label `roadmap` im Status `Backlog`: Push-Benachrichtigungen ([#138](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/138)), Kategorien ([#139](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/139)), Sortieren per Drag & Drop ([#140](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/140)), Autovervollständigung aus früheren Einkäufen ([#141](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/141)), Offline-Bearbeitung auch für Listen und Gruppen ([#142](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/142)), weitere Sprachen ([#143](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/143)), [Anlass-Listen](#ausbaustufe-anlass-listen) ([#144](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/144)).

## Ausbaustufe: Anlass-Listen

Nur geplant, nicht umgesetzt ([#144](https://github.com/Till-und-Scholler-AI-slop/Mitbringsel/issues/144)). Listen für Anlässe, die anders funktionieren als normale Einkaufslisten, zum Beispiel Grillabend, Geburtstag, Party, Silvester, Weihnachten, Brunch mit Gästen, Picknick, Camping, Urlaub oder Umzug. Der App-Name „Mitbringsel“ passt genau zu diesem Fall; das Feature ist daher ein guter Kandidat für eine spätere Ausbaustufe.

**Unterschiede zur normalen Einkaufsliste**

- **Zeitlich begrenzt:** Eine Anlass-Liste hat ein Datum, etwa als Badge am Listen-Chip („Sa, 21.6.“), und ist nach dem Anlass erledigt. Sie sollte dann archiviert oder ausgeblendet werden können, statt dauerhaft in der Listenleiste zu stehen.
- **Wer bringt was mit:** Bei Feiern geht es weniger ums gemeinsame Einkaufen und mehr darum, Aufgaben zu verteilen. Mitglieder sollen Einträge übernehmen können („Ich bring den Salat“).
- **Bedeutung des Avatars am Eintrag:** Bei normalen Listen zeigt er, wer den Eintrag hinzugefügt hat. Bei Anlass-Listen sollte er zeigen, wer sich darum kümmert bzw. es mitbringt. Nicht übernommene Einträge brauchen einen eigenen Zustand („noch offen, wer übernimmt?“).

**Offene Fragen** (noch nicht entschieden)

- Können auch Personen außerhalb der Gruppe (in der Oberfläche: Haushalt), etwa Partygäste, zu einer Anlass-Liste eingeladen werden, ohne der Gruppe beizutreten?
- Ist „Anlass-Liste“ ein eigener Listentyp oder eine Option (Datum und Übernehmen-Modus) für jede Liste?
- Was passiert mit der Liste nach dem Datum: automatisch archivieren, nachfragen oder manuell?
