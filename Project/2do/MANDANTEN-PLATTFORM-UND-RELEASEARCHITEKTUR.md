# Mandantenplattform, Vereins-Cells und Releasearchitektur

Stand: 25.09.2026
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
Spreadsheet, eine Court-Quelle sowie vier lokale SQLite-Dateien. Die Migration
beginnt nicht mit einem optionalen `tenantId`-Feld in einzelnen Requests, sondern
mit einem transaktionalen PostgreSQL-Datenmodell fuer den bestehenden
Heimatverein und einer parallel aufgebauten, reproduzierbaren Plattformbasis.
Ein frei uebergebenes `tenantId`-Feld waere keine ausreichende
Mandantentrennung.

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
eigene Infrastruktur. Fuer die ersten drei bis vier Jahre wird mit etwa 20 bis
50 Mandanten geplant. Die erste Architektur- und Kapazitaetsgrenze liegt bei
hoechstens etwa 100 Mandanten; eine darueber hinausgehende Skalierung wird erst
nach nachhaltigem Wachstum geplant.

Ein typischer Verein besitzt etwa 70 bis 250 Mitglieder. Voraussichtlich haben
etwa 35 bis 125 Personen ein Benutzerkonto, von denen wiederum ungefaehr die
Haelfte regelmaessig aktiv ist. Die Kapazitaetsplanung richtet sich trotzdem
nicht nur nach Tenant- oder Mitgliederzahl, sondern nach gemessenen
gleichzeitigen Benutzern, WebSockets, Buchungsspitzen, Datenbankverbindungen,
Joblast, Retention und Restorezeiten.

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

### 1.5 Produkt- und Migrationsrahmen bis Mai 2027

Bis zum Saisonstart im Mai 2027 bleibt ASKÖ Piberbach der reale Test- und
Referenzverein. Fachliche Entwicklung dient in dieser Phase vorrangig der
Produktvalidierung im Heimatverein. Parallel entsteht auf einem weiteren
Hetzner-Cloud-Server die spaetere Plattformbasis.

Die PostgreSQL-Migration ist trotz dieses Featurefokus eine bewusst vorgezogene
Strukturmassnahme, weil die priorisierten Funktionen transaktionale Datenhaltung
benoetigen. Die Reihenfolge lautet:

1. Personen-, Mitgliedschafts-, Konto- und Rollenmodell festlegen;
2. PostgreSQL, Migrationen, Backup und Restore bereitstellen;
3. Personen, Authentifizierung und Sicherheitsstate migrieren;
4. Anlagen und Plaetze modellieren;
5. ein begrenztes Hallenreservierungs-MVP fuer ASKÖ Piberbach umsetzen;
6. Nutzung, Buchungsspitzen, Supportaufwand und Ressourcenbedarf im Winterbetrieb
   messen;
7. verbleibende Sheet- und SQLite-Domaenen kontrolliert migrieren und die
   Plattformprovisionierung bis zum Saisonstart stabilisieren.

Ein spielerisches Wett- oder virtuelles Waehrungssystem ist nur eine spaetere
Produktidee und derzeit weder priorisiert noch Bestandteil dieses Zeitplans.

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
waere bei bis zu etwa 100 Mandanten unverhaeltnismaessig teuer und schwer
wartbar.
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
| Betreiberidentitaet | Plattform |
| Benutzerkonto und Login | Verein/Tenant |
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
aufgeloest werden. In der ersten kommerziellen Ausbaustufe gibt es bewusst keine
globale Benutzeridentitaet fuer Vereinsmitglieder. Ein Mensch, der mehreren
Vereinen angehoert, besitzt je Verein ein getrenntes Konto. Derselbe kanonische
Login darf deshalb in verschiedenen Tenant-Datenbanken vorkommen, muss aber
innerhalb eines Vereins eindeutig sein.

```text
tenants
  Verein, Status, Vertrag und Grundkonfiguration

sections
  Tennis und spaetere Sektionen eines Vereins

people
  vereinsbezogene Stamm- und Kontaktdaten

memberships
  person_id
  Mitgliedsstatus, Klassifikation, Beginn und Ende

user_accounts
  person_id
  vereinslokaler Login, Credential und Sperrstatus

role_assignments
  person_id beziehungsweise user_account_id
  vereins- oder spaeter sektionsbezogene Berechtigung
```

Nicht jede Person oder jedes Mitglied benoetigt ein Benutzerkonto. Eine Person
kann historisch erhalten bleiben, obwohl ihre Mitgliedschaft beendet oder ihr
Login gesperrt ist. Mitgliederklassifikation und technische Berechtigung bleiben
getrennt. Kontakt-E-Mail und Login sind weiterhin verschiedene Angaben; eine
E-Mail-Adresse ist weder tenantuebergreifender Personenschluessel noch Beweis
derselben Person.

Eine spaetere freiwillige Verknuepfung vereinslokaler Konten bleibt technisch
moeglich, wird aber nicht vorweggenommen. Sie muesste als eigener, ausdruecklich
bestaetigter Plattformvertrag umgesetzt werden und duerfte Konten niemals allein
anhand gleicher E-Mail-Adressen zusammenfuehren.

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
- Jede Session ist an ein vereinslokales Benutzerkonto, dessen aktuelle Rollen
  und genau einen Tenant gebunden.
