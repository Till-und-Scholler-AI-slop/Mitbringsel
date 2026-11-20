# 0006: Offline in Phase 6: Outbox über REST, Neuladen statt Delta

Status: akzeptiert

## Kontext

Phase 6 macht Artikel offline-fähig (siehe [Roadmap](../roadmap.md)): Änderungen werden lokal angewendet, gespeichert und gesendet, sobald das Netz zurück ist. [ADR 0005](0005-live-sync-phase-5.md) hatte dafür vorgesehen, dass der Client über den WebSocket schreibt (`mutate`, `ack`, `opId`), der Server doppelte Änderungen über die Tabelle `processed_ops` erkennt und der Client nach dem Wiederverbinden mit `sync` nur die Änderungen seit seiner letzten `serverSeq` holt.

Bei der Planung zeigten sich zwei Dinge:

- **Wiederholen ist schon sicher.** Ein Artikel hat eine ID vom Client, ein zweites Anlegen mit derselben ID in derselben Liste gibt den gespeicherten Artikel zurück. Eine Änderung mit derselben HLC gewinnt nicht gegen die gespeicherte ([ADR 0004](0004-lww-pro-feld.md)). Löschen ist ein Tombstone, ein zweites Löschen ändert nichts. Eine eigene `opId` würde nichts erkennen, was nicht schon erkannt wird.
- **`serverSeq` folgt nicht der Reihenfolge der Commits.** Jede Änderung zieht ihre Nummer aus `change_seq` innerhalb ihrer Transaktion. Zieht A die 10 und B die 11 und committet B zuerst, kann ein Client „alles seit 9“ fragen, die 11 bekommen und sich 11 merken. A erscheint danach mit der 10 und fehlt bei „alles seit 11“ für immer. Ein Delta ab einer `serverSeq` wäre nur mit einer globalen Sperre über alle Schreibzugriffe oder mit Transaktions-IDs von PostgreSQL sicher.

## Entscheidung

