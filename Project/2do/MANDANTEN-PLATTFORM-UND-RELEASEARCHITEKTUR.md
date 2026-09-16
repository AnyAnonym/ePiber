# Mandantenplattform, Vereins-Cells und Releasearchitektur

Stand: 15.09.2026
Status: Nicht-kanonische fachliche und technische Arbeitsgrundlage; noch nicht
implementiert, freigegeben oder als verbindliche Sollarchitektur dokumentiert
Gegenstand: Kommerzielle ePiber-Plattform fuer mehrere Tennisvereine mit
isolierten Vereinsinstanzen, Entwicklungs- und Testumgebungen sowie
kontrollierten Software-Releases

Diese Datei ist eine nicht-kanonische Arbeitsgrundlage unter `Project/2do/`.
Sie fasst die bisherigen Planungsentscheidungen, das empfohlene Zielbild,
Alternativen, Risiken und eine schrittweise Umsetzung zusammen. Verbindliche
fachliche Regeln, Datenvertraege, Sicherheitsvorgaben und Betriebsablaeufe
werden erst vor freigegebenen Umsetzungsschritten in die dafuer vorgesehenen
kanonischen Dokumente uebernommen.

Der aktuelle ePiber-Betrieb ist als Single-Tenant-System gebaut: Ein
Backendprozess verarbeitet genau einen Vereinsdatenbestand, ein Google
Spreadsheet, eine Court-Quelle sowie vier lokale SQLite-Dateien. Diese Datei
beschreibt keine kleine Erweiterung dieses Modells, sondern eine spaetere
Architekturmigration. Ein optionales `tenantId`-Feld in einzelnen Requests
waere keine ausreichende Mandantentrennung.

## 1. Bestaetigter Ausgangspunkt

### 1.1 Mandant

Ein Mandant ist in der ersten kommerziellen Ausbaustufe genau ein Tennisverein.
Er besitzt und verantwortet insbesondere:

- Vereinsstammdaten und Branding;
- Mitglieder und Funktionaere;
- mehrere Anlagen und Tennisplaetze;
- Platzreservierungen und Platzsperren;
- Bewerbe, Ranglisten, Matches und Ergebnisse;
- Scoreboard-Quellen, Monitore und weitere Geraete;
- eigene Rollen, Berechtigungen und Vereinskonfiguration;
- eigene Daten, Backups, Exporte und Loeschauftraege.

Ein Mandant ist weder ein einzelner Platz noch ein einzelnes Turnier. Ein
Tennisverein kann mehrere Anlagen, Anlagen mehrere Plaetze und Plaetze mehrere
zugeordnete Geraete besitzen.

### 1.2 Sektionen

In der ersten Ausbaustufe gibt es pro Verein nur die Sektion Tennis. Das
Datenmodell soll weitere Sektionen jedoch strukturell ermoeglichen, ohne deren
fachliche Funktionen vorwegzunehmen.

```text
Tenant / Verein
  -> Sektion Tennis
       -> Anlagen
            -> Plaetze
                 -> Scorequellen und Geraete
       -> Mitgliederzuordnungen
       -> Bewerbe, Ranglisten und Matches
       -> Reservierungen
```

Beim Anlegen eines Vereins wird automatisiert genau eine aktive Sektion Tennis
angelegt. Erst eine spaetere fachliche Entscheidung darf weitere Sektionen wie
Fussball oder Stocksport und deren unterschiedliche Regelwerke freischalten.

### 1.3 Betriebsmodell

ePiber wird zentral als SaaS betrieben. Vereine betreiben nicht selbst ihre
eigene Infrastruktur. Fuer die ersten zwei bis drei Jahre wird mit etwa 20 bis
100 Mandanten geplant.

Jeder Verein erhaelt eine logisch und betrieblich isolierte Vereins-Cell. Eine
Cell besteht nicht aus einem All-in-one-Container. Anwendung, Worker,
persistente Daten, Backups, Monitoring und zentrale Plattformdienste haben
unterschiedliche Lebenszyklen und werden deshalb getrennt betrieben.

### 1.4 Release-Modell

Neue Funktionen werden zuerst durch Entwickler, danach durch interne Tester und
ausgewaehlte Versuchsbenutzer erprobt. Produktivvereine erhalten neue Stande
nicht zwingend gleichzeitig. Es gibt kontrollierte Release-Ringe fuer Pilot,
Beta und Stable.

Kundenindividuelle Software-Forks sind nicht vorgesehen. Es sollen immer nur
wenige, zentral kontrollierte Produktversionen gleichzeitig unterstuetzt werden.

## 2. Zielbild im Ueberblick

```text
                                Zentrale Plattform
 +-------------------------------------------------------------------+
 | Edge / DNS / TLS / WAF / Load Balancer                            |
 | Tenant Registry und Release Controller                            |
 | Container Registry, CI/CD und Artefaktsignaturen                  |
 | Secret Manager und Key Management                                 |
 | PostgreSQL-Cluster, Object Storage, Backup und Restore-Automation |
 | zentrale Observability, Alerting und Betreiberzugang              |
 +---------------------------+---------------------------------------+
                             |
       +---------------------+---------------------+
       |                     |                     |
       v                     v                     v
 +-------------+       +-------------+       +-------------+
 | Verein A    |       | Verein B    |       | Verein C    |
 | App         |       | App         |       | App         |
 | Worker      |       | Worker      |       | Worker      |
 | DB A        |       | DB B        |       | DB C        |
 | Storage A   |       | Storage B   |       | Storage C   |
 +-------------+       +-------------+       +-------------+
```

Die Plattform trennt zwei Ebenen:

1. **Control Plane:** Verwaltung der Vereine, Domains, Tarife,
   Releasezuordnung, Konfiguration, Provisionierung, Supportfreigaben und
   Lifecycle-Aktionen.
2. **Tenant Data Plane:** Fachliche Verarbeitung der Daten eines konkreten
   Vereins, einschliesslich Benutzer, Spielbetrieb, Reservierungen, Geraete,
   Jobs, Audit und Echtzeitkommunikation.

Die Control Plane darf keine normalen Fachdaten eines Vereins unkontrolliert
verarbeiten. Die Tenant Data Plane darf weder andere Vereine noch globale
Vertrags- und Betreiberinformationen lesen.

## 3. Vereins-Cell