- Ein anderer Verein wird ueber dessen validierte Domain und ein separates Konto
  verwendet; es gibt zunaechst keinen globalen Vereinswechsel in einer Session.
- Repositorymethoden erhalten Tenant-Scope explizit, etwa
  `getMatch(tenantId, matchId)` statt `getMatch(matchId)`.
- `AsyncLocalStorage` darf Logging vereinfachen, aber keine expliziten
  Datenbank- und Repositoryparameter ersetzen.

## 5. Datenbankstrategie

### 5.1 Entscheidungsvorbereitung

Fuer die erwarteten 20 bis 50 und hoechstens etwa 100 Vereine werden drei
Varianten betrachtet.

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

Connection Pools muessen pro Cell klein und begrenzt sein. Ein zentraler
PgBouncer oder ein gleichwertiger Pooler verhindert, dass beispielsweise 50
App- und Worker-Cells mit jeweils mehreren ungenutzten Verbindungen die
PostgreSQL-Grenzen erschoepfen.

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

### 5.7 Migrationspfad fuer den bestehenden Heimatverein

ASKÖ Piberbach wird als erster realer Tenant auf das neue Datenmodell migriert.
Die Umstellung erfolgt domaenenweise, aber ohne dauerhaftes Dual-Write derselben
Fachdaten nach Google Sheets beziehungsweise SQLite und PostgreSQL:

1. asynchrone Repositoryvertraege und kontrollierte Transaktionsgrenzen
   einfuehren;
2. PostgreSQL-Schema, versionierte Migrationen, Connection Pooling, Readiness,
   Metriken, Backup und Restore bereitstellen;
3. Personen, Mitgliedschaften, vereinslokale Konten, Rollen, Sessions,
   Loginlimits und Sicherheitsstate gemeinsam migrieren;
4. Anlagen, Plaetze und das neue Reservierungsmodell ausschliesslich in
   PostgreSQL aufbauen;
5. Audit und Scorehistorie migrieren;
6. Messaging samt transaktionaler Outbox migrieren;
7. verbleibenden Anwendungsstate, Idempotenz und Jobs aufteilen und migrieren;
8. Bewerbe und Eintragungen migrieren;
9. Matches und Ranglisten wegen ihrer gemeinsamen Ergebnisfolgen zusammen
   migrieren;
10. Google Sheets danach nur noch als kontrollierten Import-/Exportweg verwenden.

Fuer jeden Domaenencutover sind ein geprueftes Backup, ein begrenztes
Schreibfenster, Anzahl- und Referenzvergleiche, eine PAJ-Abnahme, Auditabschluss
und ein dokumentierter Rueckfallplan erforderlich. Sheet-spezifische
Zeilenpositionen und Developer Metadata werden nicht zum dauerhaften
PostgreSQL-Datenmodell.

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

Das erste Hallenreservierungs-MVP fuer ASKÖ Piberbach soll bewusst auf den
nachgewiesenen Kern begrenzt werden:

- Anlagen, Hallenplaetze, Oeffnungszeiten und zeitlich begrenzte Platzsperren;
- freie Zeiten anzeigen;
- eigene Reservierung erstellen und stornieren;
- gleichzeitige Doppelbuchungen durch eine PostgreSQL-Constraint verhindern;
- Buchungsvorlauf, offene Buchungskontingente und Stornofrist serverseitig
  erzwingen;
- administrative Aenderungen nur berechtigt, begruendet und auditiert erlauben;
- mobile Bedienung und interne Benachrichtigung;
- strukturierte Abschlusslogs und Audit fuer Start, Erfolg, Ablehnung und
  unklaren Ausgang ohne freie Personen- oder Buchungspayloads.

Gaeste, Zahlungen, Wartelisten, No-show-Regeln, wiederkehrende Trainings und
weitere Prioritaetsmodelle werden erst nach einer fachlichen Entscheidung in den
MVP aufgenommen.

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
| Integration | gemeinsamer technischer Test | ausschliesslich synthetisch | intern geschuetzt |
| Testuser | manuelle Abnahme durch Versuchsbenutzer | synthetisch, keine Produktivkopie | kontrolliert erreichbar |
| Produktion | Vereine mit echten Daten | Produktivdaten | oeffentlich ueber HTTPS |

Produktion und Test muessen in getrennten Accounts, Projekten oder mindestens
getrennten Netz- und Ausfallbereichen liegen. Produktivdaten werden nicht in
lokale, CI- oder allgemeine Testumgebungen kopiert. Realistische Konstellationen
werden in der aktuellen Ausbaustufe durch synthetische Generatoren bereitgestellt.
Eine spaetere Verwendung nachweisbar anonymisierter Datensaetze bedarf einer
eigenen Datenschutz- und Freigabeentscheidung.

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

### 8.4 Bestaetigte aktuelle Auspraegungsstufe der Systemlandschaft

