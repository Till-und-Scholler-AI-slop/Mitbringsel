# Design mit Claude Design

Das visuelle Design entsteht in Claude Design. Gewählt ist die Richtung „Markt bunt“ (Iteration 4 von „Kräftig & farbig“), der Login folgt Iteration 2 mit kompaktem Kopf, die Startseite Iteration 1 (Seite „Start“, `start-*` und `StartApp`). Das Frontend übernimmt daraus Design-Tokens und Layouts, schreibt die Komponenten aber selbst in Vue nach. Generiertes HTML wird nie 1:1 kopiert.

## Vorgehen

1. **Vorschläge holen:** In Claude Design 2 bis 3 unterschiedliche Stilrichtungen für die Kern-Screens erstellen lassen, jeweils hell und dunkel.
2. **Richtung wählen:** Ich entscheide mich für eine Richtung und lasse sie dort verfeinern.
3. **Tokens ableiten:** Farben, Typografie, Abstände, Radien und Schatten werden als CSS Custom Properties in `styles/tokens.css` festgehalten, mit je einem Satz für hell und dunkel.
4. **Komponenten bauen:** Der Agent baut zuerst die `Base`-Komponenten nach dem Design (siehe [Konventionen](conventions.md)), dann die fachlichen Komponenten und Views.
5. **Abgleich:** Weicht die Umsetzung vom Design ab, weil das Design technisch ungünstig ist (z.B. schlechte Touch-Ziele, zu wenig Kontrast), weist der Agent darauf hin, statt still abzuweichen.

## Kern-Screens

- Login
- Startseite mit den Haushalten
- Listenansicht mit Artikeln (Hauptscreen, Smartphone und Desktop)
- Artikel hinzufügen und bearbeiten (Bottom Sheet auf dem Smartphone, Dialog auf dem Desktop, Karte in der Kontextspalte auf großen Bildschirmen)
- Haushalt verwalten und Einladungslink teilen
- Einstellungen (Sprache, Theme, Account)
- Zustände: leere Liste, offline, Synchronisation läuft, Fehler

## Navigation

Es gibt keinen eigenen Screen mit der Listenübersicht eines Haushalts. Wer einen Haushalt öffnet, landet direkt in einer Liste: in der zuletzt geöffneten (pro Gerät gemerkt), sonst in der ersten aktiven. Hat der Haushalt keine Liste, zeigt die Listenansicht einen Leerzustand mit „Liste anlegen“.

- **Listen wechseln:** über die Chips im Kopf der Listenansicht.
- **Listen-Aktionen** (umbenennen, archivieren, löschen): Chip gedrückt halten (Touch), Rechtsklick (Maus) oder den schon aktiven Chip noch einmal antippen bzw. mit Enter auslösen (Tastatur, Screenreader). Auf dem Desktop öffnen sie sich ebenso über Rechtsklick oder die Kontextmenütaste (`Umschalt+F10`) auf einem Listeneintrag in der Seitenleiste.
- **Archivierte Listen:** ein Chip „Archiv (n)“ am Ende der Chip-Reihe.
- **Haushalt wechseln:** Wechsler-Menü am Haushaltsnamen im Kopf der Listenansicht (`start-4-wechsler`). Es enthält die Haushalte, „Haushalt verwalten“, „Haushalt gründen“, „Einladungslink einfügen“ und „Alle Haushalte“.
- **Haushalt verwalten:** eigener Screen (`verwalten-*`), erreichbar über das Wechsler-Menü und auf dem Desktop über die Seitenleiste. Die Karten der Startseite haben kein Zahnrad.

## Desktop

Ab `48rem` Breite gilt ein eigenes Layout, nicht das gestreckte Smartphone-Layout:

- **Start und Listenansicht** teilen einen Rahmen mit grüner Seitenleiste links (`start-desktop-*`, `StartApp` mit `layout="desktop"`). Rechts der Inhalt: auf der Startseite die Haushalt-Karten, in der Liste der Haushaltsname groß mit Wechsler und die Chips umbrechend statt scrollend.
- **Seitenleiste** nach dem Entwurf der Kontextspalte (`KontextDesktop`), für alle Desktop-Breiten ab `48rem`: eine schwebende Karte (16 px Abstand, Radius 28 px, 260 bis 300 px breit) mit Logo; der aktuelle Haushalt mit seinen offenen Artikeln und darunter seine Listen mit Icon, Name und offenen Artikeln, die aktuelle hervorgehoben, die angepinnte (siehe unten) mit Pin; die anderen Haushalte mit ihren offenen Artikeln; „Haushalt gründen“; Sync-Chip mit einer Zeile Text („Alles synchron“, „Alle sehen denselben Stand.“); Profil unten („Das bist du“). Die Zahlen kommen aus den lokalen Stores, die alle Haushalte vorladen.
- **Artikel anlegen und bearbeiten** zwischen `48rem` und `80rem` als Dialog, ab `80rem` in der Kontextspalte (siehe [Große Bildschirme](#große-bildschirme)).
- **Verwalten** zweispaltig: links Name und Mitglieder, rechts Einladung und Austreten/Löschen (`verwalten-desktop-*`).
- **Einladung** mit Kopf und Karte nebeneinander (`markt2-einladung-desktop-*`).
- **Login** nach `login-desktop-*`.

## Große Bildschirme

Ab `80rem` (1280 px) bekommt die Listenansicht eine Kontextspalte neben der Liste. Vorlage ist Claude Design, Seite „2 · Markt bunt“, Abschnitt „3d · Kontextspalte mit zwei Karten“ (Artboards `markt2-kontext-*`, Quellkomponente `KontextDesktop`); sie ersetzt den Entwurf `markt2-gross-*` und das Panel aus `markt2-desktop-*`. Entscheidungen und Alternativen: [ADR 0008](adr/0008-grosse-bildschirme.md).

### Breakpoints

| Breite | Layout |
| --- | --- |
| unter `48rem` | Smartphone |
| `48rem` bis unter `80rem` | Desktop mit Seitenleiste; Formular als Dialog, keine Kontextspalte |
| ab `80rem` | Kontextspalte; Listenspalte bis 820 px, Kontextspalte 440 px |
| ab `137.5rem` (2200 px) | Listenspalte bis 860 px, Kontextspalte 480 px; alles um 1.1 größer |

- Die Vergrößerung ab `137.5rem` läuft über `html { font-size: 110% }`, nicht über `zoom` wie im Design. Feste Breiten stehen deshalb in `rem`; Konturen und Schatten in `px` bleiben gleich.
- Unter `80rem` stapelt das Design die Karten unter die Liste. Das übernehmen wir nicht: Dort bleibt es beim Dialog.
- Media Queries können keine Variablen lesen ([ADR 0003](adr/0003-eigenes-css-mit-tokens.md)); `80rem` steht als `CONTEXT_COLUMN_QUERY` in `components/list/contextColumn.ts` und wird im CSS mit Verweis darauf wiederholt; `137.5rem` gibt es nur im CSS (`base.css`, `ListView.vue`).

### Aufbau

- **Kopf** über Liste und Kontextspalte: Haushaltsname (40 px) mit Wechsler, rechts die Avatare der Mitglieder.
- **Listenspalte:** Chips umbrechend mit „Archiv (n)“ und einem runden, gestrichelten Button „Neue Liste“ am Ende; Quick-Add mit Hinweis „Enter ↵“ im Feld und einem runden Button daneben, der die Erstellen-Karte öffnet (`aria-pressed`, solange sie offen ist); Artikelzeilen mit Chevron, leichtem Anheben beim Hover, der bearbeitete Artikel mit hellem Hintergrund und orangem Ring; darunter „Erledigt“.
- **Kontextspalte:** zentriert neben der Liste (Abstand 32 px), `sticky` (`top: 24px`, Höhe `min(812px, 100vh - 190px)`, mindestens 560 px), mit zwei Karten untereinander.

### Karten

Immer ist genau eine Karte offen. Sie nimmt die restliche Höhe ein und scrollt innen. Die andere klappt zu einer Leiste von 76 px zusammen (Icon, Titel, eine Zeile Zusammenfassung, Chevron); ein Klick darauf öffnet sie. Auf- und Zuklappen sind animiert, nicht bei `prefers-reduced-motion`. Die Leiste trägt `aria-expanded`, der Fokus geht in die geöffnete Karte.

- **Überblick** mit dem Umschalter „Aktivität“ | „Zweite Liste“.
  - *Aktivität:* „Zuletzt im Haushalt“, nach Tagen gruppiert („Heute“, „Gestern“); je Eintrag Avatar, Text („Mehmet hat Butter abgehakt“, eigene Einträge als „Du hast …“), Listen-Chip mit Icon und Zeit („vor 4 Min.“, „09:12“). Zugeklappt: der neueste Eintrag.
  - *Zweite Liste:* Chips der anderen aktiven Listen zur Auswahl, Kopf mit Icon, Name und „3 offen“, eigenes Quick-Add, kompakte Zeilen (Haken, Name, Notiz, Menge). Zugeklappt: „Bäcker · 3 offen · zuletzt Zimtschnecken“.
- **Erstellen/Bearbeiten** mit dem Formular (`ItemForm`).
  - *Neu:* Kopf „Neuer Artikel“, Marke „Neu in Supermarkt“. Zugeklappt: „Neuer Artikel · In Supermarkt · mit Menge, Einheit und Notiz“.
  - *Bearbeiten:* Kopf mit dem Artikelnamen, Marke „In Supermarkt“; ein Kasten „Eingetragen von Sophie · heute, 09:12“ und „Zuletzt geändert von Mehmet · vor 4 Min.“ (ein früheres Mitglied heißt „ehemaliges Mitglied“); Chips „In andere Liste verschieben“; „Löschen“ und „Speichern“; der Link „Stattdessen neuen Artikel anlegen“. Zugeklappt: „Tomaten bearbeiten · Noch nicht gespeichert · in Supermarkt“.

### Verhalten

- Nach dem Laden ist der Überblick offen. Bis es den Überblick gibt (#176), zeigt die Kontextspalte nur die Formular-Karte: ohne geöffneten Artikel ein leeres Formular für einen neuen.
- Der gewählte Tab und die angepinnte Liste werden pro Gerät und Haushalt gemerkt, nicht synchronisiert. Ohne gemerkten Tab öffnet „Aktivität“, ohne gemerkten Pin ist die erste andere aktive Liste angepinnt. Wird die angepinnte Liste die aktuelle, wechselt der Pin; eine archivierte oder gelöschte Liste wird vergessen. Hat der Haushalt nur eine aktive Liste, ist „Zweite Liste“ deaktiviert. Den Pin in der Seitenleiste gibt es nur, solange „Zweite Liste“ gewählt ist.
- Der Button am Quick-Add öffnet die Erstellen-Karte, ein Klick auf einen Artikel die Bearbeiten-Karte.
- Nach „Hinzufügen“ bleibt die Erstellen-Karte offen und leer, der Fokus geht zurück ins Namensfeld.
- Nach „Speichern“, „Löschen“, „Abbrechen“, Esc und dem Verschieben öffnet der Überblick. „Löschen“ zeigt den bekannten „Rückgängig“-Toast.
- Verschieben speichert die Werte im Formular mit.
- Ein Listenwechsel beim Bearbeiten schaltet auf „Neuer Artikel“ mit leerem Formular. Ein Klick auf einen anderen Artikel übernimmt dessen Werte; ungespeicherte Eingaben gehen ohne Rückfrage verloren.
- Die Aktivität sehen alle Mitglieder, auch Einträge aus archivierten Listen; sie reicht 30 Tage zurück.

## Name und Wortmarke

Die App heißt **Tuolino**, Entwurf auf Seite „9 · Name“ im Design-Canvas. Das Logo (`BrandLogo`) sind zwei Preisschilder nach Variante „9b · Zitrone & Beere (umgedreht)“: vorne ein Zitronen-Schild (`#F4F06B`) mit Beeren-Schrift (`#C2185B`), dahinter schräg ein Beeren-Schild, beide mit Loch, Tinten-Rand und hartem Schatten. Der Punkt des „i“ ist in allen Größen ein heller Lila-Kreis (`#DCCBFF`). Die drei Farben stehen als `--color-logo-*` in `tokens.css`. Interne Namen (IndexedDB, `localStorage`-Keys, Web-Locks, Postgres, Container-Images, Domains, Repo) heißen weiter `mitbringsel`.

## App-Icons (PWA)

Das App-Icon ist selbst das Preisschild (Variante „B · Das Icon ist das Etikett“ im Artboard „Preisschild · Tuolino · App-Icon“): die ganze Kachel Sonnengelb (`#FFD23F`) mit Tinten-Rand (`#16181D`), oben links ein grünes Loch (`#1F7A3A`) und ein leicht gedrehtes **T** (als SVG-Pfad, unabhängig von Systemschriften).

- `frontend/public/icon.svg`: abgerundete Kachel für Browser-Favicon und Standard-PNGs (`pwa-192x192.png`, `pwa-512x512.png`, `favicon.ico`).
- `frontend/public/icon-maskable.svg`: vollflächiges `#FFD23F` ohne Transparenz und ohne Rand, Loch und T innerhalb der zentralen 80 %-Safe-Zone für `pwa-512x512-maskable.png` und `apple-touch-icon.png` (180 × 180).

Neu erzeugen der Rasterdateien nach Änderungen an den SVGs (ohne neue Node-Dependency, mit `rsvg-convert` und ImageMagick `magick`):

```bash
rsvg-convert -w 192 -h 192 frontend/public/icon.svg -o frontend/public/pwa-192x192.png
rsvg-convert -w 512 -h 512 frontend/public/icon.svg -o frontend/public/pwa-512x512.png
rsvg-convert -w 512 -h 512 frontend/public/icon-maskable.svg -o frontend/public/pwa-512x512-maskable.png
rsvg-convert -w 180 -h 180 frontend/public/icon-maskable.svg -o frontend/public/apple-touch-icon.png
rsvg-convert -w 32 -h 32 frontend/public/icon.svg -o /tmp/favicon-32.png && magick /tmp/favicon-32.png frontend/public/favicon.ico && rm /tmp/favicon-32.png
```

Danach in `frontend/index.html` den Parameter `?v=` an den Icon-Links hochzählen: Browser halten Favicons in einem eigenen Cache und laden sie sonst nicht neu.

Alternativ lassen sich die PNGs auch mit `google-chrome-stable --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=W,H --screenshot=<ziel>.png file://<pfad>.svg` erzeugen (für transparente Ecken zusätzlich `--default-background-color=00000000`).

## Anforderungen an das Design

- Mobile first, Touch-Ziele mindestens 44 × 44 px, Artikel mit einer Hand im Supermarkt abhakbar
- Hell- und Dunkelmodus, Umschaltung nach System oder manuell
- Gut lesbar bei Sonnenlicht und schnellem Drüberschauen
- Sichtbarer Sync-Status, aber unaufdringlich
- Platz für längere deutsche Wörter ("Frühstücksflocken", "Spülmaschinentabs")

## Startprompt für Claude Design

```
Gestalte eine mobile-first Web-App für geteilte Einkaufslisten in WGs.
Screens: Listenansicht mit Artikeln (Name, optional Menge, Einheit, Notiz,
abhakbar, Avatar von wer es hinzugefügt hat), Artikel hinzufügen als
Bottom Sheet, Gruppen- und Listenübersicht, Einstellungen.
Zeige jeden Screen im Hell- und Dunkelmodus und auch als Desktop-Variante.
Ein dezenter Sync-Status (online, offline, synchronisiert) soll sichtbar sein.
Mach mir 3 deutlich unterschiedliche Stilrichtungen zur Auswahl.
```