### 3.1 Bestandteile

Eine Vereins-Cell besteht mindestens aus folgenden logisch getrennten Teilen:

| Bestandteil | Aufgabe | Mandantenscope |
|---|---|---|
| `epiber-app` | HTTPS-/WebSocket-Fachlogik, API und Frontend-Auslieferung | je Verein |
| `epiber-worker` | persistente Hintergrundjobs, Imports, Benachrichtigungen, Retention | je Verein |
| Tenant-Datenbank | fachliche, Sicherheits- und Betriebsdaten | je Verein |
| Tenant-DB-Rolle | technisch minimaler Datenbankzugriff | je Verein |
| Storage-Namespace | zukuenftige Dateien und Medien | je Verein |
| Tenant-Secrets | Integrationen, Geraete, Mail, externe Anbieter | je Verein |
| Domainrouting | Subdomain oder verifizierte eigene Kundendomain | je Verein |
| Backup-/Restore-Objekte | Sicherung, Export und Wiederherstellung | je Verein |

App und Worker verwenden dasselbe signierte Softwareartefakt oder klar
versionierte Teilimages. Sie erhalten aber getrennte Serviceidentitaeten,
Ressourcenlimits und Berechtigungen.

### 3.2 Nicht in die Cell gehoerende Komponenten

Folgende Komponenten werden zentral betrieben, aber logisch mandantenfaehig
ausgelegt:

- DNS, Zertifikatsverwaltung und Edge-Routing;
- Container Registry und CI/CD;
- Tenant Registry und Release Controller;
- Secret Manager und Key Management;
- PostgreSQL-Cluster;
- Object Storage;
- zentrale Plattformobservability und Alerting;
- Off-site-Backupziel;
- Betreiber-IAM und Break-glass-Zugang.

Ein eigener PostgreSQL-Prozess, Prometheus-Server oder Grafana-Server pro Verein
waere bei 20 bis 100 Mandanten unverhaeltnismaessig teuer und schwer wartbar.
Die fachlichen Daten, Datenbankrechte, Storageobjekte und Betreiberansichten
bleiben trotzdem pro Verein getrennt.

### 3.3 Isolationseigenschaften

Eine Cell ist keine alleinige Sicherheitsgrenze. Die folgenden Schutzschichten
muessen zusammenwirken:

1. eigener App-/Worker-Deployment-Scope pro Verein;
2. eigene Datenbank und eigene Datenbankrolle;
3. eigene Secrets und Storage-Praefixe;
4. verbindlicher Tenant-Kontext in Anwendung, Jobs, Audit und Events;
5. Netzwerk- und IAM-Policies mit minimalen Rechten;
6. getrennte Backup- und Restoreobjekte;
7. automatisierte negative Isolationstests;
8. operator-only Observability fuer Plattformdaten.

Ein Fehler in einer Schicht darf nicht automatisch Zugriff auf Daten anderer
Vereine erlauben.

### 3.4 Ressourcen und Noisy Neighbors

Jede Cell benoetigt eigene Grenzen fuer:

- CPU und Hauptspeicher;
- maximale HTTP- und WebSocket-Verbindungen;
- Job-Parallelitaet;
- Datenbankverbindungen;
- Speicherplatz und Datei-Uploads;
- externe API-Aufrufe;
- E-Mail-, Push- oder SMS-Kontingente;
- Platz-, Mitglieder- und Geraeteanzahl gemaess Tarif.

Grenzen gelten hierarchisch:

```text
Plattform -> Umgebung -> Cell/Tenant -> Benutzer/IP -> Endpoint/Integration
```

Ein grosser, fehlerhafter oder missbrauchender Verein darf die anderen Vereine
nicht durch Datenbankverbindungen, WebSockets, Joblast oder externe Quoten
blockieren.

## 4. Organisations- und Datenmodell

### 4.1 Scope je Fachobjekt

| Fachobjekt | Scope |
|---|---|
| Plattformbenutzer/Identitaet | Plattform |
| Verein/Tenant | Plattform-Control-Plane |
| Tarif, Vertrag, Entitlement | Verein |
| Sektion | Verein |
| Mitgliedschaft | Verein |
| Rolle | Verein, spaeter optional Sektion |
| Anlage, Platz, Scorequelle, Monitor | Sektion |
| Reservierung | Sektion und Platz |
| Bewerb, Rangliste, Match | Sektion |
| Vereinsbranding und allgemeine Termine | Verein |
| Audit, Export, Restoreauftrag | Verein, mit Plattformkontrolle |

### 4.2 Identitaet, Person und Mitgliedschaft

Die heutige Kopplung von Personenzeile, Login, Passwort und Vereinsrolle muss
aufgeloest werden.

```text
users
  globale Benutzeridentitaet
  Login, Credential oder externer IdP-Link

tenants
  Verein, Status, Vertrag und Grundkonfiguration

sections
  Tennis und spaetere Sektionen eines Vereins

memberships
  user_id + tenant_id
  Aktivstatus, Mitgliedsklassifikation, Rollen

people
  tenant_id + person_id
  vereinsbezogene Stamm- und Kontaktdaten
```

Dadurch kann ein Mensch mehreren Vereinen angehoeren und in jedem Verein andere
Rollen besitzen. Eine Plattformidentitaet darf nicht mit einem vereinsinternen
Personenprofil gleichgesetzt werden.

### 4.3 Rollen

Voraussichtliche Tenantrollen:

- `player`;
- `operator`;
- `sports_admin`;
- `tenant_admin`;
- spaeter optional `section_admin`;
- spaeter optional `reservation_manager` und `content_manager`.

Plattformrollen bleiben davon strikt getrennt:

- `platform_operator`;
- `support`;
- `billing_admin`;
- `security_admin`;
- `privacy_admin`;
- `backup_operator`.

Plattformrollen erben keine Fachrechte eines Vereins. Ein Supportzugriff braucht
eine begruendete, zeitlich begrenzte Freigabe, sichtbare Kennzeichnung und einen
vollstaendigen Auditpfad. Zugang zu Passwoertern, Tokens oder nicht benoetigten
Personendaten ist ausgeschlossen.

### 4.4 Tenant- und Request-Kontext

Jeder Request, WebSocket und Hintergrundjob wird verbindlich einem Tenant
zugeordnet:

```text
TenantContext {
  tenantId
  tenantSlug
  canonicalHost
  status
  timezone
  locale
  plan
  entitlements
  configurationRevision
}

RequestContext {
  requestId
  tenant
  principal
  sourceIp
  authMethod
  startedAt
}
```

Regeln:

- Tenant wird aus einer validierten Domain-zu-Tenant-Zuordnung bestimmt.
- Weder URL-Parameter noch Requestbody duerfen den Tenant frei bestimmen.
- Unbekannte, gesperrte oder nicht fertig provisionierte Tenants werden vor dem
  Datenzugriff abgewiesen.
- Jede Session ist an Benutzer und aktive Mitgliedschaft beziehungsweise Tenant
  gebunden.
- Ein Vereinswechsel ist eine kontrollierte Serveraktion, kein geaenderter
  Queryparameter.
- Repositorymethoden erhalten Tenant-Scope explizit, etwa
  `getMatch(tenantId, matchId)` statt `getMatch(matchId)`.
- `AsyncLocalStorage` darf Logging vereinfachen, aber keine expliziten
  Datenbank- und Repositoryparameter ersetzen.

## 5. Datenbankstrategie

### 5.1 Entscheidungsvorbereitung

Fuer die erwarteten 20 bis 100 Vereine werden drei Varianten betrachtet.

| Variante | Beschreibung | Bewertung |
|---|---|---|
| Eigene Datenbank je Tenant | Ein PostgreSQL-Cluster, aber Datenbank und DB-Rolle je Verein | empfohlen |
| Eigenes Schema je Tenant | Eine Datenbank mit einem Schema je Verein | moegliche Sparvariante |
| Gemeinsame Tabellen | Ein Schema, Trennung ueber `tenant_id` und RLS | erst bei sehr hoher Skalierung |

### 5.2 Eigene Datenbank je Verein

```text
PostgreSQL-Cluster Produktion
  -> epiber_tenant_001
  -> epiber_tenant_002
  -> epiber_tenant_003
```

Jede Datenbank besitzt eine eigene, minimal berechtigte DB-Rolle und eigene
Credentials aus dem Secret Manager.

Vorteile:

- starke logische Isolation;
- ein vergessener Tenantfilter in einem Query kann nicht direkt Daten anderer
  Vereine lesen;
- klare Datenbankrechte je App-Cell;
- einfacher Tenantexport und logisches Backup;
- gezielter Tenant-Restore und Tenantumzug moeglich;
- grosse oder sensible Vereine koennen spaeter auf einen eigenen DB-Cluster
  verschoben werden;
- sehr gute Passung zum App-Container-pro-Verein-Modell.

Nachteile:

- Schema-Migrationen muessen ueber viele Datenbanken orchestriert werden;
- mehr Connection Pools und Datenbankinventar;
- mandantenuebergreifende Analysen sind schwieriger;
- Point-in-Time Recovery eines einzelnen Tenants braucht neben Cluster-PITR auch
  logische Export- und Restoreverfahren.

### 5.3 Eigenes Schema je Verein

```text
epiber_platform
  -> tenant_001.*
  -> tenant_002.*
  -> tenant_003.*
```

Vorteile:

- weniger Datenbanken und Connection Pools;
- gemeinsame Plattformadministration einfacher;
- zentrale Migrationen koennen einfacher erscheinen;
- geringerer Grundaufwand.

Nachteile:

- schwachere Isolation als eigene Datenbanken;
- fehlerhafte Schemaauswahl oder `search_path` kann Daten vermischen;
- Berechtigungsmodell und Migrationen bleiben komplex;
- Tenant-Restore, Umzug und rechtssicherer Export sind aufwendiger;
- eine falsch konfigurierte DB-Rolle kann alle Schemas erreichen.

### 5.4 Gemeinsame Tabellen mit `tenant_id`

Vorteile:

- effizienteste Ressourcenverwendung;
- ein Schema und zentrale Auswertungen;
- bei sehr grossen Tenantzahlen gut skalierbar.

Nachteile:

- hoechstes Risiko eines Cross-Tenant-Datenlecks;
- jeder Query, Cache, Job und Eventpfad muss Tenantfilter korrekt erzwingen;
- PostgreSQL Row-Level Security und tenantgebundener Connection Context sind
  zwingend;
- Tenantexport, -restore und -umzug sind komplex;
- passt nicht gut zur beabsichtigten Cell-Isolation.

### 5.5 Vorlaeufige Empfehlung

Die Zielarchitektur plant standardmaessig:

> Einen zentral betriebenen PostgreSQL-Cluster je Umgebung, darin eine eigene
> Datenbank und eigene DB-Rolle je Verein.

Test und Produktion verwenden getrennte Datenbankcluster. Grosse,
compliance-sensitive oder besonders lastintensive Vereine koennen spaeter eine
dedizierte Cell mit eigenem DB-Cluster erhalten.

Die Anwendung fuehrt trotzdem einen Tenant-Kontext. Dieser bleibt fuer Audit,
Jobs, Storage, Domainerkennung, Support, Backups und zukuenftige gemeinsame
Plattformdienste erforderlich.

### 5.6 Datenbankanforderungen

PostgreSQL wird langfristig System of Record fuer:

- Vereins-, Sektions-, Anlagen- und Platzdaten;
- Personen, Mitgliedschaften und Rollen;
- Reservierungen;
- Bewerbe, Matches und Ranglisten;
- Sessions, Idempotenz und Sicherheitszustand;
- Messaging, Benachrichtigungen und Quittierungen;
- Audit und Scorehistorie;
- Geraete- und Monitorzustand;
- Jobs, Outbox und Migrationsstatus.

Pflichtmerkmale:

- transaktionale Fachwrites;
- referenzielle Integritaet;
- kontrollierte Schema-Migrationen;
- Point-in-Time Recovery;
- verschluesselte Volumes und Backups;
- Connection Pooling;
- DB-Rollen mit minimalen Rechten;
- Audit von privilegierten DB-Zugriffen;
- Health-, Kapazitaets- und Backupmonitoring.

Google Sheets bleibt waehrend einer Uebergangszeit pro Verein eine kontrollierte
Import-/Export- oder Legacyintegration. Es ist langfristig nicht die
transaktionale Primaerdatenbank fuer Reservierungen, Stammdaten, Sessions oder
Vertragsdaten.

