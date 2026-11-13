# Aufgeschobene Punkte

Dinge, die bewusst auf später verschoben wurden, damit sie nicht verloren gehen. Erledigtes wird gestrichen (Zeile löschen), Neues mit kurzem Kontext ergänzt. Grundsätzliche offene Entscheidungen stehen in der [Roadmap](roadmap.md).

## Design-Abgleich

Die Umsetzung weicht an grundlegenden Stellen vom Design ab (siehe [Design](design.md), Navigation und Desktop). Reihenfolge der Schritte, je ein PR:

- [ ] **Dialoge von Verwalten nach dem Design** (`verwalten-aktionen-hell`, `verwalten-entfernen-hell`, `verwalten-umbenennen-hell`, `verwalten-umbenennen-zulang-*`): Mitglied-Aktionen, Entfernen-Bestätigung und Umbenennen angleichen; die Seite selbst ist angeglichen, die Dialoge noch im alten Stil.
- [ ] **Desktop-Varianten von Verwalten und Einladung** (`verwalten-desktop-*`, `markt2-einladung-desktop-*`): Verwalten zweispaltig, Einladung mit Kopf und Karte nebeneinander. `GroupSettingsView` und `InviteView` sind vorerst einspaltig.
- [ ] **Feinabgleich Listenansicht** (`markt2-liste-hell`): aktiver Chip mit Innenschatten und Druck-/Rückfeder-Animation, erledigte Artikel 17/22 px mit 14 px Innenabstand, Mengen-Pille 3/10 px, Zeilen-Innenabstand `10px 4px 10px 14px`.

## Login

- [ ] **Datenschutz und Impressum:** Seiten anlegen und im Login-Footer links neben dem Sprachschalter verlinken (im Design vorgesehen). Hängt an der offenen Entscheidung in der Roadmap.
- [ ] **Google-App veröffentlichen:** Für den Status "In Produktion" im Google-Zustimmungsbildschirm braucht es einen Link zur Datenschutzerklärung (hängt am Punkt oben); bis dahin können sich nur eingetragene Testnutzer anmelden.
- [ ] **Sprache aus dem Nutzerprofil:** Der Sprachschalter merkt sich die Wahl vorerst nur in `localStorage`. Sobald das Profil die Sprache speichern kann, gewinnt nach dem Login das Profil (siehe [Konventionen](conventions.md), i18n).

## Gruppen

- [ ] **Account löschen und letzter Owner:** Löscht der letzte Owner einer Gruppe seinen Account, fällt seine Mitgliedschaft per `ON DELETE CASCADE` weg und die Gruppe hat keinen Owner mehr. Beim Bau der Account-Löschung festlegen: vorher einen Owner bestimmen lassen, das älteste Mitglied automatisch befördern oder leere Gruppen löschen.
- [ ] **Owner-Übergabe:** Der Owner kann die Gruppe nur löschen, nicht übergeben (siehe [Überblick](overview.md)). Nachrüsten, falls sich das im Alltag als Lücke zeigt.
- [ ] **Limit für Gruppen pro Nutzer:** `POST /api/v1/groups` legt beliebig viele Gruppen an; jeder angemeldete Nutzer könnte die Tabelle füllen. Vor dem öffentlichen Start eine Obergrenze (z.B. pro Nutzer und Mitglieder pro Gruppe) im Service festlegen, mit eigenem Fehlercode.
- [ ] **Limit für Listen pro Gruppe:** `Service.Create` im Paket `list` legt beliebig viele Listen an. Zusammen mit dem Gruppen-Limit eine Obergrenze im Service festlegen, mit eigenem Fehlercode.

## Artikel

- [ ] **Symbol und Farbe pro Liste:** Die Chips im Design haben links einen Kreis in der Listenfarbe mit Symbol (🛒, 🧴, 🔨), auch auf den Karten der Startseite und in der Desktop-Seitenleiste. `lists` hat dafür keine Spalten; braucht eine Schema- und API-Änderung.
- [ ] **Artikel anlegen, bearbeiten und löschen in der UI:** Die Listenansicht kann nur abhaken. `create`, `update` und `remove` im Artikel-Store sind fertig und getestet, aber ohne Oberfläche. Design: Bottom Sheet auf dem Smartphone, Panel auf dem Desktop.
- [ ] **Abgehakte entfernen übersteht kein Schließen des Tabs:** `useRemoveChecked` sendet erst, wenn der Toast endet (etwa 5 Sekunden). Wird der Tab vorher geschlossen, bleibt alles auf dem Server, und die Artikel stehen beim nächsten Öffnen wieder da. Mit der Outbox in Phase 6 das Entfernen sofort in die Outbox legen und erst beim Senden die Zeit des Toasts abwarten, oder beim Verlassen der Seite (`pagehide`) sofort senden.
- [ ] **Uhr-Symbol in der Artikelzeile:** Das Design markiert noch nicht synchronisierte Artikel mit einer Uhr („Noch nicht synchronisiert“). Kommt mit der Outbox in Phase 6.
- [ ] **Tombstones nach 30 Tagen löschen:** Gelöschte Artikel bleiben vorerst für immer in `items`. Phase 6, zusammen mit `sync` und dem Aufräum-Job für `processed_ops` (als weitere `cleanup.Task`); danach muss ein Client mit zu alter `serverSeq` einen vollständigen Abgleich bekommen.
- [ ] **Listen-Tombstones oder Neuabgleich für `sync`:** Listen werden hart gelöscht (kaskadierend, kein Tombstone), ein Client mit alter `serverSeq` erfährt von gelöschten Listen also nichts. Für `sync` in Phase 6 entweder Listen-Tombstones einführen oder einen vollständigen Neuabgleich der Listen verlangen.