- **REST schreibt weiter, auch offline gemachte Änderungen.** Eine Outbox im Client sendet die gesammelten Änderungen als die bekannten REST-Aufrufe. `mutate`, `ack`, `opId`, `sync`, `syncResult` und `processed_ops` entfallen. Der WebSocket bleibt der Weg vom Server zu den Clients: Ereignisse, Verbindungsstatus und `ready` als Startsignal für den Abgleich.
- **Die HLC kommt vom Client.** `createItem` und `updateItem` bekommen ein optionales Feld `clock`. Ohne `clock` stempelt der Server wie bisher selbst (`item.Clock`). Der Server prüft das Format und begrenzt eine Uhr, die mehr als 5 Minuten vorgeht (`Merge`, `MaxClockSkew`). Jeder Tab würfelt beim Laden eine zufällige Knoten-ID und speichert sie nicht (Nachtrag Schritt 5: geplant war eine gespeicherte pro Gerät; die Tabs eines Browsers hätten sie geteilt und zwei Änderungen mit derselben Uhr stempeln können, von denen die zweite verliert). Der Client übernimmt die Uhren jedes Artikels, den er empfängt (Empfangsregel der HLC): Seine nächste Änderung ist damit neuer als alles, was er gesehen hat, auch wenn seine Geräteuhr nachgeht.
- **Outbox:** Sie liegt in IndexedDB und gehört einem Nutzer. Sie sendet der Reihe nach, immer eine Änderung zur Zeit; nur ein Tab sendet (`navigator.locks`). Netzfehler, 5xx und 429 wiederholt sie mit Backoff. Bei 401 hält sie an und behält alles. Bei 400, 403, 404 und 409 verwirft sie die Änderung, übernimmt den Stand des Servers und zeigt einen Hinweis; dazu gehört `ITEM_ID_TAKEN` beim Wiederholen eines Anlegens, wenn der Artikel inzwischen gelöscht wurde. Änderungen, die älter als die Tombstone-Frist (30 Tage) sind, verwirft sie ungesendet, weil der Server den Tombstone dann schon entfernt haben kann.
- **Anzeige ohne Merge im Client:** Der Store hält den Stand des Servers, darüber liegen die Felder ausstehender Änderungen aus der Outbox. Die Antwort des Servers ersetzt den Artikel, die Änderung verlässt die Outbox. Der Server bleibt die einzige Stelle, die per LWW entscheidet.
- **Abgleich durch vollständiges Neuladen:** Nach jedem `ready` sendet die Outbox, und der Client lädt Gruppen, Listen und Artikel vollständig neu. Für die Artikel gibt es `GET /groups/{groupId}/items`: alle nicht gelöschten Artikel der aktiven Listen eines Haushalts, eine Anfrage pro Haushalt. Nachtrag (Issue #130): Die Antwort enthält zusätzlich `listIds`, die aktiven Listen des Haushalts, die sie abdeckt, auch die ohne Artikel. Ohne sie ließe sich eine leere Liste nicht von einer unterscheiden, die die Antwort nicht kennt, und veraltete gespeicherte Artikel könnten nicht sicher verworfen werden. Senden und Laden dürfen gleichzeitig laufen, weil die ausstehenden Felder über dem geladenen Stand liegen. `serverSeq` ordnet weiter die Ereignisse zu einem Objekt.
- **Was offline geht:** Haushalte, Listen und die Artikel aller aktiven Listen sind offline lesbar, der Client lädt sie vor. Ändern lassen sich offline nur Artikel: anlegen, bearbeiten, abhaken, löschen und „Abgehakte entfernen“. Haushalte und Listen ändern braucht eine Verbindung.
- **Lokaler Speicher:** IndexedDB über `idb`, getrennt pro Nutzer. Ein ausdrücklicher Logout löscht alles (geteilte Geräte). Eine abgelaufene Session löscht nichts, damit die Outbox beim erneuten Anmelden desselben Nutzers weiterläuft; meldet sich ein anderer Nutzer an, wird gelöscht.
- **Tombstones** von Artikeln löscht der Aufräum-Job nach 30 Tagen (`cleanup.Task`). Listen bleiben hart gelöscht, ohne Tombstone.
- **PWA:** `vite-plugin-pwa` im Modus `generateSW`. Der Service Worker speichert die App-Shell vorab, nie `/api`. Neue Versionen übernimmt er beim nächsten Laden (`autoUpdate`); ausstehende Änderungen liegen in IndexedDB und gehen dabei nicht verloren.
- **Neue Dependencies:** `idb` (Laufzeit, etwa 1 KB), `fake-indexeddb` und `vite-plugin-pwa` (beide nur für Entwicklung und Build).

Verworfene Alternativen:

- **`mutate`/`ack` über den WebSocket** (Plan aus ADR 0005): eine zweite Schreibstrecke mit eigener Fehlerbehandlung, Zuordnung der `ack`s, Timeouts und `processed_ops`. Der Gewinn, eine schon offene Verbindung, fällt bei einer Einkaufsliste nicht ins Gewicht. Über REST kann die Outbox auch senden, wenn der Socket nicht steht.
- **`opId` und `processed_ops` für REST:** Wiederholungen sind ohne sie schon harmlos (siehe Kontext).
- **Delta ab `serverSeq`:** Kann Änderungen dauerhaft übersehen (siehe Kontext). Absichern ließe es sich nur mit einer globalen Sperre oder Transaktions-IDs, für Datenmengen von wenigen Kilobyte pro Haushalt.
- **Listen-Tombstones:** Nur für ein Delta nötig. Beim vollständigen Laden verschwinden gelöschte Listen von selbst, ihre Artikel mit ihnen.
- **LWW-Merge auch in TypeScript** (Konsequenz aus ADR 0004): Der Client müsste genau wie der Server entscheiden, mit doppelten Tests. Die Anzeige braucht nur „ausstehend liegt oben“, entscheiden darf der Server allein.
- **Nur geöffnete Listen offline:** Spart den neuen Endpunkt, aber eine Liste, die jemand anders gerade angelegt hat, wäre im Laden ohne Netz leer.
- **Dexie:** Abfragen und `liveQuery` blieben ungenutzt, weil Pinia den Zustand hält; `idb` macht nur die IndexedDB-API Promise-fähig.
- **Service Worker von Hand:** Die Liste der gehashten Dateien für den Vorab-Speicher müsste man selbst ins Build einbauen.
- **Background Sync** (der Service Worker sendet die Outbox bei geschlossener App): Gibt es nur in Chromium. Die Outbox sendet, sobald die App wieder offen ist.

## Konsequenzen

- ADR 0005 gilt weiter für Phase 5, seine Pläne für Phase 6 ersetzt dieser ADR. Aus ADR 0004 entfallen der Merge in TypeScript und `mutate`. In TypeScript gibt es nur die HLC (Format, Vergleich, Empfangsregel).
- Das Protokoll des WebSocket bekommt keine neuen Nachrichten, `wsReadLimit` bleibt bei 4 KiB.
- Der Client braucht jetzt Rollback: Lehnt der Server eine Änderung ab, verschwindet sie aus der Outbox, der Artikel zeigt wieder den Stand des Servers, und ein Toast nennt den Grund.
- Jedes `ready` lädt alles neu, auch nach einer kurzen Unterbrechung. Werden die Daten einmal groß, kommt ein Delta mit einer sicheren Grenze dazu.
- Offline sieht ein Tab die Änderungen eines anderen Tabs desselben Browsers erst, wenn die Outbox gesendet hat und das Ereignis ankommt.
- Eine Änderung, die länger als 30 Tage offline lag, geht verloren.
- Ein Logout mit ausstehenden Änderungen fragt vorher nach, weil er sie löscht.
