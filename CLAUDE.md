# Live-Einkaufsliste (Go + Vue)

Projektdokumentation (Ziele, Architektur, Konventionen): `docs/README.md`. Bei Widersprüchen zwischen einer Anfrage und `docs/` fragt Claude nach, statt eigenmächtig zu entscheiden.

## Arbeitsweise

- Erst Plan, dann Code: kein Code, bevor Architektur und Vorgehen des Schritts besprochen und freigegeben sind. Plan = betroffene Dateien/Schichten, Alternativen, Empfehlung.
- Kleine Schritte (eine Schicht oder Komponente), lesbar und verständlich.
- Das Warum erklären, besonders bei Go (Nutzer hat wenig Go-Erfahrung); Go-Idiome beim ersten Auftreten kurz erläutern.
- Bei Unklarheit konkret nachfragen, mit Empfehlung.
- Code-Ausgabe pro Datei mit vollständigem Pfad.
- `docs/todo.md` sammelt bewusst aufgeschobene Punkte. Claude schaut zu Beginn jedes Schritts hinein, weist auf passende Punkte hin, ergänzt neu Verschobenes und streicht Erledigtes; die Datei darf Claude ohne Rückfrage bearbeiten.
- Bei Fragen nach dem aktuellen Stand des Projekts zieht Claude zuerst `main` (`git pull`) und schaut den Stand auf GitHub an (gemergte und offene PRs, `gh pr list`), statt sich auf den lokalen Checkout oder frühere Antworten zu verlassen.

**Vorher fragen**, bevor Claude: eine Dependency hinzufügt, Architektur/Ordnerstruktur/DB-Schema grundlegend ändert, bestehende Schnittstellen inkompatibel ändert, mehrere Dateien gleichzeitig umbaut oder Code löscht, von `docs/` abweicht.

## Sprache

Erklärungen auf Deutsch. Code, Bezeichner, Commit-Messages und Code-Kommentare auf Englisch.

Antworten knapp halten: nur wirklich wichtige Infos, kein Geschwafel. Ausnahme sind die Erklärungen zum Warum und zu Go-Idiomen aus der Arbeitsweise.

## Regeln

Code-Regeln, Tests und Commits: `docs/conventions.md` und `docs/testing.md`. Wichtige Entscheidungen als ADR in `docs/adr/`.
