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
- Artikel hinzufügen und bearbeiten (Bottom Sheet auf dem Smartphone, Panel neben der Liste auf dem Desktop)
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

- **Start und Listenansicht** teilen einen Rahmen mit grüner Seitenleiste links: Logo, Start, die Haushalte mit aufklappbaren Listen, „Haushalt gründen“, Sync-Status und Profil (`start-desktop-*`, `StartApp` mit `layout="desktop"`). Rechts der Inhalt: auf der Startseite die Haushalt-Karten, in der Liste der Haushaltsname groß mit Wechsler und die Chips umbrechend statt scrollend.
- **Artikel anlegen und bearbeiten** als Panel rechts neben der Liste (`markt2-desktop-*`).
- **Verwalten** zweispaltig: links Name und Mitglieder, rechts Einladung und Austreten/Löschen (`verwalten-desktop-*`).
- **Einladung** mit Kopf und Karte nebeneinander (`markt2-einladung-desktop-*`).
- **Login** nach `login-desktop-*`.

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
