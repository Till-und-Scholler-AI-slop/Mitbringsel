# Aufgeschobene Punkte

Dinge, die bewusst auf später verschoben wurden, damit sie nicht verloren gehen. Erledigtes wird gestrichen (Zeile löschen), Neues mit kurzem Kontext ergänzt. Grundsätzliche offene Entscheidungen stehen in der [Roadmap](roadmap.md).

## Login

- [ ] **Datenschutz und Impressum:** Seiten anlegen und im Login-Footer links neben dem Sprachschalter verlinken (im Design vorgesehen). Hängt an der offenen Entscheidung in der Roadmap.
- [ ] **Einladungslink-Zustand:** Login-Variante „Anmelden und beitreten“ mit Einladungskarte (Einladende Person, Gruppe, Mitglieder). Kommt mit Phase 3 (Gruppen und Einladungen).
- [ ] **Rate Limiting für den Login:** `GET /api/v1/auth/google/login` und der Callback haben noch keine Begrenzung (vorgesehen in [Authentifizierung](auth.md)). Zusammen mit den Einladungs-Endpunkten in Phase 3 umsetzen.
- [ ] **Google-App veröffentlichen:** Für den Status "In Produktion" im Google-Zustimmungsbildschirm braucht es einen Link zur Datenschutzerklärung (hängt am Punkt oben); bis dahin können sich nur eingetragene Testnutzer anmelden.
- [ ] **Zurück zur vorherigen Seite nach erneutem Login:** Nach einer abgelaufenen Sitzung landet man nach dem Login immer auf `/`. Für den Rücksprung müsste das Ziel im Login-Versuch (Cookie) durch den Google-Ablauf mitreisen und gegen Open Redirects geprüft werden (nur relative Pfade der App). Sinnvoll, sobald es mehr als eine Seite gibt.
- [ ] **Stores bei Logout und abgelaufener Sitzung leeren:** Sobald Gruppen- und Listen-Stores Daten halten, müssen `logout()` und `expireSession()` im Auth-Store sie zurücksetzen (z.B. über einen gemeinsamen Reset), damit nach einem Nutzerwechsel keine fremden Daten sichtbar bleiben.
- [ ] **Sprache aus dem Nutzerprofil:** Der Sprachschalter merkt sich die Wahl vorerst nur in `localStorage`. Sobald das Profil die Sprache speichern kann, gewinnt nach dem Login das Profil (siehe [Konventionen](conventions.md), i18n).

## Gruppen

- [ ] **Account löschen und letzter Owner:** Löscht der letzte Owner einer Gruppe seinen Account, fällt seine Mitgliedschaft per `ON DELETE CASCADE` weg und die Gruppe hat keinen Owner mehr. Beim Bau der Account-Löschung festlegen: vorher einen Owner bestimmen lassen, das älteste Mitglied automatisch befördern oder leere Gruppen löschen.

## Gruppen

- [ ] **Owner-Übergabe:** Der Owner kann die Gruppe nur löschen, nicht übergeben (siehe [Überblick](overview.md)). Nachrüsten, falls sich das im Alltag als Lücke zeigt.
- [ ] **Account löschen:** Ist der Owner der Einzige mit Zugriff, bleibt nach dem Löschen seines Accounts eine Gruppe ohne Owner zurück. Beim Umsetzen von „Account löschen“ klären: Gruppe löschen oder Owner automatisch bestimmen.
- [ ] **Lange Gruppennamen:** Im Frontend mit „…“ abschneiden, wenn der Name nicht in die Zeile passt (bis 30 Zeichen erlaubt).

## Komponenten

- [ ] **`BaseButton`:** Varianten `danger` und Größen ergänzen, sobald ein Screen sie braucht (laut [Konventionen](conventions.md) vorgesehen, im Login-Design noch nicht vorhanden).
