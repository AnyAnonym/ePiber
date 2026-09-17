# Sicherheit, Betrieb und Qualitaet

## 1. Sicherheitsmodell

Das Backend bindet ausschliesslich an Loopback. Caddy bildet die oeffentliche
TLS- und Routinggrenze, liefert statische Dateien und setzt Security-Header.
Mutierende HTTP-Routen und WebSocket-Upgrades pruefen die Origin.

Schutzmechanismen umfassen:

- enge Header-, Body-, Nachrichten- und Zeitlimits,
- Rate Limits fuer Login, Writes, Enrollment und WebSocketverkehr,
- geschlossene Requestvertraege,
- serverseitige Rollen- und Fachpruefung,
- kontrollierte Datenprojektionen statt Rohzeilen,
- CSP-kompatibles Frontend ohne Inline-Skripte,
- lokale Skript-, Font- und Emojiressourcen,
- strukturierte Redaction fuer Logs und Browserdiagnose,
- Audit fuer sicherheitsrelevante und fachliche Mutationen.

## 2. Passwoerter und Sitzungen

Der Browser sendet einen SHA-256-Wert des Passworts. Dieser Wert ist weiterhin
ein vollwertiges Passwortaequivalent und muss ausschliesslich ueber HTTPS
transportiert werden.

Neue Credentials werden serverseitig mit scrypt, zufaelligem Salt und
versioniertem Format gespeichert. Alte SHA-256-Werte koennen bei erfolgreichem
Login migriert werden. Dummy-scrypt reduziert Timingunterschiede bei unbekannten
Identitaeten.

Sitzungscookies sind `HttpOnly`, `SameSite=Strict` und unter HTTPS `Secure`.
Nur der Hash des zufaelligen Sitzungstokens liegt in SQLite. Bei jedem Zugriff
werden Person, Login, Aktivstatus und Rollen erneut gegen den aktuellen
Last-good-Personenbestand aufgeloest.

## 3. Audit und Datenschutz

Fach- und Sicherheitswrites besitzen eine vierphasige Logik:

1. Versuch beginnt,
2. Fachoperation wird ausgefuehrt oder abgewiesen,
3. Ergebnis wird als Erfolg, Fehler oder unklar klassifiziert,
4. kontrollierte Abschlussinformationen werden gespeichert.

Auditfelder duerfen keine Passwoerter, Credential-Hashes, Cookies, Tokens,
freien Payloads oder unnoetigen Personendaten enthalten. Das Auditrepository
besitzt derzeit keine automatische fachliche Retention. Das ist fuer eine
spaetere Plattform datenschutzrechtlich und betrieblich zu entscheiden.

## 4. Observability

Der zentrale Logger schreibt einzeilige JSON-Ereignisse mit Zeit, Level,
Service, Instanz, Version, Event und kontrollierten Feldern. Redaction erfasst
Credentials, Cookies, Autorisierungswerte, E-Mail/Login und typische
Geheimnismuster.

Prometheusmetriken decken HTTP, WebSocket, Sheets, Polling, SQLite, Logging,
Frontendcollector und Datenqualitaet ab. Hochkardinale Personen-, IP-, Request-,
Session- oder Geraete-IDs werden nicht als Labels verwendet.

Browserdiagnosen besitzen eine serverseitige Event-Allowlist, kontrollierte
Felder, lokale und serverseitige Redaction, Sampling, Rate Limits und begrenzte
Queues. Diagnose kann zeitlich begrenzt fuer einzelne aktive Personen erhoeht
werden, ohne freie Frontendpayloads zu uebernehmen.

Der dokumentierte Observability-Sollstand nutzt Prometheus, Loki, Alloy, Node
Exporter und Grafana fuer Live und PAJ. PK ist davon ausgenommen. Ein aktiver
Alarmzustellweg ist derzeit nicht dokumentiert; Alarmzustaende muessen manuell
beobachtet werden.

## 5. Deployment und Laufzeit

Dokumentierte Instanzen:

