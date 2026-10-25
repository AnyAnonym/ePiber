# ePiber Observability Runbooks

Alerts enthalten keine personenbezogenen Werte. Logauszuege werden nur von
aktuellen ePiber-Admins in Grafana untersucht und vor Export redigiert. Der
Alert-Labelwert `deployment` bestimmt im aktiven Stand `live` oder `paj`.

Zuordnung:

| Deployment | Backendport | systemd-Unit |
|------------|-------------|--------------|
| `live` | 8080 | `epiber-live.service` |
| `devel` (Dashboard `paj`) | 8083 | `epiber-devel.service` |

PK ist derzeit kein aktives Observability-Deployment und wird erst nach einer
separaten Freigabe wieder in Scrapes, Logs, Authentifizierung und Alerts aufgenommen.

## Backend Down

1. Betroffene Unit mit `systemctl status` und `journalctl -u <unit> --since -10min` pruefen.
2. `curl http://127.0.0.1:<port>/live` ausfuehren.
3. Keine geheimen oder personenbezogenen Zeilen in Tickets kopieren.
4. Bei Deploymentfehler auf den dokumentierten letzten freigegebenen Commit zurueckrollen.

## Not Ready

1. `curl http://127.0.0.1:<port>/metrics` und `epiber_readiness_component_ready` pruefen.
2. Den ungesunden Teil gezielt untersuchen; keine Fachwrites blind wiederholen.

## Projection Missing / Refresh Failed

1. `/ready`, `epiber_projection_table_available` und
   `epiber_projection_refresh_failed` fuer dasselbe Deployment pruefen.
2. `postgres_projection_refresh_completed` und PostgreSQL-Readiness untersuchen.
3. Ohne Erstload bleibt die App not-ready; hohes Alter allein ist kein TTL-Ausfall.
4. Admins koennen im Servicebereich Projektionen bewusst neu laden. Dies ist
   kein externer Import oder Reparatur gespeicherter Fachdaten. Fehler behaelt
   Last-good. Keine automatische Wiederholung; Support-ID/Auditstatus verwenden.

## Court Source Stale

1. Courtquelle, Netzwerk und `court_poll_failed` fuer das Deployment pruefen.
2. ScoreLog-Gesundheit getrennt pruefen.

## PostgreSQL Unhealthy

1. Betroffene Readinesskomponente, Pool, Schema-/Tenantgate und Journal pruefen.
2. Freien Speicher und gemeinsamen Cluster pruefen. Kein automatischer Legacy-
   Rueckfall; keine Fachwrites blind wiederholen.
3. PostgreSQL-Neustart, Reparatur oder Restore sind gesonderte Infrastruktur-
   freigaben, weil Live, PAJ und Gitea gemeinsame Ausfall-/Restoregrenzen teilen.

## HTTP Server Errors

1. Deployment, Fehlerzeitraum und normalisierte Route in Grafana bestimmen.
2. Zu den strukturierten Backendlogs desselben Deployments wechseln.
3. Support-IDs bleiben JSON-Felder und duerfen nicht in Alerttexte gelangen.

## Observability Target Down

1. Das ausgefallene Ziel mit `up` nach `job` bestimmen.
2. Den zugehoerigen Dienststatus und dessen Journal lokal pruefen.
3. Bei Auth-Brokerfehlern `/live` und die Backend-Authpfade von Live und PAJ getrennt pruefen.
4. Bei Loki-, Prometheus- oder Grafana-Ausfall bleibt ePiber unabhaengig; den
   Anwendungsdienst nicht ohne separaten Befund neu starten.

## Host Disk Nearly Full

1. Betroffenes Dateisystem und Inodes pruefen.
2. Loki-, Prometheus-, Caddy-, Journal- und SQLite-Wachstum vergleichen.
3. Keine SQLite-, WAL- oder SHM-Datei bei laufendem Dienst manuell loeschen.
