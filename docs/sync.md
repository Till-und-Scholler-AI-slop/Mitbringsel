# Live-Sync, Offline und Konfliktauflösung

Jede Änderung wird zuerst lokal angewendet, in einer Warteschlange (Outbox) gespeichert und per WebSocket an den Server geschickt. Der Server entscheidet per Last Write Wins und verteilt das Ergebnis an alle verbundenen Gruppenmitglieder.

```
Client A (Vue)                   Go-Server                        Client B (Vue)
┌───────────────────┐           ┌────────────────────┐           ┌───────────────────┐
│ Outbox            │──mutate──▶│ WebSocket-Hub      │──change──▶│ Store + IndexedDB │
│        ▲          │◀───ack────│        │           │           │        │          │
│ Store + IndexedDB │           │ Sync-Service (LWW) │           │ UI aktualisiert   │
└───────────────────┘           └─────────┬──────────┘           └───────────────────┘
                                          │ LWW + serverSeq
                                          ▼
                                     PostgreSQL
```

Der Absender erhält ein `ack` und leert seine Outbox; alle anderen Clients der Gruppe erhalten die Änderung als `change`. Offline bleiben Änderungen in der Outbox, bis die Verbindung zurück ist.

## Grundprinzipien

- **Offline-first für Artikel:** Die UI liest immer aus dem lokalen Zustand (Pinia, gespiegelt in IndexedDB). Das Netzwerk ist nur der Transport.
- **IDs vom Client:** Neue Artikel bekommen eine UUIDv7 auf dem Client. So kann man offline Artikel anlegen und später ohne ID-Konflikte synchronisieren.
- **Optimistische Updates:** Die Änderung ist sofort in der UI sichtbar. Lehnt der Server sie ab, wird sie zurückgerollt und der Nutzer bekommt einen Hinweis.
- **Idempotenz:** Jede Änderung trägt eine eindeutige `opId`. Der Server verarbeitet dieselbe `opId` nur einmal, auch wenn der Client sie nach einem Verbindungsabbruch erneut sendet.

## Konfliktauflösung: Last Write Wins pro Feld

Status: Empfehlung, Entscheidung offen (siehe [Roadmap](roadmap.md)).

- **Empfehlung:** LWW pro Feld statt pro Artikel. Hakt Person A einen Artikel ab, während Person B die Menge ändert, bleiben beide Änderungen erhalten. Nur wenn beide dasselbe Feld ändern, gewinnt die spätere Änderung.
- **Zeitstempel:** Jede Änderung trägt einen Zeitstempel einer Hybrid Logical Clock (HLC) vom Client. Die HLC kombiniert Uhrzeit und Zähler und bleibt auch bei leicht abweichenden Geräteuhren konsistent. Zeitstempel, die mehr als 5 Minuten in der Zukunft liegen, setzt der Server auf seine eigene Zeit.
- **Löschen gewinnt:** Gelöschte Artikel werden als Tombstone (`deleted_at`) markiert und nicht wiederbelebt, auch wenn später eine Offline-Bearbeitung eintrifft. Tombstones werden nach 30 Tagen endgültig entfernt.
- **Gleichstand:** Bei identischem Zeitstempel entscheidet der lexikografische Vergleich der Client-IDs, damit alle Geräte zum selben Ergebnis kommen.

## Synchronisationsablauf

1. Nutzer ändert einen Artikel. Der Store wendet die Änderung lokal an, speichert sie in IndexedDB und legt sie in die Outbox.
2. Ist der WebSocket verbunden, sendet der Sync-Service die Änderung als `mutate`-Nachricht.
3. Der Server prüft Session und Gruppenmitgliedschaft, wendet LWW in einer Transaktion an und vergibt eine fortlaufende `serverSeq`.
4. Der Server bestätigt dem Absender mit `ack` (die Änderung verlässt die Outbox) und sendet allen anderen Verbindungen der Gruppe ein `change`.
5. Empfangende Clients mischen die Änderung per LWW in ihren lokalen Zustand.

## Wiederverbinden nach Offline-Phase

1. Der Client baut den WebSocket neu auf (exponentielles Backoff, maximal 30 Sekunden).
2. Er sendet `sync` mit der letzten bekannten `serverSeq` pro Gruppe.
3. Der Server antwortet mit allen Änderungen seit dieser Sequenz. Liegt die Sequenz zu weit zurück (älter als die Tombstone-Frist), fordert der Server einen vollständigen Neuabgleich an.
4. Danach sendet der Client seine Outbox in der ursprünglichen Reihenfolge.

## WebSocket-Protokoll

Alle Nachrichten sind JSON mit einheitlichem Umschlag: `{ "type": "...", "id": "...", "payload": { ... } }`.

| Richtung | Typ | Inhalt |
| --- | --- | --- |
| Client → Server | `subscribe` | Gruppen, deren Änderungen der Client empfangen will |
| Client → Server | `mutate` | `opId`, Entität, ID, geänderte Felder, HLC-Zeitstempel |
| Client → Server | `sync` | Letzte `serverSeq` pro Gruppe |
| Server → Client | `ack` | Bestätigte `opId` und vergebene `serverSeq` |
| Server → Client | `change` | Übernommene Änderung eines anderen Nutzers |
| Server → Client | `syncResult` | Alle Änderungen seit der angefragten Sequenz |
| Server → Client | `error` | Fehlercode, betroffene `opId`, Grund |
| beide | `ping` / `pong` | Verbindung am Leben halten (alle 25 Sekunden) |

## Server-Seite

- **Hub:** Ein zentraler Hub verwaltet die Verbindungen, gruppiert nach Gruppe. Jede Verbindung hat eine Lese- und eine Schreib-Goroutine mit gepuffertem Sendekanal. Langsame Clients werden getrennt statt den Hub zu blockieren.
- **Authentifizierung:** Der WebSocket-Upgrade prüft das Session-Cookie und den `Origin`-Header.
- **Eine Instanz:** Für den Start läuft ein einzelner Backend-Container. Muss später horizontal skaliert werden, verteilt PostgreSQL `LISTEN/NOTIFY` die Änderungen zwischen Instanzen. Das wird erst bei Bedarf gebaut.

## Abgrenzung erstes Release

Artikel sind voll offline-fähig. Gruppen, Einladungen und Listen werden zunächst online über REST verwaltet. Ihre Änderungen werden aber per WebSocket als Ereignis an alle Mitglieder verteilt, damit neue Listen sofort bei allen erscheinen.
