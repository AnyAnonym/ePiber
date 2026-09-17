# Technischer Istbestand

## 1. Systemkontext

```text
Browser / Monitor
  -> Caddy (TLS, statische Dateien, Security-Header, Routing)
  -> Node.js-Backend auf Loopback
       -> Google Sheets API
       -> state.sqlite
       -> messaging.sqlite
       -> scorelog.sqlite
       -> audit.sqlite
       -> externe Court-Scorequelle
       -> strukturierte Logs und Prometheus-Metriken
```

Das System ist fuer einen kontrollierten Backendprozess pro Instanz und einen
Single-Writer-Betrieb gegen Google Sheets ausgelegt. Prozesslokale Queues,
WebSocketverbindungen, Court-Scores und Locks werden nicht zwischen mehreren
Backendprozessen geteilt.

## 2. Technologie

- Frontend: HTML, CSS, Vanilla JavaScript, native ES6-Module
- Backend: Node.js 26, CommonJS, `ws` v8, `googleapis`
- Persistenz: Google Sheets und `node:sqlite`
- Transport: HTTPS/JSON und WebSocket-Protokoll v2
- Proxy: Caddy
- Prozessmanagement: systemd auf Arch Linux
- Browsertests: Chromium ueber `playwright-core`
- kein Framework, Bundler, TypeScript oder ORM

## 3. Frontendarchitektur

Jede Seite ist ein statisches HTML-Dokument. Gemeinsame Module kapseln
Querschnittsfunktionen:

| Modul | Verantwortung |
|---|---|
| `dataClient.js` | WebSocketzustand, RPC, Subscriptions, Reconnect, operationIds |
| `authClient.js` | HTTP-Sitzung, Passwortaequivalent, Authserialisierung, Cross-Tab-Sync |
| `diagnostics.js` | kontrollierte Browserdiagnose, Redaction, Batching |
| `navbar.js` | Navigation, Authstatus, Meldungen, mobile Bedienung |
| `modals.js` | Profile, Termine, Ergebnisse, Passwortablaeufe |
| `favorites.js` | Favoriten lesen, schreiben und darstellen |
| `global.js` | Anwendungsversion laden |
| Monitorhilfen | Zielpolling, Ready-Protokoll, Scrollsteuerung |

Der Client besitzt eine WebSocket-Zustandsmaschine mit `idle`, `connecting`,
`connected`, `stale`, `backoff`, `offline` und `stopped`. Sichere Reads duerfen
nach Reconnect erneut ausgefuehrt werden; Writes werden nicht automatisch
wiederholt. Unsichere operationIds bleiben fuer eine kontrollierte Wiederaufnahme
erhalten.

## 4. Backendarchitektur

`server.js` initialisiert Repositories, Services, HTTP-Server und
WebSocketprovider. Wesentliche Bausteine:

| Baustein | Verantwortung |
|---|---|
| `server.js` | HTTP, Lifecycle, Readiness, Authrouten, Diagnose, Metriken |
| `dataProvider.js` | WS-Handshake, Principal, Policy, RPC, Topics, Limits, Audit |
| `dataPoller.js` | atomarer Gesamtimport aller Sheet-Tabellen |
| `dataStore.js` | revisionierter Last-good-In-Memory-Cache |
| `sheetService.js` | Fachwrites, Recovery, Metadata und Sheetprojektion |
| `sheetsReadCoordinator.js` | Readkoordination, Exklusivimport, Timeout, Cooldown |
| `authService.js` | Login, Passwortmigration, Sitzungen und Rollen |
| `messagingService.js` | Fachereignisse, Inbox und Zustellung |
| `monitorBroker.js` | Monitorbefehle, Status und Korrelation |
| Regelmodule | Match-, Ergebnis-, Rollen- und Personenregeln |

`sheetService.js` und `dataProvider.js` sind grosse zentrale Module und damit
Wartungs- und Aenderungsschwerpunkte.

## 5. Start und Shutdown

Beim Start werden die vier SQLite-Datenbanken geoeffnet, HTTP/WS bereitgestellt
und alle acht Sheet-Tabellen in einem gemeinsamen Import geladen und validiert.
Erst nach erfolgreichem Snapshot und erforderlichen Courtmigrationen wird
Readiness freigegeben.

`/live` kann bereits erreichbar sein, waehrend `/ready` und `/health` noch `503`
liefern. Beim Shutdown werden neue Arbeiten abgewiesen, Poller gestoppt,
WebSockets mit `1012` geschlossen, laufende HTTP-/WS-/Sheetoperationen geleert
und danach die Datenbanken geschlossen.

## 6. Datenquellen

Google Sheets ist autoritativ fuer acht Tabellen:

- Personen,
- Bewerb,
- Bewerbsart,
- Matchtyp,
- Matches1,
- RL-Platzierung,
- Navigator,
- EntryList.

Nach erfolgreichem Bootstrap gibt es kein allgemeines periodisches
Sheet-Polling. Externe manuelle Aenderungen werden durch Neustart, manuellen
Admin-Gesamtimport oder gezielte Write-Refreshes sichtbar.

Der Last-good-Cache speichert je Tabelle Revision, Fingerprint, Lade- und
Mutationszeitpunkte sowie Fehlerzustand. Ein fehlgeschlagener Import ersetzt
niemals einen vollstaendigen gueltigen Snapshot. Cache-Fencing verhindert, dass
ein alter Read eine neuere lokale Writeprojektion ueberschreibt.

