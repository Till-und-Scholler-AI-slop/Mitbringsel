# Authentifizierung und Einladungen

Das Backend wickelt den Google-Login selbst ab (OpenID Connect, Authorization Code Flow mit PKCE) und setzt danach ein eigenes Session-Cookie. Google-Tokens landen nie im Frontend.

## Login-Ablauf

1. Frontend leitet auf `GET /api/v1/auth/google/login` weiter.
2. Backend erzeugt `state`, `nonce` und PKCE-Verifier, speichert sie kurzlebig und leitet zu Google weiter.
3. Google leitet auf `/api/v1/auth/google/callback` zurück. Das Backend prüft `state`, tauscht den Code gegen Tokens und validiert das ID-Token.
4. Backend legt den Nutzer an oder aktualisiert ihn (Schlüssel: Google `sub`, nicht die E-Mail).
5. Backend erstellt eine Session in der Datenbank und setzt ein Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`.
6. Frontend lädt den aktuellen Nutzer über `GET /api/v1/me`.

## Sessions und Sicherheit

- Sessions liegen in PostgreSQL (Tabelle `sessions`), im Cookie steht nur eine zufällige Session-ID. Gespeichert wird ein Hash der ID.
- Laufzeit 30 Tage, gleitend verlängert bei Nutzung (höchstens einmal pro Stunde, damit nicht jeder Request schreibt). Logout löscht die Session serverseitig.
- Cookie-Name auf Staging und Production `__Host-session`: Das Präfix erzwingt `Secure`, `Path=/` und kein `Domain`-Attribut, sodass andere Dienste auf Subdomains von `tinowolter.com` das Cookie weder setzen noch überschreiben können. Lokal (`http://localhost`, ohne HTTPS) heißt es `session`.
- Die Middleware `requireUser` in `httpapi` prüft die Session pro Route und legt die User-ID in den Request-Context. Unbekannte oder abgelaufene Sessions ergeben `401 UNAUTHENTICATED`, Datenbankfehler `500 INTERNAL_ERROR`, damit ein kurzer Ausfall niemanden abmeldet. Die Middleware liegt in `httpapi` und nicht in `auth`, weil sie HTTP übersetzt und `auth` sonst `httpapi` importieren müsste, das selbst `auth` nutzt.
- Schreibende REST-Requests prüfen den `Origin`-Header als CSRF-Schutz zusätzlich zu `SameSite`.
- Jede Service-Methode prüft die Gruppenmitgliedschaft. Der Zugriff auf fremde Gruppen liefert `404`, um keine Existenz zu verraten.
- Rate Limiting für Login und Einladungs-Endpunkte.

## Einladungen

- Owner erzeugen einen Einladungslink mit zufälligem Token (mindestens 128 Bit).
- Einladungen laufen nach 7 Tagen ab und können widerrufen werden.
- Wer den Link öffnet, meldet sich bei Bedarf mit Google an und tritt der Gruppe bei.

## Lokale Entwicklung

Für lokale Entwicklung und E2E-Tests gibt es einen Dev-Login, der ohne Google einen Seed-Nutzer anmeldet. Er ist nur aktiv, wenn `APP_ENV=development` gesetzt ist, und wird auf Staging und Production nie registriert.
