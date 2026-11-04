# Authentifizierung und Einladungen

Das Backend wickelt den Google-Login selbst ab (OpenID Connect, Authorization Code Flow mit PKCE) und setzt danach ein eigenes Session-Cookie. Google-Tokens landen nie im Frontend.

## Login-Ablauf

1. Frontend leitet auf `GET /api/v1/auth/google/login` weiter, optional mit `?next=<Pfad>` (siehe „Rücksprung nach dem Login“).
2. Backend erzeugt `state`, `nonce` und PKCE-Verifier und speichert sie zusammen mit dem Rücksprungpfad in einem kurzlebigen Cookie (`__Secure-google-login`, lokal `google-login`): `HttpOnly`, `SameSite=Lax`, 10 Minuten gültig und nur für den Pfad des Callbacks. Danach leitet es zu Google weiter.
3. Google leitet auf `/api/v1/auth/google/callback` zurück. Das Backend prüft `state` gegen das Cookie, tauscht den Code mit dem PKCE-Verifier gegen Tokens und validiert das ID-Token (Signatur, Aussteller, Ablauf, Client-ID als Audience, `nonce`). Konten ohne bestätigte E-Mail-Adresse (`email_verified`) werden abgelehnt. Das Cookie wird in jedem Fall gelöscht, ein Versuch gilt nur einmal.
4. Backend legt den Nutzer an oder aktualisiert ihn (Schlüssel: Google `sub`, nicht die E-Mail).
5. Backend erstellt eine Session in der Datenbank, setzt das Session-Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) und leitet auf den Rücksprungpfad weiter, ohne einen auf `/`.
6. Frontend lädt den aktuellen Nutzer über `GET /api/v1/me`.

Bricht der Nutzer bei Google ab, leitet das Backend auf `/login?error=access_denied` um, bei jedem anderen Fehler auf `/login?error=login_failed`; die Login-Seite zeigt dann einen Fehlerhinweis mit "Nochmal versuchen". Hatte der Login einen Rücksprungpfad, hängt das Backend `&next=<Pfad>` an, damit auch der zweite Versuch dort endet. Details stehen nur im Server-Log.

### Rücksprung nach dem Login

Wer einen Einladungslink öffnet oder dessen Sitzung abgelaufen ist, soll nach dem Login auf derselben Seite weitermachen, nicht auf `/`. Das Frontend gibt dazu den Pfad als `?next=` an `/api/v1/auth/google/login` mit (und an die Login-Seite: `/login?next=<Pfad>`). Das Backend legt ihn als vierten Wert (base64url) in das Login-Cookie und leitet nach dem Callback dorthin.

Der Pfad ist ein Angriffspunkt (Open Redirect: ein Link, der echt anmeldet und dann auf eine fremde Seite führt). Deshalb gilt `safeNextPath` in `httpapi/nextpath.go`: Er muss mit genau einem `/` beginnen (kein `//host`, kein `/\host`), darf keinen Backslash und keine Steuerzeichen enthalten (Browser entfernen Tabs und Zeilenumbrüche aus URLs, aus `/<Tab>/host` würde `//host`), muss gültiges UTF-8 sein, höchstens 512 Bytes lang und ohne Schema und Host. Alles andere wird ignoriert, der Login endet dann auf `/`. Die Prüfung läuft beim Setzen und noch einmal beim Lesen des Cookies, weil der Browser dort beliebige Werte schicken kann. Das Frontend prüft denselben Pfad vor jedem eigenen Rücksprung noch einmal.

Warum ein Cookie statt einer Tabelle für `state` und Co.: Die Werte gehören zu genau einem Browser und leben wenige Minuten. Im Cookie brauchen sie weder Migration noch Aufräum-Job, und für Fremde sind sie wertlos (der Verifier passt nur zu einem Code für genau diesen Versuch).

Die Google-Endpunkte sind fest im Code hinterlegt statt beim Start aus Googles Discovery-Dokument gelesen, damit der Server auch startet, wenn Google kurz nicht erreichbar ist. Googles Signaturschlüssel lädt `go-oidc` bei Bedarf nach.

## Einrichtung

