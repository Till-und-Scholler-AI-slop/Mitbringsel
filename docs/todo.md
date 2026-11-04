# Aufgeschobene Punkte

Dinge, die bewusst auf später verschoben wurden, damit sie nicht verloren gehen. Erledigtes wird gestrichen (Zeile löschen), Neues mit kurzem Kontext ergänzt. Grundsätzliche offene Entscheidungen stehen in der [Roadmap](roadmap.md).

## Login

- [ ] **Datenschutz und Impressum:** Seiten anlegen und im Login-Footer links neben dem Sprachschalter verlinken (im Design vorgesehen). Hängt an der offenen Entscheidung in der Roadmap.
- [ ] **Einladungslink-Zustand:** Login-Variante „Anmelden und beitreten“ mit Einladungskarte (Einladende Person, Gruppe, Mitglieder). Kommt mit Phase 3 (Gruppen und Einladungen).
- [ ] **Login-Limit als Seite statt JSON:** `/auth/google/login` und `/callback` werden per Navigation geöffnet; bei `429` sieht man die rohe JSON-Antwort. Besser wäre ein Redirect auf `/login?error=rate_limited` mit Text im Frontend (Phase 3, Schritt 5).
- [ ] **Google-App veröffentlichen:** Für den Status "In Produktion" im Google-Zustimmungsbildschirm braucht es einen Link zur Datenschutzerklärung (hängt am Punkt oben); bis dahin können sich nur eingetragene Testnutzer anmelden.
- [ ] **Zurück zur vorherigen Seite nach erneutem Login:** Nach einer abgelaufenen Sitzung landet man nach dem Login immer auf `/`. Für den Rücksprung müsste das Ziel im Login-Versuch (Cookie) durch den Google-Ablauf mitreisen und gegen Open Redirects geprüft werden (nur relative Pfade der App). Sinnvoll, sobald es mehr als eine Seite gibt.
- [ ] **Stores bei Logout und abgelaufener Sitzung leeren:** Der Gruppen-Store leert sich selbst, sobald sich die Nutzer-ID ändert (`watch` auf die ID in `stores/groups.ts`). Listen-Store (Phase 4) und weitere Stores müssen dasselbe tun.
- [ ] **Sprache aus dem Nutzerprofil:** Der Sprachschalter merkt sich die Wahl vorerst nur in `localStorage`. Sobald das Profil die Sprache speichern kann, gewinnt nach dem Login das Profil (siehe [Konventionen](conventions.md), i18n).

## Gruppen

- [ ] **Account löschen und letzter Owner:** Löscht der letzte Owner einer Gruppe seinen Account, fällt seine Mitgliedschaft per `ON DELETE CASCADE` weg und die Gruppe hat keinen Owner mehr. Beim Bau der Account-Löschung festlegen: vorher einen Owner bestimmen lassen, das älteste Mitglied automatisch befördern oder leere Gruppen löschen.
- [ ] **Owner-Übergabe:** Der Owner kann die Gruppe nur löschen, nicht übergeben (siehe [Überblick](overview.md)). Nachrüsten, falls sich das im Alltag als Lücke zeigt.
- [ ] **Abgelaufene Einladungen aufräumen:** Abgelaufene und widerrufene Zeilen in `group_invites` werden nur ignoriert, nie gelöscht. Zusammen mit dem Aufräum-Job für Sessions und `processed_ops` (Phase 5) umsetzen.
- [ ] **Lange Gruppennamen:** Im Frontend mit „…“ abschneiden, wenn der Name nicht in die Zeile passt (bis 30 Zeichen erlaubt).

## Komponenten

- [ ] **`BaseButton`:** Varianten `danger` und Größen ergänzen, sobald ein Screen sie braucht (laut [Konventionen](conventions.md) vorgesehen, im Login-Design noch nicht vorhanden).
