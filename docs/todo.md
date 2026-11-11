# Aufgeschobene Punkte

Dinge, die bewusst auf später verschoben wurden, damit sie nicht verloren gehen. Erledigtes wird gestrichen (Zeile löschen), Neues mit kurzem Kontext ergänzt. Grundsätzliche offene Entscheidungen stehen in der [Roadmap](roadmap.md).

## Design-Abgleich

Die Umsetzung weicht an grundlegenden Stellen vom Design ab (siehe [Design](design.md), Navigation und Desktop). Reihenfolge der Schritte, je ein PR:

- [ ] **Dialoge von Verwalten nach dem Design** (`verwalten-aktionen-hell`, `verwalten-entfernen-hell`, `verwalten-umbenennen-hell`, `verwalten-umbenennen-zulang-*`): Mitglied-Aktionen, Entfernen-Bestätigung und Umbenennen angleichen; die Seite selbst ist angeglichen, die Dialoge noch im alten Stil. Den Sync-Chip „Alles synchron“ im Kopf gibt es erst mit dem Sync.
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
- [ ] **Abgelaufene Einladungen aufräumen:** Abgelaufene und widerrufene Zeilen in `group_invites` werden nur ignoriert, nie gelöscht. Mit dem Aufräum-Job für Sessions (Phase 5, Schritt 10) umsetzen.

## Artikel