## 6. Fachliche Erweiterungen

### 6.1 Stammdatenverwaltung

Die geplante Stammdatenverwaltung muss mindestens Vereins-, Sektions-, Anlagen-,
Platz-, Mitglieder- und Rollenstammdaten unterscheiden. Fachliche Rechte und
sichtbare Masken sind nach Scope zu begrenzen.

Beispiele:

- Vereinsadmin aendert Vereinsname, Branding, allgemeine Oeffnungszeiten und
  Funktionaerszuordnungen;
- Sektionsadmin verwaltet zukuenftig nur seine Sektion;
- Platzverantwortliche verwalten Platzsperren, nicht aber Mitgliederdaten;
- Plattformoperatoren aendern weder Vereinsstammdaten noch sportliche Daten ohne
  auditierten Supportzugriff.

### 6.2 Platzreservierung

Ein Reservierungssystem benoetigt transaktionale Sperren und darf nicht auf
einer Sheet- oder Browserkonvention beruhen. Es muss insbesondere behandeln:

- mehrere Anlagen und Plaetze pro Verein;
- Oeffnungszeiten, Feiertage und saisonale Regeln;
- Wartungs-, Turnier- und Trainingssperren;
- Einzel-, Doppel- und Gastspieler;
- Mitgliedschaftsstatus und Berechtigung;
- Buchungskontingente und Prioritaeten;
- parallele Buchungsversuche und Doppelbuchungen;
- wiederkehrende Buchungen;
- Storno-, Umbuchungs- und No-show-Regeln;
- Zeitzonen, UTC-Speicherung und Sommerzeit;
- optionale Zahlungen, Rechnungen und Rueckerstattungen;
- nachvollziehbare Aenderungshistorie;
- Benachrichtigungen und Erinnerungen.

Ein Buchungswrite muss atomar pruefen und speichern. Die Datenbank ist dabei
Autoritaet; die Benutzeroberflaeche zeigt nur den kontrolliert projizierten
aktuellen Stand.

## 7. Echtzeit, Caches und Hintergrundarbeit

### 7.1 WebSockets

Jede WebSocket-Verbindung ist beim Upgrade dauerhaft an einen Tenant und einen
Principal gebunden. Interne Topics werden tenantqualifiziert:

```text
tenant:<tenantId>:scores
tenant:<tenantId>:matches
tenant:<tenantId>:reservations
tenant:<tenantId>:messages:<userId>
tenant:<tenantId>:monitor:<monitorId>:commands
```

Der Browser sendet keine interne Tenantqualifizierung. Der Server ergaenzt sie
aus dem bereits validierten Verbindungskontext. Subscription und Publish muessen
denselben Tenant erzwingen.

Bei mehreren App-Replikaten wird eine Backplane benoetigt. Auszuwerten sind
Redis, NATS oder ein vergleichbarer Broker. Dabei werden getrennt behandelt:

- fluechtige Cache-Invalidierungen;
- wiederherstellbare Fachereignisse;
- persistente Outbox-Ereignisse;
- Monitorbefehle mit ACK, Timeout und Wiederholung.

### 7.2 Caches

Alle Cachekeys und In-Memory-Zustaende sind tenantgebunden. Erforderlich sind:

- `tenantId` als Teil jedes Schluessels;
- maximale Cachegroesse pro Tenant und Prozess;
- TTL, LRU und kontrollierte Invalidierung;
- Konfigurationsrevision je Tenant;
- Schutz gegen unbegrenztes Laden vieler inaktiver Tenants;
- kein globaler Quoten-Cooldown ueber alle Vereine;
- keine Tenantdaten in unqualifizierten Singleton-Maps.

### 7.3 Persistente Jobs

Lokale Timer genuegen bei mehreren Replikaten nicht. Jeder Hintergrundjob wird
persistent gespeichert und traegt mindestens:

```text
job_id
tenant_id
job_type
payload_version
idempotency_key
status
attempt_count
available_at
lease_owner
lease_until
last_error_code
```

Jobs betreffen unter anderem:

- Tenant-Provisionierung und Deprovisionierung;
- Daten- und Google-Sheets-Importe;
- Export, Archivierung und Loeschung;
- Erinnerungen und externe Zustellung;
- Wiederherstellung und Recovery;
- Retention und Backupverifikation;
- externe Court- und Mitgliederintegrationen;
- wiederkehrende Reservierungen;
- Datenmigrationen und Integritaetspruefungen.

Die Queue braucht tenantfaire Parallelitaet, globale Kapazitaetsgrenzen,
idempotente Wiederholung, Backoff mit Jitter, Dead-Letter-Status, operative
Wiederaufnahme und vollstaendige Auditierung administrativer Aktionen.

## 8. Entwicklungs-, Test- und Produktionsumgebungen

### 8.1 Umgebungen

| Umgebung | Zweck | Daten | Externe Erreichbarkeit |
|---|---|---|---|
| Lokal | Entwicklung einzelner Features | ausschliesslich synthetisch | Entwicklergeraet |
| CI/Ephemeral | automatisierte Tests pro Aenderung | automatisch erzeugt | kurzlebig, intern |
| Integration | gemeinsamer technischer Test | synthetisch/anonymisiert | intern geschuetzt |
| Testuser | manuelle Abnahme durch Versuchsbenutzer | synthetisch, keine Produktivkopie | kontrolliert erreichbar |
| Produktion | Vereine mit echten Daten | Produktivdaten | oeffentlich ueber HTTPS |

Produktion und Test muessen in getrennten Accounts, Projekten oder mindestens
getrennten Netz- und Ausfallbereichen liegen. Produktivdaten werden nicht in
lokale, CI- oder allgemeine Testumgebungen kopiert. Falls realistische
Konstellationen benoetigt werden, sind synthetische Generatoren oder
nachweisbar anonymisierte Datensaetze zu verwenden.

### 8.2 Mandantentypen

Unabhaengig von der technischen Umgebung werden folgende Tenanttypen benoetigt:

- interner Entwicklungstenant;
- automatisierter Testtenant;
- manueller QA-Tenant;
- Testtenant fuer Versuchsbenutzer;
- produktiver Pilottenant;
- produktiver Beta-Tenant;
- produktiver Stable-Tenant.

