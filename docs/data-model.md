# Datenmodell

Acht Tabellen tragen das erste Release. Alle Primärschlüssel sind UUIDs, alle Zeitstempel `timestamptz` in UTC. Das Schema ist ein Startpunkt und wird im ersten Architekturschritt abgestimmt.

| Tabelle | Wichtige Spalten | Hinweise |
| --- | --- | --- |
| `users` | `id`, `google_sub` (unique), `email`, `display_name`, `avatar_url`, `locale`, `theme`, `created_at` | Identität über `google_sub` |
| `sessions` | `id_hash`, `user_id`, `expires_at`, `created_at`, `last_seen_at` | Nur SHA-256-Hash der Session-ID (`bytea`, 32 Bytes); Sessions fallen beim Löschen des Nutzers weg |
| `groups` | `id`, `name`, `created_by`, `created_at`, `updated_at` | Name 1 bis 30 Zeichen (Service und `CHECK`); `created_by` wird `NULL`, wenn der Account gelöscht wird |
| `group_members` | `group_id`, `user_id`, `role` (`owner`, `admin`, `member`), `joined_at` | Primärschlüssel aus `group_id` + `user_id`; fällt mit Gruppe oder Nutzer weg (`ON DELETE CASCADE`); ein partieller Unique-Index erlaubt pro Gruppe genau einen Owner |
| `group_invites` | `id`, `group_id`, `token_hash` (`bytea`, 32 Bytes, unique), `created_by`, `created_at`, `expires_at`, `revoked_at` | Ablauf nach 7 Tagen; nur der SHA-256-Hash des Tokens wird gespeichert; fällt mit der Gruppe weg, `created_by` wird `NULL` beim Löschen des Accounts |
| `lists` | `id`, `group_id`, `name`, `icon`, `archived_at`, `created_at`, `updated_at`, `server_seq` | Name 1 bis 50 Zeichen (Service und `CHECK`); `icon` aus einem festen Set von 18 Stickern (Default `general`); fällt mit der Gruppe weg (`ON DELETE CASCADE`) |
| `items` | `id`, `list_id`, `name`, `quantity` (numeric, nullable), `unit` (nullable), `note` (nullable), `checked`, `checked_by`, `checked_at`, `created_by`, `created_at`, `deleted_at`, `field_clocks` (jsonb), `server_seq` | `field_clocks` hält den HLC-Zeitstempel pro Feld für LWW ([ADR 0004](adr/0004-lww-pro-feld.md)); `id` ohne Default (vom Client); Name 1 bis 100, Notiz bis 500 Zeichen, Menge > 0; `unit` aus `piece`, `g`, `kg`, `ml`, `l`, `pack`; `checked_by`/`checked_at` nur bei `checked`; fällt mit der Liste weg, `created_by`/`checked_by` werden `NULL` |
| `processed_ops` | `op_id`, `user_id`, `processed_at` | kommt mit Phase 6 (WS-`mutate`); Idempotenz, Einträge nach 30 Tagen löschen |

## Regeln

- **IDs:** Vom Server angelegte Zeilen bekommen ihre ID per Spalten-Default `uuidv7()` (eingebaut in PostgreSQL 18). UUIDv7 ist zeitlich sortiert und hält Indizes kompakt. Artikel bekommen ihre UUIDv7 dagegen vom Client (siehe [Live-Sync](sync.md)).
- **Feste Wertemengen** wie `locale`, `theme` und `role` sind `text` mit `CHECK`-Constraint statt PostgreSQL-`ENUM`, damit sich Werte später leicht entfernen oder umbenennen lassen.
- **`server_seq`:** Kommt aus der globalen PostgreSQL-Sequenz `change_seq` (gemeinsam für `lists` und `items`) und wird bei jeder übernommenen Änderung neu gesetzt. Clients fragen damit Änderungen seit ihrem letzten Stand ab (siehe [Live-Sync](sync.md)).
- **Einheiten:** Als festes Set im Code (Enum in Go und TypeScript), Anzeige über i18n. Freitext-Einheiten sind vorerst nicht vorgesehen.
- **Listen-Icons:** Ebenso ein festes Set (`list.Icons` in Go, `ListIcon` im API-Vertrag), das Frontend zeichnet die Sticker nach dem Design (`icons3-sticker`). Eine eigene Listenfarbe gibt es nicht, die Sticker bringen ihre Farben mit. Ein neues Icon braucht eine Migration.
- **Indizes:** Mindestens auf `items(list_id, server_seq)`, `lists(group_id, server_seq)` und `group_members(user_id)`.
- **Änderungen an Mitgliedschaften** (austreten, entfernen, Rolle ändern) sperren zuerst die Zeile der Gruppe (`SELECT … FOR UPDATE`) und laufen in einer Transaktion. So können zwei gleichzeitige Änderungen nicht beide "es gibt noch einen anderen Owner" sehen und die Gruppe ohne Owner zurücklassen.
- **Löschen von Gruppen und Listen:** Kaskadierend auf abhängige Daten, Account-Löschung entfernt Mitgliedschaften und anonymisiert `created_by`/`checked_by`.
