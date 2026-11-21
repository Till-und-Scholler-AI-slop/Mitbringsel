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

Der Pfad ist ein Angriffspunkt (Open Redirect: ein Link, der echt anmeldet und dann auf eine fremde Seite führt). Deshalb gilt `safeNextPath` in `httpapi/nextpath.go`: Er muss mit genau einem `/` beginnen (kein `//host`, kein `/\host`), darf keinen Backslash und keine Steuerzeichen enthalten (Browser entfernen Tabs und Zeilenumbrüche aus URLs, aus `/<Tab>/host` würde `//host`), muss gültiges UTF-8 sein, höchstens 512 Bytes lang und ohne Schema und Host. Alles andere wird ignoriert, der Login endet dann auf `/`. Die Prüfung läuft beim Setzen und noch einmal beim Lesen des Cookies, weil der Browser dort beliebige Werte schicken kann. Das Frontend prüft denselben Pfad vor jedem eigenen Rücksprung noch einmal. Das tut `router/nextPath.ts` mit denselben Regeln; Router-Wächter und Sitzungsablauf hängen `?next=` an die Login-Seite, die es an `/api/v1/auth/google/login` weitergibt. `/invite/:token` ist öffentlich: Anonyme sehen die Einladung mit „Mit Google beitreten“ (Rücksprung auf dieselbe Seite), danach genügt „Beitreten“.

Warum ein Cookie statt einer Tabelle für `state` und Co.: Die Werte gehören zu genau einem Browser und leben wenige Minuten. Im Cookie brauchen sie weder Migration noch Aufräum-Job, und für Fremde sind sie wertlos (der Verifier passt nur zu einem Code für genau diesen Versuch).

Die Google-Endpunkte sind fest im Code hinterlegt statt beim Start aus Googles Discovery-Dokument gelesen, damit der Server auch startet, wenn Google kurz nicht erreichbar ist. Googles Signaturschlüssel lädt `go-oidc` bei Bedarf nach.

## Einrichtung

- In der Google Cloud Console unter *Google Auth Platform* einen Zustimmungsbildschirm (Nutzertyp extern, Scopes `openid email profile`) und je Umgebung einen OAuth-Client vom Typ *Webanwendung* anlegen. Solange die App im Status "Testen" ist, können sich nur eingetragene Testnutzer anmelden.
- Autorisierte Weiterleitungs-URI je Client: `<PUBLIC_BASE_URL>/api/v1/auth/google/callback`, also lokal `http://localhost:5173/api/v1/auth/google/callback` (über den Vite-Proxy), sonst `https://<domain>/api/v1/auth/google/callback`.
- Konfiguration über `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` und `PUBLIC_BASE_URL`. Auf Staging und Production sind alle Pflicht (`PUBLIC_BASE_URL` leitet Compose aus `APP_DOMAIN` ab), lokal sind sie optional: Ohne Client gibt es nur den Dev-Login, und die Google-Endpunkte antworten `404`.
- Die Weiterleitungs-URL entsteht aus `PUBLIC_BASE_URL`, nie aus dem `Host`-Header: Den kann ein Client beliebig setzen, und der Vite-Proxy schreibt ihn um. Stellt das Frontend fest, dass eine Sitzung abgelaufen ist, leitet es auf `/login?reason=session_expired` um, damit die Seite erklärt, warum man sich neu anmelden muss. Das passiert in zwei Fällen:

- **Während der Nutzung:** Der API-Client meldet jedes `401` an einen zentralen Handler (`router/sessionExpiry.ts`). Ist der Nutzer laut Auth-Store angemeldet, setzt der Store ihn zurück und der Handler leitet um. So greift das für jeden Endpunkt, ohne dass ein Store `401` selbst behandeln muss; ein `401` von `/me` beim Start ohne gespeichertes Profil (siehe „Start ohne Netz“) oder ein zweites `401` danach lösen nichts aus.
- **Beim Start:** Nach jeder erfolgreichen Anmeldung merkt sich der Browser in `localStorage` nur, dass jemand angemeldet war (`mitbringsel.signedIn`, keine Daten). Antwortet `/me` beim Start mit `401` und der Merker ist gesetzt, ist die Sitzung inzwischen abgelaufen oder wurde woanders beendet; der Router-Guard leitet dann mit dem Hinweis um. Ein bewusster Logout löscht den Merker, danach erscheint kein Hinweis.

### Start ohne Netz

Damit die App offline startet ([ADR 0006](adr/0006-offline-phase-6.md)), speichert der Auth-Store nach jeder Bestätigung durch `/me` das Profil in IndexedDB (`services/storage/localData.ts`). Das Profil bestimmt auch, wem die lokalen Daten gehören: Meldet `/me` einen anderen Nutzer, löscht der Speicher erst alles. Der Store setzt den neuen Nutzer erst danach, damit die Stores nie Daten des vorigen finden.