Ein Testtenant darf nicht durch eine interne Rolle in einem Produktivtenant
ersetzt werden. Die Trennung schuetzt reale Vereinsdaten und erlaubt gezielte
Migrations-, Fehler- und Lasttests.

### 8.3 Ephemere Testumgebungen

Jeder Pull Request soll nach Moeglichkeit automatisiert erhalten:

- ein unveraenderliches Testimage;
- eine leere, migrierte Testdatenbank;
- synthetische Seed-Daten;
- Unit-, Integrations- und Browsertests;
- API-, WebSocket- und Berechtigungstests;
- negative Cross-Tenant-Tests;
- Ergebnis-, Reservierungs- und Migrations-Regressionstests;
- automatisches Entfernen nach Abschluss.

Secrets aus Produktion duerfen nie in ephemere Testumgebungen gelangen.

## 9. Release-Ringe

### 9.1 Ringe

```text
Ring 0: Development
Ring 1: Internal Integration
Ring 2: Test Users
Ring 3: Production Pilot
Ring 4: Production Beta
Ring 5: Production Stable
```

| Ring | Teilnehmer | Daten | Ziel |
|---|---|---|---|
| Development | Entwickler | synthetisch | neue Funktion entwickeln |
| Internal Integration | Entwicklung und QA | synthetisch | Gesamtintegration pruefen |
| Test Users | ausgewaehlte Versuchsbenutzer | synthetisch | Bedienung und Fachablauf pruefen |
| Production Pilot | eigener Verein oder enger Pilotkunde | echt | minimaler Produktiv-Blast-Radius |
| Production Beta | freiwillige Produktivvereine | echt | breiter Praxistest |
| Production Stable | regulaere Produktivvereine | echt | normaler Betrieb |

### 9.2 Promotion

Ein Release wird einmal gebaut und anschliessend unveraendert durch die Ringe
befoerdert:

```text
Git Commit
  -> Tests und Scans
  -> OCI-Image
  -> SBOM und Signatur
  -> unveraenderlicher Image-Digest
  -> Development
  -> Internal
  -> Test Users
  -> Pilot
  -> Beta
  -> Stable
```

Zwischen Ringen wird kein neues Image gebaut. Die Promotion verwendet stets
denselben Digest. Tags wie `beta` oder `stable` sind nur lesbare Zeiger, nie die
alleinige technische Releaseidentitaet.

### 9.3 Rolloutwellen

Innerhalb eines Rings erfolgen Produktivrollouts in Wellen, zum Beispiel:

```text
Pilot: 1 Tenant
Beta: 5 % -> 20 % -> 50 % -> 100 % der Beta-Tenants
Stable: 5 % -> 20 % -> 50 % -> 100 % der Stable-Tenants
```

Vor der naechsten Welle werden Health, Fehlerquote, Latenzen, Datenbankstatus,
Jobfehler, Supporttickets und fachliche Kontrollkennzahlen bewertet. Bei
definierten Abbruchkriterien stoppt der Release Controller weitere Wellen.

### 9.4 Versionspolitik

Unterstuetzt werden sollen nur:

- die aktuelle Stable-Version;
- die vorherige Stable-Version fuer ein klar begrenztes Uebergangsfenster;
- die aktuelle Beta-Version;
- gegebenenfalls eine akut notwendige Sicherheits-Patchversion.

Kritische Security-Fixes duerfen nicht dauerhaft aufgeschoben werden. Ein
Verein kann Beta-Teilnahme aktivieren oder deaktivieren, aber nicht auf Dauer
willkuerliche historische Versionen betreiben. Kundenspezifische Forks und
Sonderbuilds sind ausgeschlossen.

## 10. Entitlements und Feature Flags

Releaseversion und Funktionsfreigabe sind getrennte Konzepte.

Beispiel:

```text
Version 5.x ist technisch auf allen Stable-Tenants installiert.
Das Reservierungssystem ist nur fuer Pilot- und Beta-Tenants aktiviert.
```

### 10.1 Entitlements

Entitlements beschreiben vertraglich verfuegbare Produktbestandteile:

```text
tournament_management
court_reservation
member_management
scoreboard
multi_section
custom_domain
advanced_reporting
```

Sie werden zentral durch die Control Plane gepflegt und serverseitig erzwungen.

### 10.2 Feature Flags

Feature Flags steuern einen technischen, zeitlich begrenzten Rollout:

```text
reservation_v2_enabled
new_booking_calendar_enabled
new_member_import_enabled
```

Flags duerfen nach Plattform, Release-Ring, Tenant oder kontrollierter
Benutzergruppe gelten. Sie ersetzen nie Rollenpruefungen, Entitlements oder
serverseitige Fachregeln.

Jede Flag-Aenderung braucht:

- Eigentumer und fachliche Begruendung;
- Scope und Ablaufdatum;
- Beobachtungs- und Rollbackplan;
- Audit mit Akteur, altem und neuem kontrollierten Zustand;
- Entfernung nach abgeschlossenem Rollout.

## 11. Datenbankmigration und Rollback

Ein Containerrollback ist einfach; ein Datenbankrollback kann Daten verlieren
oder unvereinbare Zustaende erzeugen. Migrationen folgen deshalb dem
Expand/Contract-Muster:

1. Neue Tabellen, Spalten oder Indizes additiv einfuehren.
2. Alte und neue App-Version gleichzeitig kompatibel halten.
3. Daten per idempotentem Hintergrundjob backfillen.
4. Neue Lesepfade und Funktionen kontrolliert aktivieren.
5. Alte Felder erst nach erfolgreichem Flottenrollout und Ablauf des
   Kompatibilitaetsfensters entfernen.

Pflichten:

- Jede Tenant-Datenbank speichert Schema- und Migrationsstand.
- Migrationen werden zentral orchestriert und je Tenant protokolliert.
- Vor riskanten Migrationen wird ein erfolgreicher Backupstatus verlangt.
- App-Version und DB-Schema-Kompatibilitaet werden beim Start geprueft.
- Bei Migrationsfehler bleibt der Tenant in einem kontrollierten Status und
  weitere Rolloutwellen stoppen.
- Destruktive Aenderungen erfolgen nie im selben Release wie eine neue
  Abhaengigkeit darauf.
- Migrationen, Backfills und unklare Ausgaenge besitzen Audit, strukturierte
  Abschlusslogs und Wiederaufnahme.

