# Live-Sync, Offline und Konfliktauflösung

Der Sync entsteht in zwei Phasen: Phase 5 verteilt Änderungen live per WebSocket, Phase 6 macht Artikel offline-fähig. Der Abschnitt [Stand Phase 5](#stand-phase-5) beschreibt, was zuerst gebaut wird. Was erst mit Phase 6 kommt, ist unten ausdrücklich so markiert.

## Stand Phase 5

Entscheidung und Alternativen: [ADR 0005](adr/0005-live-sync-phase-5.md).

- **REST schreibt, der WebSocket verteilt.** Alle Änderungen laufen wie bisher über REST. Der Server vergibt die HLC (`item.Clock`) und `serverSeq` und sendet das Ergebnis nach dem Commit als Ereignis an die Mitglieder der Gruppe. `mutate`, `ack`, `opId`, Outbox und `sync` gibt es noch nicht.
- **Kein `subscribe`:** Beim Verbinden trägt der Server die Verbindung in alle Gruppen des Nutzers ein und sendet `ready`. Nach jedem `ready` lädt der Client per REST neu, was er geladen hat (Gruppen, Listen, offene Artikel). So gleicht sich eine Verbindung nach einer Unterbrechung ohne `sync` wieder an.
- **Best Effort:** Ein langsamer oder getrennter Client verpasst Ereignisse. Die Datenbank ist die Wahrheit, REST holt alles nach.
- **Reihenfolge über `serverSeq`:** Ereignisse können vertauscht ankommen. Der Client wendet Artikel- und Listen-Ereignisse nur an, wenn die `serverSeq` größer ist als die gespeicherte.
- **Ereignisse tragen den Stand:** `itemChanged` und `listChanged` enthalten das ganze Objekt. `groupChanged` ist nur ein Hinweis, `GET /groups` neu zu laden, weil `Group` die Rolle des jeweiligen Nutzers enthält. Jedes Ereignis nennt die `actorId`, damit die UI „gerade geändert“ von anderen erkennt.
- **Löschen:** Listen werden hart gelöscht (`listDeleted`), Artikel als Tombstone (`itemDeleted`, bei „Abgehakte entfernen“ gesammelt als `itemsDeleted`).
- **Typen:** Alle Nachrichten stehen als Schemas in `api/openapi.yaml` (`ClientMessage`, `ServerMessage`); Go- und TypeScript-Typen werden daraus erzeugt.

## Zielbild ab Phase 6

Jede Änderung wird zuerst lokal angewendet, in einer Warteschlange (Outbox) gespeichert und per WebSocket an den Server geschickt. Der Server entscheidet per Last Write Wins und verteilt das Ergebnis an alle verbundenen Gruppenmitglieder.

```
Client A (Vue)                   Go-Server                        Client B (Vue)
┌───────────────────┐           ┌────────────────────┐           ┌───────────────────┐
│ Outbox            │──mutate──▶│ WebSocket-Hub      │──event───▶│ Store + IndexedDB │
│        ▲          │◀───ack────│        │           │           │        │          │
│ Store + IndexedDB │           │ Sync-Service (LWW) │           │ UI aktualisiert   │
└───────────────────┘           └─────────┬──────────┘           └───────────────────┘
                                          │ LWW + serverSeq
                                          ▼
                                     PostgreSQL
```

Der Absender erhält ein `ack` und leert seine Outbox; alle anderen Clients der Gruppe erhalten sie als Ereignis (`itemChanged`). Offline bleiben Änderungen in der Outbox, bis die Verbindung zurück ist.

In Phase 5 läuft nur der rechte Teil: Der Server sendet nach einer REST-Änderung ein Ereignis an die Mitglieder der Gruppe. Das Schreiben per `mutate` und das `ack` folgen in Phase 6.

## Grundprinzipien

- **Offline-first für Artikel:** Die UI liest immer aus dem lokalen Zustand (Pinia, gespiegelt in IndexedDB). Das Netzwerk ist nur der Transport.
- **IDs vom Client:** Neue Artikel bekommen eine UUIDv7 auf dem Client. So kann man offline Artikel anlegen und später ohne ID-Konflikte synchronisieren.
- **Optimistische Updates:** Die Änderung ist sofort in der UI sichtbar. Lehnt der Server sie ab, wird sie zurückgerollt und der Nutzer bekommt einen Hinweis.
- **Idempotenz (ab Phase 6):** Jede Änderung trägt eine eindeutige `opId`. Der Server verarbeitet dieselbe `opId` nur einmal, auch wenn der Client sie nach einem Verbindungsabbruch erneut sendet.

## Konfliktauflösung: Last Write Wins pro Feld

Status: entschieden (siehe [ADR 0004](adr/0004-lww-pro-feld.md)).

- **Regel:** LWW pro Feld statt pro Artikel. Hakt Person A einen Artikel ab, während Person B die Menge ändert, bleiben beide Änderungen erhalten. Nur wenn beide dasselbe Feld ändern, gewinnt die spätere Änderung.
- **Zeitstempel:** Jede Änderung trägt einen Zeitstempel einer Hybrid Logical Clock (HLC) vom Client. Die HLC kombiniert Uhrzeit und Zähler und bleibt auch bei leicht abweichenden Geräteuhren konsistent. Zeitstempel, die mehr als 5 Minuten in der Zukunft liegen, setzt der Server auf seine eigene Zeit.
- **HLC-Format:** Eine HLC stempelt die Änderung eines einzelnen Feldes, sie identifiziert nicht den Artikel. Sie ist ein Text fester Breite, `<Zeit>-<Zähler>-<Knoten>`, z.B. `0000019a2b3c4d5e-0001-3f2a9c`: Millisekunden seit 1970 (16 Hex-Ziffern, klein), Zähler (4 Hex-Ziffern, klein) und Knoten-ID des Geräts (1 bis 64 Zeichen aus `A-Z a-z 0-9 _ -`). Wegen der festen Breite ist der Textvergleich (`<`, `>`) schon der HLC-Vergleich, in Go wie in TypeScript. Umsetzung: `backend/internal/item/hlc.go`.
- **Felder mit Uhr:** `name`, `quantity`, `unit`, `note` und `checked`. `checked_by` und `checked_at` gehören zur Uhr von `checked`. Die Uhren stehen in `items.field_clocks`, `Merge` (`backend/internal/item/merge.go`) entscheidet, welche Felder einer Änderung gewinnen.
- **Gleiche Änderung zweimal:** Eine gleiche HLC gewinnt nicht gegen die gespeicherte; ein erneut gesendetes `mutate` ändert also nichts (zusätzlich zur `opId`).
- **Archivierte Listen:** Artikel in einer archivierten Liste bleiben änderbar, damit Offline-Änderungen aus der Zeit vor dem Archivieren nicht verloren gehen.
- **Löschen gewinnt:** Gelöschte Artikel werden als Tombstone (`deleted_at`) markiert und nicht wiederbelebt, auch wenn später eine Offline-Bearbeitung eintrifft. Tombstones werden nach 30 Tagen endgültig entfernt.
- **Gleichstand:** Bei identischem Zeitstempel entscheidet der lexikografische Vergleich der Client-IDs, damit alle Geräte zum selben Ergebnis kommen.

## Synchronisationsablauf (ab Phase 6)

1. Nutzer ändert einen Artikel. Der Store wendet die Änderung lokal an, speichert sie in IndexedDB und legt sie in die Outbox.
2. Ist der WebSocket verbunden, sendet der Sync-Service die Änderung als `mutate`-Nachricht.
3. Der Server prüft Session und Gruppenmitgliedschaft, wendet LWW in einer Transaktion an und vergibt eine fortlaufende `serverSeq`.
4. Der Server bestätigt dem Absender mit `ack` (die Änderung verlässt die Outbox) und sendet allen anderen Verbindungen der Gruppe ein Ereignis (`itemChanged`).
5. Empfangende Clients mischen die Änderung per LWW in ihren lokalen Zustand.

## Wiederverbinden nach Offline-Phase (ab Phase 6)

In Phase 5 genügt ein Neuladen per REST nach jedem `ready`; `sync` mit Sequenzen ersetzt das in Phase 6.

1. Der Client baut den WebSocket neu auf (exponentielles Backoff, maximal 30 Sekunden).
2. Er sendet `sync` mit der letzten bekannten `serverSeq` pro Gruppe.
3. Der Server antwortet mit allen Änderungen seit dieser Sequenz. Liegt die Sequenz zu weit zurück (älter als die Tombstone-Frist), fordert der Server einen vollständigen Neuabgleich an.
4. Danach sendet der Client seine Outbox in der ursprünglichen Reihenfolge.

## WebSocket-Protokoll

Alle Nachrichten sind JSON mit einheitlichem Umschlag: `{ "type": "...", "payload": { ... } }`. Es gibt kein `id`-Feld; `ping`, `pong` und `ready` haben keine `payload`. Die Formen stehen in `api/openapi.yaml` (`ClientMessage` und `ServerMessage`, jeweils mit `type` als Unterscheidungsmerkmal).

| Richtung | Typ | Inhalt | Ab |
| --- | --- | --- | --- |
| Client → Server | `ping` | Verbindung am Leben halten (alle 25 Sekunden) | Phase 5 |
| Client → Server | `mutate` | `opId`, Entität, ID, geänderte Felder, HLC-Zeitstempel | Phase 6 |
| Client → Server | `sync` | Letzte `serverSeq` pro Gruppe | Phase 6 |
| Server → Client | `ready` | Verbindung steht, alle Gruppen des Nutzers sind eingetragen; der Client lädt per REST neu | Phase 5 |
| Server → Client | `pong` | Antwort auf `ping` | Phase 5 |
| Server → Client | `itemChanged` | Artikel angelegt oder geändert: `groupId`, `actorId`, ganzer Artikel mit `serverSeq` | Phase 5 |
| Server → Client | `itemDeleted` | Artikel gelöscht: `groupId`, `listId`, `itemId`, `serverSeq`, `actorId` | Phase 5 |
| Server → Client | `itemsDeleted` | Mehrere Artikel gelöscht („Abgehakte entfernen“): `groupId`, `listId`, `actorId`, je Artikel `itemId` und `serverSeq` | Phase 5 |
| Server → Client | `listChanged` | Liste angelegt, umbenannt, archiviert oder wieder aktiviert: `actorId`, ganze Liste mit `serverSeq` | Phase 5 |
| Server → Client | `listDeleted` | Liste gelöscht: `groupId`, `listId`, `actorId` | Phase 5 |
| Server → Client | `groupChanged` | Name, Mitglieder oder Rollen geändert; Hinweis, `GET /groups` neu zu laden | Phase 5 |
| Server → Client | `groupRemoved` | Gruppe gelöscht oder Nutzer entfernt (`reason`: `deleted`, `removed`) | Phase 5 |
| Server → Client | `error` | Fehlercode (`ErrorCode`) | Phase 5 |
| Server → Client | `ack` | Bestätigte `opId` und vergebene `serverSeq` | Phase 6 |
| Server → Client | `syncResult` | Alle Änderungen seit der angefragten Sequenz | Phase 6 |

Der `error` aus Phase 5 trägt nur einen Code; in Phase 6 kommen die betroffene `opId` und ein Grund dazu.

### Ping und Pong

Browser können keine WebSocket-Protokoll-Pings senden. Der Client schickt deshalb alle 25 Sekunden eine `ping`-Nachricht, der Server antwortet mit `pong` und trennt eine Verbindung nach 60 Sekunden Stille. Das hält auch Traefik offen.

### Reihenfolge und Zustellung

- Der Server sendet nach dem Commit, aber ohne globale Ordnung. Zwei Ereignisse zum selben Artikel können vertauscht ankommen; der Client wendet ein Ereignis nur an, wenn dessen `serverSeq` größer ist als die gespeicherte.
- Die Zustellung ist Best Effort. Wer ein Ereignis verpasst (Verbindung weg, zu langsam), holt es mit dem Neuladen nach dem nächsten `ready` nach.
- Mitgliedschaften bestimmen, wer Ereignisse bekommt: Wer in eine Gruppe aufgenommen wird, wechselt mit seinen Verbindungen in deren Raum; wer sie verlässt, bekommt `groupRemoved` und verlässt den Raum.

## Server-Seite

- **Hub:** Das Paket `backend/internal/realtime` verwaltet die Verbindungen als Räume pro Gruppe. Es kennt keine Domäne und verteilt nur Bytes. Jede Verbindung hat einen gepufferten Sendekanal; langsame Clients werden getrennt statt den Hub zu blockieren. Der Name `sync` entfällt, weil er mit der Standardbibliothek kollidiert; die Konfliktauflösung bleibt im Paket `item`.
- **Veröffentlichen:** Die Services `item`, `list` und `group` rufen nach dem Commit und nur bei echten Änderungen ein kleines `Publisher`-Interface auf. In `httpapi` setzt ein `Broadcaster` daraus die Nachrichten zusammen.
- **Authentifizierung:** `GET /api/v1/ws` liegt hinter der Session-Prüfung. Die `Origin` muss zum Host von `PUBLIC_BASE_URL` passen, sonst `403 CROSS_ORIGIN_REQUEST`. Der Schutz gegen Cross-Origin-Anfragen aus der Standardbibliothek greift hier nicht, weil er GET durchlässt und der Vite-Proxy im Dev-Betrieb den `Host`-Header umschreibt.
- **Lebensdauer und Limits:** Eine Verbindung lebt höchstens etwa eine Stunde, damit die Session beim Wiederverbinden neu geprüft wird. Pro Nutzer sind etwa 10 Verbindungen erlaubt. Beim Logout schließt das Frontend den Socket, beim Herunterfahren schließt der Server alle Verbindungen selbst.
- **Eine Instanz:** Für den Start läuft ein einzelner Backend-Container. Muss später horizontal skaliert werden, verteilt PostgreSQL `LISTEN/NOTIFY` die Änderungen zwischen Instanzen. Das wird erst bei Bedarf gebaut.

## Abgrenzung erstes Release

Artikel sind voll offline-fähig. Gruppen, Einladungen und Listen werden zunächst online über REST verwaltet. Ihre Änderungen werden aber per WebSocket als Ereignis an alle Mitglieder verteilt (`listChanged`, `groupChanged` …), damit neue Listen sofort bei allen erscheinen.