- In der Google Cloud Console unter *Google Auth Platform* einen Zustimmungsbildschirm (Nutzertyp extern, Scopes `openid email profile`) und je Umgebung einen OAuth-Client vom Typ *Webanwendung* anlegen. Solange die App im Status "Testen" ist, können sich nur eingetragene Testnutzer anmelden.
- Autorisierte Weiterleitungs-URI je Client: `<PUBLIC_BASE_URL>/api/v1/auth/google/callback`, also lokal `http://localhost:5173/api/v1/auth/google/callback` (über den Vite-Proxy), sonst `https://<domain>/api/v1/auth/google/callback`.
- Konfiguration über `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` und `PUBLIC_BASE_URL`. Auf Staging und Production sind alle Pflicht (`PUBLIC_BASE_URL` leitet Compose aus `APP_DOMAIN` ab), lokal sind sie optional: Ohne Client gibt es nur den Dev-Login, und die Google-Endpunkte antworten `404`.
- Die Weiterleitungs-URL entsteht aus `PUBLIC_BASE_URL`, nie aus dem `Host`-Header: Den kann ein Client beliebig setzen, und der Vite-Proxy schreibt ihn um. Stellt das Frontend fest, dass eine Sitzung abgelaufen ist, leitet es auf `/login?reason=session_expired` um, damit die Seite erklärt, warum man sich neu anmelden muss. Das passiert in zwei Fällen:

- **Während der Nutzung:** Der API-Client meldet jedes `401` an einen zentralen Handler (`router/sessionExpiry.ts`). Ist der Nutzer laut Auth-Store angemeldet, setzt der Store ihn zurück und der Handler leitet um. So greift das für jeden Endpunkt, ohne dass ein Store `401` selbst behandeln muss; ein `401` von `/me` beim Start oder ein zweites `401` danach lösen nichts aus.
- **Beim Start:** Nach jeder erfolgreichen Anmeldung merkt sich der Browser in `localStorage` nur, dass jemand angemeldet war (`mitbringsel.signedIn`, keine Daten). Antwortet `/me` beim Start mit `401` und der Merker ist gesetzt, ist die Sitzung inzwischen abgelaufen oder wurde woanders beendet; der Router-Guard leitet dann mit dem Hinweis um. Ein bewusster Logout löscht den Merker, danach erscheint kein Hinweis.

## Sessions und Sicherheit

- Sessions liegen in PostgreSQL (Tabelle `sessions`), im Cookie steht nur eine zufällige Session-ID. Gespeichert wird ein Hash der ID.
- Laufzeit 30 Tage, gleitend verlängert bei Nutzung (höchstens einmal pro Stunde, damit nicht jeder Request schreibt). Bei jeder Verlängerung setzt `requireUser` das Cookie mit der neuen Ablaufzeit neu, sonst würde der Browser es nach den ersten 30 Tagen trotz Nutzung verwerfen. Logout löscht die Session serverseitig.
- Cookie-Name auf Staging und Production `__Host-session`: Das Präfix erzwingt `Secure`, `Path=/` und kein `Domain`-Attribut, sodass andere Dienste auf Subdomains von `tinowolter.com` das Cookie weder setzen noch überschreiben können. Lokal (`http://localhost`, ohne HTTPS) heißt es `session`.
- Die Middleware `requireUser` in `httpapi` prüft die Session pro Route und legt die User-ID in den Request-Context. Unbekannte oder abgelaufene Sessions ergeben `401 UNAUTHENTICATED`, Datenbankfehler `500 INTERNAL_ERROR`, damit ein kurzer Ausfall niemanden abmeldet. Die Middleware liegt in `httpapi` und nicht in `auth`, weil sie HTTP übersetzt und `auth` sonst `httpapi` importieren müsste, das selbst `auth` nutzt.
- Schreibende REST-Requests werden zusätzlich zu `SameSite` gegen CSRF geprüft: `http.CrossOriginProtection` aus der Standardbibliothek liegt um den ganzen Router und lehnt POST, PUT, PATCH und DELETE ab, die laut `Sec-Fetch-Site` (ältere Browser: `Origin` gegen `Host`) von einer anderen Seite kommen. Antwort: `403 CROSS_ORIGIN_REQUEST`. GET verändert deshalb nie etwas.
- Jede Service-Methode prüft die Gruppenmitgliedschaft. Der Zugriff auf fremde Gruppen liefert `404`, um keine Existenz zu verraten.
- Rate Limiting (Token-Bucket im Speicher, `httpapi/ratelimit.go`, bei Überschreitung `429 RATE_LIMITED` mit `Retry-After`; die beiden Google-Routen leiten stattdessen auf `/login?error=rate_limited` um, weil der Browser sie per Navigation öffnet und sonst rohes JSON zeigen würde):

  | Route | Schlüssel | Grenze pro Minute |
  |---|---|---|
  | `GET /auth/google/login` und `/callback` (gemeinsam) | Client-IP | 10 |
  | `GET /invites/{token}` | Client-IP | 30 |
  | `POST /invites/{token}/accept` | Nutzer | 10 |

  Die Client-IP ist der **letzte** Eintrag von `X-Forwarded-For`: Traefik hängt dort die Adresse an, die er gesehen hat, alles davor schreibt der Client. In Entwicklung (ohne Proxy) gilt `RemoteAddr`. Der Zähler liegt im Speicher und passt zu einer Backend-Instanz pro Umgebung; bei mehreren müsste er in eine geteilte Ablage.

