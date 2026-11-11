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
- Auch die Verbindungen des Absenders bekommen das Ereignis (Broadcast an den ganzen Raum). Die REST-Antwort trägt dieselbe `serverSeq`; der Tab, der die Änderung gemacht hat, verwirft das Ereignis, weil dessen `serverSeq` nicht größer ist als die gespeicherte.
- Zwei gleichzeitige Löschvorgänge können beide einen lebenden Artikel sehen und `itemDeleted` zweimal mit derselben `serverSeq` senden. Der zweite wird aus demselben Grund verworfen.
- Die Zustellung ist Best Effort. Wer ein Ereignis verpasst (Verbindung weg, zu langsam), holt es mit dem Neuladen nach dem nächsten `ready` nach.
- Mitgliedschaften bestimmen, wer Ereignisse bekommt: Wer in eine Gruppe aufgenommen wird, wechselt mit seinen Verbindungen in deren Raum; wer sie verlässt, bekommt `groupRemoved` und verlässt den Raum.
- Die Reihenfolge beim Hub ist je Fall festgelegt, und die Raumwechsel laufen immer, auch wenn eine Nachricht nicht kodiert werden kann:
  - **Aufnehmen** (Gruppe anlegen, Einladung annehmen): erst `JoinGroup`, dann `groupChanged` an den Raum. Die neuen Verbindungen bekommen den Hinweis also selbst und laden die Gruppen neu.
  - **Entfernen:** erst `LeaveGroup`, dann `groupRemoved` (`removed`) an alle Verbindungen des Entfernten (`SendToUser`, auch an solche, die noch laden), dann `groupChanged` an die übrigen Mitglieder. Der Entfernte bekommt `groupChanged` nicht; die `actorId` von `groupChanged` ist der Entfernende (beim Austreten der Austretende selbst).
  - **Löschen:** erst `groupRemoved` (`deleted`) an den Raum, dann `RemoveGroup`. Andersherum würde niemand benachrichtigt.
- Der Client verwirft Ereignisse zu Gruppen oder Listen, die er nicht kennt (nach `groupRemoved` oder `listDeleted`, oder bevor er sie geladen hat), statt sie anzulegen. `groupRemoved` kann auch vor `ready` eintreffen, weil es auch Verbindungen erreicht, die noch laden; der Client behandelt es wie sonst.
- Zwei Rennen nehmen wir bewusst hin, weil die Datenbank stimmt und das nächste `ready` es korrigiert: Wird eine Einladung fast gleichzeitig mit dem Löschen der Gruppe angenommen, kann die Verbindung in einen Raum geraten, den es nicht mehr gibt, und bleibt dort bis zum Trennen ohne Ereignisse. Wird jemand entfernt und im selben Moment wieder aufgenommen, kann `LeaveGroup` nach `JoinGroup` laufen, und er fehlt im Raum, bis er sich neu verbindet.

## Server-Seite

- **Hub:** Das Paket `backend/internal/realtime` verwaltet die Verbindungen als Räume pro Gruppe. Es kennt keine Domäne und verteilt nur Bytes. Jede Verbindung hat einen gepufferten Sendekanal; langsame Clients werden getrennt statt den Hub zu blockieren. Beim Verbinden wird die Verbindung erst registriert und dann werden die Gruppen geladen; Entfernen aus einer Gruppe oder Löschen einer Gruppe während des Ladens merkt sich der Hub, damit die Verbindung nicht in einen Raum gerät, den sie nicht mehr betreten darf. Pro Nutzer gilt ein Limit: Die 11. Verbindung wird abgewiesen, die älteste bleibt bestehen. Der Name `sync` entfällt, weil er mit der Standardbibliothek kollidiert; die Konfliktauflösung bleibt im Paket `item`.
- **Veröffentlichen:** Die Services `item`, `list` und `group` rufen nach dem Commit und nur bei echten Änderungen ein kleines `Publisher`-Interface auf. In `httpapi` setzt ein `Broadcaster` daraus die Nachrichten zusammen. Der Publisher blockiert nie und gibt keinen Fehler zurück, denn die Änderung ist gespeichert, egal ob jemand sie erfährt. Beim Artikel-Service (`item.Publisher`) gilt:
  - **Anlegen:** `itemChanged` nach dem Speichern, nicht bei einer Wiederholung derselben Anfrage (gleiche ID in derselben Liste).
  - **Ändern:** `itemChanged` erst nach dem Commit der Transaktion und nur, wenn mindestens ein Feld gewonnen hat. Verliert jedes Feld den Merge oder ist der Artikel ein Tombstone, ändert sich nichts und es gibt weder Ereignis noch neue `serverSeq`.
  - **Löschen:** `itemDeleted` nur beim ersten Löschen. Löschen eines Tombstones ändert nichts.

  Beim Listen-Service (`list.Publisher`) gilt:
  - **Anlegen, Umbenennen, Archivieren, Reaktivieren:** `listChanged` mit der gespeicherten Liste (samt `serverSeq`), nach dem Schreiben. Eine Änderung, die nichts ändert, wird übersprungen: derselbe Name, Archivieren einer archivierten oder Reaktivieren einer aktiven Liste schreiben nichts, vergeben keine neue `serverSeq` und senden kein Ereignis. Der Service liest die Liste dafür vor dem Schreiben; die Anfrage gilt als zum Zeitpunkt dieses Lesens ausgeführt.
  - **Löschen:** `listDeleted` nach dem Löschen, mit der Gruppe der Liste, die der Service vorher gelesen hat. Zwei gleichzeitige Löschvorgänge: der zweite findet keine Zeile (`ErrNotFound`) und sendet nichts. Die Artikel der Liste bekommen kein eigenes Ereignis; der Client verwirft sie mit der Liste.

  Beim Gruppen-Service (`group.Publisher`) gilt:
  - **Anlegen:** Die Gruppe hat kein eigenes Ereignis, sie entsteht über `MemberJoined`: Die Verbindungen des Erstellers treten dem Raum bei, danach geht `groupChanged` an den Raum. Das passiert nach dem Commit und vor dem Laden der Antwort; scheitert das Laden, existiert die Gruppe trotzdem und der Ersteller ist im Raum.
  - **Umbenennen:** `groupChanged` nur, wenn sich der Name ändert. Derselbe Name schreibt nichts. Die Rechteprüfung kommt vor diesem Vergleich, ein Außenstehender bekommt also denselben Fehler wie bisher.
  - **Rolle ändern:** `groupChanged` nur, wenn sich die Rolle ändert. Dieselbe Rolle ändert nichts (der Service erkennt das in der Transaktion).
  - **Einladung annehmen:** `MemberJoined` nur, wenn wirklich jemand aufgenommen wurde (`AddMemberIfAbsent` meldet das). Wer schon Mitglied ist oder den Link ein zweites Mal öffnet, löst nichts aus.
  - **Mitglied entfernen oder Austreten:** `MemberRemoved` nach dem Commit. Der Owner kann nicht austreten (`ErrOwnerImmutable`), dabei gibt es kein Ereignis.
  - **Gruppe löschen:** `GroupDeleted` nach dem Löschen. Listen und Artikel bekommen kein eigenes Ereignis; der Client verwirft sie mit der Gruppe.