| Instanz | Oeffentliche Basis | Backend |
|---|---|---|
| Live | `https://epiber.at` | `localhost:8080` |
| PAJ | `https://epiber.at:8081` | `localhost:8083` |
| PK | `https://epiber.at:8082` | `localhost:8084` |

Die Anwendung laeuft unter getrennten unprivilegierten systemd-Benutzern mit
restriktiven Sandboxes und eigenen State-Verzeichnissen. Der aktuelle Rollout
baut aus einem Git-Checkout, prueft zuerst PAJ und uebernimmt danach denselben
Commit auf Live. Das ist fuer wenige Instanzen praktikabel, aber noch keine
Artefaktpromotion fuer eine Mandantenflotte.

## 6. Backup und Restore

Der dokumentierte Ist-/Sollmix umfasst manuelle Rolloutbackups,
Spreadsheetkopien, konsistente SQLite-Sicherungen, Integritaetspruefungen und
Restoreanweisungen. Nicht nachgewiesen beziehungsweise noch offen sind:

- automatisiertes Backupwerkzeug,
- regelmaessige systemd-Backupjobs,
- verschluesseltes Off-site-Ziel,
- immutable Sicherung,
- verbindliche RPO-/RTO-Werte,
- automatisierte Restoretests,
- Backupalteralarmierung,
- vollstaendiger Rebuild eines leeren Ersatzhosts.

Die Dokumentation eines Backupkonzepts ist kein Nachweis, dass Sicherungen
laufen oder wiederherstellbar sind. Vor kommerziellem Betrieb muessen Backup,
Restore und Alarmierung messbar und regelmaessig getestet sein.

## 7. Readiness und Fehlerverhalten

Readiness verlangt unter anderem:

- abgeschlossene Initialisierung,
- gesunde SQLite-Repositories,
- einen vollstaendigen Sheet-Snapshot,
- keinen laufenden Shutdown,
- ausreichend frische Courtquelle bei aktiven Courts,
- keine unaufloesbaren Anzeigeregeln aktiver Legacy-Courts.

Ein alter Last-good-Snapshot allein blockiert Readiness nicht. Das verbessert
Ausfalltoleranz gegen Google, kann aber fachlich veraltete Daten laenger
bereitstellen.

## 8. Tests

Verfuegbare Pruefungen:

- `npm run check`: Syntax und projektspezifische statische Regeln,
- `npm test`: Backend-, Repository-, Service-, Vertrags- und Integrationstests,
- `npm run test:browser`: reale Browsertests mit Chromium,
- `npm run test:workflow`: Git-/Versionsworkflow,
- `npm run test:coverage`: Node-Testcoverage,
- `npm run build`: Check, normale Tests und Workflowtests.

Abgedeckt sind unter anderem Auth, Rollen, Idempotenz, Recovery, Sheets,
Messaging, Audit, Court-Polling, Monitorsteuerung, Matchregeln, responsive
Oberflaechen und Shutdown.

Qualitaetsgrenzen:

- Browsertests sind nicht Teil von `npm run build`.
- Es gibt keinen automatisierten Test gegen eine reale Google-Sheets-Instanz.
- Es gibt keine statische Typpruefung.
- Der projektspezifische Check ersetzt keinen vollwertigen allgemeinen Linter.
- Grosse zentrale Module erhoehen Regressionrisiko und Testdauer.

## 9. Betriebsgrundsaetze fuer die Weiterentwicklung

- Neue Funktionen benoetigen Logs, Audit, Datenschutz- und Fehlerpfade.
- Ein Deployment ist erst nach Readiness-, Smoke- und Versionspruefung fertig.
- Fachwrites duerfen bei unklarem Ausgang nicht automatisch wiederholt werden.
- Restoretests sind Teil des Produkts, nicht nur Infrastrukturarbeit.
- Geheimnisse gehoeren weder in Git noch in Logs, Tickets oder Diagnosen.
- Kapazitaet wird anhand von Messwerten, nicht nur Tenantzahl geplant.
