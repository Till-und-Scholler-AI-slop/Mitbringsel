# Aufgeschobene Punkte

Dinge, die bewusst auf später verschoben wurden, damit sie nicht verloren gehen. Erledigtes wird gestrichen (Zeile löschen), Neues mit kurzem Kontext ergänzt. Grundsätzliche offene Entscheidungen stehen in der [Roadmap](roadmap.md).

## Login

- [ ] **Datenschutz und Impressum:** Seiten anlegen und im Login-Footer links neben dem Sprachschalter verlinken (im Design vorgesehen). Hängt an der offenen Entscheidung in der Roadmap.
- [ ] **Google-App veröffentlichen:** Für den Status "In Produktion" im Google-Zustimmungsbildschirm braucht es einen Link zur Datenschutzerklärung (hängt am Punkt oben); bis dahin können sich nur eingetragene Testnutzer anmelden.
- [ ] **Stores bei Logout und abgelaufener Sitzung leeren:** Der Gruppen-Store leert sich selbst, sobald sich die Nutzer-ID ändert (`watch` auf die ID in `stores/groups.ts`). Der Listen-Store (`stores/lists.ts`) tut das auch. Der Artikel-Store (F3) muss dasselbe tun.
- [ ] **Sprache aus dem Nutzerprofil:** Der Sprachschalter merkt sich die Wahl vorerst nur in `localStorage`. Sobald das Profil die Sprache speichern kann, gewinnt nach dem Login das Profil (siehe [Konventionen](conventions.md), i18n).

## Gruppen

- [ ] **Account löschen und letzter Owner:** Löscht der letzte Owner einer Gruppe seinen Account, fällt seine Mitgliedschaft per `ON DELETE CASCADE` weg und die Gruppe hat keinen Owner mehr. Beim Bau der Account-Löschung festlegen: vorher einen Owner bestimmen lassen, das älteste Mitglied automatisch befördern oder leere Gruppen löschen.
- [ ] **Owner-Übergabe:** Der Owner kann die Gruppe nur löschen, nicht übergeben (siehe [Überblick](overview.md)). Nachrüsten, falls sich das im Alltag als Lücke zeigt.
- [ ] **Limit für Gruppen pro Nutzer:** `POST /api/v1/groups` legt beliebig viele Gruppen an; jeder angemeldete Nutzer könnte die Tabelle füllen. Vor dem öffentlichen Start eine Obergrenze (z.B. pro Nutzer und Mitglieder pro Gruppe) im Service festlegen, mit eigenem Fehlercode.
- [ ] **Limit für Listen pro Gruppe:** `Service.Create` im Paket `list` legt beliebig viele Listen an. Zusammen mit dem Gruppen-Limit eine Obergrenze im Service festlegen, mit eigenem Fehlercode.
- [ ] **Abgelaufene Einladungen aufräumen:** Abgelaufene und widerrufene Zeilen in `group_invites` werden nur ignoriert, nie gelöscht. Zusammen mit dem Aufräum-Job für Sessions und `processed_ops` (Phase 5) umsetzen.

## Artikel

- [ ] **Abgehakte gesammelt entfernen:** Die Übersicht verlangt "abgehakte Artikel können gesammelt entfernt werden". Das erzeugt viele Tombstones auf einmal und gehört zum Sync (Phase 5): als eine Nachricht, die für jeden Artikel einen Tombstone und eine `serverSeq` vergibt.
- [ ] **Tombstones nach 30 Tagen löschen:** Gelöschte Artikel bleiben vorerst für immer in `items`. Zusammen mit dem Aufräum-Job für Sessions, Einladungen und `processed_ops` (Phase 5) umsetzen; danach muss ein Client mit zu alter `serverSeq` einen vollständigen Abgleich bekommen.

## Start

- [ ] **Offline-Text der Startseite:** Der Hinweis sagt ehrlich, dass Gründen und Ändern ohne Internet nicht gehen. Mit Offline-Bearbeitung (Phase 6) auf den Text aus dem Design umstellen („Du kannst deine Haushalte trotzdem öffnen und bearbeiten …“).
- [ ] **Listen-Chips und letzte Aktivität auf den Haushalt-Karten:** Das Design zeigt sie, sie brauchen Listen und Artikel (Phase 4).
- [ ] **Desktop-Rahmen mit Seitenleiste:** Das Design hat auf dem Desktop eine Navigation links (Start, Haushalte, Listen). Die Startseite ist vorerst einspaltig; die Seitenleiste mit dem Haushalt- und Listen-Screen bauen (Phase 4).
- [ ] **Sync-Anzeige im Kopf:** Der Status-Chip (synchron, offline, ausstehend) fehlt; `BaseSyncIndicator` kommt mit dem Live-Sync (Phase 5).
- [ ] **Health-Store ungenutzt:** Die Startseite zeigt den Serverstatus nicht mehr. `stores/health.ts` samt Service und Tests ist aktuell nirgends eingebunden; entscheiden, ob er gelöscht oder für eine Statusanzeige genutzt wird.

## Verwalten

- [ ] **Desktop-Variante des Verwalten-Screens:** Das Design (`verwalten-desktop-*`) setzt Name und Mitglieder neben Einladung und Austreten. `GroupSettingsView` ist vorerst einspaltig.
- [ ] **Zurück zum Haushalt:** Der Pfeil im Kopf führt vorerst zur Startseite. Mit dem Haushalt-Screen (Phase 4) dorthin zurückführen, und die `GroupCard` zum Haushalt verlinken statt nur zu den Einstellungen.
- [ ] **Namensformular teilen:** `RenameGroupDialog` und `CreateGroupDialog` sind fast gleich (Validierung, Fehleranzeige, Buttons). Bei einer dritten Verwendung ein gemeinsames Formular herausziehen.

## Einladung

- [ ] **Desktop-Variante der Einladungsseite:** Das Design (`markt2-einladung-desktop-*`) setzt Kopf und Karte nebeneinander. `InviteView` ist vorerst einspaltig und zentriert, wie auf dem Handy.
- [ ] **„Erstellt von dir“ bei offenen Links:** Das Design markiert die eigenen Links. `Invite` liefert nur `createdByName`; Namen sind nicht eindeutig, also steht überall „Erstellt von {Name}“. Mit einer Ersteller-ID im Schema (`api/openapi.yaml`) nachrüsten.
- [ ] **Ablaufdatum der Einladung anzeigen:** Die Vorschau liefert `expiresAt`, die Seite zeigt es nicht (im Design nicht vorgesehen).

## Komponenten

- [ ] **`BaseButton`-Größen:** Größen ergänzen, sobald ein Screen sie braucht (laut [Konventionen](conventions.md) vorgesehen). Die Variante `danger` gibt es seit dem Verwalten-Screen.
