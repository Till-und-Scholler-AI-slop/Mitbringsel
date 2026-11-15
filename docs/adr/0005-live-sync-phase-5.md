# 0005: Live-Sync in Phase 5: REST schreibt, WebSocket verteilt

Status: akzeptiert; die Pläne für Phase 6 ersetzt [ADR 0006](0006-offline-phase-6.md)

## Kontext

Die [Roadmap](../roadmap.md) trennt den Sync in zwei Phasen: Phase 5 bringt den WebSocket-Hub, das Protokoll und den Broadcast, Phase 6 Offline, Outbox und das Wiederverbinden mit `sync`. Das Backend ist dafür schon vorbereitet: `item.Merge` und `item.Clock` (siehe [ADR 0004](0004-lww-pro-feld.md)) setzen LWW pro Feld um, und alle Schreibzugriffe laufen über REST.

Offen war, wie weit der WebSocket in Phase 5 gehen soll. Schreiben über den WebSocket (`mutate`, `ack`, `opId`) braucht Outbox, Idempotenz (`processed_ops`) und Nachsynchronisieren, also genau die Teile von Phase 6. Ohne sie wäre es nur eine zweite, schlechter getestete Schreibstrecke neben REST.

## Entscheidung

- **REST schreibt, der WebSocket verteilt nur Ereignisse vom Server an die Clients.** Der Server vergibt die HLC über `item.Clock`. `mutate`, `ack`, `opId`, Outbox, `processed_ops` und `sync` kommen in Phase 6. Nach jedem `ready` lädt der Client per REST neu, was er geladen hat. Die Zustellung ist Best Effort; die Datenbank ist die Wahrheit.
- **Bibliothek:** `github.com/coder/websocket`.
- **Eigene Ereignistypen** statt eines allgemeinen `change`: `itemChanged`, `itemDeleted`, `itemsDeleted`, `listChanged`, `listDeleted`, `groupChanged`, `groupRemoved` sowie `ready`, `pong` und `error` vom Server, `ping` vom Client. Artikel- und Listen-Ereignisse tragen den vollständigen Stand mit `serverSeq`. `groupChanged` ist nur ein Hinweis, `GET /groups` neu zu laden, weil `Group` die Rolle des Anfragenden enthält. Jedes Ereignis trägt die `actorId`. Der Client wendet Artikel- und Listen-Ereignisse nur an, wenn die `serverSeq` größer ist als seine eigene, denn Ereignisse können in anderer Reihenfolge ankommen.
- **Kein `subscribe`:** Beim Verbinden trägt der Server die Verbindung in alle Gruppen des Nutzers ein und sendet `ready`. Ändert sich eine Mitgliedschaft, wechseln die Verbindungen den Raum (`JoinGroup`/`LeaveGroup`), und die Betroffenen bekommen `groupRemoved`.
- **Umschlag `{type, payload}` ohne `id`.** `ping`, `pong` und `ready` haben keine `payload`.
- **Ping/Pong auf App-Ebene:** Browser können keine WebSocket-Protokoll-Pings senden. Der Client sendet alle 25 Sekunden `ping`, der Server antwortet mit `pong` und trennt nach 60 Sekunden Stille. Das hält auch Traefik offen.
- **Paket `backend/internal/realtime`:** Der Hub kennt keine Domäne und verteilt Bytes in Räume pro Gruppe. Der Name `internal/sync` entfällt, weil er mit der Standardbibliothek `sync` kollidiert. Der Upgrade-Handler und ein `Broadcaster` liegen in `httpapi`. Die Services `item`, `list` und `group` definieren je ein kleines `Publisher`-Interface (beim Konsumenten, wie `ListAccess` und `MemberLookup`). Sie veröffentlichen nach dem Commit und nur bei echten Änderungen.
- **Nachrichten als Schemas in `api/openapi.yaml`** ([ADR 0002](0002-openapi-als-api-vertrag.md) gilt sinngemäß). Kein AsyncAPI, keine handgeschriebenen Typen.
- **Authentifizierung und Origin:** `GET /api/v1/ws` liegt hinter der bestehenden Session-Prüfung (`requireUser`). Eine eigene Origin-Prüfung gegen den Host von `PUBLIC_BASE_URL` antwortet mit 403 `CROSS_ORIGIN_REQUEST`, weil `http.CrossOriginProtection` GET (und damit den Upgrade) durchlässt und der Vite-Proxy den `Host`-Header umschreibt. Eine Verbindung lebt höchstens etwa eine Stunde, damit die Session beim Wiederverbinden neu geprüft wird; beim Logout schließt das Frontend den Socket. Pro Nutzer sind etwa 10 Verbindungen erlaubt. `srv.RegisterOnShutdown(hub.Close)` schließt die Verbindungen, weil `Shutdown` gekaperte Verbindungen nicht schließt.
- **Eine Backend-Instanz** pro Umgebung. PostgreSQL `LISTEN/NOTIFY` kommt nur bei Bedarf.
- **Listen werden hart gelöscht** (kaskadierend, kein Tombstone). Artikel haben in `Item` kein `deletedAt`, deshalb gibt es das eigene Ereignis `itemDeleted`.
- **Aufräum-Job in Phase 5** nur für abgelaufene Sessions und alte Einladungen. Tombstones (30 Tage) und `processed_ops` folgen in Phase 6 zusammen mit `sync`.
- **„Abgehakte gesammelt entfernen“** ist in Phase 5 der letzte Schritt: REST `POST /lists/{listId}/items/remove-checked`, eine Transaktion, ein Tombstone und eine `serverSeq` pro Artikel, ein Ereignis `itemsDeleted`. Nachtrag (Schritt 11): Der Client schickt die IDs der Artikel, die er als abgehakt zeigt, und der Server löscht nur die, die noch abgehakt sind. Das Frontend sendet erst nach einigen Sekunden, damit „Rückgängig“ ohne Wiederherstellen auf dem Server auskommt (Löschen gewinnt, [ADR 0004](0004-lww-pro-feld.md)); „alle gerade abgehakten“ würde in dieser Zeit auch Artikel löschen, die jemand anderes eben erst abgehakt hat.