- [ ] **Symbol und Farbe pro Liste:** Die Chips im Design haben links einen Kreis in der Listenfarbe mit Symbol (🛒, 🧴, 🔨), auch auf den Karten der Startseite und in der Desktop-Seitenleiste. `lists` hat dafür keine Spalten; braucht eine Schema- und API-Änderung.
- [ ] **Artikel anlegen, bearbeiten und löschen in der UI:** Die Listenansicht kann nur abhaken. `create`, `update` und `remove` im Artikel-Store sind fertig und getestet, aber ohne Oberfläche. Design: Bottom Sheet auf dem Smartphone, Panel auf dem Desktop.
- [ ] **Hervorhebung und Uhr-Symbol in der Artikelzeile:** Das Design markiert kürzlich von anderen geänderte Artikel („gerade geändert") und noch nicht synchronisierte mit einer Uhr. Die Hervorhebung kommt in Phase 5 (Schritt 9), die Uhr mit der Outbox in Phase 6.
- [ ] **Abgehakte gesammelt entfernen:** Die Übersicht verlangt "abgehakte Artikel können gesammelt entfernt werden". Phase 5, Schritt 11: REST-Endpunkt `POST /lists/{listId}/items/remove-checked`, eine Transaktion, pro Artikel ein Tombstone und eine `serverSeq`, ein Ereignis `itemsDeleted`.
- [ ] **Tombstones nach 30 Tagen löschen:** Gelöschte Artikel bleiben vorerst für immer in `items`. Phase 6, zusammen mit `sync` und dem Aufräum-Job für `processed_ops`; danach muss ein Client mit zu alter `serverSeq` einen vollständigen Abgleich bekommen.
- [ ] **Listen-Tombstones oder Neuabgleich für `sync`:** Listen werden hart gelöscht (kaskadierend, kein Tombstone), ein Client mit alter `serverSeq` erfährt von gelöschten Listen also nichts. Für `sync` in Phase 6 entweder Listen-Tombstones einführen oder einen vollständigen Neuabgleich der Listen verlangen.

## Live-Sync

- [ ] **Lesegrenze des WebSocket für `mutate` anheben:** `wsReadLimit` in `httpapi/ws.go` steht auf 4 KiB, weil es nur `ping` gibt. Mit `mutate` und `sync` in Phase 6 an die größte erlaubte Nachricht anpassen.
- [ ] **Traefik-Timeout auf Staging prüfen:** Phase 5, Schritt 8: Eine Verbindung länger als 2 Minuten offen halten (auch ohne Änderungen, nur mit den `ping`-Nachrichten) und sehen, ob Traefik sie trennt (`respondingTimeouts.readTimeout`, Standard 60 Sekunden). Falls ja, am Entrypoint anheben oder abschalten.
- [ ] **Beim Herunterfahren auf Close-Frames warten:** `hub.Close` stößt das Schließen nur an; `main` wartet nicht, bis die Handler die Close-Frames geschrieben haben, und beendet den Prozess womöglich vorher (die Clients sehen dann 1006 statt 1001). Einen `sync.WaitGroup` über die aktiven WebSocket-Handler führen und in `main` mit `shutdownCtx` abwarten.
- [ ] **Elfter offener Tab bleibt offline:** Der Server erlaubt 10 gleichzeitige Verbindungen pro Nutzer und antwortet auf die elfte mit `429` (siehe [Authentifizierung](auth.md)). Der Browser zeigt davon nur 1006, der Client versucht es mit Backoff weiter und bleibt `offline`; die Sitzungsprüfung per `GET /me` hilft nicht, weil die Session gültig ist. Falls sich das im Alltag zeigt: Tabs eine Verbindung teilen lassen (`BroadcastChannel` oder `SharedWorker`) oder den Hinweis in der UI erklären.

## Start

- [ ] **Offline-Text der Startseite:** Der Hinweis sagt ehrlich, dass Gründen und Ändern ohne Internet nicht gehen. Mit Offline-Bearbeitung (Phase 6) auf den Text aus dem Design umstellen („Du kannst deine Haushalte trotzdem öffnen und bearbeiten …“).
- [ ] **Zähler und letzte Aktivität auf den Haushalt-Karten:** Die Chips auf den Karten (Iteration 1) zeigen die Zahl offener Artikel; `List` liefert sie nicht, dafür braucht die API ein Feld oder einen eigenen Endpunkt. Die letzte Aktivität („Mehmet hat Hafermilch abgehakt“) braucht den Sync (Phase 5).
- [ ] **Sync-Anzeige im Kopf:** Der Status-Chip (synchron, offline, ausstehend) fehlt; `BaseSyncIndicator` kommt mit dem Live-Sync (Phase 5, Schritt 9).
- [ ] **Hinweis beim Rauswurf aus einem Haushalt:** Wird man entfernt oder der Haushalt gelöscht, während er offen ist, wechselt die App nur still zur Startseite (`useLeaveRemovedGroup`). Mit `BaseToast` einen Hinweis zeigen („Du wurdest aus ‚WG Kaiserstraße 12‘ entfernt“ bzw. „… wurde gelöscht“); den Grund liefert `groupRemoved` (`reason`), den Namen hat der Gruppen-Store vor dem Verwerfen.
- [ ] **Health-Store ungenutzt:** Die Startseite zeigt den Serverstatus nicht mehr. `stores/health.ts` samt Service und Tests ist aktuell nirgends eingebunden; entscheiden, ob er gelöscht oder für eine Statusanzeige genutzt wird.

## Verwalten

- [ ] **Namensformular teilen:** `RenameGroupDialog` und `CreateGroupDialog` sind fast gleich (Validierung, Fehleranzeige, Buttons). Mit `ListNameDialog` (Anlegen und Umbenennen von Listen) gibt es eine dritte Verwendung: jetzt ein gemeinsames Formular herausziehen.

## Einladung

- [ ] **„Erstellt von dir“ bei offenen Links:** Das Design markiert die eigenen Links. `Invite` liefert nur `createdByName`; Namen sind nicht eindeutig, also steht überall „Erstellt von {Name}“. Mit einer Ersteller-ID im Schema (`api/openapi.yaml`) nachrüsten.
- [ ] **Ablaufdatum der Einladung anzeigen:** Die Vorschau liefert `expiresAt`, die Seite zeigt es nicht (im Design nicht vorgesehen).

## Komponenten

- [ ] **Fehlende Basis-Komponenten:** In den [Konventionen](conventions.md) stehen `BaseCheckbox`, `BaseSelect`, `BaseTextarea` und `BaseToast`, die es noch nicht gibt (`BaseModal` und `BaseBottomSheet` deckt `BaseDialog` ab, `BaseSyncIndicator` kommt mit dem Sync in Phase 5). Bauen, sobald ein Screen sie braucht.
- [ ] **`BaseButton`-Größen:** Größen ergänzen, sobald ein Screen sie braucht (laut [Konventionen](conventions.md) vorgesehen). Die Variante `danger` gibt es seit dem Verwalten-Screen.
