================================================================================
CADDY-FRAGMENTE FUER GEMEINSAM GENUTZTE ANWENDUNGEN
================================================================================

Der Host verwendet genau einen Caddy-Prozess fuer ePiber und weitere
Anwendungen. `Project/server-configs/Caddyfile` ist die gemeinsame Hauptdatei,
darf anwendungsfremde Konfiguration aber nicht inline vereinnahmen oder bei
einem ePiber-Rollout entfernen.

Installierte Fragmentverzeichnisse:

Oeffentliche statische JavaScript-/CSS-Dateien werden im jeweiligen Fallback
selektiv mit zstd/gzip komprimiert. Cache-Control bleibt no-cache; HTML, private
Antworten, API, Grafana und WebSockets werden dadurch nicht komprimiert.
Der gemeinsame Caddy darf nur nach vollstaendiger Validierung reloadet werden;
Fremdfragmente und deren bestehende Encoder bleiben unveraendert.

- `/etc/caddy/conf.d/*.caddy`: vollstaendige zusaetzliche Sites. Das
  versionierte Fragment `conf.d/m365-connector.caddy` stellt den internen
  M365-Konnektor auf `127.0.0.1:3000` bereit.
- `/etc/caddy/epiber-live-routes/*.caddy`: Pfadrouten innerhalb von
  `epiber.at`, importiert vor dem allgemeinen statischen ePiber-Fallback. Das
  versionierte Fragment `epiber-live-routes/wc.caddy` stellt `/wc/*` auf
  `127.0.0.1:8090` bereit.
- `/etc/caddy/epiber-live-mode.caddy`: genau ein aktiver ePiber-Live-Modus.
  `epiber-live-modes/active.caddy` stellt den regulaeren Betrieb bereit;
  `epiber-live-modes/maintenance.caddy` sperrt HTTP-/WebSocket-Fachpfade und
  liefert ausschliesslich die statische, datensparsame Wartungsseite aus.

Ein Anwendungsrollout installiert oder aktualisiert nur seine eigenen
Fragmente. Weder ePiber noch eine andere Anwendung darf eines der beiden
Verzeichnisse leeren, unbekannte Fragmente loeschen oder die installierte
Hauptdatei ohne vorherige Diffpruefung vollstaendig ersetzen.

Vor jedem Reload wird die zusammengesetzte installierte Konfiguration mit
`caddy validate --config /etc/caddy/Caddyfile` geprueft. Nach dem Reload werden
alle von der Aenderung betroffenen Origins und Pfade einzeln getestet.

Ein Moduswechsel kopiert atomar genau eines der beiden versionierten Fragmente
nach `/etc/caddy/epiber-live-mode.caddy`, validiert die gesamte installierte
Konfiguration und laedt Caddy erst danach neu. Die gemeinsame Hauptdatei und
anwendungsfremde Fragmente werden dabei nicht ersetzt.
