# Tests und Seed-Daten

Getestet wird, was kaputtgehen darf, ohne dass man es sofort merkt: Sync- und Konfliktlogik, Berechtigungen und die Outbox. Ziel ist Aussagekraft, keine Abdeckungsquote.

## Was getestet wird

| Bereich | Testart | Beispiele |
| --- | --- | --- |
| LWW-Merge und HLC (Go und TypeScript) | Unit, tabellengetrieben | Gleichzeitige Änderungen an verschiedenen und gleichen Feldern, Gleichstand, Löschen gewinnt, Uhr in der Zukunft |
| Services | Unit mit Fake-Repositories | Nicht-Mitglied darf nicht lesen oder schreiben, Rechte von Owner, Admin und Member, abgelaufene Einladung |
| Repositories und Migrationen | Integration gegen echtes Postgres (`testcontainers-go`) | Queries, Constraints, `server_seq`, Idempotenz über `processed_ops` |
| WebSocket-Hub | Unit und Integration | Unit (`realtime`): Räume, langsamer Client, Limit, Rennen beim Verbinden; Integration mit zwei Clients ab Schritt 3. Phase 5: zwei Clients, Änderung von A kommt bei B an; Entfernen aus der Gruppe; langsamer Client. Wiederverbinden mit `sync` kommt in Phase 6 |
| HTTP-Handler | `httptest` | Statuscodes, Fehlerformat, Validierung |
| Outbox und Sync-Service (Frontend) | Unit mit Vitest, IndexedDB-Fake | Reihenfolge, erneutes Senden, Rollback bei Ablehnung |
| Stores und Basis-Komponenten | Vitest + Vue Test Utils | Props, Events, Zustände von `BaseButton`, `BaseInput` |
| Kern-Szenarien | E2E mit Playwright | Zwei Browser-Kontexte bearbeiten dieselbe Liste; ein Kontext geht offline, ändert und kommt zurück |

## Regeln

- Tests prüfen Verhalten, nicht Implementierungsdetails.
- Neue Sync- oder Berechtigungslogik kommt nie ohne Test. Bei einem Bugfix schreibt der Agent zuerst einen Test, der den Fehler zeigt.
- Go-Tests sind tabellengetrieben, wo es passt, und laufen mit `-race`.

## Seed-Daten

Dummy-Daten lohnen sich hier besonders, weil man Live-Sync nur mit mehreren Nutzern und vollen Listen realistisch ausprobieren kann.

- Ein Seed-Befehl (`make seed`) befüllt die lokale Datenbank reproduzierbar: 3 Nutzer, 2 Gruppen (eine WG mit 2 Mitgliedern, eine mit 3), 4 aktive Listen mit 40 Artikeln und eine archivierte Liste mit 4 Artikeln. Die Artikel haben gemischte Mengen, Einheiten, Notizen und abgehakte Einträge. Der Code liegt in `backend/db/seed/`, der Einstieg in `backend/cmd/seed/`; geschrieben wird nur über die Services, nie mit eigenem SQL, damit die Daten dieselben Regeln erfüllen wie echte.
- Die Seed-Nutzer sind `anna@example.com` (Anna Schäfer), `ben@example.com` (Benedikt „Ben“ Müller-Lüdenscheidt) und `chloe@example.com` (Chloé O'Brien). Nach dem Lauf gibt `make seed` die Login-Adressen aus, z.B. `http://localhost:5173/?devUser=anna%40example.com`.
- Zusammen mit dem Dev-Login (siehe [Authentifizierung](auth.md)) kann man sich als verschiedene Seed-Nutzer in zwei Browserfenstern anmelden und Sync direkt testen. Annas Fenster ist das normale, Bens ein privates Fenster mit dessen Adresse.
- Gruppen: „WG Kaiserstraße 12“ (Anna Owner, Ben Mitglied) und „Familie Müller-Lüdenscheidt“ (Ben Owner, Chloé Admin, Anna Mitglied). Die archivierte Liste „Grillparty Sommer“ gehört zur WG.
- `make seed` lässt sich beliebig oft wiederholen. Die Nutzer bleiben bestehen (gleiche IDs, Sessions bleiben gültig), alle Gruppen, deren Owner ein Seed-Nutzer ist, werden samt Listen, Artikeln und Mitgliedern gelöscht und neu angelegt. Fremde Nutzer und Gruppen bleiben unberührt. Wer als Seed-Nutzer von Hand eine eigene Gruppe angelegt hat, verliert sie also auch.
- Seed-Daten sind deutsch und englisch gemischt, mit Umlauten und langen Namen, damit Layout- und Encoding-Probleme früh auffallen.
- Tests verwenden eigene, kleine Fixtures pro Test statt der Seed-Daten, damit sie unabhängig bleiben.
- Seed-Daten laufen nie auf Staging oder Production. Dafür gibt es zwei Sperren, die vor dem Verbinden prüfen: `APP_ENV` muss `development` sein, und der Host in `DATABASE_URL` muss lokal sein (`localhost`, `127.0.0.1`, `::1` oder ein Unix-Socket-Pfad; bei mehreren Hosts jeder einzelne). Eine Option zum Übergehen gibt es bewusst nicht. Der Seed-Befehl ist außerdem nicht im Docker-Image enthalten (siehe [Deployment](deployment.md)).