Fuer die erste Ausbaustufe wird die Systemlandschaft bewusst in vier
betriebliche Bereiche gegliedert. Diese Aufteilung ist der aktuelle Zielstand;
sie nimmt noch keine spaetere Einzelserver- oder Clusterstruktur vorweg:

```text
Entwicklerrechner
  -> lokale Entwicklung mit synthetischen Daten

Engineering-/Testserver
  -> Gitea
  -> Gitea Container Registry
  -> CI/CD-Steuerung und zunaechst isolierter CI-Runner
  -> Integrationstestumgebung
  -> QA- und Testuser-Tenants
  -> ausschliesslich synthetische Testdaten

Produktionsserver
  -> produktive Vereins-Cells
  -> produktive Worker
  -> Zugriff auf produktive Datenbanken

Unabhaengiges Backupziel
  -> verschluesselte, moeglichst unveraenderliche Off-site-Backups
```

Der Engineering-/Testserver ist kein manuell gepflegter Ersatz fuer lokale
Entwicklerrechner. Er stellt gemeinsame, reproduzierbare Engineeringdienste und
nichtproduktive Zielumgebungen bereit. Lokale Entwicklung, CI, Integration,
manuelle QA, Testuser und Produktion bleiben als unterschiedliche Stufen
erhalten, auch wenn CI, Integration und manuelle Testtenants anfangs denselben
physischen Server mit getrennten Diensten, Identitaeten und Ressourcenlimits
nutzen.

Der Engineering-/Testserver uebernimmt in dieser Stufe insbesondere:

- selbst gehostete Git-Repositories, Reviews und technische Dokumentation in
  Gitea;
- die OCI-kompatible Gitea Container Registry fuer versionierte
  Anwendungsimages;
- Gitea Actions oder eine gleichwertige CI/CD-Steuerung;
- Build, Tests, Scans, SBOM-Erzeugung und Vorbereitung der
  Artefaktsignatur durch einen eingeschraenkten Runner;
- Integration, manuelle QA und kontrollierte Tests durch Versuchsbenutzer;
- nichtproduktive PostgreSQL-Datenbanken mit synthetischen Seed-Daten;
- mindestens zwei synthetische Tenants fuer positive Ablauftests und negative
  Cross-Tenant-Isolationstests.

Produktion baut keine Software und startet keine Anwendung direkt aus einem
Git-Checkout. Sie bezieht ausschliesslich ausdruecklich freigegebene,
nachvollziehbare OCI-Images aus der Registry und referenziert Releases technisch
ueber den unveraenderlichen Image-Digest. Ein Ausfall von Gitea oder Registry
darf bereits laufende Produktions-Cells nicht beenden; er darf jedoch weitere
Builds, Deployments und einen unvorbereiteten Neuaufbau blockieren und wird
deshalb ueberwacht und in Backup und Restore einbezogen.

Fuer die Erststufe gelten folgende Trennungsregeln:

- keine Produktivdaten oder unkontrollierten Produktivkopien auf
  Entwicklerrechnern oder dem Engineering-/Testserver;
- keine produktiven Datenbank-, Tenant-, Session- oder Integrationscredentials
  in Gitea, Testtenants oder allgemeinen CI-Jobs;
- getrennte PostgreSQL-Instanzen beziehungsweise Cluster, DB-Rollen, Secrets,
  Domains und Netzwerkfreigaben fuer Test und Produktion;
- kein allgemeiner Root- oder Plattformadministratorzugang des CI-Runners zur
  Produktion;
- Produktionspromotion nur mit einer eng begrenzten Deploymentidentitaet und
  auditierten Freigaben;
- Signaturschluessel und andere hochprivilegierte Freigabecredentials nicht
  ungeschuetzt im allgemeinen Runner ablegen;
- Gitea, Registrymetadaten und benoetigte OCI-Artefakte duerfen nicht nur auf dem
  Engineering-/Testserver existieren, sondern werden unabhaengig gesichert;
- das Off-site-Backupziel liegt nicht im Ausfall- und Administrationsbereich des
  einzigen Engineering-/Test- oder Produktionsservers.

Der CI-Runner fuehrt veraenderlichen Code aus und ist daher eine eigene
Sicherheitszone. In der ersten Stufe darf er aus Kostengruenden auf dem
Engineering-/Testserver betrieben werden, jedoch nur mit eigener
Serviceidentitaet, isolierten Buildumgebungen, eingeschraenkten Credentials sowie
CPU-, RAM-, Prozess- und Speicherlimits. Buildumgebungen sollen kurzlebig und
reproduzierbar sein. Sobald Builds andere Testdienste messbar beeintraechtigen,
nicht vertrauenswuerdiger Code ausgefuehrt wird oder staerkere
Produktionsberechtigungen erforderlich waeren, wird der Runner auf eine eigene
VM oder einen eigenen Host verlagert.

### 8.5 Moegliche spaetere Auftrennung

Die aktuelle Vier-Bereiche-Struktur ist kein dauerhaftes Verbot weiterer
Trennung. Bei wachsender Flotte, Last, Verfuegbarkeitszusage oder
Betriebskomplexitaet kann daraus schrittweise folgende Struktur entstehen:

```text
Management/Engineering -> Gitea, Registry und CI-Steuerung
CI-Runner              -> Builds und automatisierte Tests
Testplattform          -> Integration, QA und Testuser
Produktions-App        -> Vereins-Cells und Worker
Produktions-DB         -> PostgreSQL und PgBouncer
Backup/DR              -> unabhaengiger Anbieter oder Account
```

Diese Darstellung ist ein moeglicher spaeterer Ausbau und noch keine
beschlossene unmittelbar folgende Auspraegungsstufe. Komponenten werden nicht
allein aufgrund einer abstrakten Zielarchitektur ausgelagert. Eine Auftrennung
wird insbesondere geprueft, wenn mindestens einer der folgenden Ausloeser
eintritt:

- CI-Builds oder Testlast beeintraechtigen Gitea, Registry oder manuelle QA;
- unterschiedliche Vertrauens- oder Berechtigungsniveaus verlangen eine eigene
  Runner-Isolation;
- produktive App- und Datenbanklast konkurrieren messbar um CPU, RAM, I/O oder
  Netzwerk;
- Backup-, Restore-, Wartungs- oder Deploymentarbeiten ueberschreiten die
  freigegebenen RPO-/RTO- oder Wartungsziele;
- die vereinbarte Verfuegbarkeit verlangt getrennte Ausfallbereiche;
- Flottengroesse, Supportaufwand oder Compliance machen unabhaengige
  Verantwortungs- und Zugriffszonen notwendig.

Auch nach einer spaeteren Auftrennung bleiben Images, Konfiguration und
Provisionierung reproduzierbar. Die zusaetzlichen Systeme duerfen keine
manuellen Sonderinstallationen oder kundenspezifischen Softwarestaende
erzwingen.

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
oder unvereinbare Zustaende erzeugen. Der regulaere ePiber-Rollback setzt deshalb
nicht die Datenbank zurueck. Stattdessen bleiben die aktuelle und die vorherige
unterstuetzte App-Version waehrend eines festgelegten Rollbackfensters mit
demselben erweiterten Datenbankschema kompatibel.

### 11.1 Expand/Contract-Verfahren

Migrationen folgen dem Expand/Contract-Muster:

1. Neue Tabellen, Spalten oder Indizes additiv einfuehren.
2. Alte und neue App-Version gleichzeitig kompatibel halten.
3. Daten per idempotentem Hintergrundjob backfillen.
4. Neue Lesepfade und Funktionen kontrolliert aktivieren.
5. Alte Felder erst nach erfolgreichem Flottenrollout und Ablauf des
   Kompatibilitaetsfensters entfernen.

Eine Umbenennung oder inkompatible Typaenderung erfolgt nicht unmittelbar.
Stattdessen wird die neue Struktur zunaechst parallel angelegt, bei Bedarf
voruebergehend doppelt beschrieben, kontrolliert befuellt und erst in einem
spaeteren Release autoritativ. Der alte Pfad wird erst entfernt, wenn keine
unterstuetzte App-Version ihn mehr benoetigt. Destruktive Contract-Migrationen
liegen deshalb mindestens ein Release hinter der erstmaligen Nutzung der neuen
Struktur.

### 11.2 App-/Schema-Kompatibilitaetsvertrag

Jedes Release besitzt neben Image-Digest, Git-Commit und SBOM einen
maschinenlesbaren Datenbankvertrag. Dieser enthaelt mindestens:

```text
application_release
image_digest
minimum_schema
preferred_schema
maximum_schema
required_migrations
compatible_rollback_releases
```

`minimum_schema` bezeichnet den aeltesten unterstuetzten Schemastand,
`maximum_schema` den neuesten sicher les- und beschreibbaren Stand und
`preferred_schema` den nach vollstaendiger Migration erwarteten Stand. Der
Release Controller prueft diesen Vertrag vor Migration und Deployment. Die App
prueft ihn beim Start erneut und verweigert Readiness, wenn ihre Tenant-Datenbank
ausserhalb des freigegebenen Bereichs liegt.

Die Tenant-Datenbank fuehrt nicht nur eine einzelne Versionsnummer, sondern ein
unveraenderliches Migrationsjournal, mindestens mit:

```text
migration_id
checksum
started_at
completed_at
status
application_release
error_code
```

Bereits erfolgreich ausgefuehrte Migrationen werden nicht nachtraeglich
veraendert. Neue Korrekturen erhalten eine neue Migrations-ID. Abweichende
Checksummen oder unbekannte Migrationsstaende sperren ein automatisches
Deployment und erfordern eine kontrollierte Klaerung.

### 11.3 Tenantweise Migrationsausfuehrung

Migrationen werden nicht unkontrolliert durch jedes startende App-Replikat
ausgefuehrt. Ein zentral orchestrierter, je Tenant exklusiv gesperrter
Migrationslauf verwendet einen eigenen Startmodus desselben signierten
OCI-Artefakts oder ein eindeutig demselben Release zugeordnetes Migrationsimage:

```text
epiber-image migrate
epiber-image app
epiber-image worker
```

