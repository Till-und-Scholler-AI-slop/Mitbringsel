# 0002: OpenAPI als API-Vertrag

Status: akzeptiert

## Kontext

Backend (Go) und Frontend (TypeScript) tauschen JSON aus. Bisher standen die Formen doppelt im Code: als Go-Structs mit `json`-Tags in `httpapi` und als handgeschriebene TypeScript-Typen in `frontend/src/types/api.ts`. Ändert sich ein Feld nur auf einer Seite, fällt das erst zur Laufzeit auf. Mit Gruppen, Listen, Artikeln und Einladungen kommen bald viele Endpunkte dazu.

## Entscheidung

- **Spec-first:** `api/openapi.yaml` (OpenAPI 3.0.3) wird von Hand geschrieben und ist die einzige Quelle für Pfade, Schemas und Fehlercodes. Eine API-Änderung beginnt dort.
- **Backend:** `oapi-codegen` erzeugt nur die Datentypen (`backend/internal/httpapi/apigen`). Routing, Middleware und Handler bleiben handgeschrieben; Handler antworten mit den generierten Typen.
- **Frontend:** `openapi-typescript` erzeugt nur Typen (`frontend/src/types/openapi.gen.ts`); `types/api.ts` gibt ihnen kurze Namen. Der eigene REST-Client (`services/api/client.ts`) bleibt.
- **Generierter Code wird eingecheckt**, wie bei sqlc. `make generate` erzeugt beide Seiten, die CI prüft, ob der Stand aktuell ist. Die Docker-Builds brauchen die Spec deshalb nicht.
- **OpenAPI 3.0 statt 3.1**, weil `oapi-codegen` 3.1 noch nicht vollständig unterstützt.

Verworfene Alternativen:

- **Handgepflegte Typen auf beiden Seiten:** kein Werkzeug nötig, aber keine Garantie, dass beide Seiten zusammenpassen.
- **Code-first (Spec aus Go-Kommentaren, z.B. `swaggo`):** Die Kommentare veralten unbemerkt, und die Spec ist kein eigenständig prüfbarer Vertrag.
- **`oapi-codegen` mit komplettem Server:** strenger, weil auch Routen und Handler-Signaturen aus der Spec kommen, aber der Router mit `requireUser`, CSRF-Schutz und JSON-404/405 müsste in die generierte Struktur umgebaut werden.
- **`openapi-fetch` als Client im Frontend:** zusätzliche Laufzeit-Dependency, die unseren `ApiError`-Mechanismus ersetzt hätte, ohne Mehrwert für die wenigen Aufrufe.

## Konsequenzen

- Zwei neue Werkzeuge: `oapi-codegen` als `tool` in `backend/go.mod`, `openapi-typescript` als devDependency. Keines landet im ausgelieferten Code.
- `openapi-typescript` verlangt TypeScript 5 als Peer-Dependency, das Projekt nutzt 6. Ein `overrides`-Eintrag in `frontend/package.json` erlaubt TypeScript 6 nur für dieses Paket. Unterstützt eine neue Version TypeScript 6 offiziell, fällt der Eintrag weg.
- Neue Felder und Endpunkte kosten einen Schritt mehr: erst die Spec, dann `make generate`, dann der Code. Dafür meldet der Compiler auf beiden Seiten, was nicht mehr passt.
- Die Spec beschreibt nur Formen und Statuscodes. Ob ein Handler tatsächlich den Statuscode aus der Spec sendet, prüfen weiterhin die Handler-Tests. Domänen-Enums (z.B. `user.Locale`) werden in die generierten Typen umgewandelt; ein Test stellt sicher, dass jeder Wert auch in der Spec steht.
- Die generierte Datei im Frontend ist von ESLint und Prettier ausgenommen; `golangci-lint` überspringt generierten Go-Code von selbst.
