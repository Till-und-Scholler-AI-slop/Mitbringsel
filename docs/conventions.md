# Code-Qualität, Komponenten und i18n

Best Practices und SOLID gelten für jeden Schritt. Der Agent weist aktiv darauf hin, wenn eine Anfrage diese Prinzipien verletzen würde, und schlägt eine bessere Lösung vor.

## SOLID konkret

- **Single Responsibility:** Ein Handler parst und antwortet, ein Service entscheidet, ein Repository speichert. Eine Vue-Komponente hat eine Aufgabe; wächst sie über etwa 200 Zeilen, schlägt der Agent eine Aufteilung vor.
- **Open/Closed:** Neue WebSocket-Nachrichtentypen werden über eine Handler-Registry ergänzt, ohne bestehende Verzweigungen umzubauen.
- **Liskov:** Implementierungen eines Interfaces (z.B. echtes und Test-Repository) verhalten sich gleich, inklusive Fehlerfällen.
- **Interface Segregation:** Kleine Go-Interfaces, die genau das abbilden, was der Konsument braucht.
- **Dependency Inversion:** Services hängen von Interfaces ab, nicht von `pgx` oder dem WebSocket-Paket. Im Frontend hängen Stores von Service-Interfaces ab.

## Allgemeine Regeln

- Keine Magic Numbers und Strings: Konstanten oder Konfiguration.
- Kein `any` in TypeScript; Typen für alle API- und WebSocket-Nachrichten.
- Eingaben werden im Backend immer validiert, auch wenn das Frontend schon validiert (z.B. Name 1 bis 200 Zeichen, Notiz bis 1000 Zeichen).
- Fehler werden nie still geschluckt: geloggt, an den Nutzer übersetzt gemeldet, oder bewusst kommentiert ignoriert.
- Zeitstempel in der API sind UTC (`…Z`). Jeder Mapper in `httpapi` ruft `.UTC()` auf, weil pgx Zeiten in der lokalen Zone des Servers liefert. Handler-Tests nutzen Fixtures in `testZone` und prüfen mit `requireUTCTimestamps`, damit ein vergessener Aufruf auffällt.
- Konventionelle Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`). Erledigt ein PR ein Issue, nennt seine Beschreibung es mit `Closes #n` (siehe [Issues und Project](issues.md)). Hat eine KI mitgearbeitet, nennen Commit und PR sie als Co-Autor (siehe [KI als Co-Autor](#ki-als-co-autor)).
- Migrationen sind abwärtskompatibel: Die vorherige Version des Backends muss mit dem neuen Schema noch laufen, weil ein fehlgeschlagenes Deployment nur die Images zurückrollt, nicht die Datenbank. Spalten und Tabellen also erst hinzufügen und erst in einem späteren Release entfernen oder umbenennen.
- Generierter Code (sqlc unter `internal/platform/db/sqlcgen`, API-Typen unter `internal/httpapi/apigen` und `frontend/src/types/openapi.gen.ts`) wird eingecheckt und nie von Hand bearbeitet. Nach Änderungen an `db/queries`, `db/migrations` oder `api/openapi.yaml` `make generate` ausführen; die CI prüft, ob der Stand aktuell ist.
- Nach Änderungen an `api/openapi.yaml` auch im Frontend `npm run type-check`, `npm run test` und `npm run lint` laufen lassen, nicht nur die Backend-Tests. Ein neuer `ErrorCode` braucht einen Text in `frontend/src/i18n/locales/de.json` und `en.json` (`errors`) und einen Eintrag in `API_ERROR_CODES` in `frontend/src/i18n/__tests__/i18n.spec.ts`, sonst schlägt die Frontend-CI fehl.
- Go-Werkzeuge, die zum Build gehören (z.B. sqlc), stehen als `tool` in `backend/go.mod` und werden mit `go tool <name>` aufgerufen. So nutzen alle Rechner und die CI dieselbe Version.

## KI als Co-Autor

Jeder Commit und PR, an dem ein KI-Agent mitgearbeitet hat (Claude Code, Antigravity und andere), nennt die KI, damit sie auf GitHub als Contributor erscheint.