Eine PostgreSQL-Advisory-Lock oder eine gleichwertige Lease verhindert parallele
Migrationslaeufe fuer dieselbe Tenant-Datenbank. Migrationen und Backfills sind
idempotent und wiederaufnehmbar; lange Datenumbauten laufen als kontrollierte
Hintergrundjobs und nicht als unbegrenzt blockierende Startmigration.

Der Ablauf je Tenant lautet:

1. Tenantstatus, App-Version und vollstaendiges Migrationsjournal ermitteln.
2. Zielrelease, Image-Digest und App-/Schema-Kompatibilitaet pruefen.
3. Bei riskanten Aenderungen erfolgreichen Backup- und PITR-Status verlangen.
4. Exklusive tenantbezogene Migrationssperre erwerben.
5. Ausstehende Expand-Migrationen in definierter Reihenfolge ausfuehren.
6. Checksummen, Referenzen, Constraints und fachliche Kontrollwerte pruefen.
7. Zielimage fuer genau diesen Tenant starten.
8. Readiness sowie technische und fachliche Smoke-Tests ausfuehren.
9. Beobachtungszeit und Healthgates des Release-Rings abwarten.
10. Erst danach den Tenant und die naechste Rolloutwelle freigeben.

Unterschiedliche Tenants duerfen waehrend eines Flottenrollouts voruebergehend
auf unterschiedlichen freigegebenen App- und Schemastaenden stehen. Der Release
Controller fuehrt deshalb je Tenant mindestens Zielrelease, Image-Digest,
aktuellen Schemastand, Migrationsstatus und letzten erfolgreichen
Wiederherstellungspunkt. Scheitert eine Migration, bleibt der betroffene Tenant
auf der bisherigen kompatiblen App-Version oder in einem kontrollierten
Wartungsstatus; weitere Rolloutwellen stoppen.

### 11.4 Rollback- und Recoveryfaelle

Der Rueckweg richtet sich nach der Fehlerart:

| Fehlerfall | Vorgehen |
|---|---|
| App-Fehler bei additiv kompatiblem Schema | Zielimage stoppen und vorheriges freigegebenes Image per Digest starten; erweitertes Schema unveraendert lassen |
| Abgebrochene oder teilweise Migration | Tenant kontrolliert sperren und idempotente Migration fortsetzen oder vorwaerts reparieren; kein blinder Down-Lauf |
| Fehlerhafte neue Fachdaten ohne strukturellen Schaden | Schreibpfad stoppen, Auswirkungen ueber Audit bestimmen und Daten kontrolliert korrigieren |
| Datenkorruption oder unaufloesbarer Migrationsschaden | Tenantbezogenes PITR beziehungsweise Restore mit bewusstem Wiederherstellungspunkt und passendem App-Image durchfuehren |
| Bereits ausgefuehrte destruktive Contract-Migration | Vorwaertsfix bevorzugen; Rueckkehr hinter die Kompatibilitaetsgrenze nur als koordinierter Restore von Datenbank und App |

Ein Datenbankrestore ist kein normaler Deploymentrollback. Er kann spaetere
produktive Writes verlieren und benoetigt deshalb Schreibstopp, festgelegten
Wiederherstellungspunkt, Integritaets- und Fachpruefungen, Auditabschluss sowie
gegebenenfalls Sitzungs-, Reset- und Geraeteinvalidierung. Erst danach wird das
zum restaurierten Schema passende, bekannte Image gestartet.

Automatische Down-Migrationen sind nicht der primaere Produktions-Rollbackweg.
Sie koennen entfernte oder bereits in neuer Semantik gespeicherte Daten nicht
zuverlaessig rekonstruieren. Sie duerfen nur fuer nachweislich verlustfreie,
einzeln freigegebene Faelle verwendet werden. Der Normalfall bleibt:

```text
vorwaertskompatible Expand-Migration
  -> kontrolliertes App-Deployment
  -> bei Bedarf App-Rollback ohne DB-Rollback
  -> Contract erst nach Ablauf des Kompatibilitaetsfensters
```

### 11.5 Verbindliche Anforderungen fuer ePiber

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
- Die aktuelle und die vorherige Stable-Version bleiben waehrend des
  Rollbackfensters mit dem erweiterten Schema kompatibel.
- Ein App-Rollback veraendert das Datenbankschema im Normalfall nicht.
- Contract-Migrationen benoetigen eine ausdrueckliche Kompatibilitaets- und
  Restorefreigabe.
- CI prueft leere Neuinstallation, Upgrade von jedem unterstuetzten Ausgangsstand,
  wiederholte idempotente Ausfuehrung, Abbruch und Wiederaufnahme sowie den
  App-Rollback auf dem erweiterten Schema.
- Audit und strukturierte Abschlusslogs enthalten nur kontrollierte Kennungen,
  Versionen, Phasen, Ergebnisse und Fehlercodes, jedoch keine freien Fachdaten,
  Secrets oder unnoetigen Personendaten.

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

