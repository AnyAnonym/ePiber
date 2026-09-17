# Roadmap

## 1. Leitprinzip

Die Reihenfolge folgt Abhaengigkeiten, nicht dem sichtbaren Funktionswunsch:

1. Entscheidungen und Messwerte,
2. Backup, Restore und Alarmierung,
3. PostgreSQL- und Identitaetsbasis,
4. begrenztes Reservierungs-MVP,
5. reproduzierbare Plattform und zweite Cell,
6. Notifications und PWA,
7. vollstaendige Domaenenmigration,
8. Releasechain und externe Piloten,
9. Betriebsreife und erst danach Skalierung.

Die Roadmap ist Zielrichtung. Termine, Budgets und Exit Gates muessen vor
Umsetzung durch Verantwortliche bestaetigt werden.

## Phase 0: Entscheidungen, Messung und aktuelle Betriebsluecken

### Ergebnisse

- Mandant, Sektion, Person, Mitgliedschaft, Konto und Rolle sind definiert.
- Reservierungsregeln sind fachlich freigegeben.
- Datenregion, AVV, Retention, RPO/RTO und Supportmodell sind entschieden.
- Istwerte fuer Benutzer, Sessions, WebSockets, Datenvolumen, Backupdauer,
  Restorezeit und Supportaufwand sind erfasst.
- aktiver Alarmkanal ist eingerichtet und getestet.
- automatisiertes verschluesseltes Off-site-Backup existiert.
- ein vollstaendiger PAJ-Restore und Host-Rebuild wurden geuebt.

### Exit Gate

Freigegebenes Fachmodell, gemessene Ausgangslage, benannte Verantwortung und
nachgewiesener Restore.

## Phase 1: PostgreSQL- und Identitaetsbasis

### Ergebnisse

- getrennte PostgreSQL-Umgebungen fuer Entwicklung, Test und Produktion,
- Schemahistorie und Migrationstool,
- PgBouncer und begrenzte Pools,
- DB-Readiness, Metriken, PITR und Restoretest,
- asynchrone Repositoryvertraege und klare Transaktionsgrenzen,
- migrierte Personen, Mitgliedschaften, Konten, Rollen und Credentials,
- migrierte Sessions, Loginlimits und Security-State.

### Migrationsmethode

Pro Domaene: Backup, Schreibfenster, Referenzvergleich, Shadow Reads,
PAJ-Abnahme, Auditabschluss und Rueckfallplan. Kein dauerhafter Dual-Write.

### Exit Gate

Identitaet und Security-State des Heimatvereins sind autoritativ und
transaktional in PostgreSQL.

## Phase 2: Hallenreservierungs-MVP

### Ergebnisse

- Anlagen, Plaetze, Oeffnungszeiten und Sperren,
- freie Zeiten, eigene Buchung und Stornierung,
- DB-Constraint gegen Doppelbuchung,
- Vorlauf, Kontingent und Stornofrist,
- begruendete Adminaenderung,
- mobile Oberflaeche,
- Inboxereignisse, Audit und Logs,
- Backup-/Restoreabnahme der Reservierungen.

### Pflichtpruefungen

Parallelbuchung, Race Conditions, Zeitzone/Sommerzeit, Berechtigung,
Stornofrist, Wiederanlauf, Restore, Datenschutz und Regression.

### Exit Gate

Produktiver Winterbetrieb beim Heimatverein ohne Doppelbuchung und mit
nachgewiesenem Restore.

## Phase 3: Reproduzierbare Plattformbasis

Diese Phase kann parallel zu Phase 1 und 2 vorbereitet werden.

### Ergebnisse

- Hetzner-Ressourcen in OpenTofu,
- reproduzierbarer Arch-Bootstrap und Ansible-Konfiguration,
- OCI Registry und signierte App-/Worker-Images,
- Podman-Quadlets und Caddyrouting,
- kontrollierte Secretbereitstellung,
- immutable Off-site-Backups,
- Rebuild-and-Restore ab nacktem Image,
- deklarative Tenantdefinition,
- synthetischer zweiter Tenant mit eigener DB und Rolle.

### Exit Gate

Ersatzhost und Testverein sind ohne manuelle Spezialschritte provisionier- und
wiederherstellbar.

## Phase 4: Notification-Grundsystem und PWA

### Reihenfolge

1. Messaging in das PostgreSQL-Zielmodell ueberfuehren.
2. Ereigniskatalog, Outbox und Worker schaffen.
3. bestehende Fachereignisse anbinden.
4. Eigenmeldungs-, Rollen- und Zielgruppenregeln vereinheitlichen.
5. Kontoeinstellungen und geraetebezogene Pushfreigabe einfuehren.
6. Reminderjobs persistieren.
7. PWA-Manifest, Service Worker und Web Push umsetzen.
8. ungueltige Subscriptions bereinigen.
9. iOS-/Android-Verhalten fachlich und technisch abnehmen.

