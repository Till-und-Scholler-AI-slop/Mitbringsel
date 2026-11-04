# Aufgeschobene Punkte

Dinge, die bewusst auf später verschoben wurden, damit sie nicht verloren gehen. Erledigtes wird gestrichen (Zeile löschen), Neues mit kurzem Kontext ergänzt. Grundsätzliche offene Entscheidungen stehen in der [Roadmap](roadmap.md).

## Login

- [ ] **Datenschutz und Impressum:** Seiten anlegen und im Login-Footer links neben dem Sprachschalter verlinken (im Design vorgesehen). Hängt an der offenen Entscheidung in der Roadmap.
- [ ] **Einladungslink-Zustand:** Login-Variante „Anmelden und beitreten“ mit Einladungskarte (Einladende Person, Gruppe, Mitglieder). Kommt mit Phase 3 (Gruppen und Einladungen).
- [ ] **Google-App veröffentlichen:** Für den Status "In Produktion" im Google-Zustimmungsbildschirm braucht es einen Link zur Datenschutzerklärung (hängt am Punkt oben); bis dahin können sich nur eingetragene Testnutzer anmelden.
- [ ] **Stores bei Logout und abgelaufener Sitzung leeren:** Der Gruppen-Store leert sich selbst, sobald sich die Nutzer-ID ändert (`watch` auf die ID in `stores/groups.ts`). Listen-Store (Phase 4) und weitere Stores müssen dasselbe tun.
- [ ] **Sprache aus dem Nutzerprofil:** Der Sprachschalter merkt sich die Wahl vorerst nur in `localStorage`. Sobald das Profil die Sprache speichern kann, gewinnt nach dem Login das Profil (siehe [Konventionen](conventions.md), i18n).

## Gruppen

- [ ] **Account löschen und letzter Owner:** Löscht der letzte Owner einer Gruppe seinen Account, fällt seine Mitgliedschaft per `ON DELETE CASCADE` weg und die Gruppe hat keinen Owner mehr. Beim Bau der Account-Löschung festlegen: vorher einen Owner bestimmen lassen, das älteste Mitglied automatisch befördern oder leere Gruppen löschen.
- [ ] **Owner-Übergabe:** Der Owner kann die Gruppe nur löschen, nicht übergeben (siehe [Überblick](overview.md)). Nachrüsten, falls sich das im Alltag als Lücke zeigt.
- [ ] **Abgelaufene Einladungen aufräumen:** Abgelaufene und widerrufene Zeilen in `group_invites` werden nur ignoriert, nie gelöscht. Zusammen mit dem Aufräum-Job für Sessions und `processed_ops` (Phase 5) umsetzen.

## Start

- [ ] **Offline-Text der Startseite:** Der Hinweis sagt ehrlich, dass Gründen und Ändern ohne Internet nicht gehen. Mit Offline-Bearbeitung (Phase 6) auf den Text aus dem Design umstellen („Du kannst deine Haushalte trotzdem öffnen und bearbeiten …“).
- [ ] **Listen-Chips und letzte Aktivität auf den Haushalt-Karten:** Das Design zeigt sie, sie brauchen Listen und Artikel (Phase 4).
- [ ] **Desktop-Rahmen mit Seitenleiste:** Das Design hat auf dem Desktop eine Navigation links (Start, Haushalte, Listen). Die Startseite ist vorerst einspaltig; die Seitenleiste mit dem Haushalt- und Listen-Screen bauen (Phase 4).
- [ ] **Sync-Anzeige im Kopf:** Der Status-Chip (synchron, offline, ausstehend) fehlt; `BaseSyncIndicator` kommt mit dem Live-Sync (Phase 5).
- [ ] **Health-Store ungenutzt:** Die Startseite zeigt den Serverstatus nicht mehr. `stores/health.ts` samt Service und Tests ist aktuell nirgends eingebunden; entscheiden, ob er gelöscht oder für eine Statusanzeige genutzt wird.

## Einladung

- [ ] **Desktop-Variante der Einladungsseite:** Das Design (`markt2-einladung-desktop-*`) setzt Kopf und Karte nebeneinander. `InviteView` ist vorerst einspaltig und zentriert, wie auf dem Handy.
- [ ] **Einladungsseite ohne Anmeldung:** `/invite/:token` verlangt noch eine Anmeldung und das Ziel geht beim Login verloren (Phase 3, Schritt 3b zusammen mit „Einladungslink-Zustand“ im Login).
- [ ] **Ablaufdatum der Einladung anzeigen:** Die Vorschau liefert `expiresAt`, die Seite zeigt es nicht (im Design nicht vorgesehen).

## Komponenten

- [ ] **`BaseButton`:** Varianten `danger` und Größen ergänzen, sobald ein Screen sie braucht (laut [Konventionen](conventions.md) vorgesehen, im Login-Design noch nicht vorhanden).
