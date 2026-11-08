# Projektüberblick und Funktionsumfang

Stand: 26.10.2026

## Überblick

Web-App für digitale Einkaufslisten, die in Echtzeit zwischen mehreren Personen synchronisiert wird. Wenn zwei Mitbewohner gleichzeitig Artikel hinzufügen, abhaken oder bearbeiten, sehen beide die Änderung sofort.

- **Zielgruppe:** Ich selbst, meine WG und weitere Nutzer, die die App frei nutzen dürfen. Keine Vermarktung, kein Bezahlmodell.
- **Plattformen:** Desktop-Browser und Smartphone, installierbar als PWA.
- **Kernversprechen:** Live-Synchronisation, die auch offline funktioniert und sich danach automatisch nachsynchronisiert.
- **Ich als Entwickler:** Ich will den Code verstehen und die Architektur kontrollieren. Ich habe gute Vue-Kenntnisse und erste Erfahrungen mit Go.

## Funktionsumfang

Die Hierarchie ist: Nutzer gehören zu Gruppen, Gruppen haben mehrere Listen, Listen enthalten Artikel.

**Begriffe:** In der Oberfläche heißt eine Gruppe **Haushalt** (englisch *household*), so wie im Design. Code, API, Datenbank und diese Dokumentation bleiben bei **Gruppe** (`group`).

**Accounts**

- Anmeldung ausschließlich über Google Login
- Profil mit Name und Avatar aus dem Google-Konto, Sprache (de/en) und Theme (hell/dunkel/System) einstellbar
- Account löschen (inklusive Austritt aus allen Gruppen)

**Gruppen**

- Nutzer können Gruppen erstellen (z.B. "WG Kaiserstraße")
- Andere per Einladungslink beitreten lassen
- Rollen: Eine Gruppe hat genau einen Owner (wer sie anlegt), beliebig viele Admins und Members. Der Owner löscht die Gruppe und ernennt oder entlässt Admins; Admins laden per Einladungslink ein, benennen die Gruppe um und entfernen Members. Members nutzen die Listen und können austreten.
- Der Owner kann weder austreten noch die Rolle wechseln; er löscht die Gruppe, wenn er sie loswerden will. Eine Übergabe der Gruppe an jemand anderen ist nicht vorgesehen.
- Gruppennamen haben höchstens 30 Zeichen; längere Anzeigen werden in der Oberfläche mit „…“ abgeschnitten.

**Listen**

- Mehrere Listen pro Gruppe (z.B. "Supermarkt", "Drogerie", "Baumarkt")
- Listen erstellen, umbenennen, archivieren, löschen
- Alle Mitglieder erstellen, benennen um und archivieren Listen; löschen (samt aller Artikel) dürfen nur Owner und Admins
- Listennamen haben höchstens 50 Zeichen; doppelte Namen innerhalb einer Gruppe sind erlaubt

**Artikel**

- Pflichtfeld: Name
- Optional: Menge, Einheit (z.B. Stück, g, kg, ml, l, Packung), Notiz
- Abhaken und wieder zurücksetzen
- Bearbeiten und löschen
- Abgehakte Artikel sind optisch getrennt und können gesammelt entfernt werden
- Sichtbar, wer einen Artikel hinzugefügt und wer ihn abgehakt hat

**Querschnitt**

- Live-Synchronisation aller Änderungen innerhalb einer Gruppe
- Offline-Nutzung mit automatischer Nachsynchronisation
- Installierbar als PWA, responsiv für Smartphone und Desktop
- Mehrsprachig (Deutsch und Englisch zum Start)
- Hell- und Dunkelmodus

**Bewusst nicht im ersten Release:** Push-Benachrichtigungen, Kategorien, Sortieren per Drag & Drop, Autovervollständigung aus früheren Einkäufen. Diese Punkte stehen in der [Roadmap](roadmap.md).
