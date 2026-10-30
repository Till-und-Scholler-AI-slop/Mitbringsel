# Aufgeschobene Punkte

Dinge, die bewusst auf später verschoben wurden, damit sie nicht verloren gehen. Erledigtes wird gestrichen (Zeile löschen), Neues mit kurzem Kontext ergänzt. Grundsätzliche offene Entscheidungen stehen in der [Roadmap](roadmap.md).

## Login

- [ ] **Datenschutz und Impressum:** Seiten anlegen und im Login-Footer links neben dem Sprachschalter verlinken (im Design vorgesehen). Hängt an der offenen Entscheidung in der Roadmap.
- [ ] **Einladungslink-Zustand:** Login-Variante „Anmelden und beitreten“ mit Einladungskarte (Einladende Person, Gruppe, Mitglieder). Kommt mit Phase 3 (Gruppen und Einladungen).
- [ ] **Fehler nach Google-Login:** Der Google-Callback im Backend leitet bei Abbruch oder Fehler auf `/login?error=<code>` um. Das Frontend zeigt dafür schon die Fehlerkarte (siehe [Authentifizierung](auth.md)).
- [ ] **Sitzung abgelaufen:** Bekommt das Frontend bei einem angemeldeten Nutzer ein `401`, leitet es auf `/login?reason=session_expired` um. Die Login-Seite zeigt den Hinweis schon an; die Umleitung im API-Client fehlt noch.
- [ ] **Sprache aus dem Nutzerprofil:** Der Sprachschalter merkt sich die Wahl vorerst nur in `localStorage`. Sobald das Profil die Sprache speichern kann, gewinnt nach dem Login das Profil (siehe [Konventionen](conventions.md), i18n).

## Komponenten

- [ ] **`BaseButton`:** Varianten `danger` und Größen ergänzen, sobald ein Screen sie braucht (laut [Konventionen](conventions.md) vorgesehen, im Login-Design noch nicht vorhanden).