## Einladungen

- Owner und Admins erzeugen einen Einladungslink mit zufälligem Token (256 Bit, base64url). In der Datenbank liegt nur der SHA-256-Hash; den Token zeigt nur die Antwort auf `POST /groups/{id}/invites`, einmalig. Das Frontend baut daraus den Link `/invite/<token>`.
- Der Link gilt 7 Tage für beliebig viele Personen und kann widerrufen werden. Pro Gruppe sind höchstens 10 Links gleichzeitig offen.
- `GET /invites/{token}` braucht keine Anmeldung, damit die Seite hinter dem Link die Einladung zeigen kann. Wer den Token hat, sieht Gruppenname, die einladende Person, die Mitgliederzahl und die ersten vier Mitglieder mit Vornamen und Avatar; die vollständige Liste bleibt hinter dem Login. Die Antwort trägt `Cache-Control: no-store`.
- Wer den Link öffnet, meldet sich bei Bedarf mit Google an und tritt mit `POST /invites/{token}/accept` als Member bei. Wer schon Mitglied ist, behält seine Rolle.
- Unbekannte Token antworten `404 INVITE_NOT_FOUND`, abgelaufene oder widerrufene `410 INVITE_EXPIRED`. Das verrät nichts, weil sich 256-Bit-Token nicht erraten lassen.
- Der Token steht im Pfad und damit in Zugriffslogs eines Reverse Proxys. Der Go-Server loggt keine Pfade; ein Traefik-Access-Log sollte die Pfade unter `/api/v1/invites/` nicht aufzeichnen.

## Lokale Entwicklung

Für lokale Entwicklung und E2E-Tests gibt es einen Dev-Login, der ohne Google anmeldet. Er ist nur aktiv, wenn `APP_ENV=development` gesetzt ist, und wird auf Staging und Production nie registriert.

- `POST /api/v1/auth/dev/login` nimmt E-Mail und Namen entgegen, legt den Nutzer bei Bedarf an und erzeugt eine echte Session mit Cookie. Danach läuft alles wie nach einem Google-Login; nur der Weg zur Session ist ein anderer.
- Das Frontend meldet sich im Dev-Modus (`import.meta.env.DEV`) automatisch an, wenn `GET /api/v1/me` mit `401` antwortet oder ein anderer Nutzer angemeldet ist. Den Nutzer liest es aus `frontend/.env.local` (`VITE_DEV_USER_EMAIL`, `VITE_DEV_USER_NAME`, Vorlage in `frontend/.env.example`), die nicht ins Repo kommt.
- Für Sync-Tests mit mehreren Nutzern überschreibt der URL-Parameter `?devUser=<email>` den Nutzer. Cookies gelten für das ganze Browserprofil, deshalb braucht der zweite Nutzer ein privates Fenster oder einen anderen Browser; ein zweites normales Fenster würde die Session des ersten übernehmen.
- `requireUser` kennt keine Ausnahme für die Entwicklung: Ein falsch gesetztes `APP_ENV` soll höchstens einen zusätzlichen Endpunkt freischalten, nie jeden Request als angemeldet durchlassen.
