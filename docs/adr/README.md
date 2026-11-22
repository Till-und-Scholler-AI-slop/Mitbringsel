# Architecture Decision Records

Wichtige Entscheidungen werden hier als kurzer ADR festgehalten: Kontext, Entscheidung, Konsequenzen.

Dateiname: `NNNN-kurzer-titel.md` (fortlaufend nummeriert, z.B. `0001-lww-pro-feld.md`).

Vorlage:

```markdown
# NNNN: Titel

Status: vorgeschlagen | akzeptiert | ersetzt durch NNNN

## Kontext

## Entscheidung

## Konsequenzen
```

## Übersicht

- [0001](0001-staging-und-production.md): Staging und Production
- [0002](0002-openapi-als-api-vertrag.md): OpenAPI als API-Vertrag
- [0003](0003-eigenes-css-mit-tokens.md): Eigenes CSS mit Design-Tokens statt Tailwind
- [0004](0004-lww-pro-feld.md): Last Write Wins pro Feld statt pro Artikel
- [0005](0005-live-sync-phase-5.md): Live-Sync in Phase 5: REST schreibt, WebSocket verteilt
- [0006](0006-offline-phase-6.md): Offline in Phase 6: Outbox über REST, Neuladen statt Delta
- [0007](0007-github-projects-statt-todo.md): Offene Punkte als GitHub-Issues statt in `todo.md`
- [0008](0008-grosse-bildschirme.md): Große Bildschirme: Kontextspalte, Aktivität auf dem Server, Verschieben per `listId`
