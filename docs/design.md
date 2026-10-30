# Design mit Claude Design

Das visuelle Design entsteht in Claude Design. Gewählt ist die Richtung „Markt bunt“ (Iteration 4 von „Kräftig & farbig“), der Login folgt Iteration 2 mit kompaktem Kopf. Das Frontend übernimmt daraus Design-Tokens und Layouts, schreibt die Komponenten aber selbst in Vue nach. Generiertes HTML wird nie 1:1 kopiert.

## Vorgehen

1. **Vorschläge holen:** In Claude Design 2 bis 3 unterschiedliche Stilrichtungen für die Kern-Screens erstellen lassen, jeweils hell und dunkel.
2. **Richtung wählen:** Ich entscheide mich für eine Richtung und lasse sie dort verfeinern.
3. **Tokens ableiten:** Farben, Typografie, Abstände, Radien und Schatten werden als CSS Custom Properties in `styles/tokens.css` festgehalten, mit je einem Satz für hell und dunkel.
4. **Komponenten bauen:** Claude baut zuerst die `Base`-Komponenten nach dem Design (siehe [Konventionen](conventions.md)), dann die fachlichen Komponenten und Views.
5. **Abgleich:** Weicht die Umsetzung vom Design ab, weil das Design technisch ungünstig ist (z.B. schlechte Touch-Ziele, zu wenig Kontrast), weist Claude darauf hin, statt still abzuweichen.

## Kern-Screens

- Login
- Gruppenübersicht
- Listenübersicht einer Gruppe
- Listenansicht mit Artikeln (Hauptscreen, Smartphone und Desktop)
- Artikel hinzufügen und bearbeiten (Bottom Sheet auf dem Smartphone, Dialog auf dem Desktop)
- Gruppe verwalten und Einladungslink teilen
- Einstellungen (Sprache, Theme, Account)
- Zustände: leere Liste, offline, Synchronisation läuft, Fehler

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