- Der Commit endet mit einem Trailer `Co-authored-by: <Name mit Modell> <E-Mail>`, je KI einer. Die E-Mail muss zu einem GitHub-Account gehören, sonst zählt GitHub den Co-Autor nicht; ein Trailer ohne E-Mail (z.B. `Co-Authored-By: Gemini 4 Neon via Antigravity`) zählt nicht.
- Geprüfte Trailer:

  | KI | Trailer | GitHub-Account |
  | --- | --- | --- |
  | Claude | `Co-Authored-By: Claude <Modell> <noreply@anthropic.com>` | `claude` |

- Gibt es für ein Werkzeug keinen geprüften Trailer, sagt der Agent das dem Nutzer, statt eine E-Mail zu raten. Ist ein neuer Trailer geprüft, kommt er in die Tabelle.
- Squash-Merge: GitHub übernimmt die Trailer der Branch-Commits in die Nachricht des Squash-Commits; sie werden nicht gelöscht.
- Die PR-Beschreibung nennt die beteiligten KIs in einer Zeile.
- Prüfen, ob GitHub den Co-Autor erkennt (für gepushte Commits): `user.login` darf für den KI-Trailer nicht `null` sein.

  ```sh
  gh api graphql -f query='query($o:String!){repository(owner:"Till-und-Scholler-AI-slop",name:"Mitbringsel"){object(expression:$o){... on Commit{authors(first:5){nodes{name email user{login}}}}}}}' -f o=<sha>
  ```

## Wiederverwendbare Komponenten

Alles, was mehr als einmal vorkommt, wird eine Komponente in `components/base/` mit `Base`-Präfix. Fachliche Komponenten setzen sich daraus zusammen.

| Komponente | Zweck |
| --- | --- |
| `BaseButton` | Varianten primary, secondary, ghost, danger, danger-solid (endgültiges „Ja“ in Bestätigungsdialogen); Größen; Lade- und Disabled-Zustand |
| `BaseIconButton` | Button nur mit Icon und verpflichtendem `aria-label` |
| `BaseInput` / `BaseTextarea` | Label, Fehlermeldung, `v-model` |
| `BaseSelect` | Auswahl, z.B. für Einheiten |
| `BaseCheckbox` | Abhaken von Artikeln |
| `BaseModal` / `BaseBottomSheet` | Dialoge; Bottom Sheet auf dem Smartphone |
| `BaseToast` | Hinweise, z.B. bei abgelehnten Änderungen; gezeigt über `useToastsStore`, gestapelt in `AppToasts` |
| `BaseAvatar` | Profilbild mit Initialen-Fallback |
| `BaseSticker` | Listen-Icon als ausgeschnittener Sticker (Daten in `stickers.ts`), immer `aria-hidden` |
| `BaseEmptyState` | Leere Listen und Gruppen |
| `BaseSyncIndicator` | Status online, offline, synchronisiert ausstehende Änderungen |

- Props und Emits sind mit TypeScript typisiert (`defineProps<…>()`, `defineEmits<…>()`).
- Wiederverwendbare Logik liegt in Composables (z.B. `useOnlineStatus`, `useTheme`, `useConfirm`).
- Barrierefreiheit: semantisches HTML, Tastaturbedienung, sichtbarer Fokus, Kontraste nach WCAG AA in beiden Themes.
- Druck-Animation: Buttons und Links, die drückbar aussehen, bekommen die globale Klasse `press-sticker` (mit Sticker-Schatten, sinkt auf ihn; ein Umschalter mit `aria-pressed="true"` bleibt unten) oder `press-inset` (flach, sinkt mit Innenschatten ein) aus `styles/base.css`, keine eigenen `:active`-Regeln für Bewegung und Schatten und kein eigenes `transition`. Ausnahme: der aktuelle Eintrag der Seitenleiste mit eigenem Look laut Design.

## i18n

- Kein hart codierter UI-Text in Komponenten. Alle Texte kommen aus `i18n/locales/de.json` und `en.json`.
- Schlüssel sind hierarchisch nach Bereich benannt, z.B. `list.item.addPlaceholder`.
- Zahlen, Mengen und Datumsangaben werden über die Formatierungsfunktionen von `vue-i18n` lokalisiert.
- Startsprache aus dem Browser, danach aus dem Nutzerprofil. Fallback ist Deutsch.
- Das Backend liefert Fehlercodes (z.B. `ITEM_NAME_TOO_LONG`), keine fertigen Texte; das Frontend übersetzt sie.