Google-Sheets-zu-PostgreSQL-Migrationen erfolgen tenantweise, nicht als globaler
Big Bang. Pro Tenant werden Import, Referenzen, Pruefsummen, Shadow Reads,
kontrolliertes Schreibfenster, finaler Deltaimport und Cutover dokumentiert.

## 12. CI/CD und Artefakte

### 12.1 Pipeline

Jede Aenderung durchlaeuft mindestens:

1. statische Checks und Formatpruefungen;
2. Unit- und Integrationstests;
3. Browser-, API- und WebSocket-Tests;
4. Berechtigungs- und negative Tenantisolationstests;
5. Dependency-, Lizenz-, Secret- und SAST-Scans;
6. Datenbankmigrations- und Upgradepruefungen;
7. Build eines reproduzierbaren OCI-Images;
8. SBOM, Artefaktsignatur und Build-Provenance;
9. Deployment nach Integration und automatisierte Smoke-Tests;
10. kontrollierte Promotion in weitere Release-Ringe.

### 12.2 Artefaktregeln

- Produktion verwendet keine direkt aus Git-Checkouts gestarteten Prozesse.
- Dasselbe signierte Image wird von Test bis Produktion befoerdert.
- Jede Auslieferung ist ueber Image-Digest, Commit, Buildzeit und SBOM
  nachvollziehbar.
- Releaseberechtigung und Buildberechtigung sind getrennt.
- Ein Rollback verwendet ein bereits bekanntes, kompatibles Image.
- Images und Abhaengigkeiten werden regelmaessig auf Schwachstellen geprueft.

## 13. Plattformbetrieb

### 13.1 Orchestrierung

Fuer eine kleine erste Flotte kann automatisierter Docker-/Podman-Betrieb mit
Compose und Infrastructure/Configuration as Code genuegen. Bei 20 bis 100
Mandanten muss die Architektur aber auf einen Scheduler vorbereitet sein.

Pragmatischer Pfad:

1. OCI-Images, zentrale Registry, deklarative Tenantdefinitionen und
   automatisiertes Provisioning.
2. Mehrere Hosts mit kontrolliertem Flottenrollout, Ressourcenlimits und
   Neuplatzierung.
3. Bei begruendetem Bedarf k3s/Kubernetes, Nomad oder Managed Container Service
   mit mehreren Failure Domains.

Kubernetes wird nicht allein wegen der Mandantenfaehigkeit eingefuehrt. Es ist
erst sinnvoll, wenn Flottengroesse, Hochverfuegbarkeit und Betriebskompetenz den
zusaetzlichen Aufwand rechtfertigen.

### 13.2 Netzwerk

Erforderlich sind:

- Edge Load Balancer oder Managed Ingress;
- oeffentlich nur HTTPS auf Port 443;
- Port 80 nur Redirect und ACME, falls erforderlich;
- getrennte Netzbereiche fuer Edge, App, Datenbank, Observability und Backup;
- Netzwerkpolicy Edge -> App -> Datenbank;
- kontrollierter Egress nur zu freigegebenen Integrationen;
- kein oeffentlich erreichbarer Datenbank-, Metrics- oder Grafana-Port;
- MFA-geschuetzter Betreiberzugang ueber Bastion oder Zero-Trust-Zugang;
- WAF, DDoS-Schutz und globale Ratenbegrenzung.

### 13.3 DNS und TLS

Standarddomains koennen beispielsweise sein:

```text
verein-a.epiber.example
verein-b.epiber.example
```

Spaeter koennen verifizierte Kundendomains ergaenzt werden. Notwendig sind:

- Domain-zu-Tenant-Registry;
- kontrollierter Besitznachweis bei Custom Domains;
- automatische Zertifikate und Erneuerung;
- CAA und DNSSEC nach Infrastrukturentscheidung;
- externe Ueberwachung von DNS, Zertifikatsablauf, HTTPS und WSS;
- eindeutiges Domain-Onboarding und Offboarding;
- kein Tenant-Routing allein aufgrund unvalidierter Hostheader.

### 13.4 Secrets

Secrets werden zentral verwaltet:

- Secret Manager und KMS-gestuetzte Verschluesselung;
- Workload Identity statt langlebiger Dateischluessel, soweit Integrationen dies
  erlauben;
- separates Credential je Tenant und Umgebung;
- Rotation, Eigentumer, Ablauf und Zugriffsaudit;
- keine Secrets in Git, Images, Logs, Tickets oder Changelogs;
- getrennte Break-glass-Credentials mit regelmaessigem Test;
- kein gemeinsamer Maschinen-Bearer ueber alle Kunden, wenn Einzelcredentials
  moeglich sind.

### 13.5 Backups und Disaster Recovery

Vor kommerziellem Produktivbetrieb erforderlich:

- automatisierte verschluesselte Off-site-Backups;
- immutable Backupziel mit Object Lock;
- PostgreSQL-PITR und logische Tenantexports;
- Backupalter, Fehler und Kapazitaet aktiv ueberwachen;
- regelmaessige automatisierte Restoretests;
- dokumentierter Restore eines einzelnen Tenants;
- regelmaessiger kompletter Host-/Regions-DR-Test;
- verbindliche RPO- und RTO-Ziele;
- Sitzungs-, Reset- und Geraeteinvalidierung bei Restore;
- Loeschregister fuer datenschutzrechtliche Loeschungen nach Restore;
- klare Trennung von Backup-, Prune- und Restoreberechtigungen.

### 13.6 Observability und Alerting

Zentrale Plattformobservability ist ausschliesslich fuer Betreiber vorgesehen.
Vereinsadmins erhalten keine gemeinsame Grafana-Organisation mit Daten anderer
Vereine.

Erforderlich sind:

- externe synthetische HTTPS-, Login- und WSS-Probes;
- aktive Alarmzustellung und benannter Bereitschaftsweg;
- SLOs fuer Verfuegbarkeit, API-/WS-Latenz, Fachwrites, Jobs, Datenbank und
  Backupalter;
- zentrale Logs ausserhalb des App-Ausfallbereichs;
- datensparsame strukturierte Logs mit `tenantId`, Request- und Trace-ID;
- keine unbeschraenkte Tenant-ID als Prometheus-Label;
- tenantbezogene Diagnose ueber kontrollierte Views statt globaler Kundenrechte;
- Kosten-, Kapazitaets- und Quotenueberwachung je Verein;
- manipulationsgeschuetzte Security- und Auditlogs.