Verworfene Alternativen:

- **`mutate`/`ack` schon jetzt:** Ohne Outbox und `processed_ops` gäbe es zwei Schreibwege mit je eigener Fehlerbehandlung, ohne dass ein Nutzer davon etwas hat.
- **`gorilla/websocket`:** Kein `context`; Fristen (Deadlines), Pong-Handler und den einen gleichzeitigen Schreiber pro Verbindung müssten wir von Hand sichern. `coder/websocket` nimmt `context.Context` und erledigt das.
- **`golang.org/x/net/websocket`:** Gilt als veraltet und bietet weder Kontext noch Fristen in brauchbarer Form.
- **Veröffentlichen im HTTP-Handler:** Jeder WebSocket-Transport in Phase 6 müsste es wiederholen. Im Service steht es einmal, nach dem Commit.
- **Decorator um die Services:** Bräuchte eine zusätzliche Abfrage für die `groupID`, die der Service ohnehin schon kennt.
- **Allgemeines `change` plus `subscribe`:** Der Client müsste den Typ im Payload erneut unterscheiden, und `subscribe` bräuchte eine eigene Rechteprüfung, obwohl die Mitgliedschaft schon feststeht.
- **AsyncAPI:** Zweites Spezifikationsformat und zweite Toolchain für wenige Nachrichten, die in OpenAPI Platz haben.
- **Handgeschriebene Typen:** Genau das, was ADR 0002 abgeschafft hat.
- **Eine einzelne Hub-Goroutine mit Channels statt Mutex:** Mehr Code und schwerer zu testen, ohne Vorteil bei dieser Größe. Ein Mutex um die Räume genügt, solange das Senden selbst nie blockiert.

## Konsequenzen

- Phase 6 erweitert `ClientMessage` um `mutate` und `sync` (und `ServerMessage` um `ack` und `syncResult`) und ergänzt die Tabelle `processed_ops`. Nachtrag: Ersetzt durch [ADR 0006](0006-offline-phase-6.md), Phase 6 schreibt weiter per REST und lädt nach `ready` vollständig neu.
- Für `sync` braucht es Listen-Tombstones oder einen vollständigen Neuabgleich, weil gelöschte Listen sonst nicht mehr auffindbar sind. Nachtrag: [ADR 0006](0006-offline-phase-6.md) lädt vollständig neu, Listen bleiben ohne Tombstone.
- Die Zustellung ist Best Effort: Ein langsamer oder getrennter Client verpasst Ereignisse und holt sie nach dem nächsten `ready` per REST nach.
- Der Client braucht keine Rollback-Logik für Schreibzugriffe; REST-Fehler zeigt er wie bisher an.
- Ein zweites Backend-Exemplar würde Ereignisse nur an die eigenen Verbindungen verteilen. Vor einer Skalierung muss `LISTEN/NOTIFY` dazukommen.