### Exit Gate

Inbox bleibt autoritativ; Push ist optional, datensparsam, idempotent und nach
Neustart recoveryfaehig.

## Phase 5: Vollstaendige Domaenenmigration und Cell-Faehigkeit

### Domaenen

- Audit und Scorelog,
- Messaging und Outbox,
- persistente Jobs,
- Bewerbe und EntryList,
- Matches und Ranglisten gemeinsam,
- Geraete, Courts und Monitorstate.

### Plattformvertraege

- verbindlicher `TenantContext` in HTTP, WS, Jobs, Events und Audit,
- Domain-zu-Tenant-Aufloesung,
- tenantqualifizierte Topics und Caches,
- keine persistente Speicherung im App-Container,
- standardisierte Health-/Readiness-/Shutdown-Vertraege,
- Ressourcenlimits,
- negative Cross-Tenant-Tests in CI.

### Exit Gate

Der Heimatverein laeuft als erste Cell; der synthetische zweite Tenant kann
keine Daten lesen, schreiben, abonnieren, sichern oder restaurieren.

## Phase 6: Releasechain und erster externer Pilot

### Ergebnisse

- ephemere CI-Umgebungen und synthetische Testdaten,
- Unit-, Integrations-, Browser-, API- und WS-Tests,
- SAST, Dependency-, Lizenz- und Secretscans,
- reproduzierbares Image, SBOM, Signatur und Provenance,
- Promotion desselben Digests durch Release-Ringe,
- Healthgates und automatische Abbruchkriterien,
- Expand/Contract-Migrationen,
- Tenantexport, Einzeltenant-Restore und Tenantumzug,
- standardisiertes Onboarding und Offboarding.

### Exit Gate

Ein externer Pilotverein kann automatisiert bereitgestellt, aktualisiert,
exportiert, restauriert und deaktiviert werden.

## Phase 7: Betriebsreife und kommerzielle Freigabe

### Pflichtnachweise

- AVV, Subprozessoren und Datenregion,
- Incident- und Securityprozess,
- MFA/Passkeys fuer privilegierte Rollen,
- zeitlich begrenzter Supportzugriff,
- Access Reviews,
- Penetrationstest,
- klare SLA- und Supportgrenzen,
- aktive Alarmierung und Eskalation,
- regelmaessige Restore- und DR-Uebungen,
- Quoten- und Kostenmonitoring pro Tenant,
- personelle Stellvertretung.

### Exit Gate

Anwendung, Betrieb, Datenschutz, Restore, Support und Sicherheit sind
wiederholbar und nicht von einer einzelnen Person abhaengig.

## Phase 8: Skalierung nach Messwerten

Erst bei nachgewiesenem Bedarf:

- mehrere App-Nodes,
- Edge Load Balancer,
- WebSocket-Backplane,
- verteilte Worker und tenantfaire Leases,
- Leadermechanismus fuer Singletonjobs,
- getrennte App-/Edge-/DB-Hosts,
- mehrere Failure Domains,
- PostgreSQL-HA,
- Last-, Chaos- und Isolationstests,
- gegebenenfalls k3s/Kubernetes, Nomad oder Managed Service.

Entscheidend sind CPU-/RAM-P95, DB-Latenz, Poolauslastung, WebSockets,
Jobrueckstand, Buchungsspitzen, Backupdauer, Restorezeit und vertragliche
Verfuegbarkeit, nicht die Tenantzahl allein.

## Phase 9: Weitere Produktbereiche

Nach stabiler Plattform koennen folgen:

- Kalender,
- weitere Sektionen,
- direkte persoenliche Nachrichten,
- optionaler E-Mail-Kanal,
- Zahlungen und Rechnungen,
- Reporting,
- Custom Domains,
- SSO,
- dedizierte Enterprise-Cells.

## Querschnittliche Definition of Done

Jede Phase benoetigt:

- bestaetigte Fachregeln und Abgrenzungen,
- Migration und Rueckfallstrategie,
- automatisierte Tests einschliesslich Fehler- und Recoverypfaden,
- strukturierte Abschlusslogs,
- Audit fuer Fachwrites,
- Datenschutz- und Retentionpruefung,
- Metriken, Dashboards und Alerts,
- Backup- und Restoreabnahme,
- Runbook und benannte Verantwortung,
- dokumentierte Exit-Gate-Entscheidung.