## 14. Sicherheit, Datenschutz und Audit

### 14.1 Sicherheitsanforderungen

- MFA oder Passkeys fuer privilegierte Vereins- und Plattformrollen;
- zentrale IAM- und regelmaessige Access Reviews;
- Verschluesselung fuer Datenbankvolumes, Object Storage und Backups;
- Patch- und Vulnerability-SLA;
- Dependency-, Secret-, SAST-, Image- und IaC-Scans;
- SBOM und signierte Artefakte;
- regelmaessige Penetrationstests;
- WAF, DDoS-Schutz und Egress Policies;
- dokumentierte Incident-, Breach- und Change-Prozesse;
- Trennung von Betreiber-, Support-, Datenschutz- und Backupaufgaben.

### 14.2 Audit

Jeder fachliche oder administrative Auditdatensatz muss mindestens tragen:

```text
event_id
tenant_id
occurred_at
request_id
trace_id
actor_type
actor_id
membership_id
action
target_type
target_id
result
support_access_id
```

Die bestehende Semantik `started -> success|failed|unknown` bleibt fuer
verteilte Operationen erhalten. Auditprojektionen enthalten nur kontrollierte
Felder; keine Passwoerter, Tokens, freien Payloads oder unnoetigen
Personendaten.

### 14.3 Datenschutz

Vor breitem kommerziellem Betrieb sind mindestens zu entscheiden und
umzusetzen:

- Auftragsverarbeitungsvertraege und Subprozessoren;
- Datenregion und Drittlandtransfers;
- Datenklassifikation;
- Aufbewahrungs-, Archivierungs- und Loeschfristen;
- Auskunft, Export, Berichtigung, Sperrung und Loeschung;
- Umgang mit Daten in Backups und Restorefaellen;
- Supportzugriffe und Protokollierung;
- Rechtsgrundlagen fuer Notifications und optionale Marketingfunktionen;
- Incident- und Datenschutzverletzungsverfahren.

## 15. Priorisierter Umsetzungsplan

### Phase 0: Entscheidungen und verbindliches Zielmodell

- [ ] Mandant verbindlich als Tennisverein festlegen.
- [ ] Sektion als vorbereitetes Unterobjekt und Tennis als einzige aktive
      Erstsektion festlegen.
- [ ] Vereins-, Sektions- und Plattformrollen definieren.
- [ ] Login- und Mehrvereinsmitgliedschaftsmodell entscheiden.
- [ ] Tarif-, Entitlement- und Feature-Flag-Modell entscheiden.
- [ ] Release-Ringe, Betateilnahme, Supportfenster und Versionspolitik
      beschliessen.
- [ ] Datenbank pro Tenant als Standardmodell oder eine begruendete Alternative
      verbindlich festlegen.
- [ ] RPO/RTO, Retention, Export, Loeschung und Datenregionen festlegen.
- [ ] Betreiber-, Support-, Datenschutz- und Incidentverantwortung benennen.

**Exit:** Freigegebenes fachliches, wirtschaftliches und betriebliches
Zielmodell.

### Phase 1: Bestehenden Single-Tenant-Betrieb produktionsfest machen

- [ ] Automatisierte verschluesselte Off-site-Backups umsetzen.
- [ ] Restoretests und Backupaltermonitoring einrichten.
- [ ] Aktive Alarmzustellung und Bereitschaftsweg einrichten.
- [ ] Produktion und Staging in getrennte Ausfallbereiche ueberfuehren.
- [ ] Reproduzierbares Image und CI-Pipeline aufbauen.
- [ ] Infrastruktur und Konfiguration als Code verwalten.
- [ ] Keine Produktion mehr direkt aus veraenderlichen Git-Checkouts betreiben.

**Exit:** Nachgewiesene Wiederherstellbarkeit, Alarmierung und
artefaktbasierter Releaseprozess.

### Phase 2: Container- und Cell-Faehigkeit

- [ ] Anwendung vollstaendig konfigurierbar und containerfaehig machen.
- [ ] Persistente Daten aus App-Containern entfernen.
- [ ] Health, Readiness, Shutdown und Ressourcenlimits standardisieren.
- [ ] Tenantdefinitionen ohne Secrets erstellen.
- [ ] Tenant Registry und Secretreferenzen konzipieren.
- [ ] Domain-, Zertifikats- und Storage-Namespace-Provisionierung automatisieren.
- [ ] App- und Worker-Deployment pro Verein vorbereiten.

**Exit:** Neuer Verein kann reproduzierbar als isolierte Cell bereitgestellt
werden.

### Phase 3: Entwicklungs- und Releasechain

- [ ] Ephemere CI-Umgebungen mit synthetischen Daten erstellen.
- [ ] Integration-, QA- und Testuser-Tenants bereitstellen.
- [ ] Signierte OCI-Images, SBOM und Provenance einfuehren.
- [ ] Promotion desselben Image-Digests durch Release-Ringe umsetzen.
- [ ] Release Controller mit Wellen, Healthgates und Abbruchkriterien erstellen.
- [ ] Entitlements und Feature Flags getrennt implementieren.
- [ ] Produktiv-Pilot- und Beta-Onboardingprozess definieren.

**Exit:** Neue Funktionen koennen kontrolliert von Entwicklung bis Stable
promotet werden.

### Phase 4: Tenantkontext und Servicegrenzen

- [ ] TenantContext und RequestContext definieren.
- [ ] Host/Domain sicher zu Tenant aufloesen.
- [ ] Sessions und Principals an Tenant/Membership binden.
- [ ] Repository-, Cache-, Audit- und Idempotenzschnittstellen tenantpflichtig
      machen.
- [ ] WebSocketverbindungen und Topics tenantgebunden modellieren.
- [ ] Jobs und Outbox mit `tenant_id` einführen.
- [ ] Negative Cross-Tenant-Tests als CI-Pflicht etablieren.

**Exit:** Mandantentrennung ist im Code explizit und testbar, auch wenn weiter
zunaechst eine Cell nur einen Tenant ausfuehrt.

### Phase 5: Identitaet und PostgreSQL

- [ ] Users, Tenants, Memberships, Sections und People als neues Modell
      umsetzen.