Die erste Plattform laeuft auf Arch Linux, weil dafuer ein eigener betrieblicher
Grundstandard vorgesehen ist. Das Rolling-Release-Modell verlangt einen
geschuetzten Test- und Promotionweg; Datenbank- und Anwendungs-Hauptversionen
werden unabhaengig vom Hostbetriebssystem fest gepinnt und kontrolliert
aktualisiert.

Fuer eine kleine erste Flotte wird folgender bewusst schlanker Referenzstack
vorlaeufig empfohlen; die Einzelwerkzeuge sind vor ihrer Umsetzung noch
praktisch zu bewerten:

- OpenTofu fuer Cloud-Ressourcen, Netzwerk, Firewall und DNS;
- Cloud-init nur fuer den reproduzierbaren Bootstrap;
- Ansible fuer Hostkonfiguration und Betriebsdienste;
- OCI-Images sowie selbst gehostetes Gitea fuer Git, Reviews und
  CI/CD-Steuerung mit dessen OCI-kompatibler Container Registry; die Registry
  liegt ausserhalb des produktiven App-Laufzeitbereichs, muss aber nicht von
  einem fremden SaaS-Anbieter betrieben werden;
- Podman mit systemd-Quadlets fuer Cells und zentrale Dienste;
- Caddy fuer Edge, TLS und validiertes Domainrouting;
- PostgreSQL mit PgBouncer;
- SOPS/age und kontrollierte systemd-/Podman-Credentials fuer Secrets;
- pgBackRest oder WAL-G fuer PostgreSQL-PITR sowie Restic fuer geeignete
  Datei- und Konfigurationssicherungen;
- die bestehende Prometheus-, Loki-, Alloy- und Grafana-Ausrichtung fuer
  Observability.

Ein Provider- oder Golden Image darf den Neuaufbau beschleunigen, ist aber nicht
die alleinige Quelle der Wahrheit. Ein nacktes vertrauenswuerdiges Arch-Image
muss durch OpenTofu, Cloud-init, Ansible, OCI-Artefakte, getrennte Secrets und
gepruefte Datenbackups wiederherstellbar sein.

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

### 13.1.1 Vorlaeufige Kapazitaetsstufen

Die Werte sind Startpunkte und werden durch Messung und Lasttests ersetzt:

| Stufe | Rechenleistung | RAM | Primaerspeicher | Betriebsform |
|---|---:|---:|---:|---|
| ASKÖ als erster Produktivtenant | 4 vCPU | 8 GB, bevorzugt 16 GB | 160 bis 250 GB NVMe | ein Produktionshost; Testtenants getrennt auf Engineering/Test |
| etwa 10 Tenants | 4 bis 8 vCPU | 16 GB | 160 bis 250 GB NVMe | ein Plattformhost mit externen Backups |
| etwa 50 Tenants, zusammen | 12 bis 16 vCPU | 32 GB | 300 bis 500 GB NVMe | technisch moeglich, Trennung empfohlen |
| etwa 50 Tenants, getrennt | App 8 vCPU; DB 4 bis 8 vCPU | App 16 bis 32 GB; DB 16 bis 32 GB | DB 250 bis 500 GB | App-/Edge- und PostgreSQL-Host getrennt |

Vor einer Erweiterung werden mindestens RAM- und Swapdruck, CPU-P95,
Datenbanklatenz, Poolauslastung, WebSocketzahl, Jobrueckstand, Speicherfuellstand,
Backupdauer und praktisch gemessene Restorezeit bewertet. Vor zehn, 50 und 100
Tenants sind synthetische Last- und Isolationstests mit realistischen
Reservierungsspitzen erforderlich.

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

Die erste kommerzielle Stufe verlangt keine aktive Hochverfuegbarkeit. Das
vorlaeufige Betriebsmodell ist Rebuild-and-Restore: Ein ausgefallener oder nicht
mehr vertrauenswuerdiger Host wird durch einen sauberen neuen Server ersetzt,
deklarativ aufgebaut und aus geprueften Backups wiederhergestellt. Ein dauerhaft
laufender redundanter Ersatzserver ist dafuer zunaechst nicht erforderlich.

RPO bezeichnet den maximal akzeptierten Datenverlust seit dem letzten nutzbaren
Wiederherstellungspunkt. RTO bezeichnet die maximal akzeptierte Zeit bis zum
wiederhergestellten vereinbarten Betriebsumfang. Als noch freizugebende
Planungswerte gelten:

| Szenario | RPO | RTO |
|---|---:|---:|
| einzelne Tenant-Datenbank | 15 Minuten | 2 bis 4 Stunden |
| vollstaendiger Produktionshost | 15 bis 60 Minuten | 4 bis 8 Stunden |
| vollstaendiger Standortausfall | 1 bis 4 Stunden | 8 bis 24 Stunden |
| Anbieter- oder Accountverlust | bis 24 Stunden | 24 bis 48 Stunden |

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
- klare Trennung von Backup-, Prune- und Restoreberechtigungen;
- gesicherte und praktisch getestete Wiederherstellung von Gitea-Repositories,
  Registrymetadaten, benoetigten OCI-Artefakten und CI/CD-Konfiguration.

