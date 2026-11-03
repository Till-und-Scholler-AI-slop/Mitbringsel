# Tests und Seed-Daten

Getestet wird, was kaputtgehen darf, ohne dass man es sofort merkt: Sync- und Konfliktlogik, Berechtigungen und die Outbox. Ziel ist Aussagekraft, keine Abdeckungsquote.

## Was getestet wird

| Bereich | Testart | Beispiele |
| --- | --- | --- |
| LWW-Merge und HLC (Go und TypeScript) | Unit, tabellengetrieben | Gleichzeitige Änderungen an verschiedenen und gleichen Feldern, Gleichstand, Löschen gewinnt, Uhr in der Zukunft |
| Services | Unit mit Fake-Repositories | Nicht-Mitglied darf nicht lesen oder schreiben, Rechte von Owner, Admin und Member, abgelaufene Einladung |
| Repositories und Migrationen | Integration gegen echtes Postgres (`testcontainers-go`) | Queries, Constraints, `server_seq`, Idempotenz über `processed_ops` |
| WebSocket-Hub | Integration | Zwei Clients, Änderung von A kommt bei B an; Wiederverbinden mit `sync` |
| HTTP-Handler | `httptest` | Statuscodes, Fehlerformat, Validierung |
| Outbox und Sync-Service (Frontend) | Unit mit Vitest, IndexedDB-Fake | Reihenfolge, erneutes Senden, Rollback bei Ablehnung |
| Stores und Basis-Komponenten | Vitest + Vue Test Utils | Props, Events, Zustände von `BaseButton`, `BaseInput` |
| Kern-Szenarien | E2E mit Playwright | Zwei Browser-Kontexte bearbeiten dieselbe Liste; ein Kontext geht offline, ändert und kommt zurück |

## Regeln

- Tests prüfen Verhalten, nicht Implementierungsdetails.
- Neue Sync- oder Berechtigungslogik kommt nie ohne Test. Bei einem Bugfix schreibt Claude zuerst einen Test, der den Fehler zeigt.
- Go-Tests sind tabellengetrieben, wo es passt, und laufen mit `-race`.

## Seed-Daten

Dummy-Daten lohnen sich hier besonders, weil man Live-Sync nur mit mehreren Nutzern und vollen Listen realistisch ausprobieren kann.

- Ein Seed-Befehl (`make seed`) befüllt die lokale Datenbank reproduzierbar: 3 Nutzer, 2 Gruppen (eine WG mit 2 Mitgliedern, eine mit 3), 4 Listen und rund 40 Artikel mit gemischten Mengen, Einheiten, Notizen und abgehakten Einträgen.
- Zusammen mit dem Dev-Login (siehe [Authentifizierung](auth.md)) kann man sich als verschiedene Seed-Nutzer in zwei Browserfenstern anmelden und Sync direkt testen.
- Seed-Daten sind deutsch und englisch gemischt, mit Umlauten und langen Namen, damit Layout- und Encoding-Probleme früh auffallen.
- Tests verwenden eigene, kleine Fixtures pro Test statt der Seed-Daten, damit sie unabhängig bleiben.
- Seed-Daten laufen nie auf Staging oder Production.
