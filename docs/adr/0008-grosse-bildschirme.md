# 0008: Große Bildschirme: Kontextspalte, Aktivität auf dem Server, Verschieben per `listId`

Status: akzeptiert

## Kontext

Phase 7 setzt die Listenansicht für Full HD und WQHD nach Claude Design um (Seite „2 · Markt bunt“, Abschnitt „3d · Kontextspalte mit zwei Karten“, Artboards `markt2-kontext-*`, Quellkomponente `KontextDesktop`; ersetzt den Entwurf `markt2-gross-*`). Neben der Liste steht eine Kontextspalte mit zwei Karten: „Überblick“ (Aktivität des Haushalts oder eine angepinnte zweite Liste) und „Erstellen/Bearbeiten“. Die Bearbeiten-Karte zeigt, wer einen Artikel zuletzt geändert hat, und kann ihn in eine andere Liste verschieben. Siehe [Design](../design.md#große-bildschirme) und [Roadmap](../roadmap.md).

Vor dem Code waren acht Fragen offen (#172). Fakten aus dem Code, die sie beeinflusst haben:

- Das Panel für das Artikel-Formular erscheint heute ab `79rem` (`ITEM_PANEL_QUERY` in `components/list/itemPanel.ts`, wiederholt im CSS von `ListView.vue`).
- Die Tokens nutzen `rem` für Abstände, Radien und Schriften, `px` nur für Konturen (2–3 px) und Schatten. Media Queries in `rem` beziehen sich auf die Grundschrift des Browsers, nicht auf die `font-size` von `<html>`.
- Das Design stapelt die Karten unter 1280 px unter die Liste und skaliert ab 2200 px mit `zoom: 1.1`. Wann die breiteren WQHD-Spalten gelten, legt es nicht fest.
- `updateItem` ist `PATCH /items/{itemId}`, ohne Liste im Pfad. `field_clocks` ist `jsonb`.
- Items-Store, IndexedDB und die Anzeige ausstehender Änderungen sind pro Liste organisiert (`byList`, `writeItems(userId, listId)`).
- `items` hat kein `updated_at`. Live-Ereignisse tragen den ganzen Artikel, nicht die geänderten Felder; `recentChanges` lebt nur von Ereignissen und vergisst nach 5 s.
- Der Client kennt die Namen der aktuellen Mitglieder, nicht die früherer.
- Die zuletzt geöffnete Liste steht pro Gerät in `localStorage` (`services/lastList.ts`).

## Entscheidung

1. **Breakpoints und Skalierung**
   - Die Kontextspalte gilt ab `80rem` (1280 px) und ersetzt dort das Panel (`ITEM_PANEL_QUERY` wird `80rem`; Nachtrag #174: heißt jetzt `CONTEXT_COLUMN_QUERY` in `components/list/contextColumn.ts`). Zwischen `48rem` und `80rem` bleibt die Listenansicht wie heute: das Formular als Dialog, keine Überblick-Karte. Vom Design (Karten unter der Liste) weichen wir bewusst ab, weil die Karten unter einer langen Liste kaum erreichbar wären.
   - Spalten: Liste bis 820 px, Kontextspalte 440 px. Ab `137.5rem` (2200 px) gelten die WQHD-Maße 860 px und 480 px, und alles wird um den Faktor 1.1 größer.
   - Die Vergrößerung läuft über die Grundschrift (`html { font-size: 110% }` in der Media Query), nicht über `zoom`. Dafür stehen die festen Breiten in `rem` statt `px`. Konturen und Schatten in `px` bleiben gleich.
2. **Aktivität entsteht auf dem Server.** Ein Protokoll pro Haushalt, geschrieben in derselben Transaktion wie die Änderung, mit Endpunkt, Live-Ereignis und Aufräum-Job.
   - Zeitpunkt eines Eintrags ist die Serverzeit der Annahme (wie `createdAt`, `checkedAt`). Offline Gemachtes erscheint mit dem Zeitpunkt des Sendens.
   - Arten: eingetragen, abgehakt, wieder auf die Liste gesetzt, geändert (mit den neuen Werten), verschoben, gelöscht, „n Artikel aus Erledigt entfernt“. Eine Änderung, bei der kein Feld gewinnt, schreibt nichts. Listen-Aktionen (anlegen, umbenennen, archivieren) kommen vorerst nicht hinein.
   - Jeder Eintrag liefert den Namen des Akteurs mit (`actorName`, wie `Invite.createdByName`), `null` bei gelöschtem Account.
   - Der Feed wird nicht in IndexedDB gespeichert; offline zeigt er die bestehenden Lade- und Fehlerzustände.
3. **Verschieben ist eine Änderung von `listId`** über `updateItem`, mit eigener Uhr in `field_clocks` (LWW pro Feld wie die übrigen Felder, [ADR 0004](0004-lww-pro-feld.md)). Ziel muss eine aktive Liste desselben Haushalts sein: unbekannt, gelöscht oder fremder Haushalt gibt `404 LIST_NOT_FOUND`, archiviert `409 LIST_ARCHIVED` (neuer Code). Die Outbox verwirft beides mit Rollback und Hinweis. Verschieben speichert die Werte im Formular mit: ein `updateItem` mit `listId` und den geänderten Feldern.
   - Nachtrag #180: Das Ziel wird nur geprüft, wenn `listId` den Merge gewinnt; ein veraltetes oder wiederholtes Verschieben ist kein Fehler. Eine `listId` gleich der aktuellen Liste gilt wie jedes andere Feld. Wird die Zielliste zwischen Prüfung und Schreiben archiviert, nehmen wir das hin (der Artikel bleibt änderbar).
4. **`updatedBy` und `updatedAt`** am Artikel, gesetzt bei jeder angenommenen Änderung, bei der mindestens ein Feld gewinnt, auch beim Abhaken und Verschieben. Ist der Akteur kein Mitglied mehr, nennt die Oberfläche ihn „ehemaliges Mitglied“.
5. **Zweite Liste:** pro Gerät und Haushalt in `localStorage` gemerkt, zusammen mit dem gewählten Tab, nicht synchronisiert (wie `lastList`). Ohne gemerkten Tab öffnet „Aktivität“. Ohne gemerkten Pin ist die erste andere aktive Liste angepinnt. Wird die angepinnte Liste die aktuelle, wechselt der Pin auf eine andere; eine archivierte oder gelöschte Liste wird vergessen. Hat der Haushalt nur eine aktive Liste, ist der Tab „Zweite Liste“ deaktiviert.
   - Nachtrag #176: Bis es die Aktivität gibt (#185), gibt es weder Tabs noch einen gemerkten Tab; die Überblick-Karte zeigt die zweite Liste direkt und hat nur dann etwas zu zeigen, wenn es eine zweite aktive Liste gibt. Mit nur einer aktiven Liste fehlt die Karte, die Formular-Karte steht allein. Wird die angepinnte Liste die aktuelle, wird die bisher aktuelle Liste angepinnt (Vor und Zurück tauscht beide), sonst die erste andere.
6. **Eine Seitenleiste für alle Desktop-Breiten** ab `48rem` (Start und Liste): schwebende Karte mit offenen Artikeln, verschachtelten Listen und Pin.
7. **Formular in der Kontextspalte:** Nach „Hinzufügen“ bleibt es offen und leer, der Fokus geht ins Namensfeld. Nach „Speichern“, „Löschen“, „Abbrechen“, Esc und „Verschieben“ öffnet der Überblick. Ein Listenwechsel beim Bearbeiten schaltet auf „Neuer Artikel“. Ein Klick auf einen anderen Artikel verwirft ungespeicherte Eingaben ohne Rückfrage. Nach dem Neuladen ist der Überblick offen.
8. **Sichtbarkeit und Aufbewahrung der Aktivität:** Alle Mitglieder sehen die ganze Aktivität des Haushalts, auch Einträge von vor ihrem Beitritt und aus archivierten Listen. Einträge einer gelöschten Liste fallen mit ihr weg (`ON DELETE CASCADE`). Der Aufräum-Job löscht Einträge nach 30 Tagen, der Frist der Tombstones. Ein gelöschter Account lässt den Akteur leer (`NULL`).

Verworfene Alternativen:

- **Karten unter der Liste zwischen `48rem` und `80rem`** (Fallback im Design): unter einer langen Liste kaum erreichbar.
- **`zoom: 1.1`:** vergrößert auch Konturen und Schatten, verlangt die Höhenrechnung mit `/ 1.1` und ist in Firefox erst seit Version 126 da.
- **Aktivität nur aus Live-Ereignissen im Client:** nach jedem Neuladen leer, verpasst alles, während die App zu ist, und kennt die geänderten Felder nicht.
- **Aktivität aus `createdAt`/`checkedAt`:** zeigt weder Änderungen noch Verschieben, Löschen oder „aus Erledigt entfernt“.
- **Verschieben als Löschen und Neuanlegen:** neue ID, Autor und Erstellzeit gehen verloren, zwei Einträge in der Outbox, eine gleichzeitige Bearbeitung geht verloren, der Feed zeigt „gelöscht“ und „eingetragen“.
- **`updatedBy` nur für Name, Menge, Einheit und Notiz:** eine zweite Regel neben „jede angenommene Änderung“, und das Abhaken steht ohnehin in `checkedBy`.
- **„Zuletzt geändert“ aus der Aktivität ableiten:** nach 30 Tagen weg und offline nicht vorhanden.
- **Pin in IndexedDB pro Nutzer oder synchronisiert:** mehr Aufwand für eine Ansichtseinstellung eines Geräts.

## Konsequenzen

- Neue Schnittstellen: `Item.updatedBy`/`updatedAt`, `listId` in `UpdateItemRequest` und `ItemClocks`, `GET /groups/{groupId}/activity` und ein Live-Ereignis für neue Aktivität. `ItemClocks.listId` und die neuen Felder müssen in Daten älterer App-Versionen in IndexedDB fehlen dürfen.
- Migrationen: Spalten `updated_by`/`updated_at` an `items` (gefüllt aus `created_by`/`created_at`) und eine Tabelle für die Aktivität. Beide nur hinzufügend.
- Das Verschieben muss im Client einen Artikel samt ausstehender Änderung und Rollback zwischen zwei Listen bewegen; `itemChanged` mit neuer `listId` entfernt ihn aus der alten Liste.
- Der Feed ist so aktuell wie der Server: Was in der Outbox wartet, erscheint dort erst nach dem Senden.
- [Sync](../sync.md) und [Datenmodell](../data-model.md) werden in den PRs zu #180 und #183 ergänzt.
- Verschieben auf dem Smartphone und Listen-Aktionen im Feed sind nicht entworfen und bleiben eigene Issues im Backlog.