Das DR-Runbook beginnt regelmaessig testweise mit einem nackten Providerimage.
Es provisioniert Host, Netzwerk und Rechte, laedt bekannte OCI-Artefakte, stellt
Secrets kontrolliert bereit beziehungsweise rotiert sie, restauriert PostgreSQL,
prueft alle Tenant-Datenbanken und schaltet DNS oder Routing erst nach
Integritaets-, Health- und Fachpruefungen um. Die reine VM-Bereitstellungszeit ist
nicht mit dem erreichten RTO gleichzusetzen.

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

Die Phasen beschreiben fachliche und technische Abhaengigkeiten, aber keine rein
serielle Projektorganisation. Insbesondere laeuft Phase 3 ab Beginn parallel zu
den ASKÖ-bezogenen Phasen 1 und 2, ohne deren laufenden Produktivbetrieb zu
gefaehrden.

### Phase 0: Entscheidungen und Messbasis

- [x] Mandant als Tennisverein und Tennis als einzige aktive Erstsektion fuer die
      erste kommerzielle Stufe festlegen.
- [x] Vereinslokale Benutzerkonten ohne globale Mitgliederidentitaet als
      Erstmodell festlegen.
- [x] ASKÖ Piberbach bis Mai 2027 als realen Referenz- und Testverein festlegen.
- [x] Etwa 20 bis 50 Mandanten in drei bis vier Jahren und hoechstens etwa 100
      Mandanten als erste Kapazitaetsgrenze festlegen.
- [x] Entwicklerrechner, Engineering-/Testserver, Produktionsserver und
      unabhaengiges Off-site-Backup als aktuelle Auspraegungsstufe festlegen;
      spaetere weitere Trennung bleibt bedarfsabhaengig.
- [ ] Rollen, Reservierungsregeln, RPO/RTO, Retention, Datenregionen und
      Verantwortlichkeiten verbindlich freigeben.
- [ ] Istwerte fuer Prozessspeicher, Benutzer, WebSockets, Datenmengen,
      Buchungsspitzen, Support und Restorezeiten erfassen.

**Exit:** Fachmodell fuer Personen und Hallenreservierung sowie messbare
Betriebsziele sind freigegeben.

### Phase 1: PostgreSQL- und Personenbasis fuer ASKÖ

- [ ] Personen, Mitgliedschaften, vereinslokale Konten und Rollen modellieren.
- [ ] PostgreSQL fuer Entwicklung, Test und spaetere Produktion bereitstellen.
- [ ] Versionierte Migrationen, PgBouncer, Readiness, Metriken und Auditvertrag
      einrichten.
- [ ] PostgreSQL-PITR, logischen Tenantexport und Restoretest aufbauen.
- [ ] Asynchrone Repository- und Transaktionsvertraege einfuehren.
- [ ] Personen, Authentifizierung, Sessions und Sicherheitsstate kontrolliert
      migrieren.
- [ ] Google Sheets fuer diese Domaene nach dem Cutover auf kontrollierten Import
      beziehungsweise Export begrenzen.

**Exit:** ASKÖ-Personen, Mitgliedschaften, Konten und Rollen sind in PostgreSQL
autoritative, transaktionale Daten.

### Phase 2: Hallenreservierungs-MVP

- [ ] Anlagen, Plaetze, Oeffnungszeiten und Sperren modellieren.
- [ ] Buchungsraster, Vorlauf, Kontingente und Stornofristen fachlich festlegen.
- [ ] Konfliktfreie Reservierung mit Datenbankconstraint umsetzen.
- [ ] Eigene Stornierung und kontrollierte Adminaenderung umsetzen.
- [ ] Interne Meldungen, Audit, Abschlusslogs und Datenschutzpfade integrieren.
- [ ] Mobile Bedienung sowie Konkurrenz-, Berechtigungs- und Regressionstests
      umsetzen.
- [ ] Winterbetrieb im Heimatverein beobachten und Kennzahlen auswerten.

**Exit:** ASKÖ kann Hallenplaetze produktiv reservieren; Doppelbuchung,
Berechtigung, Audit, Backup und Restore sind praktisch abgenommen.

### Phase 3: Parallele Plattformbasis

- [ ] Hetzner-Cloud-Ressourcen mit OpenTofu definieren.
- [ ] Arch-Linux-Basis mit Cloud-init und Ansible reproduzierbar aufbauen.
- [ ] OCI-Registry, Podman-Quadlets, Caddy und Secretbereitstellung einrichten.
- [ ] Engineering-/Testserver mit Gitea, Container Registry, eingeschraenktem
      CI-Runner und getrennten nichtproduktiven PostgreSQL-Datenbanken aufbauen.
- [ ] Integration, QA und Testuser als getrennte nichtproduktive Stufen mit
      ausschliesslich synthetischen Daten bereitstellen.
- [ ] Automatisierte verschluesselte Off-site-Backups, Backupaltermonitoring und
      aktive Alarmzustellung umsetzen.
- [ ] Gitea-, Registry- und CI/CD-Restore aus dem unabhaengigen Backup praktisch
      testen.