## 7. Lokale Persistenz

### 7.1 `state.sqlite`

Enthaelt Sitzungen, Geraete, Idempotenzoperationen, Loginlimits und revisionierten
Anwendungsstate wie Courts, Monitorziele, Favoriten, Recoveryplaene und
Diagnosekonfiguration.

### 7.2 `messaging.sqlite`

Enthaelt Fachereignisse, persoenliche Projektionen, Receipts, Zustellstatus,
Kommentare, Moderation, Reaktionen und Interaktionsoperationen. Der Code-Iststand
verwendet Schema 10 einschliesslich idempotenter Sammelquittierung.

### 7.3 `scorelog.sqlite`

Speichert dauerhafte Scoreaenderungen mit Event-ID und Courtfolge. Es ist eine
Historienquelle, aber kein Wiederanlaufzustand fuer den aktuellen Live-Score.

### 7.4 `audit.sqlite`

Speichert Versuche und Ergebnisse kritischer Aktionen als `started`, `success`,
`failed` oder `unknown` mit kontrollierten Vorher-/Nachherfeldern. Passwoerter,
Hashes, Cookies und Tokens sind ausgeschlossen.

Alle Repositories verwenden Foreign Keys, WAL, `synchronous=FULL`, restriktive
Dateirechte und explizite Transaktionen.

## 8. Fachwrite und Idempotenz

Der typische Writeablauf lautet:

```text
Principal
  -> geschlossener Requestvertrag
  -> Rollen- und Fachpruefung
  -> operationId und Payloadhash
  -> persistierter Recoveryplan
  -> serialisierter Sheetwrite
  -> Bestaetigungsread
  -> lokale Cacheprojektion
  -> Fachereignis und Inbox
  -> Auditabschluss
  -> Topic-Invalidierung
```

`(actor, operationId)` wird an Endpoint, Payloadhash und Ergebnis gebunden.
Identische Wiederholungen liefern das bekannte Ergebnis, abweichende Payloads
erzeugen einen Konflikt. Bei Transportverlust wird der Zielzustand gelesen und
nicht blind erneut geschrieben.

Google Developer Metadata adressiert stabile Datensaetze unabhaengig von
Zeilenverschiebungen. Trotzdem bietet Google Sheets keine echte atomare
Compare-and-set-Transaktion ueber mehrere Zeilen oder Eindeutigkeitsregeln.

## 9. HTTP

Oeffentliche Betriebsendpunkte:

- `GET /version`
- `GET /live`
- `GET /ready`
- `GET /health`

Interne Endpunkte:

- `GET /metrics`
- `GET /internal/messaging-report`
- `GET /api/admin/grafana-auth`

Weitere HTTP-Routen betreffen Benutzersitzung, Passwortablaeufe,
Monitorsitzung, Browserdiagnose und Diagnoseadministration. Jeder Request erhaelt
eine serverseitige Request-ID, die bei kontrollierten Fehlern als Support-ID
dient.

## 10. WebSocket v2

Der Client startet auf `/ws` mit Protokollversion, Client-/Geraete-ID, Seitentyp
und exakter Anwendungsversion. Die Version muss mit dem Backend uebereinstimmen.

Principals:

- `anonymous`
- `user` mit Rolle `player`, `operator` oder `admin`
- `device`

RPCs sind nach oeffentlich, authentifiziert, Operator/Admin, nur Admin und nur
Geraet getrennt. `contracts.js` validiert geschlossene Parameter- und
Antwortobjekte.

Subscriptions publizieren ueberwiegend Invalidierungen und Revisionen. Der
Client liest die autoritative Projektion danach neu. Wichtige Topics sind
Scores, Scoreboardstate, Tabellenrevisionen, Navigator, Monitore,
persoenliche Meldungen und Bewerbshistorie.

Terminale Close-Codes betreffen Richtlinien-, Geraete- und
Versionsverletzungen. Dienstneustart, temporaere Nichtverfuegbarkeit, Timeout und
Stale-Verbindung sind reconnectfaehig.

## 11. Live-Score-Datenfluss

```text
persistenter Court-State
  -> Polling nur fuer aktive Courts
  -> HTTPS-Fetch mit Timeout und Groessenlimit
  -> JSON-/Struktur-/Semantikpruefung
  -> Baseline- und Epochpruefung
  -> ScoreLog vor Anzeige persistieren
  -> sichtbaren In-Memory-Score aktualisieren
  -> Scoretopics publizieren
```

Sind beide Courts inaktiv, wird die externe Quelle nicht abgefragt. Nach einem
Neustart wird der aktuelle Live-Score nicht aus dem ScoreLog rekonstruiert.

## 12. Architekturgrenzen

- Horizontale Skalierung ist ohne verteilte Koordination nicht sicher.
- Google Sheets erzwingt operative Single-Writer-Regeln.
- Prozesslokale Locks und Queues schuetzen nur eine Backendinstanz.
- Ein Last-good-Snapshot besitzt kein zeitliches Ablaufdatum.
- Gruppenstatistik wird ausschliesslich im Frontend berechnet.
- Externe E-Mail- und WhatsApp-Adapter sind nicht sendende Platzhalter.
- Browser- und Backendversion sind hart gekoppelt.