- **Beim Start** gilt ein gespeichertes Profil sofort: Der Nutzer ist angemeldet (`fromCache`), und `/me` prüft im Hintergrund. So hängt der Start auch bei schlechtem Netz nicht am Server.
- **Antwortet `/me`**, ersetzt die Antwort das Profil (`fromCache` wird `false`). Bei `401` greift der übliche Weg über die abgelaufene Sitzung; die lokalen Daten bleiben, damit derselbe Nutzer nach dem Anmelden weitermacht. Bei einem Netzfehler oder `5xx` bleibt der Nutzer angemeldet, und der Store fragt `/me` erneut, sobald der Socket `ready` meldet.
- **Ohne gespeichertes Profil** wartet der Start wie zuvor auf `/me`.
- **Nur beim Start:** Nach einem Logout oder einer abgelaufenen Sitzung meldet das gespeicherte Profil niemanden an.
- **Ein bewusster Logout** löscht alle lokalen Daten, das Gerät kann geteilt sein. Eine Antwort von `/me`, die erst danach eintrifft, verwirft der Store.

## Sessions und Sicherheit

- Sessions liegen in PostgreSQL (Tabelle `sessions`), im Cookie steht nur eine zufällige Session-ID. Gespeichert wird ein Hash der ID.
- Laufzeit 30 Tage, gleitend verlängert bei Nutzung (höchstens einmal pro Stunde, damit nicht jeder Request schreibt). Bei jeder Verlängerung setzt `requireUser` das Cookie mit der neuen Ablaufzeit neu, sonst würde der Browser es nach den ersten 30 Tagen trotz Nutzung verwerfen. Logout löscht die Session serverseitig.
- Abgelaufene Sessions löscht der Aufräum-Job des Servers (`internal/cleanup`, beim Start und dann stündlich). Für den Nutzer ändert das nichts: Eine abgelaufene Session wird schon vorher wie eine unbekannte abgewiesen.
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
  | `GET /ws` (Verbindungsaufbau) | Nutzer | 30 |

  Die Client-IP ist der **letzte** Eintrag von `X-Forwarded-For`: Traefik hängt dort die Adresse an, die er gesehen hat, alles davor schreibt der Client. In Entwicklung (ohne Proxy) gilt `RemoteAddr`. Der Zähler liegt im Speicher und passt zu einer Backend-Instanz pro Umgebung; bei mehreren müsste er in eine geteilte Ablage.

## WebSocket

`GET /api/v1/ws` öffnet die Live-Verbindung (siehe [Sync](sync.md) und [ADR 0005](adr/0005-live-sync-phase-5.md)). Der Upgrade ist ein gewöhnlicher GET-Request mit Cookie und läuft deshalb durch dieselben Prüfungen wie die REST-Routen, in dieser Reihenfolge:

1. **Origin:** Der Host der `Origin` (mit Port, ohne Beachtung der Groß-/Kleinschreibung) muss dem Host von `PUBLIC_BASE_URL` entsprechen, sonst `403 CROSS_ORIGIN_REQUEST`. Das Schema wird nicht verglichen. Eine Anfrage ganz ohne `Origin` ist erlaubt: Browser senden den Header bei jedem WebSocket-Handshake, ohne ihn kommt die Anfrage nicht von einer Webseite, und ohne Webseite gibt es kein CSRF. `null` und alles, was sich nicht als URL mit Host lesen lässt, wird abgelehnt. Die Prüfung steht vor der Session-Prüfung, damit eine fremde Seite nicht erfährt, ob der Besucher angemeldet ist.
2. **Session:** wie bei jeder geschützten Route (`requireUser`, `401 UNAUTHENTICATED`). Verlängert die Prüfung die Session, steht das neue Cookie schon in der `101`-Antwort des Upgrades.
3. **Rate Limit:** höchstens 30 Verbindungsaufbauten pro Minute und Nutzer (`429 RATE_LIMITED` mit `Retry-After`). Zusätzlich sind höchstens 10 Verbindungen gleichzeitig offen; die elfte bekommt ebenfalls `429`, aber ohne `Retry-After`, weil nicht absehbar ist, wann eine andere schließt.

Warum die eigene Origin-Prüfung: `http.CrossOriginProtection` lässt GET durch, und ein Handshake ist ein GET. Der `Host`-Header taugt nicht als Maßstab, weil der Vite-Proxy ihn im Dev-Betrieb umschreibt. Und `SameSite=Lax` genügt nicht: Eine Seite auf einer Schwester-Subdomain (`andere.tinowolter.com`) liegt auf derselben Site, der Browser schickt das Cookie also mit, sodass sie eine Verbindung im Namen des Nutzers öffnen könnte (das `__Host-`-Präfix schützt davor, das Cookie zu setzen, nicht davor, dass es gesendet wird).

