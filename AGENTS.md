# Live-Einkaufsliste (Go + Vue)

Anweisungen für alle Coding-Agents (Claude Code, Antigravity und andere). `CLAUDE.md` importiert nur diese Datei.

Projektdokumentation (Ziele, Architektur, Konventionen): `docs/README.md`. Bei Widersprüchen zwischen einer Anfrage und `docs/` fragt der Agent nach, statt eigenmächtig zu entscheiden.

## Arbeitsweise

- Erst Plan, dann Code: kein Code, bevor Architektur und Vorgehen des Schritts besprochen und freigegeben sind. Plan = betroffene Dateien/Schichten, Alternativen, Empfehlung.
- Kleine Schritte (eine Schicht oder Komponente), lesbar und verständlich.
- Das Warum erklären, besonders bei Go (Nutzer hat wenig Go-Erfahrung); Go-Idiome beim ersten Auftreten kurz erläutern.
- Nach jedem gemergten Schritt kurz einordnen, was steht, was angebunden ist und was fehlt, bevor der nächste geplant wird. Wirken Antworten des Nutzers verwirrt, eine Code-Tour durch die betroffenen Dateien anbieten statt weiterzumachen, und zwischen Teilen auf ein ausdrückliches OK warten.
- Bei Unklarheit konkret nachfragen, mit Empfehlung.
- Code-Ausgabe pro Datei mit vollständigem Pfad.
- `docs/todo.md` sammelt bewusst aufgeschobene Punkte. Der Agent schaut zu Beginn jedes Schritts hinein, weist auf passende Punkte hin, ergänzt neu Verschobenes und streicht Erledigtes; die Datei darf er ohne Rückfrage bearbeiten.
- Bei Fragen nach dem aktuellen Stand des Projekts zieht der Agent zuerst `main` (`git pull`) und schaut den Stand auf GitHub an (gemergte und offene PRs, `gh pr list`), statt sich auf den lokalen Checkout oder frühere Antworten zu verlassen.

**Vorher fragen**, bevor der Agent: eine Dependency hinzufügt, Architektur/Ordnerstruktur/DB-Schema grundlegend ändert, bestehende Schnittstellen inkompatibel ändert, mehrere Dateien gleichzeitig umbaut oder Code löscht, von `docs/` abweicht.

## Sprache

Erklärungen auf Deutsch. Code, Bezeichner, Commit-Messages und Code-Kommentare auf Englisch.

Antworten knapp halten: nur wirklich wichtige Infos, kein Geschwafel. Ausnahme sind die Erklärungen zum Warum und zu Go-Idiomen aus der Arbeitsweise.

## Regeln

Code-Regeln, Tests und Commits: `docs/conventions.md` und `docs/testing.md`. Wichtige Entscheidungen als ADR in `docs/adr/`.

Das Repository ist öffentlich: Alles, was committet wird, ist für alle sichtbar. Nie interne Hostnamen (z.B. von Firmen-Registries), private E-Mail-Adressen oder Secrets committen.
