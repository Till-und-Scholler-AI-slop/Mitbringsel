# Datenmodell

Acht Tabellen tragen das erste Release. Alle Primärschlüssel sind UUIDs, alle Zeitstempel `timestamptz` in UTC. Das Schema ist ein Startpunkt und wird im ersten Architekturschritt abgestimmt.

| Tabelle | Wichtige Spalten | Hinweise |
| --- | --- | --- |
| `users` | `id`, `google_sub` (unique), `email`, `display_name`, `avatar_url`, `locale`, `theme`, `created_at` | Identität über `google_sub` |
| `sessions` | `id_hash`, `user_id`, `expires_at`, `created_at`, `last_seen_at` | Nur SHA-256-Hash der Session-ID (`bytea`, 32 Bytes); Sessions fallen beim Löschen des Nutzers weg |
| `groups` | `id`, `name`, `created_by`, `created_at`, `updated_at` | |
| `group_members` | `group_id`, `user_id`, `role` (`owner`, `member`), `joined_at` | Primärschlüssel aus `group_id` + `user_id` |
| `group_invites` | `id`, `group_id`, `token_hash`, `created_by`, `expires_at`, `revoked_at` | Ablauf nach 7 Tagen |
| `lists` | `id`, `group_id`, `name`, `archived_at`, `created_at`, `updated_at`, `server_seq` | |
| `items` | `id`, `list_id`, `name`, `quantity` (numeric, nullable), `unit` (nullable), `note` (nullable), `checked`, `checked_by`, `checked_at`, `created_by`, `created_at`, `deleted_at`, `field_clocks` (jsonb), `server_seq` | `field_clocks` hält den HLC-Zeitstempel pro Feld für LWW |
| `processed_ops` | `op_id`, `user_id`, `processed_at` | Idempotenz; Einträge nach 30 Tagen löschen |

## Regeln

- **IDs:** Vom Server angelegte Zeilen bekommen ihre ID per Spalten-Default `uuidv7()` (eingebaut in PostgreSQL 18). UUIDv7 ist zeitlich sortiert und hält Indizes kompakt. Artikel bekommen ihre UUIDv7 dagegen vom Client (siehe [Live-Sync](sync.md)).
- **Feste Wertemengen** wie `locale`, `theme` und `role` sind `text` mit `CHECK`-Constraint statt PostgreSQL-`ENUM`, damit sich Werte später leicht entfernen oder umbenennen lassen.
- **`server_seq`:** Kommt aus einer globalen PostgreSQL-Sequenz und wird bei jeder übernommenen Änderung neu gesetzt. Clients fragen damit Änderungen seit ihrem letzten Stand ab (siehe [Live-Sync](sync.md)).
- **Einheiten:** Als festes Set im Code (Enum in Go und TypeScript), Anzeige über i18n. Freitext-Einheiten sind vorerst nicht vorgesehen.
- **Indizes:** Mindestens auf `items(list_id, server_seq)`, `lists(group_id, server_seq)` und `group_members(user_id)`.
- **Löschen von Gruppen und Listen:** Kaskadierend auf abhängige Daten, Account-Löschung entfernt Mitgliedschaften und anonymisiert `created_by`/`checked_by`.