- **Lebensdauer:** Der Server beendet jede Verbindung nach einer Stunde mit dem Code 1001. Der Client verbindet sich neu, und damit wird die Session erneut geprüft. Ohne das würde eine Verbindung eine abgelaufene oder beendete Session überleben.
- **Logout:** Der Server kennt die Verbindungen einer Session nicht; beim Logout schließt das Frontend den Socket selbst: `stores/sync.ts` beobachtet den angemeldeten Nutzer und stoppt den Socket, sobald er wegfällt (Logout, abgelaufene Session, Nutzerwechsel).
- **Fehlerstatus sichtbar?** Nein. Die Browser-API zeigt vom fehlgeschlagenen Handshake nur „Verbindung geschlossen“ (Code 1006), nie den HTTP-Status. Das Frontend prüft deshalb nach mehreren Fehlversuchen in Folge `GET /me`: Der Sync-Store tut das nach jedem dritten Versuch (3, 6, 9 …). Antwortet `GET /me` mit `401`, greift der übliche Weg über die abgelaufene Session (`setUnauthenticatedHandler`, `expireSession`), und der Store stoppt den Socket. Details: [Sync](sync.md#client-seite).
- **Entwicklung:** Der Upgrade kommt über den Vite-Proxy, der `Origin` unverändert durchreicht. Die App muss deshalb unter dem Host von `PUBLIC_BASE_URL` geöffnet werden (`http://localhost:5173`); `http://127.0.0.1:5173` wird abgelehnt, auch wenn es derselbe Rechner ist.

## Einladungen

- Owner und Admins erzeugen einen Einladungslink mit zufälligem Token (256 Bit, base64url). In der Datenbank liegt nur der SHA-256-Hash; den Token zeigt nur die Antwort auf `POST /groups/{id}/invites`, einmalig. Das Frontend baut daraus den Link `/invite/<token>`.
- Der Link gilt 7 Tage für beliebig viele Personen und kann widerrufen werden. Pro Gruppe sind höchstens 10 Links gleichzeitig offen.
- `GET /invites/{token}` braucht keine Anmeldung, damit die Seite hinter dem Link die Einladung zeigen kann. Wer den Token hat, sieht Gruppenname, die einladende Person, die Mitgliederzahl, die ersten vier Mitglieder mit Vornamen und Avatar sowie das Ablaufdatum des Links; die vollständige Liste bleibt hinter dem Login. Die Antwort trägt `Cache-Control: no-store`.
- Wer den Link öffnet, meldet sich bei Bedarf mit Google an und tritt mit `POST /invites/{token}/accept` als Member bei. Wer schon Mitglied ist, behält seine Rolle.
- Unbekannte Token antworten `404 INVITE_NOT_FOUND`, abgelaufene oder widerrufene `410 INVITE_EXPIRED`. Das verrät nichts, weil sich 256-Bit-Token nicht erraten lassen.
- Der Aufräum-Job löscht abgelaufene und widerrufene Einladungen 30 Tage nach Ablauf bzw. Widerruf. Bis dahin sagt ein alter Link noch „abgelaufen“ (`410`), danach „ungültig“ (`404`).
- Der Token steht im Pfad und damit in Zugriffslogs eines Reverse Proxys. Der Go-Server loggt keine Pfade; ein Traefik-Access-Log sollte die Pfade unter `/api/v1/invites/` nicht aufzeichnen.

## Lokale Entwicklung

Für lokale Entwicklung und E2E-Tests gibt es einen Dev-Login, der ohne Google anmeldet. Er ist nur aktiv, wenn `APP_ENV=development` gesetzt ist, und wird auf Staging und Production nie registriert.

- `POST /api/v1/auth/dev/login` nimmt E-Mail und Namen entgegen, legt den Nutzer bei Bedarf an und erzeugt eine echte Session mit Cookie. Danach läuft alles wie nach einem Google-Login; nur der Weg zur Session ist ein anderer.
- Das Frontend meldet sich im Dev-Modus (`import.meta.env.DEV`) automatisch an, wenn `GET /api/v1/me` mit `401` antwortet oder ein anderer Nutzer angemeldet ist. Den Nutzer liest es aus `frontend/.env.local` (`VITE_DEV_USER_EMAIL`, `VITE_DEV_USER_NAME`, Vorlage in `frontend/.env.example`), die nicht ins Repo kommt.
- Für Sync-Tests mit mehreren Nutzern überschreibt der URL-Parameter `?devUser=<email>` den Nutzer. Cookies gelten für das ganze Browserprofil, deshalb braucht der zweite Nutzer ein privates Fenster oder einen anderen Browser; ein zweites normales Fenster würde die Session des ersten übernehmen.
- `make seed` legt drei Dev-Nutzer samt Gruppen, Listen und Artikeln an (`anna@example.com`, `ben@example.com`, `chloe@example.com`, siehe [Tests und Seed-Daten](testing.md#seed-daten)). Der Dev-Login findet sie über die Subject-Kennung `dev:<email>`.
- Schickt ein Login keinen Namen, etwa mit `?devUser=<email>`, behält ein bestehender Nutzer seinen gespeicherten Namen; ein neuer Nutzer bekommt den Teil der E-Mail vor dem `@`. Deshalb bleiben die Namen der Seed-Nutzer erhalten. Google schickt immer einen Namen, dort ändert sich nichts.
- `requireUser` kennt keine Ausnahme für die Entwicklung: Ein falsch gesetztes `APP_ENV` soll höchstens einen zusätzlichen Endpunkt freischalten, nie jeden Request als angemeldet durchlassen.