## Live-Sync

- [ ] **Lesegrenze des WebSocket für `mutate` anheben:** `wsReadLimit` in `httpapi/ws.go` steht auf 4 KiB, weil es nur `ping` gibt. Mit `mutate` und `sync` in Phase 6 an die größte erlaubte Nachricht anpassen.
- [ ] **Beim Herunterfahren auf Close-Frames warten:** `hub.Close` stößt das Schließen nur an; `main` wartet nicht, bis die Handler die Close-Frames geschrieben haben, und beendet den Prozess womöglich vorher (die Clients sehen dann 1006 statt 1001). Einen `sync.WaitGroup` über die aktiven WebSocket-Handler führen und in `main` mit `shutdownCtx` abwarten.
- [ ] **Elfter offener Tab bleibt offline:** Der Server erlaubt 10 gleichzeitige Verbindungen pro Nutzer und antwortet auf die elfte mit `429` (siehe [Authentifizierung](auth.md)). Der Browser zeigt davon nur 1006, der Client versucht es mit Backoff weiter und bleibt `offline`; die Sitzungsprüfung per `GET /me` hilft nicht, weil die Session gültig ist. Falls sich das im Alltag zeigt: Tabs eine Verbindung teilen lassen (`BroadcastChannel` oder `SharedWorker`) oder den Hinweis in der UI erklären.

## Start

- [ ] **Offline-Text der Startseite:** Der Hinweis sagt ehrlich, dass Gründen und Ändern ohne Internet nicht gehen. Mit Offline-Bearbeitung (Phase 6) auf den Text aus dem Design umstellen („Du kannst deine Haushalte trotzdem öffnen und bearbeiten …“).
- [ ] **Zähler und letzte Aktivität auf den Haushalt-Karten:** Die Chips auf den Karten (Iteration 1) zeigen die Zahl offener Artikel; `List` liefert sie nicht, dafür braucht die API ein Feld oder einen eigenen Endpunkt. Die letzte Aktivität („Mehmet hat Hafermilch abgehakt“) braucht den Sync (Phase 5).
- [ ] **Sync-Chip in Phase 6:** `BaseSyncIndicator` kennt nur „Synchron“ und „Offline“. Mit der Outbox den gelben Zustand „n ausstehend“ und „Offline · n ausstehend“ ergänzen und den Hinweis in der Seitenleiste auf die Texte aus dem Design umstellen („Änderungen bleiben auf diesem Gerät und gehen raus, sobald du wieder online bist.“, „Wird gerade an die WG übertragen …“).
- [ ] **Health-Store ungenutzt:** Die Startseite zeigt den Serverstatus nicht mehr. `stores/health.ts` samt Service und Tests ist aktuell nirgends eingebunden; entscheiden, ob er gelöscht oder für eine Statusanzeige genutzt wird.

## Verwalten

- [ ] **Namensformular teilen:** `RenameGroupDialog` und `CreateGroupDialog` sind fast gleich (Validierung, Fehleranzeige, Buttons). Mit `ListNameDialog` (Anlegen und Umbenennen von Listen) gibt es eine dritte Verwendung: jetzt ein gemeinsames Formular herausziehen.

## Einladung

- [ ] **„Erstellt von dir“ bei offenen Links:** Das Design markiert die eigenen Links. `Invite` liefert nur `createdByName`; Namen sind nicht eindeutig, also steht überall „Erstellt von {Name}“. Mit einer Ersteller-ID im Schema (`api/openapi.yaml`) nachrüsten.
- [ ] **Ablaufdatum der Einladung anzeigen:** Die Vorschau liefert `expiresAt`, die Seite zeigt es nicht (im Design nicht vorgesehen).

## Komponenten

- [ ] **Fehlende Basis-Komponenten:** In den [Konventionen](conventions.md) stehen `BaseCheckbox`, `BaseSelect` und `BaseTextarea`, die es noch nicht gibt (`BaseModal` und `BaseBottomSheet` deckt `BaseDialog` ab). Bauen, sobald ein Screen sie braucht.
- [ ] **Toasts über der Eingabeleiste:** Das Design (`toast-*`) setzt den Stapel auf dem Smartphone 8 px über die Eingabeleiste der Listenansicht. Die gibt es noch nicht, deshalb steht er vorerst 16 px über der Safe-Area (`AppToasts`). Mit „Artikel anlegen“ nachziehen.
- [ ] **Toasts außerhalb von `AppFrame`:** Der Stapel hängt in `AppFrame`, also nur auf Start- und Listenansicht. Braucht ein anderer Screen (Verwalten, Einladung) einen Toast, den Stapel nach `App.vue` ziehen und die Position auf dem Desktop von der Seitenleiste abhängig machen.
- [ ] **`BaseButton`-Größen:** Größen ergänzen, sobald ein Screen sie braucht (laut [Konventionen](conventions.md) vorgesehen). Die Variante `danger` gibt es seit dem Verwalten-Screen.
