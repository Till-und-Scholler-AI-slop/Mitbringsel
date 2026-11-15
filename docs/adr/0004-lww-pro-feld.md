# 0004: Last Write Wins pro Feld statt pro Artikel

Status: akzeptiert

## Kontext

Mehrere Personen bearbeiten dieselbe Liste, teils offline. Treffen zwei Änderungen am selben Artikel zusammen, muss der Server sie deterministisch zusammenführen (siehe [Sync](../sync.md)). Offen war die Einheit des Vergleichs: der ganze Artikel oder das einzelne Feld (siehe [Roadmap](../roadmap.md)).

Typischer Fall beim Einkaufen: Anna ändert die Menge von „Milch“, Ben hakt sie gleichzeitig ab. Pro Artikel gewinnt nur eine der beiden Änderungen, die andere geht still verloren.

## Entscheidung

- Last Write Wins gilt **pro Feld**. Jedes Feld eines Artikels hat einen eigenen HLC-Zeitstempel; nur bei Änderungen am selben Feld gewinnt die spätere.
- Die Zeitstempel stehen in `items.field_clocks` (jsonb), wie in [Datenmodell](../data-model.md) vorgesehen.
- Die übrigen Regeln aus [Sync](../sync.md) bleiben: Löschen gewinnt (Tombstone), Gleichstand entscheidet die Client-ID, Zeitstempel weit in der Zukunft setzt der Server auf seine Zeit.

## Konsequenzen

- Gleichzeitige Änderungen an verschiedenen Feldern gehen nicht verloren.
- Das Schema von `items` enthält `field_clocks` von Anfang an; eine spätere Umstellung wäre eine Migration über alle Artikel.
- Der Merge ist aufwendiger als pro Artikel und gibt es in Go und TypeScript. Beide Implementierungen brauchen dieselben tabellengetriebenen Tests (siehe [Tests](../testing.md)).
- Jede `mutate`-Nachricht nennt die geänderten Felder, nicht den ganzen Artikel.
- Nachtrag: [ADR 0006](0006-offline-phase-6.md) lässt den Merge in TypeScript und `mutate` entfallen. Der Server entscheidet allein, der Client schickt per REST die geänderten Felder mit seiner HLC.