- [ ] Rebuild-and-Restore ab nacktem Image innerhalb des Ziel-RTO testen.
- [ ] Deklarative Tenantdefinitionen und Provisionierung ohne Secrets erstellen.
- [ ] Einen synthetischen zweiten Tenant samt eigener DB und DB-Rolle
      bereitstellen.

**Exit:** Ein sauberer Ersatzhost und ein neuer Testverein sind ohne manuelle
Spezialkonfiguration reproduzierbar herstellbar.

### Phase 4: Verbleibende Datenmigration und Cell-Faehigkeit

- [ ] Audit, Scorelog, Messaging, Jobs und Outbox migrieren.
- [ ] Bewerbe und Eintragungen migrieren.
- [ ] Matches und Ranglisten gemeinsam migrieren.
- [ ] Anwendung vollstaendig konfigurierbar und containerfaehig machen.
- [ ] Persistente Daten aus App-Containern entfernen.
- [ ] Health, Readiness, Shutdown und Ressourcenlimits standardisieren.
- [ ] TenantContext, Domainaufloesung, WebSockettopics, Caches und Jobs
      tenantpflichtig machen.
- [ ] Negative Cross-Tenant-Tests als CI-Pflicht etablieren.

**Exit:** ASKÖ laeuft als erste isolierte Vereins-Cell; eine zweite synthetische
Cell kann keine ASKÖ-Daten lesen oder veraendern.

### Phase 5: Entwicklungs- und Releasechain bis Pilot

- [ ] Ephemere CI-Umgebungen mit synthetischen Daten erstellen.
- [ ] Signierte OCI-Images, SBOM und Provenance einfuehren.
- [ ] Dasselbe Image unveraendert durch Integration, Testuser und Pilot
      promoten.
- [ ] Healthgates, Abbruchkriterien und kompatible Expand/Contract-Migrationen
      umsetzen.
- [ ] Tenantexport, Tenantrestore und Tenantumzug testen.
- [ ] Produktiv-Pilot- und Beta-Onboardingprozess definieren.

**Exit:** Der erste externe Pilotverein kann kontrolliert provisioniert,
aktualisiert, exportiert und wiederhergestellt werden.

### Phase 6: Skalierung und optionale Hochverfuegbarkeit

- [ ] Mehrere App-Nodes und verteiltes Routing einrichten.
- [ ] Pub/Sub-Backplane fuer WebSockets einführen.
- [ ] Persistente Job-Worker mit Lease und Fairness betreiben.
- [ ] Leader-Mechanismus fuer singletonartige Poller und Jobs umsetzen.
- [ ] PostgreSQL-HA und regelmaessige Failovertests bei wirtschaftlich oder
      vertraglich begruendetem Bedarf etablieren; PITR besteht bereits vorher.
- [ ] Tenant Cells auf mehrere Failure Domains verteilen.
- [ ] Last-, Chaos- und Isolationstests wiederkehrend ausfuehren.

**Exit:** Der Verlust eines einzelnen App-Nodes unterbricht keinen Verein
dauerhaft. Diese Phase ist fuer die erste Rebuild-and-Restore-Stufe keine
Voraussetzung.

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
- ein Providerimage als einzige Wiederherstellungsquelle behandeln;
- Arch-Linux-, PostgreSQL- oder Containerupdates ohne vorherige
  Integrationspruefung direkt in Produktion uebernehmen;
- eine individuelle Version dauerhaft ohne Sicherheits- und Supportgrenzen
  zulassen.

## 17. Vor kanonischer Umsetzung zu klaerende Fragen

1. Welche Rollen duerfen ausschliesslich auf Vereinsebene und welche spaeter auf
   Sektionsebene vergeben werden?
2. Welche Mindest- und Maximalkonfigurationen gelten je Tarif fuer Mitglieder,
   Plaetze, Geraete, Speicher und Integrationen?
3. Werden Kundendomains von Beginn an benoetigt oder nur Plattformsubdomains?
4. Welche der vorlaeufigen RPO/RTO-Werte und welche Supportzeiten werden
   vertraglich zugesagt?
5. Welche Datenregionen, Off-site-Backupanbieter und Subprozessoren sind
   zulassig?
6. Duerfen Beta-Vereine ein Release jederzeit verlassen, wenn eine irreversible
   Datenmigration bereits erfolgt ist?
7. Welche Funktionen muessen bei einer Vereins-Suspendierung weiterhin fuer
   Datenexport, Datenschutz und Rechnungsabwicklung erreichbar sein?
8. Wie viele ASKÖ-Hallenplaetze, welche Buchungsdauer, welcher Vorlauf, welche
   offenen Kontingente und welche Stornofrist gelten im ersten MVP?
9. Sind Mitspieler Pflicht, sind Gaeste erlaubt und welche Regeln gelten fuer
   Training, Turniere, wiederkehrende Sperren und spaetere Zahlungen?
10. Ab welcher gemessenen Last, Flottengroesse oder Verfuegbarkeitszusage wird
    PostgreSQL auf einen eigenen Host verschoben?
11. Ab welcher Flottengroesse oder Verfuegbarkeitszusage wird ein Scheduler oder
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