- [ ] PostgreSQL-Cluster fuer Test und Produktion bereitstellen.
- [ ] Datenbank und DB-Rolle pro Tenant automatisiert anlegen.
- [ ] Sessions, Idempotenz und Jobs zuerst migrieren.
- [ ] Messaging, Audit, Scorelog und Geraetezustand migrieren.
- [ ] Fach- und Stammdaten tenantweise migrieren.
- [ ] Google Sheets auf kontrollierten Import/Export reduzieren.
- [ ] Tenantexport, Tenantrestore und Tenantumzug testen.

**Exit:** App-Container sind weitgehend zustandslos und einzelne Vereine sind
vollstaendig aus einer eigenen Datenbank wiederherstellbar.

### Phase 6: Skalierung und Hochverfuegbarkeit

- [ ] Mehrere App-Nodes und verteiltes Routing einrichten.
- [ ] Pub/Sub-Backplane fuer WebSockets einführen.
- [ ] Persistente Job-Worker mit Lease und Fairness betreiben.
- [ ] Leader-Mechanismus fuer singletonartige Poller und Jobs umsetzen.
- [ ] PostgreSQL-HA, PITR und regelmaessige Failovertests etablieren.
- [ ] Tenant Cells auf mehrere Failure Domains verteilen.
- [ ] Last-, Chaos- und Isolationstests wiederkehrend ausfuehren.

**Exit:** Der Verlust eines einzelnen App-Nodes unterbricht keinen Verein
dauerhaft.

### Phase 7: Sektionen und weitere Produktbereiche

- [ ] Fachliches Modell weiterer Sektionen abstimmen.
- [ ] Rollen- und Datenabgrenzung Verein/Sektion pruefen.
- [ ] Anlagen, Plaetze und Reservierungsregeln je Sektion ausbauen.
- [ ] Sektionuebergreifende Mitgliedschaft, Reporting und Abrechnung nur nach
      ausdruecklicher fachlicher Entscheidung implementieren.

**Exit:** Weitere Sektionen erweitern die Plattform ohne Bruch der
Vereinsisolation.

## 16. Zentrale Risiken und Verbote

Folgende Ansaetze sind fuer die Zielarchitektur nicht ausreichend oder zu
vermeiden:

- nur ein `tenantId`-Feld in Browserrequests hinzufuegen;
- mehrere Vereine in die heutigen globalen Caches, WebSockettopics oder
  SQLite-Dateien laden;
- Tenant aus einem nicht validierten URL-Parameter oder Hostheader ableiten;
- eine gemeinsame DB-Rolle mit Vollzugriff fuer alle App-Cells verwenden;
- Produktivdaten unkontrolliert nach Entwicklung oder Test kopieren;
- Produktion aus mutablem Git-Checkout betreiben;
- pro Kunde einen Softwarefork pflegen;
- Datenbankmigrationen als sofort reversible Containerrollbacks behandeln;
- Kundenadmins Zugriff auf zentrale Plattformgrafana-Daten geben;
- Tenant-ID unbeschraenkt als Metriklabel verwenden;
- Secrets, Passwoerter, Tokens oder freie Fachpayloads in Logs, Auditprojekte,
  Tickets oder Changelogs schreiben;
- Backups nur auf demselben Host speichern;
- eine individuelle Version dauerhaft ohne Sicherheits- und Supportgrenzen
  zulassen.

## 17. Vor kanonischer Umsetzung zu klaerende Fragen

1. Soll sich ein Benutzer mit einem globalen ePiber-Konto bei mehreren Vereinen
   anmelden koennen oder bleiben Logins anfangs vereinslokal?
2. Welche Rollen duerfen ausschliesslich auf Vereinsebene und welche spaeter auf
   Sektionsebene vergeben werden?
3. Welche Mindest- und Maximalkonfigurationen gelten je Tarif fuer Mitglieder,
   Plaetze, Geraete, Speicher und Integrationen?
4. Werden Kundendomains von Beginn an benoetigt oder nur Plattformsubdomains?
5. Welche RPO/RTO und Supportzeiten werden vertraglich zugesagt?
6. Welche Datenregionen und Subprozessoren sind zulassig?
7. Duerfen Beta-Vereine ein Release jederzeit verlassen, wenn eine irreversible
   Datenmigration bereits erfolgt ist?
8. Welche Funktionen muessen bei einer Vereins-Suspendierung weiterhin fuer
   Datenexport, Datenschutz und Rechnungsabwicklung erreichbar sein?
9. Welche fachlichen Reservierungsregeln gelten genau fuer Gaeste, Kontingente,
   Storno, Training, Turniere und Zahlungen?
10. Ab welcher Flottengroesse oder Verfuegbarkeitszusage wird ein Scheduler oder
    Managed Container Service dem automatisierten Docker-/Podman-Betrieb
    vorgezogen?

## 18. Vorgesehene spaetere kanonische Dokumentation

Vor einer konkreten Implementierung sind mindestens folgende kanonische
Dokumente vorzuschlagen, abzustimmen und zu pflegen:

| Zieldatei | Vorgesehener Inhalt |
|---|---|
| `Project/FACHKONZEPT.txt` | Produktvision fuer mehrere Vereine, Mandant, Sektionen, Reservierung und neue Benutzergruppen |
| `Project/software/MANDANTENARCHITEKTUR.txt` | Tenantmodell, Identity/Membership, Cell, Isolations- und Datenbankstrategie |
| `Project/software/ARCHITEKTUR.txt` | konkrete Modul-, Kontext-, Cache-, Job- und WebSocket-Architektur |
| `Project/software/DATENBANK.txt` | PostgreSQL-Schema, Tenant-/Section-Scope, Migration, Export und Retention |
| `Project/software/ENDPOINTS.txt` | Tenantauflosung, Sessions, Rollen und neue API-/WS-Vertraege |
| `Project/server-configs/PLATTFORM-UND-RELEASEARCHITEKTUR.md` | Infrastruktur, Container, Umgebungen, CI/CD, Release-Ringe und Provisionierung |
| `Project/server-configs/BACKUP-RESTORE-KONZEPT.md` | Tenantbackup, PITR, Einzeltenant-Restore und DR |
| `Project/server-configs/observability/README.md` | Plattform- und Tenantobservability, Berechtigungen und Alarmierung |

Die vorliegende Datei selbst ersetzt keine dieser verbindlichen Quellen.