- **Authentifizierung:** `GET /api/v1/ws` liegt hinter der Session-Prüfung. Die `Origin` muss zum Host von `PUBLIC_BASE_URL` passen, sonst `403 CROSS_ORIGIN_REQUEST`. Der Schutz gegen Cross-Origin-Anfragen aus der Standardbibliothek greift hier nicht, weil er GET durchlässt und der Vite-Proxy im Dev-Betrieb den `Host`-Header umschreibt.
- **Lebensdauer und Limits:** Eine Verbindung lebt höchstens etwa eine Stunde, damit die Session beim Wiederverbinden neu geprüft wird. Pro Nutzer sind etwa 10 Verbindungen erlaubt. Beim Logout schließt das Frontend den Socket, beim Herunterfahren schließt der Server alle Verbindungen selbst.
- **Fristen und Größen:** Der Server liest höchstens 4 KiB pro Nachricht (heute gibt es nur `ping`; Phase 6 braucht für `mutate` mehr). Er trennt eine Verbindung nach 60 Sekunden ohne Nachricht und gibt jeder Nachricht beim Schreiben 10 Sekunden. Die Verbindung wird ohne Kompression geführt.
- **Unbekannter Typ:** Eine Nachricht mit einem Typ, den der Server nicht kennt, beantwortet er mit `error` (`INVALID_REQUEST`) und lässt die Verbindung offen, damit ein Client einer anderen Version nicht getrennt wird. Neue Nachrichtentypen kommen als Eintrag in die Handler-Registry (`newWSHandlers` in `httpapi/ws.go`).
- **Schließcodes:** Der Server schließt, wenn er einen Grund hat, mit einem Close-Frame. Das Frontend verbindet sich in allen Fällen neu (mit Backoff) und lädt nach `ready` per REST nach; der Code sagt nur, warum.

  | Code | Grund (Text im Frame) | Anlass |
  | --- | --- | --- |
  | 1001 | `server shutting down` | Server wird heruntergefahren (`Hub.Close`) |
  | 1001 | `connection lifetime reached` | Verbindung ist eine Stunde alt |
  | 1003 | `text messages only` | Binärnachricht |
  | 1008 | `invalid message` | Kein JSON, kein Umschlag `{type, payload}` oder `type` leer |
  | 1009 | (von der Bibliothek) | Nachricht größer als 4 KiB |
  | 1011 | `internal error` | Gruppen konnten nicht geladen werden oder ein Handler ist gescheitert |
  | 1013 | `too slow` | Sendepuffer voll, siehe Hub |
  | 1006 (kein Frame) | | 60 Sekunden Stille, Schreib-Timeout oder Netzabbruch: Der Browser meldet 1006, weil kein Close-Frame ankommt |
- **Eine Instanz:** Für den Start läuft ein einzelner Backend-Container. Muss später horizontal skaliert werden, verteilt PostgreSQL `LISTEN/NOTIFY` die Änderungen zwischen Instanzen. Das wird erst bei Bedarf gebaut.

## Abgrenzung erstes Release

Artikel sind voll offline-fähig. Gruppen, Einladungen und Listen werden zunächst online über REST verwaltet. Ihre Änderungen werden aber per WebSocket als Ereignis an alle Mitglieder verteilt (`listChanged`, `groupChanged` …), damit neue Listen sofort bei allen erscheinen.
