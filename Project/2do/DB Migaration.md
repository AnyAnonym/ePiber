# PostgreSQL-Datenbankmigration

Stand: 25.09.2026
Status: Nicht-kanonische fachliche und technische Arbeitsgrundlage; noch nicht
implementiert, freigegeben oder als verbindliche Sollarchitektur dokumentiert
Gegenstand: Vollstaendige Abloesung von Google Sheets, vier SQLite-Datenbanken
und persistenzrelevantem Prozessstate durch PostgreSQL

Diese Datei konserviert die fuer den ersten Migrationsschritt getroffenen
Entscheidungen, das vorgesehene Zieldatenmodell, den Datenuebernahmeweg sowie die
bewusst spaeteren Ausbaustufen. Sie ist kein bereits umgesetzter Datenvertrag.
Verbindliche Tabellen, Constraints, Betriebsablaeufe und kanonische
Dokumentationsaenderungen werden erst im jeweiligen freigegebenen
Umsetzungsauftrag festgelegt.


## 1. Verbindliche Grundentscheidungen

### 1.1 Einziges System of Record

PostgreSQL wird das einzige aktive Persistenzsystem von ePiber.

- SQLite wird nicht als Zielsystem fortgefuehrt.
- Google Sheets wird nach dem bestaetigten Cutover weder gelesen noch
  beschrieben.
- Es gibt kein dauerhaftes Dual-Write zwischen PostgreSQL und einer
  Legacyquelle.
- Es gibt keine Ruecksynchronisation von PostgreSQL nach Google Sheets.
- Das finale Spreadsheet und die vier SQLite-Dateien bleiben ausschliesslich als
  verschluesseltes historisches Quellarchiv erhalten.
- Der betriebliche Wiederherstellungsweg verwendet nach dem Cutover
  PostgreSQL-Backups und Point-in-Time Recovery, nicht das Spreadsheet.

### 1.2 Migration vor neuen Fachfunktionen

Der erste PostgreSQL-Auftrag stellt den heutigen Funktionsumfang mit
Persistenzparitaet um. Neue Personenverwaltungs-, Finanz- oder
Plattformfunktionen werden nicht gleichzeitig eingefuehrt.

Die Reihenfolge lautet:

1. PostgreSQL-Zielmodell und Migrationswerkzeuge festlegen.
2. Den vollstaendigen heutigen Persistenzumfang nach `epiber_devel` uebernehmen.
3. Bestehendes Verhalten als PostgreSQL-only-Anwendung in Devel stabilisieren
   und alle Freigabegates erfuellen.
4. Ohne dazwischengeschobene Featureentwicklung den finalen Live-Cutover nach
   `epiber_askoe` vorbereiten, freigeben und durchfuehren.
5. Erst nach stabiler Live-Migration neue Personenverwaltung,
   Vereinsverrechnung und Tenantautomatisierung in
   getrennten Fachauftraegen darauf aufbauen.

Es gibt keine kalendarische Mindestdauer und keinen Zwangstermin fuer den
Cutover. Massgeblich sind ausschliesslich die vollstaendige Devel-Abnahme,
Backup-/Restore-, Import-, Paritaets- und Betriebsnachweise sowie die
ausdrueckliche Live-Freigabe. Ein Zieldatum darf kein fehlendes Gate ersetzen.

### 1.3 ASKÖ als erster dauerhafter Tenant

ASKÖ Piberbach wird nicht in eine temporaere Uebergangsdatenbank migriert. Die
produktive Datenbank `epiber_askoe` bleibt langfristig dessen Tenant-Datenbank.

Das Modell wird bereits strukturell tenant- und sektionsfaehig aufgebaut:

```text
Tenant ASKÖ Piberbach
  -> Sektion Tennis
       -> Personen und Mitgliedschaften
       -> Bewerbe, Matches und Ranglisten
       -> Anlagen, Plaetze, Hallenzeiten und Scores
       -> Messaging, Audit und Betrieb
```

Weitere Vereine erhalten spaeter eigene Datenbanken mit demselben Schema und
eigenen minimal berechtigten Rollen. Weitere Sektionen werden strukturell
ermoeglicht, aber fachlich noch nicht implementiert.

### 1.4 Devel-first-Migrationsstrategie

`epiber_devel` ist das erste vollstaendig aufgebaute PostgreSQL-Zielsystem. Es
verwendet bereits dasselbe endgueltige Tenant-Schema und dieselben
unveraenderlichen Schemamigrationen wie die spaetere produktive Datenbank
`epiber_askoe`; eine temporaere Devel-Sonderstruktur ist ausgeschlossen.

Die Umsetzung erfolgt intern in pruefbaren Domaenenschritten. Der Devel-Betrieb
wird jedoch erst als PostgreSQL-only-Anwendung freigegeben und enthaelt dann
keinen aktiven Google-Sheets- oder SQLite-Laufzeitpfad mehr. Live bleibt bis zur
vollstaendigen Devel-Abnahme unveraendert auf dem bisherigen freigegebenen
Legacyrelease. Es gibt keinen produktiven domaenenweisen Mischbetrieb und kein
Dual-Write zwischen PostgreSQL und den Legacyquellen.

`epiber_devel` wird weder zur Live-Datenbank umbenannt noch als produktiver
Datenbestand uebernommen. Fuer den spaeteren Live-Cutover wird `epiber_askoe`
frisch mit denselben Schemamigrationen aufgebaut und aus einem finalen,
konsistenten Live-Export befuellt. Devel und Live unterscheiden sich damit nur
bei Daten, Rollen, Credentials, Integrationen und Umgebungskonfiguration, nicht
beim fachlichen Datenbankschema.

Der Live-Cutover beginnt erst, nachdem insbesondere folgende Nachweise fuer
Devel wiederholbar erfolgreich sind:

- Neuaufbau einer leeren Datenbank durch alle Schemamigrationen;
- vollstaendiger Import und technische sowie fachliche Validierung;
- Funktionsparitaet der bestehenden Anwendung auf PostgreSQL;
- Backup, Point-in-Time Recovery und praktischer Restore;
- Restart-, Shutdown-, Last- und Fehlerpfade ohne Legacy-Persistenz;
- erneuter Neuaufbau aus den versionierten Migrationen und Importwerkzeugen.

Mit dem PostgreSQL-only-Cutover wird die bereitgestellte Testumgebung
betrieblich vollstaendig von PAJ auf Devel umbenannt. Dazu gehoeren insbesondere
`epiber-devel.service`, `epiber-devel-worker.service`, StateDirectory,
Caddy-/Access-Log-Bezeichner, `INSTANCE_ID=devel`, Prometheus-/Loki-
Deploymentlabel, Grafana-Auswahl, Auth-Realm und die zugehoerigen Runbooks. Die
oeffentliche Test-Origin bleibt `https://epiber.at:8081`.

Der technische Unix-Benutzer `paj`, der Checkoutpfad `/srv/http/ePiber/paj`, der
laufende Git-Seitenbranch und seine `-paj-`-Versionierung bleiben bestehen und
sind nicht Bestandteil des Betriebsrenames. Historische Observability-Daten mit
Label `paj` bleiben als Vorgaenger der neuen `devel`-Serie abfragbar. Importierte
Score-, Audit- und Operationsprovenienz behaelt `source_instance=paj`; neue
PostgreSQL-Ereignisse verwenden `devel`.

Die Konfigurations- und Unit-Umbenennung wird erst gemeinsam mit der
PostgreSQL-Devel-Bereitstellung aktiviert. Bis dahin bleibt der laufende
Legacy-Testbetrieb korrekt als PAJ benannt; es gibt keinen gemischten
Zwischenbetrieb mit teilweise neuen Labels.

App und erster Worker bleiben fuer `epiber_devel` und den ersten Live-Cutover
getrennte gehaertete systemd-Dienste auf dem bestehenden Host. Die gleichzeitige
Umstellung auf OCI-/Podman-Cells ist nicht Bestandteil der Persistenzmigration
und folgt erst nach stabiler Live-Migration als eigener Plattformauftrag.


## 2. Ausgangslage

### 2.1 Aktive Google-Sheets-Daten

Google Sheets ist derzeit die autoritative Quelle fuer acht geladene Tabellen:

1. `Personen`
2. `Bewerb`
3. `Bewerbsart`
4. `Matchtyp`
5. `Matches1`
6. `RL-Platzierung`
7. `Navigator`
8. `EntryList`

Die historischen Tabs `Logging` und `ScoreLog` werden vom aktuellen Backend
nicht mehr aktiv gelesen oder beschrieben. Sie bleiben fuer die Migration
trotzdem Teil des vollstaendigen Spreadsheet-Archivs.

### 2.2 Aktive SQLite-Datenbanken

Der aktuelle Stand verwendet vier getrennte Datenbanken:

| Datei | Inhalt und Autoritaet |
|---|---|
| `state.sqlite` | Sessions, Monitore, Idempotenz, Loginlimits, Court-/Monitor-State, Favoriten, Startseite, Frontend-Logging-Konfiguration, Recovery-State und Hallenzeiten |
| `messaging.sqlite` | Bewerbsereignisse, persoenliche Meldungen, Quittierungen, Zustellungen, Kommentare und Reaktionen |
| `scorelog.sqlite` | dauerhafte Court-Scorehistorie und Court-Sequenzen |
| `audit.sqlite` | Audit-Lifecycle `started -> success|failed|unknown` |

### 2.3 Persistenzrelevanter Prozessspeicher

Zusaetzlich bestehen:

- Last-good-Caches fuer Sheetdaten;
- volatile aktuelle Live-Scores;
- Poller- und Recoveryzustand;
- laufende Queue- und Verbindungszustaende.

Last-good-Caches werden nicht als Fachdaten migriert. Aktuelle Live-Scores werden
dagegen im Zielmodell gemeinsam mit Baseline, Epoch und Revision dauerhaft
persistiert.

### 2.4 Zentrale Schwachstellen des Iststands

- Zwischen Sheets und SQLite existiert keine gemeinsame Transaktion.
- Fachlich zusammengehoerige Writes ueberschreiten mehrere Persistenzgrenzen.
- Google Sheets bietet kein transaktionales Compare-and-set fuer die benoetigten
  Zeilen- und Gesamtbestandspruefungen.
- Developer Metadata, Fingerprints, Operation-IDs, Bestaetigungsreads und
  Recovery-Plaene kompensieren fehlende Datenbanktransaktionen.
- Personenzeilen vermischen Stammdaten, Kontakt, Mitgliedschaft, Login,
  Credential und Rollen.
- `app_state` vermischt mehrere Domaenen in generischen JSON-Dokumenten.
- `hall-times:v1` ist ein vollstaendiges relationales Fachmodell in einem
  einzigen gemeinsam revisionierten JSON-Wert.
- Personen- und andere Referenzen sind vielfach untypisierte Strings.
- Sonderwerte wie `PRE`, `BYE`, `[wo]` und `[ret]` vermischen Referenz und
  Fachstatus.
- Zeitwerte verwenden parallel Unix-Millisekunden, ISO-Strings,
  `YYMMDD-HHMM`, `TT.MM.JJJJ` und implizite Wiener Lokalzeit.
- Audit-, Score- und Messagingdaten besitzen noch keine durchgaengige
  fachliche Retention.


## 3. PostgreSQL-Umgebungen

PostgreSQL-Datenverzeichnisse, temporaeres Migrations-Staging, physische und
logische Backups sowie sonstiger persistenter Migrations- und Object Storage
liegen ausschliesslich in ausdruecklich freigegebenen EU-/EWR-Regionen. Eine
Drittlandregion ist fuer diese Datenklassen nicht zulaessig. Die Regel erteilt
keine automatische Freigabe fuer spaetere externe Mail-, Speech-, LLM- oder
sonstige Integrationsanbieter; diese benoetigen jeweils eine eigene
Datenschutz- und Regionspruefung.

### 3.1 Erste Betriebsstufe

Die erste Betriebsstufe wird bewusst in zwei Kapazitaetsschritten aufgebaut.
Zunaechst entsteht auf dem bestehenden Host ausschliesslich die getrennte
PostgreSQL-Development-Instanz:

```text
PostgreSQL-Development-Instanz
  -> Datenbank epiber_devel
```

Der Livebetrieb bleibt waehrenddessen mit seinem bisherigen Legacyrelease und
seinen bisherigen Persistenzquellen unveraendert. Vor dem Aufbau der spaeteren
PostgreSQL-Live-Instanz ist ein verpflichtendes Kapazitaets- und Isolationsgate
vorgesehen. Zu diesem Zeitpunkt wird anhand gemessener Last entschieden:

1. bestehender Host mit mindestens 8 GiB RAM, bevorzugt 16 GiB, fuer zwei
   getrennte PostgreSQL-Instanzen erweitern; oder
2. `epiber_devel` auf den Engineering-/Testserver verlagern und
   `epiber_askoe` auf dem Produktionshost aufbauen.

Am 25.09.2026 besitzt der bestehende Host drei CPU-Kerne, 3,7 GiB RAM, bereits
genutzten Swap und rund 34 GiB freien Primaerspeicher. Dieser Stand ist fuer die
erste sparsam konfigurierte Development-Instanz ausreichend, aber nicht fuer den
dauerhaften Parallelbetrieb zweier PostgreSQL-Instanzen samt Anwendungen und
Observability freigegeben. CPU, RAM, Swap, I/O, freier Speicher, Importspitzen,
Backup- und Restorelast werden vor der Gateentscheidung erneut gemessen.

Werden Development und Live spaeter auf demselben Host betrieben, erhalten die
beiden Instanzen trotzdem getrennte:

- Unix-Socket-Verzeichnisse ohne allgemeinen TCP-Listener;
- Datenverzeichnisse;
- WAL-Verzeichnisse und WAL-Archive;
- systemd-Units;
- PostgreSQL-Rollen und Credentials;
- Ressourcenlimits;
- Backupsaetze;
- Readiness- und Monitoringzustaende.

Die PostgreSQL-Prozesse laufen zusaetzlich unter getrennten nicht anmeldbaren
Unix-Systembenutzern `postgres-devel` und spaeter `postgres-live`. Sie teilen nur
die root-owned read-only PostgreSQL-Binaerdateien, aber keine Gruppenrechte auf
Daten-, WAL-, Temp-, Runtime- oder Socketverzeichnisse. Ein Prozess der einen
Instanz kann das Datenverzeichnis der anderen nicht lesen.

App- und Workerzugriff erfolgt ueber gezielte Socketgruppen und weiterhin
getrennte SCRAM-Datenbankrollen. pgBackRest wird je Stanza mit den minimal
erforderlichen Dateisystem- und Datenbankrechten ausgefuehrt. Die eigenen
Systembenutzer bedingen getrennte systemd-Units; die Arch-Standardunit wird nicht
fuer beide Cluster gemeinsam verwendet.

Sie teilen dann nur den physischen Host, aber nicht denselben PostgreSQL-Prozess,
dasselbe Datenverzeichnis oder dieselbe Backupidentitaet. Der Kapazitaetsausbau
ersetzt keine getrennten Rollen, Credentials, Ressourcenlimits und
Wiederherstellungswege.

In der ersten Stufe lauschen beide PostgreSQL-Instanzen ausschliesslich auf ihren
getrennten, dateirechtlich geschuetzten Unix-Sockets. App, Worker, Migration
Runner, Backup und lokale Administration erhalten nur den jeweils erforderlichen
Socketzugriff. Persoenliche Administration erfolgt per SSH auf den Host und von
dort lokal; ein PostgreSQL-TCP-Port wird weder auf Loopback noch extern
freigegeben. Bei einer spaeteren Trennung von App- und Datenbankhost wird der
private TLS-/Netzwerkvertrag als eigener Infrastrukturausbau festgelegt. Ein
oeffentlich erreichbarer Datenbankport bleibt ausgeschlossen.

Fuer Live wird die interne PostgreSQL-Portnummer `5432` mit dem
Socketverzeichnis `/run/postgresql/epiber-live` reserviert. `epiber_devel`
verwendet `5433` und `/run/postgresql/epiber-devel`. In beiden Instanzen gilt
`listen_addresses = ''`; die Portnummer identifiziert nur den lokalen
Socket-Dateinamen. Das reale Migrations-Staging ist eine getrennte Datenbank der
Development-Instanz und verwendet deren Socket.

### 3.2 Development-Bestand

`epiber_devel` ist bis zum vollstaendigen Live-Cutover der einzige bestaendige
PostgreSQL-Entwicklungs- und Abnahmebestand. Dafuer gilt keine vorab festgelegte
Kalenderdauer.

Migrationstests erzeugen zusaetzlich kurzlebige Datenbanken:

```text
leere Testdatenbank
  -> alle Schemamigrationen
  -> synthetische Seeds
  -> Tests
  -> kontrollierte Entfernung
```

Bei weiteren Entwicklern erhaelt jeder eine eigene lokale beziehungsweise
kurzlebige Datenbank und eine persoenliche Identitaet. `epiber_devel` bleibt die
gemeinsame Integrationsumgebung.

Gemeinsam verwendete Developer-Credentials sind ausgeschlossen. Developer- und
Operatoraktionen muessen personengenau nachvollziehbar bleiben.

### 3.3 Spaetere Produktionsverteilung

Fuer die ersten etwa 10 bis 20 und voraussichtlich auch 20 bis 50 Mandanten kann
ein Produktionscluster mehrere Tenant-Datenbanken tragen:

```text
Produktionscluster 1
  -> epiber_askoe
  -> epiber_verein_b
  -> epiber_verein_c
```

Bei nachgewiesenem Bedarf kann eine Tenant Registry spaeter einzelne Vereine auf
weitere Cluster verteilen. Das Datenmodell und die Datenbank-je-Tenant-Regel
bleiben dabei unveraendert.

### 3.4 PostgreSQL-Version, UUIDs und Extensions

Die erste Migrationsbasis ist PostgreSQL 18 im jeweils aktuellen, zuvor in Devel
geprueften 18.x-Minorstand. Zum Entscheidungszeitpunkt stellt Arch Linux
PostgreSQL 18.6 bereit. PostgreSQL 19 ist noch nicht stabil und wird nicht als
Migrationsbasis verwendet. Ein spaeterer Wechsel der Hauptversion ist ein
eigener geplanter Upgradevorgang mit Backup-, Kompatibilitaets- und Restoregate.

Arch Linux stellt regulär nur die aktuelle PostgreSQL-Hauptversion bereit. Die
PostgreSQL-Pakete werden deshalb von unbeaufsichtigten beziehungsweise
allgemeinen Systemupdates ausgenommen. Minorupdates innerhalb der aktiven
Hauptversion werden zeitnah zuerst in Devel geprueft; ein Majorwechsel darf nie
als Nebenwirkung eines normalen `pacman -Syu` am laufenden Cluster erfolgen.

Wechselt Arch nach stabiler Freigabe auf PostgreSQL 19, wird der Upgradeweg mit
Backup, Restorekopie, `pg_upgrade`, Extensions, Kollationspruefung,
Projektionsparitaet und Rollback zuerst getrennt in Devel nachgewiesen. Danach
kann `epiber_devel` kontrolliert folgen. Ist `epiber_askoe` noch nicht aufgebaut,
wird es anschliessend frisch auf der erfolgreich freigegebenen aktuellen
Arch-Hauptversion erstellt. Eine langfristige eigene Pflege gepinnter
PostgreSQL-18-Sicherheitspakete ist nicht vorgesehen.

Minorupdates werden immer zuerst in Devel mit Release-Note-Pruefung,
Backupstatus, kontrolliertem Neustart, Kernparitaet und Restorepfad verifiziert.
Kritische Sicherheits-, Datenverlust- oder Korruptionsfixes werden innerhalb von
sieben Tagen, regulaere Minorupdates innerhalb von 30 Tagen eingespielt. Live
folgt nur derselben unveraenderten, in Devel erfolgreichen Paketversion.

Allgemeine Systemupdates duerfen PostgreSQL weder automatisch aktualisieren noch
neu starten. Eine dokumentierte Verschiebung ist nur bei konkretem
Kompatibilitaetsblocker mit Risikobewertung und neuem Zieltermin zulaessig.

Neue interne Primaerschluessel erhalten standardmaessig einen von PostgreSQL mit
der nativen Funktion `uuidv7()` erzeugten zeitgeordneten Wert. Fuer diesen Zweck
werden weder `uuid-ossp` noch `pgcrypto` benoetigt. Legacy-/Public-IDs und
Importprovenienz bleiben die stabile Korrelation zu den Ausgangsquellen; interne
UUIDs muessen zwischen getrennten Probeimporten nicht identisch sein.

Als einzige initial verpflichtende Extension wird `pg_stat_statements` fuer die
kontrollierte Query- und Performancebeobachtung aktiviert. Die Anwendung
verwendet ausschliesslich parametrisierte Statements; Betriebsprojektionen und
Logs duerfen keine freien Parameter- oder Personenwerte ausgeben.

Weitere Extensions werden nur mit einem konkreten Fachauftrag eingefuehrt.
Insbesondere folgen `pgvector` erst mit dem Assistant und etwaige
Reservierungs-Extensions erst mit dem finalen Reservierungsschema. Kanonische
Logins werden ueber eine explizite normalisierte Textspalte und einen eindeutigen
Index abgesichert, nicht ueber `citext`.

### 3.5 Initiales Development-Ressourcenprofil

Auf dem bestehenden Host startet `epiber_devel` wegen 3,7 GiB RAM und bereits
beobachteter Swapnutzung bewusst konservativ:

Der Cluster wird von Beginn an mit UTF-8, technischer C-Kollation und
PostgreSQL-Datenseiten-Pruefsummen (`initdb --data-checksums`) initialisiert.
Checksumfehler sind sofort kritisch und blockieren Readiness beziehungsweise
weitere Writes bis zur kontrollierten Diagnose. Die Checksums ergaenzen LUKS,
pgBackRest und fachliche Pruefsummen, ersetzen sie aber nicht.

```text
max_connections = 30
shared_buffers = 128MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 1GB
wal_compression = on
max_wal_size = 1GB
shared_preload_libraries = 'pg_stat_statements'
track_io_timing = on
```

Der PostgreSQL-systemd-Dienst erhaelt initial `MemoryHigh=768M` und
`MemoryMax=1G`. Der App-Pool ist auf hoechstens fuenf, der Worker-Pool auf
hoechstens zwei Verbindungen begrenzt; Migration, Backup, Monitoring und lokale
Administration werden innerhalb des globalen Verbindungslimits getrennt
budgetiert.

PostgreSQL-Devel erhaelt auf dem Drei-Kern-Host initial `CPUQuota=150%` sowie
niedrigere CPU-/I/O-Weights als der laufende Livebetrieb. App und Worker besitzen
eigene Limits; parallele PostgreSQL-Worker starten konservativ. Import-, Backup-
und Restore-One-shots duerfen nur in angekuendigten Messfenstern kontrolliert
hoehere Limits erhalten. Drosselzeit, I/O-Latenz und Querydauer werden gemeinsam
gemessen.

Diese Werte sind ein sicherer Start- und Messrahmen, keine ungepruefte
Dauerkonfiguration. Import-, Backup-, Restore- und Lasttests duerfen sie ueber
eine dokumentierte Messentscheidung anpassen. Memory-Max-Treffer,
Swapwachstum, lange Poolwartezeiten oder I/O-Druck blockieren die Freigabe und
werden nicht durch blindes Erhoehen einzelner Limits kaschiert.


## 4. Domaenenschemas innerhalb einer Tenant-Datenbank

Die Tenantisolation erfolgt durch getrennte Datenbanken und Rollen. Innerhalb
einer Tenant-Datenbank dienen wenige PostgreSQL-Schemas der fachlichen Ordnung
und Rechtebegrenzung:

| Schema | Verantwortung |
|---|---|
| `core` | Tenant, Sektion, allgemeine Konfiguration und Revisionen |
| `identity` | Personen, externe Identifikatoren, Mitgliedschaften, Konten, Credentials, Rollen und Sessions |
| `play` | Bewerbe, Bewerbsarten, Matchtypen, EntryList, Matches, Ergebnisse, KO und Ranglisten |
| `venue` | Anlagen, Plaetze, Hallenzeiten, Courts, Monitore, Scorequellen und Live-Scores |
| `messaging` | Fachereignisse, persoenliche Inbox, Kommentare, Reaktionen und Zustellungen |
| `finance` | kuenftige Vereinsverrechnung; vorerst nur reservierte Domaenengrenze |
| `ops` | Audit, Idempotenz, Jobs, Outbox, Migrationen, Importe und technische Provenienz |

Die Schemas bleiben Teil derselben Datenbank. Fachwrites koennen deshalb
weiterhin ueber mehrere Domaenen in einer PostgreSQL-Transaktion ausgefuehrt
werden.

Das PostgreSQL-Standardschema `public` enthaelt keine ePiber-Fachobjekte;
`CREATE` wird dort fuer `PUBLIC` entzogen. Repository-, Import- und
Migrations-SQL qualifiziert alle Fachobjekte explizit mit ihrem Schema. Rollen
erhalten einen festen minimalen `search_path`, beginnend mit `pg_catalog`, und
keinen breiten impliziten Zugriff auf alle Fachschemas.

`SECURITY DEFINER`-Funktionen sind nur nach ausdruecklicher Rechtepruefung
zulaessig und setzen intern einen sicheren festen `search_path`. Schema- und
Migrationstests erkennen unqualifizierte Fachobjektreferenzen, unerwartete
Grants und neu beschreibbare Namensraeume.

Das Schema `finance` wird im ersten Schritt architektonisch beruecksichtigt, aber
nicht durch spekulative leere Fachtabellen festgeschrieben. Gebuehren,
Forderungen, Rechnungen, Positionen, Zahlungen, Storno, Exporte und die
Abgrenzung zu einer vollstaendigen doppelten Buchfuehrung werden in einem
eigenen Fachauftrag festgelegt.


## 5. Schluessel- und Identitaetsstrategie

### 5.1 Interne UUID und bestehende Legacy-ID

Neue interne Primaerschluessel werden UUIDs. Bestehende IDs bleiben als
eindeutige Legacy- beziehungsweise Public-IDs erhalten:

```text
identity.people
  id         UUID PRIMARY KEY
  legacy_id  TEXT UNIQUE
```

Entsprechendes gilt fuer Bewerbe, Matches, Meldungen und weitere bestehende
Objekte.

Diese Strategie ist fuer die Erstmigration verbindlich. Legacy-/Public-IDs
bleiben unveraenderlich, werden nicht wiederverwendet und bleiben in bestehenden
URLs, HTTP-/WebSocket-Vertraegen und Frontendparametern sichtbar. Die Umstellung
oeffentlicher Vertraege auf UUIDs ist nicht Bestandteil der Persistenzmigration.
Repositories loesen Public-IDs serverseitig auf interne UUIDs auf; relationale
Fremdschluessel verwenden ausschliesslich die internen UUIDs. UUID-Version und
Erzeugungsstelle werden gemeinsam mit PostgreSQL-Hauptversion und notwendigen
Extensions festgelegt.

Neue Personen erhalten waehrend dieses Migrationsumfangs weiterhin eine positive
kanonische dezimale Vertrags-ID. Eine tenantbezogene PostgreSQL-Sequence wird
oberhalb der hoechsten importierten Personen-ID initialisiert; `MAX(id)+1` wird
nicht fortgefuehrt. Die Vertrags-ID wird als Text mit Dezimal-Constraint
gespeichert, niemals wiederverwendet und muss keine lueckenlose Folge bilden.

Neue Matches und Bewerbsmeldungen behalten fuer den Migrationsumfang ihre
heutigen stabil aus Principal und Operation-ID abgeleiteten Vertrags-IDs mit
Praefix `m-` beziehungsweise `e-`. Intern verwenden auch sie UUIDv7 und
relationale UUID-Fremdschluessel. Die spaetere externe UUID-Vertragsmigration
behandelt diese IDs gemeinsam mit Personen-, Bewerbs- und weiteren sichtbaren
Parametern.

Nach stabiler Live-Migration sollen Personen-URLs sowie HTTP-, WebSocket- und
Frontendvertraege in einem eigenen Auftrag auf UUIDs umgestellt werden. Dieser
spaetere Auftrag entscheidet Kompatibilitaetsfrist, Alias-/Redirectverhalten und
Abschaltung numerischer Vertragsparameter. Die importierte Legacy-ID bleibt auch
danach als unveraenderliche Provenienz erhalten und wird nicht zum relationalen
Fremdschluessel.

Damit werden:

- interne Fremdschluessel sauber typisiert;
- bestehende URLs und API-Vertraege nicht unnoetig gleichzeitig geaendert;
- Quell- und Zielobjekte eindeutig korrelierbar;
- spaetere Importe aus mehreren Quellen ohne ID-Umschreibung moeglich;
- technische und sichtbare Identitaet getrennt.

### 5.2 Tenant- und Section-Scope

Jede Tenant-Datenbank enthaelt genau einen lokalen Tenant-Stammsatz. Fachliche
Root-Entitaeten tragen den erforderlichen Tenant- und gegebenenfalls
Section-Bezug. Kindtabellen erben den Scope ueber Fremdschluessel.

Audit, Jobs, Outbox, Importe und Migrationslaeufe enthalten Tenant-Kontext
explizit, auch wenn die Datenbank selbst bereits nur einen Tenant enthaelt.

`core.tenants` ist eine technisch erzwungene Singleton-Wurzel je
Tenant-Datenbank. `core.sections` referenziert sie direkt; fuer ASKÖ wird beim
Bootstrap genau die Sektion Tennis angelegt. Eine zweite Tenant-Wurzel in
derselben Datenbank ist unzulaessig und blockiert Bootstrap beziehungsweise
Readiness.

Die Tenant-Wurzel besitzt neben UUID und veraenderlichem Anzeigenamen einen
unveraenderlichen lesbaren `tenant_code`. Der synthetische Development-Tenant
verwendet `devel-epiber`, der produktive ASKÖ-Tenant `askoe-piberbach`. Beide
fuehren verpflichtend `time_zone=Europe/Vienna` und `locale=de-AT`.

App und Worker deklarieren den erwarteten Tenantcode; eine technisch erreichbare
Datenbank mit abweichendem Code bleibt `not-ready`. Import-/Exportmanifeste,
Jobs, Outbox, kontrollierte Audit-/Betriebslogs und spaetere Registry verwenden
Code und interne Tenant-UUID, ohne den Datenbanknamen zur fachlichen Identitaet
zu machen. Der Code ist nicht geheim und wird nach Vergabe nicht umbenannt.

Die initiale `core.sections`-Zeile verwendet den unveraenderlichen Sectioncode
`tennis`. Development und Live erhalten dafuer unterschiedliche interne UUIDs,
aber denselben fachlichen Code und dasselbe Schema. Weitere Sectioncodes werden
erst mit einer fachlich umgesetzten neuen Sektion angelegt.

Eine `tenant_id` wird nicht redundant in jede Fach- und Kindtabelle aufgenommen.
Der Scope folgt dort ueber Section-, Bewerbs-, Match-, Venue- und andere
fachliche Fremdschluessel. Eigenstaendig verarbeitete oder exportierte
Operationsdaten wie Audit, Jobs, Outbox, Importlaeufe und Exportmanifeste tragen
die Tenantreferenz dagegen direkt. Damit bleibt die Datenbank die harte
Isolationsgrenze, ohne ein nicht geplantes Shared-Database-Modell vorwegzunehmen.


## 6. Personen, Mitgliedschaften, Konten und Rollen

Die heutige Kopplung einer Sheetzeile wird bereits bei der Erstmigration
aufgeloest:

```text
Person
  -> Kontaktdaten
  -> externe Identifikatoren, zum Beispiel ClubDesk
  -> Mitgliedschaft in der Sektion Tennis
  -> optionales Benutzerkonto
       -> Credential
       -> Rollen
       -> Sessions
```

### 6.1 Vorgesehene logische Tabellen

- `identity.people`
- `identity.person_contacts`
- `identity.person_addresses`
- `identity.person_external_identifiers`
- `identity.memberships`
- `identity.user_accounts`
- `identity.credentials`
- `identity.tenant_role_assignments`
- `identity.sessions`
- `identity.login_rate_limits`
- `identity.user_favorites`
- `identity.user_start_pages`

### 6.2 Fachliche Regeln

- Die Erstmigration normalisiert die Struktur vollstaendig, behaelt aber das
  heutige sichtbare Rollen-, Berechtigungs- und Projektionsverhalten bei.
- Nicht jede Person oder Mitgliedschaft benoetigt ein Benutzerkonto.
- Eine Person besitzt innerhalb der Tenant-Datenbank hoechstens ein lokales
  Benutzerkonto; das Konto bleibt optional. Mehrere Mitgliedschaften oder
  spaetere Sektionszuordnungen erzeugen keine weiteren Konten.
- Ein Benutzerkonto kann mehrere getrennte Authentifizierungsmethoden besitzen.
  Die Erstmigration legt fuer den heutigen Passwortbestand genau ein
  Passwort-Credential an; das Modell bleibt fuer spaetere Passkeys oder andere
  Credentials erweiterbar, ohne zusaetzliche Konten fuer dieselbe Person zu
  erzeugen.
- Beim Erstimport entsteht ein Konto, wenn entweder ein gueltiger Login oder ein
  gueltiger Passwort-Hash vorhanden ist. Ein Credential bei leerem Login erzeugt
  ein dormantes nicht anmeldbares Konto mit `login=NULL`; erst eine spaetere
  kontrollierte Loginvergabe macht es adressierbar. Fehlen Login und Credential,
  wird kein Konto kuenstlich angelegt.
- Gueltige aktuelle `scrypt$v1$...`-Hashes werden als aktives
  Passwort-Credential mit Schema `scrypt_v1` uebernommen. Gueltige historische
  64-stellige SHA-256-Hashes werden ausdruecklich als `legacy_sha256` markiert und
  bleiben nur fuer den bestehenden Upgradepfad lesbar.
- Der erste erfolgreiche Login mit `legacy_sha256` ersetzt das Credential in
  derselben kontrollierten Operation durch einen neuen `scrypt_v1`-Hash. Ein
  fehlgeschlagener Login veraendert das Credential nicht. Unbekannte oder
  syntaktisch ungueltige Hashformate blockieren den finalen Import.
- Passwort-Hashes, Salts und Schluesselmaterial duerfen weder in Auditprojektionen
  noch in Anwendungs-, Migrations- oder Betriebslogs erscheinen.
- Pro Konto besteht hoechstens ein aktives Passwort-Credential. Erfolgreicher
  Passwortwechsel, Adminsetzung oder Legacy-Upgrade ersetzt den aktiven Hash
  atomar; alter Hash und Salt werden sofort geloescht und nicht als
  Credentialhistorie aufbewahrt.
- Fuer ersetzte oder widerrufene Credentials darf hoechstens ein
  geheimnisfreier Tombstone mit Credentialtyp, ehemaligem Schema,
  Erstellungs-/Widerrufszeit und kontrolliertem Grundcode 12 Monate bestehen.
  Danach wird auch er entfernt. Audit und Tombstone enthalten niemals Hash-,
  Salt- oder Passwortaequivalente.
- Offene Legacyfreigaben aus `KennwortVergessen=x` werden nicht als aktive
  Passwortfreigaben uebernommen, weil ihnen Ausstellungs- und Ablaufzeitpunkt
  fehlen. Der Export- und Dry-Run-Bericht fuehrt ausschliesslich ihre Anzahl;
  betroffene Benutzer benoetigen nach dem Cutover bei Bedarf eine neue
  Adminfreigabe.
- Neue Passwortfreigaben sind eigene zeitlich begrenzte und einmalig
  konsumierbare Datensaetze mit Konto, ausstellendem Akteur, Erstellung, Ablauf,
  Verbrauch beziehungsweise Widerruf. Erfolgreiche Passwortvergabe, Verbrauch
  der Freigabe und Sessionwiderruf erfolgen atomar. Auditprojektionen enthalten
  nur kontrollierte IDs, Status und Zeiten, keine Passwortdaten.
- Eine neue Passwortfreigabe ist ab ihrer Ausstellung exakt 24 Stunden gueltig.
  Der Server prueft den Ablauf unmittelbar vor der Passwortmutation. Abgelaufene
  Freigaben bleiben als zeitlich begrenzter Auditnachweis erhalten, koennen aber
  nicht reaktiviert werden; eine weitere Freigabe erzeugt einen neuen Datensatz.
- Kontakt-E-Mail und Login bleiben verschiedene Angaben.
- Vorname, Nachname, Geburtsdatum und Geschlecht bleiben Attribute der Person.
  E-Mail und Mobilnummer werden dagegen als typisierte Kontaktpunkte in
  `identity.person_contacts`, Postanschriften strukturiert in
  `identity.person_addresses` gespeichert.
- `GeschlechtID` wird fuer die Erstmigration unveraendert als nullable
  `smallint` mit der geschlossenen Wertemenge `1`, `2` oder `3` gespeichert. Die
  bestehenden Bewerbsfilter verwenden dieselben Codes. Mangels belastbar
  dokumentierter Gesamtsemantik werden im Migrationsauftrag keine neuen Labels
  oder Bedeutungen erfunden.
- Der heutige Legacy-Fallback `Geschlecht` darf nur ueber eine explizite
  Transformationsregel einen gueltigen Code liefern. Ein nichtleerer ungueltiger
  Wert blockiert den finalen Import; freier Text wird nicht in das operative
  Zielmodell uebernommen.
- Die Erstmigration erlaubt je Person hoechstens einen aktiven Kontakt pro
  heutigem Typ `email` und `mobile` sowie hoechstens eine aktive Postanschrift.
  Gleiche Kontaktwerte bei mehreren Personen bleiben zulaessig und erzeugen
  weder Identitaetsverknuepfung noch Eindeutigkeitskonflikt. Das Schema darf
  spaetere Mehrfachkontakte tragen; UI und API aktivieren sie im
  Migrationsauftrag noch nicht.
- Leere oder nach dem heutigen Vertrag ungueltige Kontaktwerte erzeugen keinen
  operativen Kontakt. Der unveraenderte Quellwert bleibt ausschliesslich in der
  geschuetzten Importprovenienz fuer den Migrationsnachweis erhalten.
- Erfolgreiche Aenderungen ersetzen den bisherigen E-Mail-, Mobil- oder
  Anschriftwert transaktional; fruehere Werte werden nicht als
  Kontakt-/Adresshistorie behalten. Das befristete Audit dokumentiert nur die
  kontrollierte Aenderungstatsache und standardmaessig keinen vollstaendigen
  Altwert. Dauerhafte Ergebnis- und Ereignissnapshots enthalten keine Kontakte.
- Spaetere mehrere gleichzeitig aktive Kontaktpunkte sind fachliche aktuelle
  Werte und keine versteckte Aenderungshistorie. Externe ClubDesk-IDs folgen
  davon getrennt ihrem dauerhaften Provenienzvertrag.
- Postanschriften uebernehmen `Land` als getrimmtes `country_label`, ohne im
  Migrationsauftrag eine ISO-Zuordnung zu behaupten. `postal_code` bleibt Text
  mit dem heutigen Vier-Ziffern-Constraint, damit fuehrende Nullen erhalten
  bleiben; `city` und `address_line` bleiben kontrollierte Textfelder.
- Eine spaetere internationale Adressnormalisierung mit ISO-Laendercode und
  laenderspezifischen Postleitzahlregeln ist ein eigener Fachauftrag. Sie darf
  nicht stillschweigend Teil der Persistenzmigration werden.
- Ein fehlender Login wird im Ziel als `NULL` und nicht als Leerstring
  gespeichert. Ein belegter Login besteht weiterhin ohne Rand-Leerraum aus 3 bis
  254 Zeichen der heutigen erlaubten ASCII-Menge und wird kleingeschrieben
  gespeichert.
- `identity.user_accounts.login` ist der einzige operative Loginwert. Ein
  Datenbank-`CHECK` erzwingt Laenge, Zeichenvorrat und kanonische Kleinschreibung;
  ein eindeutiger Index sichert die tenantweite Eindeutigkeit. Eine getrennte
  Original- oder Display-Schreibweise wird nicht gespeichert.
- Nichtkanonische, ungueltige oder doppelte Legacylogins blockieren den finalen
  Import und muessen nach dem festgelegten Korrekturvertrag vorab aufgeloest
  werden. Es gibt weder E-Mail-Fallback noch Unicode-Erweiterung im
  Migrationsauftrag.
- Eine Kontakt-E-Mail darf leer oder mehrfach verwendet sein.
- Ein belegter kanonischer Login muss innerhalb der Tenant-Datenbank eindeutig
  sein.
- Mitgliedsklassifikation `player`, `player A` oder `player B` und technische
  Berechtigungen bleiben getrennt.
- Bestehendes Rollenverhalten wird bei der Erstmigration erhalten. Neue
  Rollenklassen werden nicht gleichzeitig eingefuehrt.
- `player`, `player A` und `player B` bleiben fachliche
  Mitgliedsklassifikationen mit denselben technischen Spielerrechten.
  `Admin=1` und `Operator=1` werden als getrennte technische
  Rollenzuweisungen uebernommen; Admin erbt weiterhin Operatorrechte.
- `identity.tenant_role_assignments` speichert ausschliesslich ausdrueckliche
  tenantweite Vergaben,
  nicht daraus berechnete Vererbungen. `Admin=1` erzeugt eine Adminzuweisung,
  `Operator=1` eine Operatorzuweisung; sind beide gesetzt, bleiben beide
  Herkunftstatbestaende erhalten. Eine nur aus Admin abgeleitete
  Operatorberechtigung erzeugt keine zusaetzliche Zuweisungszeile.
- Effektive Rechte werden ueber einen versionierten geschlossenen Rollenkatalog
  berechnet. Dadurch entzieht das Entfernen einer Adminzuweisung nur geerbte
  Operatorrechte; eine unabhaengig ausdruecklich gesetzte Operatorzuweisung
  bleibt bestehen. Bestehende Antworten projizieren weiterhin die effektive
  Hoechstrolle `admin`, `operator` oder `player`.
- Eine aktive tenantweite Rollenzuweisung wird bei Entzug mit `revoked_at`
  geschlossen und erhoeht in derselben Transaktion die Konto-`auth_revision`.
  Grant und Revoke erscheinen im Sicherheitsaudit. Widerrufene Zuweisungszeilen
  unterliegen der 12-Monats-Retention; eine spaetere Neuvergabe erzeugt eine neue
  explizite Zeile.
- Dauerhafte Ergebnis- und Ereignissnapshots behalten unabhaengig davon ihre
  damals erforderliche Akteur-ID beziehungsweise Rollenprojektion. Die
  Rollenretention veraendert keine Fachhistorie und ist von den dauerhaften
  Mitgliedschaftszeitraeumen getrennt.
- Spielerrechte entstehen aus einer aktiven Section-Mitgliedschaft und nicht aus
  einer tenantweiten Player-Rollenzuweisung. Die heutigen Rollen `admin` und
  `operator` gelten fuer den gesamten Tenant. Spaetere Section-Rollen erhalten
  bei ihrer fachlichen Einfuehrung eine eigene relational typisierte
  Zuweisungstabelle; ein polymorphes `scope_type + scope_id` wird nicht
  vorweggenommen.
- Tenantweite Admin-/Operatorzuweisungen referenzieren die Person, nicht das
  optionale Benutzerkonto. Eine Person ohne Login kann damit eine vorbereitete
  Zuweisung besitzen, sie aber nicht ausueben. Bei spaeterer Kontoanlage werden
  die aktiven Personenrollen wirksam, ohne ein kuenstliches Konto oder Credential
  fuer den Import zu erzeugen.
- Ein angemeldetes Konto leitet effektive Rollen ueber seine Person ab. Eine
  Rollenmutation erhoeht die Konto-`auth_revision` und widerruft Sessions, sofern
  fuer die Person bereits ein Konto besteht.
- Importierte aktive Rollenzuweisungen erhalten mangels Legacyzeitpunkt kein
  erfundenes `granted_at`; Importzeit und Quelle liegen getrennt in der
  Provenienz. Erst PostgreSQL-seitige Neuvergaben besitzen einen belegten
  Vergabezeitpunkt und Akteur.
- Sobald mindestens eines der Quellfelder `Mitglied`, `Admin` oder `Operator`
  belegt ist, bestimmt diese Dreiergruppe die Zielprojektion. Nur wenn alle drei
  leer sind, wird `Role` nach dem heutigen Legacy-Fallback ausgewertet.
- Eine Tennis-Mitgliedschaft wird beim Erstimport genau dann angelegt, wenn
  `Mitglied` die Klassifikation `player`, `player A` oder `player B` enthaelt
  oder, bei drei leeren neuen Rollenfeldern, `Role` eine dieser
  Playerklassifikationen liefert. Ein reiner Legacywert `operator` oder `admin`
  erzeugt keine Mitgliedschaft.
- Da die Legacyquelle keinen verlaesslichen Ein- oder Austrittszeitpunkt fuehrt,
  bleiben `valid_from` und `valid_until` importierter Mitgliedschaften `NULL`.
  Der technische Importzeitpunkt wird getrennt als Provenienz gespeichert und
  darf nicht als fachliches Eintrittsdatum projiziert werden.
- Mitgliedschaften werden nach dem Cutover als unveraenderliche Zeitraeume
  gefuehrt. Pro Person und Section darf hoechstens ein aktueller Zeitraum ohne
  `valid_until` bestehen. Klassenwechsel schliessen den bisherigen Zeitraum und
  legen in derselben Transaktion einen neuen mit der neuen Klassifikation an;
  ein Austritt schliesst nur den offenen Zeitraum.
- Der erste PostgreSQL-Wechsel oder -Austritt setzt fuer einen importierten
  Zeitraum mit unbekanntem Beginn ausschliesslich den belegbaren
  Abschlusszeitpunkt. Bestehende HTTP-/WebSocket-Projektionen geben weiterhin nur
  die aktuelle Klassifikation aus; eine neue sichtbare Verlaufansicht ist nicht
  Bestandteil der Migration.
- Ein nichtleerer unbekannter Legacy-Rollenwert wird trotz des heutigen
  defensiven Laufzeitfallbacks nicht stillschweigend migriert, sondern muss vor
  dem finalen Import als Datenqualitaetsblocker explizit geklaert werden.
- Neue Rollen wie `sports_admin`, `tenant_admin`, `section_admin` oder
  `reservation_manager` sind nicht Bestandteil der Erstmigration.
- Inaktive und technische Personen werden vollstaendig migriert und nicht wegen
  ihres Status geloescht.
- Das heutige Quellfeld `Aktiv` wird strukturell in getrennte Statuswerte fuer
  Person, Mitgliedschaft und Benutzerkonto aufgeloest. `Aktiv=1` setzt beim
  Erstimport die jeweils vorhandenen Zielobjekte auf aktiv; ein leerer Wert setzt
  sie auf inaktiv. Eine Person ohne Mitgliedschaft oder Konto erhaelt dadurch
  kein kuenstliches Zielobjekt.
- Bis zu einer spaeteren ausdruecklichen Fachaenderung bleibt das sichtbare
  Legacyverhalten erhalten: Eine Aktiv-/Inaktivsetzung aendert die vorhandenen
  Personen-, Mitgliedschafts- und Kontostatus in einer Transaktion. Die
  Deaktivierung des Kontos widerruft darin zugleich alle aktiven Sessions.
- Getrennte Statuswerte duerfen spaeter fachlich auseinanderlaufen, etwa fuer
  eine reine Kontosperre oder eine beendete Mitgliedschaft. Die
  Persistenzmigration aktiviert diese neuen Bedien- und Berechtigungsfaelle noch
  nicht.
- Historische Referenzen bleiben erhalten.
- Dauerhafte Ergebnis- und Ergebniswirkungshistorien speichern fuer jeden
  damaligen Teilnehmer einen unveraenderlichen Snapshot aus damaliger
  Vertrags-ID und damaligem Anzeigenamen. Die interne Personen-UUID bleibt
  zusaetzlich referenziert, solange die Person besteht; spaetere Namensaenderungen
  schreiben den historischen Snapshot nicht um.
- Login, Rollen, Konto, Credentials, Sessions, Kontaktpunkte und Anschrift sind
  nicht Bestandteil des dauerhaften Teilnehmersnapshots. Personen werden im
  regulaeren Betrieb deaktiviert statt hart geloescht. Eine spaetere rechtlich
  erforderliche Anonymisierungs- oder Loeschregel ist ein eigener
  Datenschutzauftrag und darf die Ergebnishistorie nicht stillschweigend
  veraendern.
- Neue PostgreSQL-Sessions behalten die heutige Policy: zufaellige sichere
  Cookie-Tokens, serverseitig ausschliesslich deren SHA-256-Hash, 30 Tage
  Inaktivitaetsablauf, Verlaengerung hoechstens einmal pro Tag und maximal zehn
  parallele Geraetesessions je Konto.
- `identity.user_accounts` fuehrt eine ganzzahlige `auth_revision`. Jede
  sicherheitsrelevante Aenderung an Login, Konto-/Personenstatus, effektiven
  Rollen oder Passwort erhoeht sie in derselben Transaktion. Eine Session bindet
  die Revision ihrer Ausstellung und ist bei Abweichung sofort ungueltig;
  individueller Logout und Geraetewiderruf bleiben ueber die Sessionzeile
  moeglich.
- Kontakt-E-Mail wird nicht mehr als Session-Snapshot gespeichert. Ein
  kontrollierter kanonischer Login-Snapshot darf fuer Diagnose und
  Migrationsparitaet bestehen, ist aber nicht die Autoritaet fuer die
  Sessiongueltigkeit. Beim Cutover werden nach dem bereits festgelegten Vertrag
  keine Legacy-Sessions importiert.
- Login-Drosselung behaelt fuer die erste PostgreSQL-Stufe die heutigen
  Grenzwerte: festes 15-Minuten-Fenster und 15 Minuten Sperrdauer, Sperre ab dem
  fuenften Versuch je Kombination aus IP und kanonischem Login sowie ab dem
  zwanzigsten Versuch je IP. Erfolgreiche Anmeldung leert beide betroffenen
  Zaehler.
- Rate-Limit-Schluessel werden weiterhin ausschliesslich als starke Hashes mit
  Ablaufzeit gespeichert. Weder kanonischer Login noch Quell-IP erscheinen im
  Schluessel oder in freien Betriebslogs. Legacyzaehler werden beim Cutover nicht
  importiert; abgelaufene PostgreSQL-Eintraege entfernt der Retentionjob.
- `identity.user_favorites` speichert je Favorit eine eigene geordnete Zeile mit
  Konto, Position, Zieltyp und genau der zum Typ passenden Referenz. Explizite
  nullable UUID-Fremdschluessel beziehungsweise geschlossene `page_key`- und
  `overlay_key`-Werte ersetzen polymorphe IDs in einem JSON-Dokument; ein
  Constraint erlaubt je Zeile genau ein gueltiges Ziel.
- Die heutige fachliche Grenze von 32 Favoriten wird mit dem PostgreSQL-Cutover
  entfernt. Es gibt keine feste Anzahlgrenze je Konto; allgemeine
  Requestgroessen-, Rate-, Validierungs- und Ressourcenlimits bleiben bestehen.
  Positionen sind je Konto eindeutig und koennen transaktional neu geordnet
  werden. Strukturell ungueltige oder nicht aufloesbare Importziele blockieren
  den Import, statt stillschweigend entfernt zu werden.
- Die Startseite liegt getrennt als hoechstens eine kontrollierte typisierte
  Zielreferenz je Konto in `identity.user_start_pages` und verwendet denselben
  geschlossenen Zielkatalog, soweit der heutige Startseitenvertrag ihn erlaubt.
- `identity.person_external_identifiers` speichert externe Kennungen unter einem
  geschlossenen Anbieterwert, fuer den Erstimport `clubdesk`, und dem kanonischen
  externen Wert. Eine leere `CD-ID` erzeugt keinen Datensatz; ungueltige oder
  doppelte Kennungen blockieren den finalen Import.
- Eine externe ClubDesk-ID bleibt tenantweit dauerhaft genau einer Person
  zugeordnet und wird auch nach einem spaeteren Widerruf nicht fuer eine andere
  Person wiederverwendet. Pro Person ist hoechstens eine aktive ClubDesk-ID
  zulaessig. Eine spaetere Korrekturfunktion muss Verknuepfungen historisieren und
  auditieren, statt sie zu ueberschreiben; sie ist nicht Bestandteil der
  Persistenzmigration.

### 6.3 Aktuelle Dokumentationsabweichung

Eine aeltere Mitgliederabgleich-Arbeitsgrundlage bezeichnet `E-Mail` noch als
Login. Massgeblich fuer das Zielmodell sind aktueller Code und kanonische
Datenbankdokumentation:

- `E-Mail` ist optionale, nicht eindeutige Kontaktinformation.
- `Login` ist die vereinslokal eindeutige Anmeldekennung.

### 6.4 Source-to-Target-Matrix `Personen`

| Legacyfeld | PostgreSQL-Ziel | Transformationsvertrag |
|---|---|---|
| `ID` | `identity.people.contract_id` | bestehender gueltiger eindeutiger Legacywert unveraendert als Text; neue Personen erhalten positive Dezimalwerte aus der Sequence; interne UUID separat |
| `Vorname` | `identity.people.first_name` | getrimmt, leer wird `NULL`, maximal heutige 100 Zeichen |
| `Nachname` | `identity.people.last_name` | getrimmt, verpflichtend, maximal 100 Zeichen |
| `GeburtsDatum` | `identity.people.birth_date` | leer wird `NULL`, sonst streng validiertes `date` aus `TT.MM.JJJJ` |
| `GeschlechtID` / Fallback `Geschlecht` | `identity.people.gender_code` | leer wird `NULL`, sonst `smallint` 1 bis 3; ungueltiger nichtleerer Wert blockiert |
| `Aktiv` | Personen-, Membership- und Accountstatus | `1` aktiviert vorhandene Zielobjekte, leer deaktiviert; keine kuenstlichen Membership-/Accountzeilen |
| `E-Mail` | `identity.person_contacts` Typ `email` | kanonisch gueltiger Wert; leer/ungueltig erzeugt keinen Kontakt; nicht eindeutig |
| `TelefonMobil` | `identity.person_contacts` Typ `mobile` | heutige kanonische Textregel; leer/ungueltig erzeugt keinen Kontakt |
| `Land` | `identity.person_addresses.country_label` | getrimmter Legacytext, keine ISO-Erfindung |
| `PLZ` | `identity.person_addresses.postal_code` | Text, leer oder vier Ziffern; fuehrende Nullen bleiben |
| `Ort` | `identity.person_addresses.city` | getrimmter kontrollierter Text |
| `Adresse` | `identity.person_addresses.address_line` | getrimmter kontrollierter Text; Adresszeile nur bei mindestens einem Adresswert |
| `CD-ID` | `identity.person_external_identifiers` | Provider `clubdesk`; positive kanonische Dezimalzahl, dauerhaft personengebunden und tenantweit eindeutig |
| `Login` | `identity.user_accounts.login` | leer wird `NULL`; sonst heutiger kleingeschriebener ASCII-Vertrag und tenantweit eindeutig; Konto kann wegen Credential trotzdem dormant bestehen |
| `PasswdHash` | `identity.credentials` | gueltiges `scrypt_v1` oder markiertes `legacy_sha256`; bei leerem Login an dormantes Konto, leer erzeugt kein Passwort-Credential |
| `KennwortVergessen` | kein aktiver Import | offene Legacyfreigabe nur zaehlen und verwerfen; neue Freigabe nach Cutover erforderlich |
| `Mitglied` | `identity.memberships.classification` | `player`, `player A` oder `player B`; erzeugt aktuellen Tennis-Mitgliedschaftszeitraum |
| `Admin` | `identity.tenant_role_assignments` | `1` erzeugt explizite tenantweite Adminzuweisung |
| `Operator` | `identity.tenant_role_assignments` | `1` erzeugt explizite tenantweite Operatorzuweisung |
| `Role` | Membership-/Rollen-Fallback | nur wenn `Mitglied`, `Admin` und `Operator` alle leer sind; unbekannter nichtleerer Wert blockiert |
| `Notification` | `messaging.notification_preferences` | typisierte Praeferenzen `email`/`whatsapp`; Inbox unabhaengig aktiv, externe Zustellung bleibt deaktiviert |

Weitere unbekannte Personenfelder werden nicht stillschweigend zu operativen
JSON-Attributen. Sie bleiben im unveraenderten Quellpaket und muessen vor dem
finalen Import entweder als bewusstes Archivfeld bestaetigt oder einer
versionierten Zielbehandlung zugeordnet werden.

Der Import muss ausserdem das aktuelle neue Rollenmodell aus `Mitglied`, `Admin`
und `Operator` sowie den Legacy-Fallback `Role` korrekt zu einer eindeutigen
Zielprojektion zusammenfuehren.


## 7. Spielbetrieb

### 7.1 Katalog und Bewerbe

Vorgesehene logische Tabellen:

- `play.competition_types`
- `play.competition_type_versions`
- `play.match_formats`
- `play.match_format_versions`
- `play.competitions`
- `play.competition_entries`
- `play.competition_gender_eligibility`

Alle bisherigen IDs und fachlichen Eigenschaften bleiben ueber Legacy-ID und
typisierte Zielspalten nachvollziehbar.

Matchtypen und strukturpraegende Bewerbsarten besitzen eine stabile
Katalogidentitaet und unveraenderliche Versionen. Der Erstimport erzeugt aus
jedem aktuellen Legacydatensatz eine initiale Version. Ein Bewerb referenziert
jeweils die konkrete `match_format_version` und
`competition_type_version`, nicht nur den veraenderlichen Katalogkopf.

Eine spaetere Aenderung von Gewinnsaetzen, Satzlaenge, Tie-Break,
Entscheidungssatz, No-Ad, Raster- oder Gruppenstruktur erzeugt eine neue Version
und wirkt nicht rueckwirkend auf bestehende Bewerbe. Deren Wechsel auf eine neue
Version benoetigt eine ausdrueckliche fachliche Operation mit Validierung der
bereits vorhandenen Meldungen, Matches und Ergebnisse. Reine Anzeigebezeichnungen
duerfen getrennt vom unveraenderlichen Regelinhalt gepflegt werden.

Bewerbsgrenzen mit optionaler Uhrzeit werden praezisionserhaltend gespeichert.
Fuer `entry_start`, `entry_deadline`, `competition_start` und `competition_end`
existiert jeweils eine datumsgenaue und eine zeitpunktgenaue Zielspalte; ein
Constraint erlaubt hoechstens eine davon. Reine Datumswerte werden als `date`,
eindeutige lokale Datum-/Uhrzeitwerte nach der festgelegten Wien-Pruefung als
`timestamptz` gespeichert.

Die Fachauswertung behaelt das heutige Verhalten, ohne einen kuenstlichen
Zeitpunkt zu persistieren: Ein reines Startdatum gilt ab Beginn des Wiener
Kalendertags, ein reines Deadline- oder Enddatum einschliesslich des gesamten
Wiener Kalendertags. Bestehende Projektionen erzeugen weiterhin das erwartete
Legacyformat; Quellpraezision und Zieltyp bleiben in Importprovenienz und
kanonischem Vergleich erkennbar.

Teilnahmefilter werden relational und typisiert gespeichert.
`play.competition_gender_eligibility` enthaelt die erlaubten Codes `1`, `2` und
`3`; keine Zeile fuer einen Bewerb bedeutet weiterhin keine Einschraenkung. Am
Bewerb liegen nullable `minimum_age` und `maximum_age` mit Werte- und
Konsistenzconstraints. `N+` wird als Mindestalter, `N-` als Hoechstalter sowie
leer und `0+` als unbeschraenkt importiert.

Die Altersberechnung bleibt fuer die Erstmigration unveraendert das Wiener
Kalenderjahr minus Geburtsjahr, nicht das Alter am exakten Geburtstag. Fehlendes
oder ungueltiges Geburtsdatum beziehungsweise fehlender Geschlechtscode umgeht
eine vorhandene Einschraenkung nicht. Bestehende Projektionen erzeugen aus den
typisierten Relationen weiterhin die bisherigen Listen- und Altersstrings.

#### Source-to-Target-Matrix `Bewerb`

| Legacyfeld | PostgreSQL-Ziel | Transformationsvertrag |
|---|---|---|
| `ID` | `play.competitions.contract_id` | gueltiger eindeutiger Legacywert unveraendert; interne UUID separat |
| `BewerbsartID` | `competition_type_id` und initiale Version | verpflichtende aufloesbare Referenz auf Katalog und beim Import wirksame Version |
| `MatchtypID Standard` | `default_match_format_version_id` | nullable aufloesbare Referenz; konkrete Matches binden ihre Version bei Anlage |
| `Bezeichnung` | `name` | getrimmter kontrollierter Text |
| `EntryStart` | `entry_start_date` oder `entry_starts_at` | reine Datums- oder eindeutige Zeitpunktpraezision, niemals beide |
| `EntryDeadline` | `entry_deadline_date` oder `entry_deadline_at` | reine Datums- oder eindeutige Zeitpunktpraezision; Datum gilt fachlich einschliesslich des Tages |
| `Bewerbsbeginn` | `competition_start_date` oder `competition_starts_at` | praezisionserhaltend nach demselben Vertrag |
| `Bewerbsende` | `competition_end_date` oder `competition_ends_at` | praezisionserhaltend; reines Datum gilt einschliesslich des Tages |
| `Geschlecht` | `play.competition_gender_eligibility` | eindeutige Codes 1 bis 3; leer bedeutet unbeschraenkt |
| `Alterskategorie` | `minimum_age` / `maximum_age` | `N+`, `N-`, leer und `0+` nach dem festgelegten Vertrag |
| `SortOrder` | `sort_order` | gueltiger numerischer Wert; leer beziehungsweise heutiger ungueltiger optionaler Wert wird `NULL` und sortiert mit stabilem Tie-Breaker zuletzt |

#### Source-to-Target-Matrix `Bewerbsart`

| Legacyfeld | PostgreSQL-Ziel | Transformationsvertrag |
|---|---|---|
| `ID` | `play.competition_types.contract_id` | gueltiger eindeutiger Legacywert unveraendert |
| `Bezeichnung` | Katalogbezeichnung | getrimmter kontrollierter Text, getrennt vom Regelinhalt pflegbar |
| `EntryListAvailable` | initiale `competition_type_version` | heutiges Aktivflag wird Boolean |
| `Rasterfunktion` | initiale `competition_type_version` | ausschliesslich katalogisierter heutiger Funktionswert; unbekannt blockiert |
| `RoundRobin` | initiale `competition_type_version` | heutiges Aktivflag wird Boolean |
| `Spezifikum` | initiale `competition_type_version` | kontrollierter heutiger Wert; kein freies Erweiterungs-JSON |

#### Source-to-Target-Matrix `Matchtyp`

| Legacyfeld | PostgreSQL-Ziel der initialen `match_format_version` | Transformationsvertrag |
|---|---|---|
| `ID` | `play.match_formats.contract_id` | positive ganzzahlige Legacy-ID als Text, eindeutig |
| `Bezeichnung` | Katalogbezeichnung | getrimmter kontrollierter Text |
| `Gewinnsaetze` | `sets_to_win` | exakt 2 oder 3 |
| `Satzlaenge` | `set_target_games` | `0-4` wird 4, `0-6` wird 6 |
| `Satztiebreak` | `set_tiebreak_at_games` | passend 3 oder 6 und konsistent zur Satzlaenge |
| `Entscheidender Satz` | `deciding_set_type` | geschlossen `full_set`, `match_tiebreak_10` oder `match_tiebreak_7` |
| `NoAd` | `no_ad` | `J` wird wahr, `N` falsch; andere Werte blockieren |

Unbekannte Spalten oder nicht katalogisierte Bewerbsartwerte werden wie bei
Personen nicht in freie JSON-Felder uebernommen, sondern muessen vor dem finalen
Import explizit zugeordnet oder als reines Quellarchivfeld bestaetigt werden.

`play.competition_entries` fuehrt jede Anmeldung als eigenen unveraenderlichen
Fachvorgang mit Vertrags-ID, Person, Bewerb und `entered_at`. Eine Abmeldung
schliesst den Vorgang durch Status und `withdrawn_at`, statt ihn physisch zu
loeschen. Ein partieller eindeutiger Index erlaubt je Bewerb und Person hoechstens
eine aktive Meldung.

Eine erneute Anmeldung nach Abmeldung erzeugt einen neuen Meldevorgang mit neuer
Vertrags-ID. Bestehende APIs und EntryList-Projektionen liefern weiterhin nur den
aktiven Stand. Der Import uebernimmt vorhandene EntryList-Zeilen als aktiv und
erfindet keine aus den aktuellen Quellen nicht rekonstruierbaren frueheren
Meldeperioden. Der heutige optionale Zahlungsstatus bleibt am konkreten
Meldevorgang, ohne damit Finance-Funktionen einzufuehren.

`GebuehrBezahlt` wird zunaechst verlustfrei als nullable eng begrenzter
`legacy_fee_status` am Meldevorgang gespeichert. Mangels belastbarem aktuellem
Werte- und Verhaltensvertrag wird daraus weder Boolean noch Forderungs-, Zahlungs-
oder Financewirkung abgeleitet. Der Dry Run berichtet die vorkommenden Werte nur
als datensparsamen kontrollierten Katalog mit Anzahlen; eine spaetere
Finance-Fachmigration typisiert sie ausdruecklich.

#### Source-to-Target-Matrix `EntryList`

| Legacyfeld | PostgreSQL-Ziel | Transformationsvertrag |
|---|---|---|
| `ID` | `play.competition_entries.contract_id` | gueltiger eindeutiger Legacywert; interne UUID separat |
| `BewerbID` | `competition_id` | verpflichtende aufloesbare UUID-Fremdreferenz |
| `PersonenID` | `person_id` | verpflichtende aufloesbare UUID-Fremdreferenz |
| `Entrydate` | `entered_at` | verpflichtender eindeutiger Wiener Zeitpunkt als `timestamptz(3)` |
| `GebuehrBezahlt` | `legacy_fee_status` | nullable kontrollierter Legacytext ohne neue Zahlungssemantik |

Importierte Zeilen erhalten Status `active`; fruehere bereits geloeschte
Meldeperioden werden nicht aus Messagingtexten rekonstruiert.

### 7.2 Matches und Ergebnisse

Vorgesehene logische Tabellen:

- `play.matches`
- `play.match_sides`
- `play.match_participants`
- `play.match_results`
- `play.match_result_sets`
- `play.match_result_history`
- `play.match_progressions`

Verbesserungen gegenueber dem Sheetmodell:

- Jedes Match besitzt exakt zwei `play.match_sides` mit `side_no` 1 oder 2.
  Jede Seite besitzt hoechstens zwei geordnete Teilnehmerslots mit
  `position_no` 1 oder 2.
- Ein Teilnehmerslot ist geschlossen typisiert als `person`, `bye` oder
  `open_bracket`. Nur `person` traegt eine Personen-UUID. Constraints verhindern
  doppelte Seitenpositionen und dieselbe Person mehrfach im selben Match.
- `PRE` wird als offener Bracket-Slot und nicht als Personen-ID modelliert.
- `BYE` wird als eigener Slot- beziehungsweise Teilnehmertyp modelliert.
- Walkover und Retirement werden als Abschlussart gespeichert.
- `[wo]` und `[ret]` werden nicht dauerhaft an Personenreferenzen angehaengt.
- Satzresultate werden strukturiert gespeichert; der bisherige Ergebnisstring
  kann fuer kompatible Projektionen erzeugt werden.
- `play.match_result_sets` speichert je Ergebnisversion eine eindeutige
  fortlaufende `set_no`, die Spielwerte beider Seiten zwischen 0 und 99, optional
  die Tie-Break-Punkte des Satzverlierers zwischen 0 und 99 sowie die
  Kennzeichnung eines unvollstaendigen letzten Satzes bei Retirement. Ein
  unvollstaendiger Satz ist fuer regulaere Ergebnisse und Walkover unzulaessig.
- Der bisherige Ergebnisstring ist keine zweite autoritative Speicherung. Er
  wird kanonisch aus den Satzzeilen erzeugt und beim Import vor und nach dem
  Parsen auf exakte Rueckprojektion geprueft. Satzanzahl, Vollstaendigkeit,
  Tie-Break und Gewinner werden gegen die am Match gebundene Formatversion
  validiert.
- Jede Ergebnisversion speichert `completion_type` aus der geschlossenen Menge
  `regular`, `walkover` oder `retirement` sowie `winner_side_no` 1 oder 2. Die
  Gewinnerseite ist damit fuer Historie, Projektion und KO-Fortschreibung
  einheitlich und wird nicht mehr aus Personenmarkern abgeleitet.
- Bei regulaeren Ergebnissen und Retirement muss der Fachservice die
  Gewinnerseite vollstaendig gegen Satzstaende und gebundene Matchformat-Version
  validieren. Bei Walkover ist sie die massgebliche Fachangabe ohne
  erforderliches Satzresultat. Datenbank-Checks sichern Wertebereich und
  tabellenlokale Kombinationen; die vollstaendige Tennisgrammatik bleibt im
  Fachservice.
- Historische Rang-Snapshots bleiben am Matchresultat erhalten.
- KO-Fortschreibung wird relational und transaktional an das Ergebnis gebunden.
- `play.match_progressions` bildet den unveraenderlichen KO-Graphen als Kanten
  von einem Quellmatch zu Zielmatch und Zielseite ab. `source_outcome` ist fuer
  den ersten Vertrag geschlossen `winner`; jeder Zielslot besitzt hoechstens
  eine eingehende Fortschreibung. Quelle und Ziel muessen demselben Bewerb
  angehoeren.
- Import und Bracketaufbau validieren den Gesamtgraphen auf eindeutige Ziele und
  Zyklenfreiheit. Rundencodes wie `VF`, `HF` oder `F` sind keine technische
  Ableitungsgrundlage fuer die Fortschreibung.
- Jede wirksame Ergebnisversion erzeugt in derselben Transaktion eine dauerhaft
  historisierte Fortschreibungswirkung und setzt den aktuellen Zielslot.
  Korrektur oder Clear nehmen die aktuelle Wirkung nur unter den heutigen
  Schutzregeln fuer bereits terminierte oder fortgeschrittene Folgematches
  zurueck; fruehere Wirkung und Ruecknahme bleiben im Ergebnisjournal erhalten.
- Jede tatsaechlich wirksam gewordene Ergebniseintragung, Korrektur,
  Ergebnisloeschung und administrative Korrektur des Matchendes erzeugt in
  derselben Transaktion einen unveraenderlichen Eintrag der dauerhaften
  Ergebnishistorie. Eine Loeschung entfernt den aktuellen Ergebnisstand, aber
  nicht dessen Vorher-Zustand und die Tatsache seiner kontrollierten Ruecknahme.
- Die dauerhafte Ergebnishistorie enthaelt die kontrollierten Vorher-/Nachher-
  Zustaende, Abschlussart, Saetze, damalige Teilnehmer, Rang-Snapshots,
  Rangfolgenwirkung, KO-Fortschreibung, Zeitpunkt, Akteur und einen erforderlichen
  administrativen Fachgrund. Passwort-, Kontakt- und freie technische Payloads
  bleiben ausgeschlossen.
- `play.match_results` enthaelt unveraenderliche Ergebnisversionen. Jede
  erfolgreiche Ersteintragung oder Korrektur legt eine neue Version samt ihren
  unveraenderlichen `play.match_result_sets` an; bestehende Versionen werden
  weder ueberschrieben noch geloescht. `play.matches.current_result_id`
  referenziert den aktuell gueltigen Stand.
- Ein Ergebnis-Clear setzt `current_result_id` auf `NULL`, laesst alle bisherigen
  Ergebnisversionen bestehen und erzeugt einen unveraenderlichen
  `play.match_result_history`-Eintrag mit Vorher-Version und leerer
  Nachher-Version. Ersteintragung und Korrektur referenzieren entsprechend ihre
  Vorher-/Nachher-Versionen. Ranglisten- und KO-Wirkungen sind an denselben
  Historieneintrag gebunden.
- Gestartete, abgelehnte, fehlgeschlagene oder nicht als fachlich wirksam
  bestaetigte Versuche erzeugen keine Ergebnisversion; sie verbleiben im
  zeitlich begrenzten Operationsaudit.
- Jedes beim Import aktuell vorhandene Legacyresultat erzeugt genau eine
  unveraenderliche Ausgangsversion mit Provenienz `legacy_snapshot`. Verfuegbare
  Spiel-, Erstaufnahme- und Rangsnapshotwerte sowie der belegte aktuelle Rang-
  und KO-Zustand werden uebernommen; der zugehoerige Historieneintrag fuehrt den
  Importzeitpunkt, aber keinen erfundenen Akteur oder Korrekturgrund.
- Audit- und Messagingereignisse werden nicht heuristisch zu frueheren
  Ergebnisversionen zusammengesetzt. Ihre vorhandenen Datensaetze bleiben nach
  ihrem eigenen Vertrag erhalten. Der Migrationsbericht weist die vor
  PostgreSQL nicht rekonstruierbare Korrekturhistorie ausdruecklich als
  Quellgrenze aus; ab dem Cutover wird jede wirksame Aenderung vollstaendig
  versioniert.
- Die Erstmigration persistiert diese Historie, fuehrt aber keine neue sichtbare
  Ergebnisversions- oder Adminoberflaeche ein. Bestehende Match-, Profil- und
  Bewerbsprojektionen bleiben fuer Persistenzparitaet unveraendert. Eine spaetere
  Detailansicht ist ein eigener Fachauftrag mit Rollen-, Datenschutz- und
  Bedienentscheidung.
- Bestehende Projektionen erzeugen aus Seite 1/Position 1 und 2 sowie Seite
  2/Position 1 und 2 wieder `Spieler1ID` bis `Spieler4ID`. `PRE` ist dabei nur
  fuer einen `open_bracket`-Slot an erster Position einer Seite zulaessig;
  Abschlussarten werden niemals wieder an eine Personen-ID angehaengt.
- Der heutige Matchzustand wird nicht als frei veraenderbare redundante
  Statusspalte gespeichert. Ein kontrollierter View leitet `open_bracket`,
  `bye`, `open` und `completed` aus den typisierten Slots und der nullable
  Referenz `current_result_id` ab. `Ignore=1` wird getrennt als `is_ignored`
  gespeichert und ueberlagert nur die fachliche Sichtbarkeit.
- Indizes liegen auf den zugrunde liegenden Besetzungs-, Ergebnis- und
  Sichtbarkeitsfeldern. Neue echte Lebenszykluszustaende wie eine Absage werden
  erst mit einem eigenen Fachvertrag eingefuehrt und nicht vorab als freie
  Statuswerte reserviert.
- Jedes Match referenziert bereits bei seiner Anlage die konkret aufgeloeste
  unveraenderliche `match_format_version`. Zusaetzlich wird kontrolliert
  gespeichert, ob diese Bindung aus dem Bewerbsstandard oder einer
  ausdruecklichen Matchueberschreibung stammt.
- Ein spaeterer Wechsel des Bewerbsstandards wirkt nur auf danach neu angelegte
  Matches. Ein bestehendes Match wechselt seine Formatversion ausschliesslich
  ueber eine ausdrueckliche validierte Fachoperation. Beim Import hat ein
  vorhandenes `MatchtypID` Vorrang; andernfalls wird die bereits am Bewerb
  gebundene Standardversion aufgeloest.
- Zeitwerte werden semantisch getrennt: `matches.challenged_at` speichert den
  Forderungszeitpunkt und `matches.scheduled_at` den aktuellen Plantermin. Jede
  Ergebnisversion fuehrt `play_started_at`, `play_ended_at` und den bei
  Korrekturen unveraenderten `first_captured_at`; jeder
  Ergebnis-Historieneintrag besitzt zusaetzlich sein eigenes `changed_at`.
- Ein Walkover fuehrt `walkover_at` an der Ergebnisversion. Wie im heutigen
  Vertrag wird dabei der Plantermin geleert und in der Legacyprojektion
  `walkover_at` als `MatchDate` ausgegeben. Ein Clear entfernt den aktuellen
  Ergebniszeiger und den ergebnisgebundenen Walkovertermin, laesst die
  historischen Werte der unveraenderlichen Version bestehen.
- Historisch fehlende Zeitwerte bleiben `NULL`. Der heutige Fallback eines
  fehlenden Matchendes auf `MatchDate` darf nur in der kompatiblen Fachauswertung
  erfolgen und wird nicht als tatsaechliches Spielende persistiert.
- `Bemerkung` wird als nullable kontrolliertes `play.matches.note` erhalten.
  `Dauer` wird nach vollstaendiger Quellanalyse als nullable
  `reserved_duration_minutes` uebernommen, sofern jeder nichtleere Wert eindeutig
  eine nichtnegative ganze Minutenzahl ist; ein abweichender Bestand blockiert
  diese Transformation bis zur expliziten Regel.
- Die derzeit reservierte `PTN-Wertung` bleibt verlustfrei als eigene nullable
  Textspalte `legacy_ptn_rating` ohne operative Fachwirkung erhalten. Bekannte
  Legacyfelder werden weder in ein gemeinsames JSON verschoben noch vorschnell
  als neue Fachlogik interpretiert. Ihr spaeteres Entfernen benoetigt einen
  eigenen Nachweisauftrag nach stabiler Migration.

#### Source-to-Target-Matrix `Matches1`

| Legacyfeld | PostgreSQL-Ziel | Transformationsvertrag |
|---|---|---|
| `ID` | `play.matches.contract_id` | gueltiger eindeutiger Legacywert unveraendert; interne UUID separat |
| `Ignore` | `play.matches.is_ignored` | `1` wird wahr, leer falsch; vom abgeleiteten Matchzustand getrennt |
| `BewerbID` | `play.matches.competition_id` | verpflichtende UUID-Fremdreferenz auf aufgeloesten Bewerb |
| `BewerbRunde` | `play.matches.round_code` | getrimmter kontrollierter Legacycode, keine Fortschreibungsableitung daraus |
| `MatchtypID` | gebundene `match_format_version_id` plus Herkunft | Override falls gesetzt, sonst Bewerbsstandard; Version wird am Match fixiert |
| `ForderungDate` | `play.matches.challenged_at` | leer oder eindeutiger Wiener Zeitpunkt als `timestamptz(3)` |
| `MatchDate` | `scheduled_at` oder bei W.O. `walkover_at` | nach heutiger Abschlusssemantik auf Plan- oder Ergebniszeitpunkt aufteilen |
| `Dauer` | `reserved_duration_minutes` | nullable nichtnegative ganze Minuten nach bestaetigter Quellanalyse |
| `Spieler1ID` bis `Spieler4ID` | Seiten und typisierte Teilnehmerslots | Personen-UUIDs; `PRE`, `BYE`, `[wo]` und `[ret]` nach den festgelegten Sonderregeln aufloesen |
| `Ergebnis` | aktuelle unveraenderliche Ergebnisversion und Satzzeilen | strikte Grammatik, kanonische Rueckprojektion und Formatvalidierung |
| `MatchStart` | `match_results.play_started_at` | nullable eindeutiger Zeitpunkt; gehoert zur Ergebnisversion |
| `MatchEnde` | `match_results.play_ended_at` | nullable eindeutiger Zeitpunkt; kein persistierter Legacyfallback |
| `ErgebnisErfasstAm` | `match_results.first_captured_at` | Zeitpunkt der ersten Aufnahme, bei Korrekturen unveraendert |
| `Spieler1RangBeiErgebnis` / `Spieler3RangBeiErgebnis` | Ergebnis-Rangsnapshots | nullable nichtnegative sichere Ganzzahl, an der Ergebnisversion dauerhaft |
| `PTN-Wertung` | `play.matches.legacy_ptn_rating` | nullable kontrollierter Legacytext ohne operative Wirkung |
| `Bemerkung` | `play.matches.note` | nullable kontrollierter Freitext; nicht in Betriebslogs |

Jedes importierte aktuelle Resultat wird gemaess dem festgelegten
`legacy_snapshot`-Vertrag genau einer initialen Ergebnisversion zugeordnet.
Unbekannte Matchspalten werden nicht stillschweigend in JSON uebernommen.

### 7.3 Ranglisten

Vorgesehene logische Tabellen:

- `play.ranking_entries`
- `play.ranking_changes`
- `play.ranking_change_items`
- `play.match_ranking_effects`

Mindestens folgende Integritaetsregeln werden in PostgreSQL erzwungen:

```text
UNIQUE (competition_id, person_id)
UNIQUE (competition_id, rank) WHERE status = 'active'
```

Matchabschluss, Rangverschiebung, KO-Fortschreibung, Fachereignis, Outbox und
Idempotenzabschluss muessen in einer gemeinsamen Transaktion entstehen koennen.
Die dabei tatsaechlich wirksam gewordenen Rang- und KO-Folgen sind Teil der
dauerhaften Ergebnishistorie. Gestartete, abgelehnte oder fehlgeschlagene Versuche
ohne bestaetigte Fachwirkung gehoeren ausschliesslich in das zeitlich begrenzte
Betriebsaudit.

`play.ranking_entries` enthaelt den aktuellen aktiven Rang beziehungsweise den
aktuellen Rausnahmezustand samt letzter Platzierung, Zeitpunkt und Fachgrund.
Ergebnisbedingte Vorher-/Nachher-Raenge werden unveraenderlich in
`play.ranking_changes`, `play.ranking_change_items` und
`play.match_ranking_effects` an die jeweilige Ergebnis-Historienoperation
gebunden und dauerhaft aufbewahrt.

Nicht ergebnisbedingte Rausnahmen, Rueckkehr oder administrative Korrekturen
aktualisieren den aktuellen Ranglistenstand transaktional, erzeugen aber keine
unbegrenzt aufzubewahrende Ranghistorie. Ihre Operationsdetails unterliegen dem
allgemeinen 12-Monats-Audit. Ein gegebenenfalls daraus erzeugtes neutrales
Fachereignis bleibt davon getrennt und konserviert nicht automatisch die
vollstaendige Rangdifferenz.

#### Source-to-Target-Matrix `RL-Platzierung`

| Legacyfeld | PostgreSQL-Ziel | Transformationsvertrag |
|---|---|---|
| optionale `ID` | `play.ranking_entries.contract_id` | vorhandener gueltiger Wert erhalten; bei leerer Quelle bleibt nur interne UUID |
| `BewerbID` | `competition_id` | verpflichtende aufloesbare UUID-Fremdreferenz |
| `PersonID` | `person_id` | verpflichtende aufloesbare UUID-Fremdreferenz; je Bewerb/Person eindeutig |
| `Rang` | `rank` und `status` | positive Ganzzahl wird `active`; 0 wird `withdrawn` und verlangt vollstaendige Rausnahmedaten |
| `RausgehangenAm` | `withdrawn_at` | fuer Status `withdrawn` verpflichtender eindeutiger Zeitpunkt |
| `RausgehangenLetztePlatzierung` | `last_active_rank` | fuer `withdrawn` verpflichtende positive Ganzzahl |
| `RausgehangenGrund` | `withdrawal_reason` | fuer `withdrawn` getrimmter Freitext 3 bis 500 Zeichen, nicht in Betriebslogs |

Bei aktiven Legacyzeilen vorhandene Rausnahmedaten bleiben fuer den heutigen
kontrollierten Rueckkehrvertrag am aktuellen Eintrag erhalten, werden aber nicht
oeffentlich projiziert. Nur ergebnisgebundene Rangwirkungen werden zusaetzlich
dauerhaft versioniert.

#### Source-to-Target-Matrix `Navigator`

| Legacyfeld | PostgreSQL-Ziel | Transformationsvertrag |
|---|---|---|
| optionale `ID` | `venue.navigation_presets.contract_id` | vorhandener gueltiger Wert erhalten; sonst interne UUID |
| `Name` | `label` | getrimmter kontrollierter Anzeigetext |
| `Ziel` | typisierter Navigationstyp und Parameter | gueltiges Ziel wird mit demselben geschlossenen Katalog kompiliert; keine beliebige URL |
| `Profil` | `profile_code` | getrimmter kontrollierter Code, leer wird heutiger Standard `1` |

Ein ungueltiges Navigatorziel blockiert den Tabellenimport nicht, weil auch der
heutige Vertrag es kontrolliert deaktiviert ausliefert. Die Vorgabe wird mit
`enabled=false`, kontrolliertem Problemcode und eng begrenztem
`legacy_target`-Text fuer Adminreparatur migriert, kann aber weder navigiert noch
an einen Monitor gesendet werden. Freie Zieltexte erscheinen nicht in Logs.


## 8. Anlagen, Hallenzeiten, Courts, Monitore und Scores

### 8.1 Anlagen und Courts

Vorgesehene logische Tabellen:

- `venue.sites`
- `venue.courts`
- `venue.score_sources`
- `venue.court_assignments`
- `venue.court_live_state`
- `venue.score_events`
- `venue.court_state_events`
- `venue.monitor_devices`
- `venue.monitor_commands`
- `venue.navigation_presets`

Die heutige feste Begrenzung auf Court `1` und `2` wird nicht als dauerhaftes
Schema-Constraint uebernommen.

Der Erstimport legt fuer den bestehenden Verein eine `venue.site` an. Jeder
Court besitzt eine interne UUID sowie einen innerhalb seiner Anlage eindeutigen,
unveraenderlichen `court_code`. Die vorhandenen Vertragscodes `1` und `2` bleiben
fuer bestehende APIs und Projektionen erhalten; die veraenderliche
Anzeigebezeichnung ist davon getrennt.

Neue Courts sind nicht auf zwei Eintraege oder rein numerische Codes begrenzt,
verwenden aber einen geschlossenen Laengen- und Zeichenvorratsvertrag. Externe
Scorequellen referenzieren die Court-UUID und speichern ihre eigene
Quellkennung separat. Eine spaetere Umstellung der Courtvertraege auf UUID wird
mit dem nachgelagerten API-/Frontendumbau entschieden, nicht im
Persistenzcutover.

`venue.court_assignments` fuehrt Matchzuweisungen als unveraenderliche
Zeitraeume mit Court, Match, `assigned_at` und nullable `released_at`. Partielle
Eindeutigkeitsconstraints erlauben hoechstens eine offene Zuweisung je Court und
je Match. Wechsel, Deaktivierung oder Freigabe schliessen die bisherige Periode,
statt sie zu ueberschreiben.

Scoreereignisse referenzieren nach Moeglichkeit die konkrete Assignment-UUID
und immer den Court. Aktivierung, Reset und Zuweisungswechsel erhoehen die
kontrollierte Court-Epoch beziehungsweise Revision. Historische Zuweisungen
bleiben als Bestandteil der dauerhaften Court-Scorehistorie erhalten; bestehende
APIs projizieren weiterhin nur den aktuellen Zeitraum.

`venue.court_live_state` persistiert Aktivstatus, acht kontrollierte
Scorekomponenten, externe Baseline, Wartezustand, Epoch und Revision. Ein
App-Neustart behaelt den letzten bestaetigten sichtbaren Stand. Bei normalem
Neustart erzeugt jede erste externe Abweichung vor ihrer Anzeige ein dauerhaftes
Scoreereignis und aktualisiert den Live-State in derselben Transaktion.

Nur nach ausdruecklicher Aktivierung oder Reset dient die erste gueltige
Quellantwort weiterhin ausschliesslich als neue Baseline; erst eine folgende
Abweichung wird sichtbar und protokolliert. Ohne erfolgreichen Commit von Event
und Live-State erfolgen weder WebSocket-Push noch sichtbare Aenderung. Ein Reset
ist ein eigener kontrollierter Zustandsvorgang und kein vorgetaeuschtes externes
Scoreereignis.

Akzeptierte externe Scoreaenderungen liegen ausschliesslich in
`venue.score_events`. Scorewirksame Bedien- und Zustandsaenderungen wie `reset`,
`activated`, `deactivated`, `assignment_started` und `assignment_ended` werden
als davon getrennte unveraenderliche `venue.court_state_events` gespeichert.
Diese kontrollierten Ereignisse enthalten nur Court, gegebenenfalls Assignment,
Zeit, Akteur, Ereignistyp und resultierende Revision, keine freie Payload.

Die minimalen Court-Steuerereignisse bleiben zusammen mit der dauerhaften
Scorehistorie ohne automatische Loeschfrist erhalten, damit Standwechsel
rekonstruierbar bleiben. Das ausfuehrlichere Operationsaudit derselben
Benutzeraktion unterliegt weiterhin der allgemeinen 12-Monats-Frist. Ein Reset
bleibt damit klar von einer extern gemessenen Scoreaenderung getrennt.

`venue.court_live_state` und `venue.score_events` speichern die acht
kanonischen externen Rohkomponenten fuer drei Satzspalten sowie Heim-/Gastpunkte
getrennt. Der bisherige Scorestring ist keine zweite autoritative Spalte, sondern
wird deterministisch daraus erzeugt. Werte ausserhalb des kontrollierten
Quelltokenvertrags blockieren den Import.

Eine Anzeigeumdeutung, insbesondere der dritten physischen Satzspalte als
Tie-Break-Zaehler, wird ausschliesslich aus der unveraenderlichen
Matchformatbindung der konkreten Courtzuweisung erzeugt und nicht als zweiter
Scorestand gespeichert. Ein daraus erzeugter Ergebnisvorschlag bleibt
editierbar und muss vor Speicherung erneut gegen Match und Matchformat validiert
werden.

Produktive Monitorgeraete uebernehmen beim Live-Cutover neben dem validierten
Token-Hash ihren letzten syntaktisch und fachlich gueltigen Zielzustand samt
Revision. Das Ziel liegt als geschlossener Navigationstyp mit kontrollierten
Parametern vor, nicht als beliebige URL. Ein ungueltiges oder nicht mehr
aufloesbares Ziel wird nicht geraten; der Monitor startet dann auf der sicheren
Standardseite und der Importbericht weist den kontrollierten Problemcode aus.

Historische einzelne Navigationscommands werden nicht als dauerhafte
Fachhistorie importiert. Neue Commands bleiben bis zur Bestaetigung erhalten und
danach 30 Tage fuer Retry und Diagnose; die ausloesende Benutzeroperation folgt
der allgemeinen 12-Monats-Auditfrist. Bestehende Monitoransicht und
Fernsteuerungsbedienung bleiben unveraendert.

Der finale Live-Export ist nur zulaessig, wenn alle Courts kontrolliert
deaktiviert und alle offenen Matchzuweisungen geschlossen sind. Ein aktiver,
pollender oder nicht eindeutig aufloesbarer Court blockiert den Cutover. Der
letzte akzeptierte sichtbare Stand und die bisherige Scorehistorie werden
uebernommen; PostgreSQL startet mit deaktivierten Courts und ohne offene
Zuweisung.

Nach Writefreigabe werden benoetigte Matches bewusst neu zugewiesen und Courts
aktiviert, wodurch neue Assignment-Zeitraeume und Steuerereignisse entstehen.
Der Cutover muss deshalb ausserhalb laufender Platzspiele stattfinden und darf
keinen externen Quellstand waehrend des Drains zu erfassen versuchen.

### 8.2 Hallenzeiten

Der JSON-State `hall-times:v1` wird relational normalisiert:

- `venue.hall_time_grids`
- `venue.hall_time_grid_participants`
- `venue.hall_time_slots`
- `venue.hall_time_allocations`
- `venue.hall_time_constraints`
- `venue.hall_time_history`
- `venue.hall_time_history_items`

Erhalten bleiben:

- Raster-ID, Name, Beschreibung und Modus;
- Aktivstatus und oeffentliche Beitrittsfreigabe;
- Kapazitaet, Wartelistenaktivierung und persoenliches Wartelistenlimit;
- Fair-Use-Parameter;
- Teilnehmer;
- chronologische Termine;
- Fix- und Wartelisteneintraege;
- Queuezeit;
- Einzel- und Batchhistorie;
- unveraenderliche Slot-Snapshots in Historieneintraegen.

Alle im Quellpaket vorhandenen Hallenzeiten-Historienvorgaenge werden
uebernommen. Fuer den laufenden PostgreSQL-Betrieb bleibt die heutige Grenze von
10.000 vollstaendigen Historienvorgaengen je Raster bestehen. Ein automatischer
Verteilungsbatch zaehlt als ein Vorgang; Kopf und zugehoerige Items werden immer
gemeinsam behalten oder gemeinsam entfernt.

Die Bereinigung entfernt ausschliesslich die aeltesten vollstaendigen Vorgaenge
und veraendert weder aktuellen Slotzustand noch Vergaben. Strukturierte
Abschlusslogs enthalten nur Raster-ID, Grenzwert und Anzahlen, keine Namen oder
freien Personenwerte.

Rasterkonfiguration und einzelne Termine besitzen getrennte optimistische
Revisionen. Eine normale An-/Abmeldung sperrt und prueft nur Rasterteilnahme,
Zielslot und betroffene Vergaben anhand der `slot_revision`. Aenderungen an
verschiedenen Slots duerfen parallel committen, ohne sich durch eine globale
JSON-Revision gegenseitig abzulehnen.

Strukturelle Rasteraenderungen und automatische Gesamtverteilungen verwenden
einen exklusiven Raster-Lock und schreiben alle betroffenen Slots und
Historienitems atomar. Eine zusaetzliche monotone `projection_revision` je Raster
dient ausschliesslich WebSocket-Invalidierung und Snapshot-Cursor, nicht als
globaler Compare-and-set-Schluessel fuer Einzelbuchungen. Darstellung und
Bedienablauf bleiben gleich; Konflikte werden genauer auf den betroffenen Termin
begrenzt.

`venue.hall_time_allocations` enthaelt je Slot und Person hoechstens einen
aktuellen Eintrag mit Status `confirmed` oder `waiting`. Eine
Wartelistenposition wird nicht redundant gespeichert, sondern eindeutig aus
`queued_at` und der stabilen Allocation-ID als Tie-Breaker abgeleitet.

Wird ein Fixplatz frei, sperrt dieselbe Transaktion den Zielslot und die
relevanten Wartelisteneintraege und stuft den aeltesten Wartenden atomar hoch.
Kapazitaet, Fair-Use und persoenliches Wartelistenlimit werden vor dem Commit
geprueft. Verhinderungs- und Vermeidungswuensche liegen getrennt in
`venue.hall_time_constraints` mit den geschlossenen Werten `unavailable` und
`avoid`; historische Vorher-/Nachher-Zustaende bleiben in den History-Items.

Das heutige Hallenzeitenmodell wird nicht ungeprueft mit einem spaeteren
allgemeinen Platzreservierungssystem vermischt. Eine allgemeine Reservierung
erhaelt spaeter eigene Tabellen und Konfliktconstraints.

### 8.3 Vollstaendige Live-Score-Persistenz

PostgreSQL speichert kuenftig neben der Scorehistorie auch den zuletzt von ePiber
akzeptierten sichtbaren Zustand:

- Court-ID;
- Match- und Bewerbsbezug;
- sichtbarer Score;
- Aktivstatus;
- Baseline;
- Epoch;
- Revision;
- Zeitpunkt des letzten akzeptierten Quellstands;
- Zustand der externen Quelle.

Die externe Courtquelle bleibt Ursprung neuer Messwerte. PostgreSQL wird
Autoritaet dafuer, welchen Zustand ePiber akzeptiert und angezeigt hat.

Scoreereignisse behalten Event-ID, Court-Sequenz, Quellzeit, Rohscore,
Matchbezug und Court-Revision. Mindestens `(court_id, sequence)` bleibt
eindeutig.

Beim kombinierten Import erhaelt jeder Court eine neue kanonische lueckenlose
`court_sequence` in deterministischer Zeitreihenfolge; neue Liveevents setzen sie
atomar fort. Urspruengliche SQLite-Sequenz, Sheet-Zeilenschluessel, Quellzeit,
Quelltyp und Quellpruefsumme bleiben getrennt als Importprovenienz erhalten und
werden nicht als gemeinsam vergleichbarer Nummernraum ausgegeben.


## 9. Messaging, Outbox, Jobs und Audit

### 9.1 Messaging

Vorgesehene logische Tabellen:

- `messaging.events`
- `messaging.event_participants`
- `messaging.event_recipients`
- `messaging.receipts`
- `messaging.deliveries`
- `messaging.comments`
- `messaging.reactions`
- `messaging.user_revisions`
- `messaging.notification_preferences`

Spaetere Notifications koennen ergaenzen:

- `messaging.push_devices`
- `messaging.reminder_jobs`
- `messaging.delivery_attempts`

Fachwrite, zentrales Ereignis, Empfaengerprojektion und Outbox-Eintrag muessen
gemeinsam gespeichert werden koennen. Externe Zustellung findet erst nach Commit
durch einen Worker statt und rollt den Fachwrite bei einem externen Fehler nicht
zurueck.

`messaging.event_participants` bildet die minimale fachliche Beteiligung am
neutralen Ereignis dauerhaft und getrennt von der persoenlichen Inbox ab. Sie
enthaelt Personreferenz, damalige Vertrags-ID, getrennten Vornamen-/Nachnamen-
Snapshot und geschlossene Teilnehmerrolle. Spaetere Namens- oder
Rollenveraenderungen schreiben diese Beteiligung nicht um.

`messaging.event_recipients` enthaelt dagegen die persoenliche Inboxprojektion
mit Template-/Legacytextbezug. Recipients, Receipts und Deliveries unterliegen
der 24-Monats-Frist; ihr Entfernen darf weder `events` noch
`event_participants` loeschen. Ergebnisereignisse referenzieren fuer fachliche
Details das autoritative Ergebnisjournal und duplizieren es nicht als freie
Messagingpayload.

Neue Ereignisse und persoenliche Projektionen speichern autoritativ einen
geschlossenen Ereignistyp, `template_key`, `template_version` und validierte
strukturierte Fachparameter. Personen-Snapshots halten damalige Vertrags-ID,
Vorname und Nachname getrennt fest. Dadurch kann ein zentraler Namensformatter
spaeter die reine Anzeigereihenfolge aendern, ohne historische Fakten oder
Personennamen in der Datenbank umzuschreiben.

Die gespeicherte Template-Version fixiert die damalige fachliche Formulierung;
neue Textvorlagen wirken nicht unbeabsichtigt auf alte Ereignisse. Freie
Fachtexte wie ausdrueckliche Admin-Gruende und Kommentare bleiben als solche
gespeichert, aber von kontrollierten Templateparametern getrennt. Bestehende
Legacy-Betreff-/Textwerte, die nicht verlustfrei strukturiert werden koennen,
bleiben als unveraenderlicher Render-Fallback erhalten und werden nicht
heuristisch zerlegt.

Gerenderte Meldungstexte sind fuer neue Ereignisse keine zweite autoritative
Wahrheit. Logs, Outbox-Weckhinweise und Betriebsmetriken enthalten nur IDs,
Ereignis-/Templateversionen, Status und Zaehler, keine freien Meldungstexte.

Das heutige Personenfeld `Notification` wird in
`messaging.notification_preferences` normalisiert. Je Person und geschlossenem
Kanal `email` beziehungsweise `whatsapp` besteht hoechstens eine aktivierte
Praeferenzzeile; der Pipe-getrennte Legacytext wird nicht operativ fortgefuehrt.
Inbox bleibt ohne Praeferenzzeile immer aktiv, und Kontakt-E-Mail bleibt davon
getrennt in `identity.person_contacts`.

Leere oder nach dem heutigen Vertrag ungueltige Werte erzeugen keine externe
Kanalpraeferenz und bleiben nur in der Importprovenienz nachvollziehbar. Die
Migration aktiviert weder E-Mail- noch WhatsApp-Zustellung; beide bleiben bis
zum spaeteren Notification-Auftrag kontrolliert `not_configured`.

Kommentare unterliegen keiner allgemeinen automatischen Fachretention. Eine
ausdrueckliche administrative Endloeschung entfernt jedoch Kommentartext,
Autoren-Namenssnapshot und alle Kommentarreaktionen dauerhaft. Zur relationalen
Konsistenz bleibt ein datensparsamer Tombstone mit Kommentar-ID, Ereignis-ID,
Erstellungszeit, Loeschzeit und kontrolliertem Loeschstatus bestehen.

Der Tombstone enthaelt weder freien Text noch Reaktions-, Personen- oder
Moderationsgrunddaten. Das detailliertere Operationsaudit der Loeschung
unterliegt der allgemeinen 12-Monats-Frist. Bestehende Projektionen behandeln den
Tombstone wie heute als nicht vorhandenen Kommentar.

### 9.2 Idempotenz und Jobs

Vorgesehene logische Tabellen:

- `ops.idempotency_operations`
- `ops.jobs`
- `ops.outbox`

Eine Idempotenzoperation bindet Akteur, Operation-ID, Endpoint beziehungsweise
Command, Request-Hash, Status und kontrolliertes Ergebnis. `unknown` bleibt fuer
wirklich unklare externe oder Commit-Ausgaenge erhalten, wird fuer rein lokale
erfolgreiche PostgreSQL-Transaktionen aber wesentlich seltener benoetigt.

Die vollstaendige kontrollierte Antwortprojektion einer terminalen
Idempotenzoperation bleibt 24 Stunden abrufbar. Danach wird nur diese
Antwortprojektion entfernt; ein minimaler Tombstone aus Akteur, Operation-ID,
Command, Request-Hash und Endstatus bleibt entsprechend dem Betriebsaudit 12
Monate erhalten. Eine Wiederholung innerhalb dieser Zeit wird nicht erneut
ausgefuehrt, sondern nach Ablauf des Antwortfensters kontrolliert als bekannte
abgelaufene Operation abgewiesen.

Ergebnisbezogene Fachjournale speichern ihre Operation-ID zusaetzlich dauerhaft
und eindeutig. Eine `started`-Operation wird niemals allein wegen ihres Alters
geloescht: Ein Recoverylauf klaert sie zu `success`, `failed` oder `unknown` und
alarmiert bei Ueberfaelligkeit. Ein nicht aufloesbares `unknown` bleibt innerhalb
der Auditfrist nicht wiederholbar.

Idempotenzoperationen sind keine Arbeitswarteschlange. Offene Jobs und
Outbox-Eintraege werden nicht durch die Idempotenzretention erfasst und duerfen
nicht altersbedingt verschwinden; sie bleiben bis Verarbeitung, ausdruecklichem
kontrolliertem Abbruch oder einem dauerhaften Fehlerzustand bestehen.

Jobs tragen mindestens:

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

Fuer die erste Stufe genuegt ein einzelner Worker mit begrenzter Parallelitaet.
Eine verteilte Workerflotte ist noch nicht erforderlich.

Dieser erste Worker laeuft als eigener Prozess beziehungsweise systemd-Dienst auf
demselben Host wie die Development-App. App und Worker verwenden dasselbe
versionierte Artefakt mit getrennten Startmodi, Serviceidentitaeten,
PostgreSQL-Rollen, kleinen Connection Pools, Ressourcenlimits, Readiness- und
Shutdownvertraegen. Ein In-Process-Worker im HTTP-/WebSocket-Backend ist nicht
vorgesehen.

Der Worker beansprucht faellige Jobs mit zeitlich begrenztem Lease und
`FOR UPDATE SKIP LOCKED`, verarbeitet nur registrierte versionierte Jobtypen und
schliesst jeden Versuch mit kontrolliertem Status und Fehlercode ab. Prozess- oder
Hostneustarts duerfen keine Jobs verlieren; abgelaufene Leases werden
wiederaufnehmbar. Externe Nebenwirkungen bleiben idempotent beziehungsweise
erhalten bei nicht beweisbarem Ausgang einen ausdruecklichen `unknown`-Pfad.

Outbox und externe Nebenwirkungen verwenden einen ausdruecklichen
At-least-once-Vertrag. Jede Wirkung besitzt einen stabilen Idempotenzschluessel;
der Worker markiert erst nach bestaetigter externer Wirkung als abgeschlossen.
Bei verlorenem Antwortausgang wird ueber Anbieter-ID beziehungsweise
Idempotenzschluessel reconciled. Ein danach nicht beweisbarer Ausgang wird
`unknown` und nicht blind erneut gesendet.

Ein externer Anbieter ohne Idempotenz- oder Statusabfrage benoetigt vor
Produktivaktivierung einen ausdruecklichen Duplikat- und Fehlervertrag. Interne
WebSocket-Invalidierungen duerfen mehrfach eintreffen und werden anhand ihrer
autoritativen Revision dedupliziert. Eine systemuebergreifende Exactly-once-
Garantie wird nicht behauptet.

Erfolgreich verarbeitete Outbox-Eintraege bleiben nach Abschluss 30 Tage
erhalten. Erfolgreich abgeschlossene oder kontrolliert abgebrochene Jobs bleiben
90 Tage erhalten. Dauerhaft fehlgeschlagene `dead` Jobs werden bis zur
ausdruecklichen Klaerung nicht bereinigt und bleiben nach dieser Klaerung weitere
12 Monate als Betriebsnachweis bestehen.

Einzelne Jobversuche speichern nur kontrollierte Status, Fehlercodes, Zaehler und
Dauern, keine freien externen Antworten oder Payloads. `pending`, `leased`,
`retrying` und unaufgeloeste Eintraege werden niemals altersbedingt geloescht.
Messaging-Zustellungen, Fachereignisse und Ergebnisjournale folgen unabhaengig
ihren eigenen Retentionsvertraegen.

### 9.3 Audit

Empfohlen ist die logische Trennung in:

- `ops.audit_operations` fuer den aktuellen zusammengefassten Zustand;
- `ops.audit_transitions` fuer append-only Start- und Abschlussphasen.

Die Semantik `started -> success|failed|unknown` bleibt erhalten. Kontrollierte
Vorher-/Nachher-Projektionen duerfen als validiertes `jsonb` gespeichert werden;
freie Fachpayloads, Passwoerter und Tokens bleiben ausgeschlossen.

Der Auditstart wird vor der Fachmutation in einer kurzen eigenen Transaktion als
Operation und append-only `started`-Transition persistiert. Bei Erfolg entstehen
Fachmutation, abhaengige Ergebnis-/Ranking-/KO-Wirkung, Fachereignis, Outbox,
Idempotenzresultat, zusammengefasster Auditstatus und append-only
`success`-Transition in derselben Fachtransaktion. Dadurch kann ein erfolgreicher
Fachwrite nicht ohne seinen kontrollierten Auditabschluss committen.

Eindeutige Validierungs- oder Fachablehnungen schliessen die zuvor gestartete
Operation in einer eigenen kurzen Transaktion als `failed`. Bei verlorenem
Commit-Ausgang wird zuerst ueber Operation-ID und gespeichertes
Idempotenzresultat nachgelesen; nur ein danach weiterhin nicht aufloesbarer
externer oder Commit-Ausgang wird `unknown`. Allgemeine Auditoperationen und
-transitionen unterliegen der 12-Monats-Retention, waehrend bestaetigte
Ergebniswirkungen unabhaengig davon dauerhaft im Fachjournal liegen.

Quell-IP-Adressen von Login- und Sicherheitsoperationen werden innerhalb dieser
Frist vollstaendig kanonisch als PostgreSQL-`inet` gespeichert, aber durch eigene
Spaltenrechte und eng begrenzte Admin-/Supportprojektionen geschuetzt. Normale
Ausgaben maskieren den Wert; eine vollstaendige Aufloesung verlangt eine
ausdruecklich kontrollierte privilegierte Aktion.

IPs erscheinen weder in Anwendungslogs, Metriklabels, Outbox noch dauerhaften
Ergebnisjournalen und werden mit dem 12-Monats-Audit geloescht. Rate-Limit-
Schluessel bleiben unabhaengig davon keyed-gehasht und enthalten keinen
aufloesbaren IP-Klarwert.

Syntaktisch gueltige kanonische versuchte Logins duerfen fuer denselben
12-Monats-Zeitraum in einer ebenfalls spaltenrechtlich geschuetzten Auditspalte
stehen und werden in normalen Projektionen maskiert. Ungueltige Login-Rohtexte,
Kontakt-E-Mail-Fallbacks und Passwortdaten werden nicht gespeichert. Die
Retention entfernt Login und IP gemeinsam mit der Auditoperation.


## 10. Zeit- und Datentypen

Fuer eindeutige fachliche Zeitpunkte gilt:

- Speicherung standardmaessig als millisekundengenaues `timestamptz(3)`;
- intern eindeutige UTC-Zeit;
- Eingabe und Anzeige standardmaessig in `Europe/Vienna`.

Die Millisekundenpraezision entspricht Node.js-`Date`, bestehenden Unixwerten
und den genauesten Legacyquellen. PostgreSQL-seitige Zeitstempel werden auf diese
Praezision begrenzt, damit Roundtrips, kanonische Projektionen und Pruefsummen
nicht durch spaeter im JavaScript verlorene Mikrosekunden abweichen. Bei gleichem
Millisekundenzeitpunkt sichern UUIDv7, Sequence oder explizite Revision die
stabile Reihenfolge.

Reine Kalendertage wie Geburtsdaten bleiben `date`. Wiederkehrende lokale
Uhrzeiten werden getrennt von absoluten Zeitpunkten modelliert.

Bestehende Formate wie `YYMMDD-HHMM` werden kontrolliert konvertiert. Ungueltige
oder bei Sommer-/Winterzeit nicht eindeutig interpretierbare Werte werden nicht
geraten und blockieren bis zur freigegebenen Korrektur den finalen Import.

Fuer zweistellige Legacyjahre bleibt der heutige Pivot verbindlich: `50` bis
`99` werden 1950 bis 1999, `00` bis `49` werden 2000 bis 2049. Die angewendete
Regelversion steht in der Importprovenienz; PostgreSQL speichert danach nur den
vollstaendig aufgeloesten typisierten Wert. Eine spaetere Aenderung des
Eingabeformats schreibt importierte Zeitpunkte nicht um.

Die Konvertierung ist strikt und verlustfrei:

- Jeder lokale Zeitpunkt wird gegen `Europe/Vienna` kalendarisch validiert und
  nur bei genau einer gueltigen UTC-Zuordnung als `timestamptz(3)` uebernommen.
- Nicht existierende Uhrzeiten in der Fruehjahrsumstellung und doppeldeutige
  Uhrzeiten in der Herbstumstellung erhalten einen kontrollierten Problemcode
  und keine automatisch gewaehlte Offsetvariante.
- Reine Datumswerte in Bewerbsgrenzen bleiben als datumsgenaue Fachwerte
  erkennbar. Die Migration erfindet weder Mitternacht noch Tagesende oder eine
  andere Standarduhrzeit. Das Zielschema muss Datum und Zeitpraezision eindeutig
  abbilden.
- Geburtsdaten und andere echte Kalendertage werden als `date` gespeichert.
- Der unveraenderte Quellwert und die angewendete Konvertierungsregel bleiben in
  der geschuetzten Importprovenienz nachvollziehbar, nicht als zweiter
  operativer Fachwert.
- Anzeige und Eingabe verwenden weiterhin standardmaessig `Europe/Vienna`; die
  Datenbank- und Prozessverarbeitung eindeutiger Zeitpunkte verwendet UTC.

PostgreSQL-only App, Worker, Migration Runner, Importer und automatisierte Tests
laufen mit `TZ=UTC`. Wiener Datum-/Uhrzeiteingaben werden ausschliesslich durch
einen zentralen expliziten `Europe/Vienna`-Konverter verarbeitet; Ausgabe
formatiert anhand der Tenant-Zeitzone. Reine Kalendertage werden ohne
JavaScript-Lokalzeit behandelt.

Der heutige implizite systemd-Wert `TZ=Europe/Vienna` wird mit dem Devel-Cutover
entfernt. DST-Luecken und doppelte lokale Zeiten pruefen denselben zentralen
Vertrag. Browser-, Repository- und Projektionsparitaetstests muessen nachweisen,
dass sichtbare Wiener Zeiten trotz UTC-Prozess unveraendert bleiben.

Die Arch-Node-Laufzeit `v26.9.0` stellt entgegen der allgemeinen Node-26-
Ankuendigung auf diesem Host kein `globalThis.Temporal` bereit. Der zentrale
Backend-Konverter verwendet deshalb eine exakt gepinnte Version von
`@js-temporal/polyfill` hinter einem eigenen ePiber-Zeitmodul und fuer lokale
Zeitpunkte `disambiguation: 'reject'`.

Anwendungscode greift nicht direkt auf ein spaeter eventuell vorhandenes globales
Temporal zu. Ein Wechsel vom Polyfill auf eine native Implementierung erfolgt
nur nach vollstaendigem Paritaetstest fuer Normalzeit, beide DST-Uebergaenge,
Datumsgrenzen und Legacyformate. Autoritative Konvertierung bleibt im Backend;
Browser erhalten eindeutige ISO-Werte beziehungsweise reine Kalendertage.

Weitere Grundregeln:

- Ein technischer `imported_at`- oder Datenbank-Insertzeitpunkt wird niemals als
  unbekannter fachlicher `created_at`, Vergabe-, Eintritts- oder
  Ereigniszeitpunkt ausgegeben. Ist ein Legacyzeitpunkt nicht belegt, bleibt das
  fachliche Feld nullable und die Importprovenienz fuehrt den technischen Lauf
  getrennt.
- Datenbank und technische Spalten fuer IDs, Logins, Codes, Hashes und
  Operationen verwenden eine deterministische `C`- beziehungsweise
  `C.UTF-8`-Kollation. Sprachabhaengige Kollation darf weder technische
  Eindeutigkeit noch Importpruefsummen bestimmen.
- Ausdruecklich alphabetische Namensansichten sortieren mit einer benannten
  PostgreSQL-ICU-Kollation fuer `de-AT` und immer mit einer stabilen Vertrags-ID
  als letztem Tie-Breaker. Fachliche `sort_order`, Rang, Slot- oder
  Ereignisreihenfolge bleiben vorrangig und werden nicht durch Namenskollation
  ersetzt.
- Das Updateverfahren prueft die ICU-Kollationsversion und fuehrt bei einer
  Aenderung kontrolliertes Reindexing und Projektionsvergleiche aus.
- PLZ, Telefonnummern und externe IDs bleiben Text.
- SHA-256-Werte fuer Session-/Geraetetokens, Requests, Payloads und
  Pruefkorrelation werden als `bytea` mit exakt 32 Bytes gespeichert, nicht als
  redundanter 64-stelliger Hextext. Import und Repositorygrenzen dekodieren
  beziehungsweise kodieren kontrolliert; Hashbytes erscheinen nicht in Logs.
  Formatierte Hex-/Base64darstellung ist nur fuer explizite technische
  Pruefprojektionen zulaessig.
- Aktivitaet wird als Boolean oder kontrollierter Status gespeichert.
- `jsonb` wird nur fuer versionierte Konfiguration, kontrollierte Snapshots und
  technische Metadaten verwendet, nicht als Ersatz fuer Kernrelationen.
- PostgreSQL-native Enums werden zurueckhaltend eingesetzt, damit
  Expand/Contract-Migrationen moeglich bleiben.
- Fachliche Fremdschluessel verwenden standardmaessig `ON DELETE RESTRICT`.
  Personen, Bewerbe, Matches, Courts und Ereignisse werden im regulaeren Betrieb
  deaktiviert oder geschlossen, nicht physisch geloescht. Dauerhafte
  Ergebnisversionen, Teilnehmersnapshots, Scoreereignisse und Fachjournale
  besitzen keine Loeschkaskade von aktuellen Stammobjekten.
- `ON DELETE CASCADE` ist nur fuer ausdruecklich kurzlebige, vollstaendig
  besitzabhaengige Daten nach dokumentierter Fachentscheidung zulaessig.
  Retentionjobs und Endloeschungen entfernen ihre abgegrenzten Daten explizit in
  kontrollierter Reihenfolge und protokollieren nur IDs, Anzahlen und Status.
  Jede Cascade-Ausnahme wird im Schemaentwurf begruendet und getestet.


## 11. Source-to-Target-Zuordnung

### 11.1 Google Sheets

| Quelle | Zielbereich |
|---|---|
| `Personen` | `identity.people`, externe IDs, Mitgliedschaften, Konten, Credentials und Rollen |
| `Bewerb` | `play.competitions` |
| `Bewerbsart` | `play.competition_types` |
| `Matchtyp` | `play.match_formats` |
| `Matches1` | Matches, Seiten, Teilnehmer, Ergebnisse, Sets und Fortschreibung |
| `RL-Platzierung` | Ranglisteneintraege und historische Status-/Aenderungsdaten |
| `Navigator` | kontrollierte Navigationsvorgaben |
| `EntryList` | `play.competition_entries` |
| historisches `ScoreLog` | zusaetzliche alte Scoreereignisse, soweit nicht durch SQLite autoritativ abgedeckt |
| historisches `Logging` | ausschliesslich vollstaendiges geschuetztes Quellarchiv |

### 11.2 `state.sqlite`

| Quelle | Zielbehandlung |
|---|---|
| `sessions` | beim Cutover nicht uebernehmen; alle Benutzer melden sich neu an |
| `monitor_devices` | Live-Token-Hashes und Geraetestatus kontrolliert migrieren |
| `operations` | nur eindeutig transformierbare, terminale und beim Export noch nicht abgelaufene 24-Stunden-Idempotenzresultate; offene/`unknown` blockieren |
| `login_failures` | nicht migrieren; kontrollierter Neustart des Kurzzeitlimits |
| `court:*` | relationale Court-Zuweisung und Live-State |
| `monitor-target:*` | Monitorcommands beziehungsweise letzter kontrollierter Zielstate |
| `favorites:*` | persoenliche Favoritenrelationen |
| `start-page:*` | persoenliche Startseitenkonfiguration |
| `frontend-logging:*` | kontrollierte Diagnosekonfiguration |
| `hall-times:v1` | normalisierte Hallenzeiten-Tabellen |
| `match-result-ranking:*` | relationale Match-/Ranglisteneffekte und Provenienz |
| `record-metadata-intent:*` | nicht als Zielmodell uebernehmen; alle offenen Intents vor Cutover klaeren |
| sonstige Recovery-Plaene | fachlich aufloesen oder in explizite Migrations-/Operationszustaende ueberfuehren |

Unbekannte `app_state`-Keys blockieren die Migration, bis sie einer
Zielbehandlung zugeordnet sind.

Legacyoperationen mit `started`, offenem oder `unknown` Ausgang muessen vor dem
finalen Export fachlich aufgeloest sein. Noch nicht abgelaufene terminale
Operationen werden nur uebernommen, wenn Command, Akteur, Request-Hash und
kontrolliertes Ergebnis eindeutig in `ops.idempotency_operations`
transformierbar sind; andernfalls blockieren sie den Cutover. Abgelaufene
terminale Resultate bleiben ausschliesslich im Quellarchiv.

Die uebernommenen Antwortprojektionen behalten nur ihre verbleibende
24-Stunden-Restlaufzeit und wechseln danach in den festgelegten minimalen
Tombstonevertrag. Dauerhafte Fachwirkungen stammen unabhaengig davon aus den
Fachobjekten und -journalen, nicht aus alten Operationsresultaten.

Bekannte Nicht-`app_state`-Tabellen werden feldgenau behandelt:

| SQLite-Feld | PostgreSQL-Ziel / Behandlung |
|---|---|
| `sessions.sid_hash`, Benutzer-/Login-Snapshot und Zeiten | kein Import; alle Cookies werden ungueltig, Kontakt-E-Mail-Snapshot entfaellt |
| `monitor_devices.monitor_id` | `venue.monitor_devices.contract_id`, unveraendert und eindeutig |
| `monitor_devices.label` | kontrollierte Geraetebezeichnung |
| `monitor_devices.token_hash` | validierter eindeutiger Live-Hash; niemals Klartexttoken |
| `monitor_devices.created_at`, `updated_at`, `last_seen_at`, `revoked_at` | millisekundengenaue `timestamptz(3)`-Felder nach Statusvertrag |
| `operations.actor_key`, `operation_id`, `endpoint`, `payload_hash` | aufgeloeste Akteur-/Command-/Hashfelder nur fuer unexpired terminale Operationen |
| `operations.result_json` | validierte geschlossene Antwortprojektion, kein freies JSON; Restlaufzeit hoechstens 24 Stunden |
| `operations.created_at` | technischer Operationszeitpunkt als `timestamptz(3)` |
| `login_failures.*` | kein Import; neue gehashte Limits starten leer |

Ein Monitor-Hash mit unbekanntem Format, Dublette oder widerspruechlichem
Widerrufsstatus blockiert seine Aktivierung und verlangt kontrollierte
Neuprovisionierung. Er wird nicht stillschweigend als gueltiges Geraet
uebernommen.

Es wird keine generische PostgreSQL-Nachfolgetabelle fuer `app_state` angelegt.
Alle bekannten Schluessel werden bereits in der Erstmigration vollstaendig ihren
Fachdomaenen zugeordnet:

- Courts, Zuweisungen, Live-State und Monitorziele nach `venue`;
- Favoriten und Startseite in personengebundene, geordnete beziehungsweise
  eindeutige Konfigurationsrelationen;
- Frontend-Logging-Einstellungen und zeitlich begrenzte Zielpersonen in getrennte
  kontrollierte Konfigurationstabellen;
- Hallenzeiten in Raster, Teilnehmer, Slots, Vergaben und Historie;
- Ergebnis-Rangprovenienz in `play.match_ranking_effects` und dauerhafte
  Ergebniswirkung;
- Recovery und Idempotenz in explizite `ops`-Tabellen und Jobs.

`jsonb` bleibt fuer explizit versionierte Konfiguration, begrenzte technische
Metadaten und kontrollierte Snapshots wie `displayRules` zulaessig. Fachliche
Kernrelationen, Personen-/Matchreferenzen und frei wachsende Domaenenmodelle
duerfen nicht als generische Key-/Value-Dokumente fortgefuehrt werden.

Bei Frontenddiagnosen wird `frontend-logging:settings` als gueltige globale
kontrollierte Konfiguration relational uebernommen. Zeitlich begrenzte
personenbezogene Eintraege aus `frontend-logging:targets` werden beim Cutover
nicht fortgefuehrt, auch wenn ihre bisherige Ablaufzeit noch nicht erreicht ist.
Ein Admin muss ein weiterhin benoetigtes Ziel danach bewusst neu aktivieren.

Der Importbericht enthaelt nur die Anzahl verworfener Diagnoseziele, keine
Personen-IDs oder Debugdetails. Neue Ziele folgen wieder dem bestehenden
zeitlichen Diagnose-, Allowlist-, Audit- und Datenschutzvertrag.

### 11.3 Weitere SQLite-Dateien

- `messaging.sqlite` wird relational in `messaging` uebernommen.
- `scorelog.sqlite` wird in die Scorehistorie uebernommen und ist bei sicher
  erkannten Ueberschneidungen mit dem alten Sheet-ScoreLog autoritativ.
- `audit.sqlite` wird nach der festgelegten Retention in das neue Auditmodell
  uebernommen.


## 12. Historische Daten und Retention beim Erstimport

### 12.1 Vollstaendiges Quellarchiv

Unabhaengig von der operativen Retention wird der finale Ausgangsstand
vollstaendig archiviert:

- native Spreadsheet-Kopie;
- API-Export einschliesslich Developer Metadata;
- lesbare Exporte aller Tabs;
- alle vier SQLite-Dateien in konsistentem Zustand;
- Schema- und Quellmetadaten;
- Manifest und kryptografische Pruefsummen.

Exporter und Importer sind getrennte Werkzeuge. Der Exporter erzeugt nach
Schreibstopp beziehungsweise aus einer nachweislich konsistenten Quelle genau ein
unveraenderliches, verschluesseltes Quellpaket. Das Manifest bindet mindestens
Exportlauf-ID, Quellsysteme und -versionen, Exportstart/-ende, Dateien,
Dateigroessen, SHA-256-Pruefsummen, Sheet-Tabs und Developer-Metadata-Umfang sowie
die SQLite-Schemastaende. Es enthaelt keine Credentials oder freien
Personenwerte.

Analyse, Dry Run, Transformation, Wiederholung und finaler Import arbeiten nur
auf einem erfolgreich verifizierten Quellpaket und greifen nicht parallel erneut
auf Google Sheets oder laufende SQLite-Dateien zu. Jede Quellaenderung erfordert
ein neues Paket mit neuer Exportlauf-ID. Dadurch bleiben Berichte,
Transformationsregeln und Zielpruefsummen eindeutig an denselben Ausgangsstand
gebunden.

Auch ein reales Staging-Quellpaket entsteht unter einem angekuendigten kurzen
Legacy-Write-Freeze. Neue Fachwrites werden kontrolliert abgewiesen, waehrend
Reads verfuegbar bleiben. Laufende Writes drainieren; offene Recoveryplaene und
Auditoperationen werden geklaert, SQLite-WALs checkpointed und Sheets frisch
geladen.

Vorher-/Nachherfingerprints der Sheetquellen, SQLite-Schemastaende und die
gemeinsame Exportlauf-ID muessen denselben unveraenderten Quellstand bestaetigen.
Bei Aenderung oder unklarem Vorgang wird das Paket verworfen und der Export
wiederholt. Nach erfolgreicher Paketpruefung endet der Freeze und der
Legacybetrieb nimmt Writes wieder an. Der finale Live-Export bleibt davon
unabhaengig unter der vollstaendigen Wartungsseite.

Das Archiv wird ausschliesslich als clientseitig verschluesseltes Objekt in einem
eigenen Scaleway-Archivbucket abgelegt. Dieser Bucket ist von Devel- und Live-
pgBackRest getrennt, fuer App, Worker und Backuprollen unzugreifbar und verwendet
Object Lock im Modus Compliance mit 370 Tagen Bindung. Das Quellarchiv wird nicht
erneut in PostgreSQL oder regulaere Backupketten aufgenommen.

Das Quellpaket wird als deterministischer manifestgebundener Tar-Datenstrom
komprimiert und mit `age` fuer einen dedizierten X25519-Archivempfaenger
verschluesselt. Der Exporter besitzt nur den oeffentlichen Empfaengerschluessel;
der private Archivschluessel liegt ausschliesslich im vom Host, Git, PostgreSQL
und Scaleway getrennten Offline-Recoveryweg.

Vor Upload werden Klartextmanifest, verschluesseltes Objekt und Pruefsummen
gebunden und ein praktischer Entschluesselungs-/Lesetest mit einer kontrollierten
Testkopie ausgefuehrt. Objektname und Metadaten enthalten nur Exportlauf-ID,
Schema-/Formatversion und Zeit, keine Vereins-, Personen- oder Credentialwerte.

Die regulaere Aufbewahrungsentscheidung bleibt 12 Monate nach dem bestaetigten
Live-Cutover; der kontrollierte Loeschlauf erfolgt wegen der technischen
Sicherheitsreserve zum ersten zulaessigen Zeitpunkt nach Ablauf der 370-Tage-
Bindung. Dann entfernt die benannte verantwortliche Person nach automatisierter
Vorpruefung und ausdruecklicher Bestaetigung alle Objektversionen und den
separaten Archivschluessel. Dauerhaft erhalten bleiben nur das datensparsame
Manifest, Pruefsummen, Migrations- und Validierungsberichte sowie die fachlich
erforderlichen PostgreSQL-Daten.

Eine vor Fristablauf dokumentierte gesetzliche Aufbewahrungspflicht oder ein
konkreter Legal Hold kann die Loeschung fuer den exakt betroffenen Umfang
aussetzen. Eine vorsorgliche unbefristete Gesamtaufbewahrung ist ausgeschlossen.

### 12.2 Vollstaendig operativ uebernommene Daten

- aktive, inaktive und technische Personen;
- alle fachlichen Referenzen;
- Bewerbe, EntryList, Matches und Ranglisten;
- alle fachlich zuordenbaren Matchresultate;
- vollstaendige Scorehistorie;
- Hallenzeiten und deren Fachhistorie;
- neutrale Bewerbs- und Matchereignisse;
- Kommentare und Reaktionen.

Offizielle Matchresultate und jede nachweislich wirksam gewordene Eintragung,
Korrektur, Loeschung, administrative Matchende-Korrektur sowie ihre Ranglisten-
und KO-Folgen werden dauerhaft und ohne automatische fachliche Loeschfrist
uebernommen. Der aktuelle Zustand und das append-only Aenderungsjournal bleiben
getrennt. Reine Versuche ohne bestaetigte Fachwirkung sind keine dauerhafte
Ergebnishistorie.

### 12.3 Audit

In den operativen PostgreSQL-Bestand werden die letzten 12 Monate der nicht
ergebnisbezogenen
Audithistorie uebernommen. Aeltere Auditdaten bleiben ausschliesslich im
vollstaendigen geschuetzten Quellarchiv.

Der inklusive Stichtag wird je Importlauf deterministisch als
`export_started_at - interval '12 months'` berechnet und in der
Importprovenienz festgehalten. Massgeblich ist der fachliche Ereigniszeitpunkt;
fehlende oder ungueltige Zeitpunkte werden nicht ersatzweise aus Dateizeit oder
Importzeit geraten und muessen kontrolliert geklaert werden.

Nach dem Cutover entfernt ein kontrollierter Retentionjob nicht
ergebnisbezogene Auditoperationen rollierend nach 12 Monaten. Ergebnisbezogene
erfolgreiche Fachwirkungen werden nicht durch eine unbegrenzte Aufbewahrung des
allgemeinen Audits konserviert, sondern ausschliesslich durch die dauerhafte,
fachlich kontrollierte Ergebnishistorie. Login, Logout, Passwort, Session,
Monitor, Courtsteuerung sowie gestartete, abgelehnte und fehlgeschlagene
Fachversuche unterliegen der Auditfrist.

### 12.4 Messaging

Neutrale Fachereignisse, Bewerbs-/Matchhistorie, Kommentare und Reaktionen werden
vollstaendig uebernommen. Persoenliche Zustell- und Quittierungsdetails werden
auf die letzten 24 Monate begrenzt.

Auch hier gilt derselbe inklusive, importlaufgebundene 24-Monats-Stichtag. Das
Entfernen einer aelteren persoenlichen Projektion, Quittierung oder Zustellung
darf das zugehoerige neutrale Fachereignis, dessen Kommentare oder Reaktionen
nicht entfernen.

Nach dem Cutover wird diese Frist durch einen kontrollierten rollierenden
Retentionjob fortgefuehrt. Neutrale Fachereignisse und die dauerhafte
Ergebnishistorie bleiben davon unabhaengig erhalten.

Innerhalb dieses Retentionsumfangs werden bestehende persoenliche Projektionen
einschliesslich bereits quittierter Eigenmeldungen fuer Persistenzparitaet
unveraendert uebernommen. Die spaeter geplante Eigenmeldungsunterdrueckung und
Bereinigung bekannter alter Eigenprojektionen ist eine sichtbare
Notification-Fachaenderung und nicht Bestandteil des PostgreSQL-Cutovers.

### 12.5 Altes Sheet-Logging

Das fruehere freie Sheet-`Logging` wird nicht in operative PostgreSQL-Tabellen
und nicht in das neue Auditmodell importiert. Es bleibt ausschliesslich im
vollstaendigen geschuetzten Quellarchiv.

### 12.6 Historische Scores und Dubletten

- Der vollstaendige akzeptierte Court-Scoreverlauf wird dauerhaft und ohne
  automatische fachliche Loeschfrist uebernommen und fortgefuehrt.
- Court-Scoreereignisse bleiben fachlich und relational vom offiziell
  eingetragenen Matchresultat getrennt; ein Zwischenstand wird nicht allein
  durch seine Persistenz zum offiziellen Ergebnis.
- `scorelog.sqlite` ist bei sicher erkannter Ueberschneidung autoritativ.
- Zusaetzliche aeltere Sheet-Scoreereignisse werden transformiert.
- Sichere Dubletten werden nicht als zwei Fachereignisse gespeichert.
- Quellkennung, Quellschluessel und Importprovenienz bleiben erhalten.
- Unklare Ueberschneidungen blockieren den finalen Import.

Bei identischem Quellzeitpunkt entscheidet eine versionierte feste
Quellprioritaet mit stabilem Quellschluessel die kanonische Reihenfolge, niemals
die zufaellige Importreihenfolge. Eine gleiche SQLite-Event-ID ist nur bei
identischem kontrolliertem Inhalt idempotent; abweichender Inhalt blockiert. Die
fachliche Sheet-/SQLite-Dublettenregel wird erst aus der realen Strukturanalyse
abgeleitet und darf nicht allein auf gleichem Scoretext oder nahem Zeitpunkt
beruhen, weil ein Spielstand nach Zwischenveraenderung erneut auftreten kann.

Die konkreten Deduplizierungsregeln werden erst nach gesonderter Strukturanalyse
der historischen Scorequellen festgelegt.

### 12.7 Laufplan und Batchvertrag der Retentionjobs

Kurzzeitbereinigung fuer abgelaufene Loginlimits, Sessions und vollstaendige
24-Stunden-Idempotenzantworten laeuft alle 15 Minuten. Stundlich werden terminale
Outbox-, Monitorcommand- und Jobkandidaten gegen ihre jeweilige Frist geprueft.
Der 12-Monats-Audit-, 24-Monats-Messaging- und geklaerte Dead-Job-Lauf startet
taeglich initial um 02:15 UTC und entfernt dabei auch seit 12 Monaten widerrufene
technische Rollenzuweisungen und geheimnisfreie Credential-Tombstones. Feste
UTC-Planung vermeidet doppelte oder
ausgelassene DST-Laeufe.

Jede Loeschtransaktion verarbeitet hoechstens 1.000 Root-Datensaetze und besitzt
ein Zeitbudget von fuenf Sekunden. Weitere Batches verwenden `SKIP LOCKED`,
pausieren nach einem festen Gesamtlaufbudget und werden spaeter fortgesetzt,
statt Fachwrites lang zu blockieren. Die Hallenzeiten-Grenze wird primaer nach
einem neuen Historienvorgang und zusaetzlich durch einen taeglichen Reparaturlauf
durchgesetzt.

Abschlusslogs enthalten ausschliesslich Retentionklasse, Cutoff, Anzahl, Dauer,
Fortsetzungsstatus und Ergebniscode. Permanente Ergebnis-, Court-Score- und
Court-Steuerhistorien besitzen keinen Retentionjob.


## 13. Datenbereinigung und Migrationsprovenienz

Ein erzeugtes Quellpaket wird niemals veraendert. Solange Live noch auf dem
Legacyrelease autoritativ ist, werden fachlich korrigierbare Datenprobleme jedoch
bevorzugt ueber den kontrollierten bestehenden Anwendungspfad beziehungsweise
eine ausdruecklich freigegebene Quellkorrektur im autoritativen Legacybestand
behoben. Danach wird stets ein vollstaendig neues Quellpaket mit neuer
Exportlauf-ID erzeugt.

Der Importer fuehrt deterministische Format-, Typ- und Strukturtransformationen
aus. Historische Sonderfaelle, die in der Quelle nicht mehr sinnvoll korrigiert
werden koennen, benoetigen eine explizite versionierte Override-Regel mit
stabiler Quellreferenz, Problemcode, Begruendung und kontrollierter Zielwirkung.
Direkte manuelle Korrekturen in Staging- oder Zieltabellen sind ausgeschlossen.

Jede relevante Transformation dokumentiert mindestens:

- Importlauf-ID;
- Quelltyp und Quellobjekt;
- stabile Quellreferenz;
- Quellpruefsumme;
- kontrollierten Problemcode;
- angewendete Regelversion;
- Zielobjekt beziehungsweise Ausschlussgrund;
- Validierungsergebnis.

Importbefunde verwenden einen versionierten geschlossenen Schweregradvertrag:

- `BLOCKER`: kein finaler Import, zum Beispiel doppelte Identitaet, verwaiste
  Fachreferenz, unklare Rolle, Zeit oder Scoreueberschneidung;
- `WARNING`: deterministische Zielbehandlung entspricht bereits dem heutigen
  Fallback, zum Beispiel ungueltiger optionaler Kontakt erzeugt keinen
  operativen Kontakt und bleibt nur im Quellarchiv;
- `INFO`: verlustfreie Normalisierung wie Trim, leere optionale Zeichenfolge zu
  `NULL` oder kanonischer Legacycode zu typisiertem Wert.

Jeder Problemcode bindet feste Severity, Regelversion, Quellbereich und
Zielwirkung. Der finale Import verlangt null Blocker. Warnings werden mit Anzahl
je Code ausdruecklich freigegeben und im versionierten Ausnahmemanifest an den
Quellpakethash gebunden; Info bleibt zaehlbar. Freie Quellwerte erscheinen in
keiner Berichtsklasse.

Fuer eine Override-Regel werden zusaetzlich Regelautor, Begruendung und
Freigabezeitpunkt dokumentiert. Freie Personenwerte werden dabei nicht in
Betriebslogs oder den datensparsamen Gesamtbericht uebernommen.

Der Import besitzt die Phasen:

```text
vollstaendiger Export
  -> unveraendertes Staging
  -> Analyse
  -> deterministische Transformation
  -> Validierung
  -> Zieltabellen
  -> fachlicher und technischer Abgleichbericht
```

Der Zielimport laeuft stets gegen eine frisch aufgebaute, fuer App und Worker
gesperrte Datenbank. Jede Domaene wird in einer begrenzten Transaktion importiert
und unmittelbar technisch validiert; Importjournal, Quellmanifest und
Pruefsummen binden jeden abgeschlossenen Schritt an denselben Quellstand.

Eine abgeschlossene Domaenentransaktion ist keine Teilfreigabe. Scheitert ein
spaeterer Schritt oder die Gesamtvalidierung, wird die Datenbank niemals
startfaehig markiert und nicht manuell in ihrem Teilzustand repariert. Der
freigegebene Lauf beginnt erneut mit einer leeren, versioniert aufgebauten
Datenbank und fuehrt alle Schritte reproduzierbar aus.

Erst ein finales atomares Importgate markiert Schema-, Seed-/Import- und
Validierungsstand gemeinsam als freigegeben. App- und Worker-Readiness verlangen
dieses Gate. Damit bleibt der Gesamtimport unteilbar freigegeben, ohne Score-,
Messaging- und Audithistorien in eine einzige unbegrenzt grosse Transaktion zu
zwingen.

Kritische Fehler duerfen nicht bestmoeglich oder stillschweigend geraten werden.
Sie blockieren den finalen Import. Dazu gehoeren mindestens:

- ungueltige oder doppelte IDs;
- ungueltige oder doppelte Logins;
- unklare Rollenprojektion;
- ungueltige Credentials;
- verwaiste Personen-, Match- oder Bewerbsreferenzen;
- widerspruechliche ClubDesk-Zuordnungen;
- unklare Zeitpunkte;
- nicht aufloesbare Ranking- oder KO-Zustaende;
- nicht zuordenbare Scoreueberschneidungen;
- unbekannte persistente State-Keys.

Der finale Devel- und Live-Import ist ein unteilbares Freigabegate. Eine
Quarantaene darf im Analyse- und Dry-Run-Bericht Problemobjekte aufnehmen, aber
die Anwendung startet nicht mit ausgelassenen Zeilen, gesperrten Fachdomaenen
oder einem nur teilweise freigegebenen Bestand. Jeder kritische Befund muss vor
der Freigabe entweder durch eine versionierte deterministische
Transformationsregel oder durch eine ausdruecklich bestaetigte Quellkorrektur
aufgeloest sein. Danach wird der Import aus den unveraenderten Quellen
vollstaendig neu ausgefuehrt und validiert.


## 14. Synthetischer Devel-Bestand und geschuetztes Migrations-Staging

### 14.1 Dauerhafter Devel-Bestand

`epiber_devel` wird ausschliesslich aus versionierten synthetischen Seeds
aufgebaut. Produktive oder aus Produktion pseudonymisierte Personen-,
Nachrichten-, Audit- oder Fachdaten werden nicht als normaler dauerhafter
Development-Bestand verwendet.

Die Seeds bilden mindestens aktive, inaktive und technische Personen,
Rollenvarianten, Login- und Kontaktkonstellationen, Bewerbe, Einzel und Doppel,
`BYE`, `PRE`, Walkover, Retirement, Ranglisten- und KO-Folgen, EntryList,
Messaging, Audit, Courts, Monitore, Scorehistorie und Hallenzeiten ab. Erwartete
Ergebnisse und Invarianten sind maschinenpruefbar und reproduzierbar.

Ein versioniertes Node.js-Seed-CLI erzeugt diesen Bestand deterministisch aus
benannten Szenariopaketen. Automatisierte Testprofile verwenden einen festen
Testzeitpunkt. Das gemeinsame `full-devel` verlangt dagegen bei jedem Rebuild
einen expliziten `--as-of`-Zeitpunkt, standardmaessig kontrolliert auf den
aktuellen Wiener Kalendertag gesetzt. Seedversion und `as_of` werden gemeinsam im
Seedmanifest gespeichert.

Alle relativen Bewerbs-, Match- und Hallentermine entstehen deterministisch aus
`as_of`; derselbe Seed mit demselben Wert erzeugt dieselben fachlichen
Projektionen und Pruefsummen. Die danach laufende Devel-App verwendet echte
UTC-Systemzeit. Legacy-/Public-IDs und Fixture-UUIDs bleiben stabil; der normale
produktive Writepfad erzeugt neue UUIDs weiterhin mit `uuidv7()`.

Die Szenarien sind in kleine abhaengigkeitsdeklarierende Pakete fuer mindestens
Core, Identity/Auth, Bewerbe/Entries, Matches, Rangliste/KO, Messaging,
Courts/Scores, Monitore und Hallenzeiten getrennt. Automatisierte Tests laden nur
die fuer ihren Vertrag erforderlichen Pakete.

Ein versioniertes Profil `full-devel` kombiniert alle kanonischen Pakete in
stabiler Reihenfolge und ist der einzige verbindliche Referenzbestand der
gemeinsamen Development-Datenbank. Seine erwarteten Projektionen, Invarianten und
SHA-256-Pruefsummen werden an Seedversion und `as_of` gebunden. Lokale
Experimente und nachtraegliche UI-Testaenderungen duerfen diesen Bestand
temporaer veraendern, gehoeren aber nicht zum Seed und werden beim naechsten
ausdruecklichen Neuaufbau verworfen.

Alle dafuer vorgesehenen synthetischen Testkonten verwenden ein festes und ueber
Rebuilds stabiles Devel-Testpasswort. Da die Testanwendung extern erreichbar ist,
wird es als vertrauliches Testcredential behandelt: Es steht weder in Git noch
in der Dokumentation oder in Logs, sondern wird dem Seed-Runner ueber ein lokales
geschuetztes Credential zugefuehrt und kontrolliert an Tester weitergegeben. Der
Runner erzeugt daraus regulaere scrypt-Credentials. Produktive Passwoerter oder
Hashes werden niemals uebernommen.

Alle normalen synthetischen Rollen verwenden dasselbe Standard-Testpasswort.
Eigene kontrollierte Sonderkonten bilden dagegen fehlendes Passwort,
`legacy_sha256`-Upgrade, gesperrtes beziehungsweise inaktives Konto sowie offene,
abgelaufene und verbrauchte Passwortfreigaben ab. Das konkrete Standardpasswort
wird im Seed-Entwurf eindeutig als nichtproduktives Testcredential
gekennzeichnet.

Die PAJ-/Devel-Webanwendung bleibt fuer Entwickler und ausgewaehlte Tester ueber
den externen HTTPS-/WSS-Port 8081 erreichbar. Diese Freigabe betrifft nur Caddy
und die kontrollierten Anwendungspfade. PostgreSQL besitzt weiterhin keinen
TCP-Listener und ist ausschliesslich ueber geschuetzte lokale Unix-Sockets nach
einer administrativen SSH-Anmeldung erreichbar.

Der feste Credentialvertrag setzt ausschliesslich synthetische Daten,
gesperrte produktive Integrationen, starke nicht veroeffentlichte
Testcredentials, Login-Drosselung und den vollstaendigen HTTPS-/WSS-Vertrag
voraus. Eine Freigabe von Datenbank-, Admin- oder internen Statusports ist daraus
nicht ableitbar.

Der Seed-Runner darf nur gegen ausdruecklich als nichtproduktiv erkannte leere
beziehungsweise freigegebene Testdatenbanken laufen. Er bricht bei unbekanntem
Bestand ab, validiert nach dem Aufbau alle Szenarioinvarianten und kann keine
Produktivdatenbank leeren oder ueberschreiben. Manuelle UI-Eingaben und ein
unversionierter SQL-Dump sind keine Quelle des kanonischen Devel-Bestands.

Der normale Seed-Befehl akzeptiert ausschliesslich eine leere, eindeutig als
nichtproduktiv markierte Datenbank. Ein bestehendes `epiber_devel` kann nur ueber
den getrennten Befehl `rebuild-devel` ersetzt werden. Dieser prueft
Instanzkennung, exakten Datenbanknamen, Tenantmarker, synthetische Herkunft,
fehlende Produktivkennzeichen und aktuellen Devel-Backupstatus und verlangt die
explizite Eingabe des Zieldatenbanknamens.

Live-Datenbanknamen und reale Migrations-Stagingdatenbanken sind zusaetzlich
durch harte Denylists und fehlende Rollenrechte ausgeschlossen. Der Rebuild wird
mit kontrollierten Versionen, Zeiten, Anzahlen und Ergebnis auditiert, ohne
synthetische Personen- oder Credentialwerte auszugeben.

Testkonten verwenden eindeutige Development-Logins und normale sichere
Passwort-Hashes. Klartextcredentials werden nicht in PostgreSQL gespeichert.
Persoenliche Developer- und Operatoridentitaeten bleiben von fachlichen
Testkonten getrennt.

### 14.2 Reale Migrationsprobe

Der tatsaechliche Legacy-Bestand wird dennoch vor dem Live-Cutover wiederholt
gegen das Importwerkzeug geprueft. Dies erfolgt ausschliesslich in einer
getrennten, besonders geschuetzten und kurzlebigen Staging-Datenbank:

```text
kontrollierter manueller Start
  -> konsistenter verschluesselter Quell-Export
  -> isolierte Staging-Datenbank
  -> unveraendertes Staging und deterministische Transformation
  -> technische und fachliche Validierung
  -> datensparsamer Abgleichbericht
  -> kontrollierte Entfernung der Staging-Datenbank und entschluesselten Quellen
```

Die Staging-Datenbank wird als separate kurzlebige Datenbank in derselben
PostgreSQL-Development-Instanz angelegt, aber nicht zu `epiber_devel`, nicht fuer
allgemeine Entwicklung und nicht fuer weitere Entwickler freigegeben. App- und
Workerrollen erhalten kein `CONNECT`; Zugriffe sind zeitlich und personell
begrenzt. Ausgaben enthalten nur kontrollierte Zaehler, Problemcodes und
technische Quellreferenzen, keine freien Personen-, Nachrichten- oder
Auditwerte.

Exporter, Entschluesselung, Analyse und Import laufen als kontrollierte One-shots
unter dem eigenen nicht anmeldbaren Unix-Systembenutzer `epiber-migration`.
Quellpaket und entschluesselte Dateien liegen in einem Verzeichnis mit Modus
`0700` auf dem kurzlebigen verschluesselten Stagingcontainer. Der oeffentlich
erreichbare Devel-Appbenutzer `paj`, Worker und allgemeine Entwicklergruppen
erhalten weder Dateirechte noch Datenbank-`CONNECT`.

Nur datensparsame Berichte mit Zaehlern, Codes und Pruefsummen werden in einen
getrennten kontrolliert lesbaren Ergebnisbereich projiziert. Nach Drop,
Containerloeschung und Schluesselvernichtung verbleibt kein Klartextquellpaket
auf Root- oder Devel-Datenpfaden.

Da physische Backups und WAL den gesamten PostgreSQL-Cluster umfassen, gilt fuer
jede reale Probe ein verpflichtender Backup-Reset-Vertrag:

1. letzten sauberen Devel-Backup-/Restorepunkt vor der Probe verifizieren;
2. regulaere Devel-Backups kontrolliert pausieren und WAL des Stagingfensters in
   ein getrenntes temporaeres verschluesseltes Repository leiten;
3. Staging-Datenbank nach Moeglichkeit in einem eigenen verschluesselten
   Tablespace mit separatem kurzlebigem Schluessel anlegen;
4. App und Worker waehrend des realen Staginglaufs von dieser Datenbank und ihren
   Rollen vollstaendig ausschliessen;
5. nach Bericht und Regressionsextraktion die Datenbank droppen, temporaere
   Quellen und WAL-Repositories entfernen und den Stagingschluessel vernichten;
6. PostgreSQL checkpointen und den regulaeren Devel-WAL-/Backupweg wieder
   aktivieren;
7. eine neue vollstaendige Devel-Backupbasis erzeugen und Restore sowie
   Backupalter erneut verifizieren.

Eine durchgaengige Devel-PITR-Kette ueber das reale Stagingfenster ist bewusst
ausgeschlossen. Backups oder WAL mit realen Stagingdaten duerfen nicht in das
regulaere Devel-Repository gelangen. Kann diese Trennung nicht nachgewiesen
werden, darf die reale Probe nicht in der Development-Instanz stattfinden und
benoetigt stattdessen eine eigene kurzlebige PostgreSQL-Instanz.

### 14.3 Uebernahme erkannter Sonderfaelle

Ein in der realen Migrationsprobe entdeckter relevanter Sonderfall wird nicht als
Produktivdatensatz in Devel konserviert. Stattdessen wird daraus ein minimaler,
synthetischer Regressionstest ohne rueckfuehrbare Personen- oder Fachwerte
erstellt. Dadurch waechst der reproduzierbare Testbestand kontrolliert mit den
tatsaechlich beobachteten Datenformen.

### 14.4 Zugriffsschutz und externe Wirkungen

Development und Migrations-Staging besitzen getrennte Datenbanken, Rollen und
Credentials. Produktive externe Schreibwirkungen sind in beiden Umgebungen
gesperrt. Dazu gehoeren insbesondere E-Mail, Push, Webhooks sowie spaetere
Finanz- und Buchhaltungsexporte.

Courtquellen, Monitorcredentials, Datei- und Object-Storage-Ziele sowie weitere
Integrationen werden im synthetischen Devel-Bestand ausschliesslich durch
freigegebene Testgegenstellen ersetzt. Das Migrations-Staging fuehrt keine
externen Fachwirkungen aus. Es darf keine stillschweigende Uebernahme einer
produktiven Integration oder eines produktiven Credentials geben.

Netzwerk-Egress ist fuer Devel standardmaessig gesperrt und wird nur fuer eine
explizite Ziel-Allowlist freigegeben. Eine Testfreigabe benoetigt eine eigene
nichtproduktive Gegenstelle und eigene Development-Credentials. Produktive Ziele
oder Credentials duerfen auch nicht fuer vermeintlich nur lesende Zugriffe
verwendet werden.

App und Worker erzwingen diese Grenze zusaetzlich pro systemd-Dienst mit
`IPAddressDeny=any` und ausschliesslicher Loopback-Freigabe. Der externe
HTTPS-/WSS-Testzugang auf Caddy-Port 8081 bleibt davon unberuehrt: Caddy proxyt
auf das lokale Backend, waehrend der Backendprozess selbst keine externen Ziele
erreichen kann. Lokale Fake-Courts und Testgegenstellen muessen auf Loopback
bereitgestellt werden.

pgBackRest erhaelt als eigener Dienst nur den benoetigten Scaleway-Egress. Der
Legacy-Exporter ist ein getrenntes kontrolliertes One-shot mit dem erforderlichen
Google-Zugriff; der Staging-Importer verarbeitet danach ausschliesslich das
lokale verschluesselte Quellpaket ohne externen Egress. Die Wirksamkeit von
`IPAddressDeny`/`IPAddressAllow` wird auf dem tatsaechlichen Host ueber positive
Loopback- und negative externe Verbindungstests nachgewiesen.

| Dienst / Integration | Erlaubter Zugriff in Devel | Verboten / Nachweis |
|---|---|---|
| Caddy | externer HTTPS-/WSS-Testzugang auf 8081, lokaler Backendproxy | keine internen DB-/Adminports extern |
| Devel-App | Unix-Socket zu `epiber_devel`, Loopback-Fakes | kein externer Egress, keine Google-/Scaleway-/Produktivcredentials |
| Devel-Worker | Unix-Socket, registrierte lokale Testjobs | kein externer Egress oder produktiver Zustellkanal |
| Courtquelle | ausschliesslich Loopback-Fake mit Testdaten | kein lesender oder schreibender Produktivcourt |
| Monitore | synthetische Testgeraete und Tokens | keine produktiven Token-Hashes in Devel |
| E-Mail/WhatsApp/Push/Webhooks | kontrolliert `not_configured` oder lokaler Fake | keine reale Zustellung |
| Datei-/Object-Storage der App | lokale Testziele auf Loopback/verschluesseltem Testpfad | kein produktiver Bucket |
| pgBackRest | ausschliesslich Devel-Bucket bei Scaleway | kein Appzugriff und kein Live-Bucket-Credential |
| Legacy-Exporter | kontrolliertes One-shot zu Google und lokalen SQLite-Quellen | keine Approlle; Ausgabe nur verschluesseltes Quellpaket |
| Staging-Importer | lokales verschluesseltes Quellpaket und Staging-DB | kein externer Netzwerkzugriff oder Fachwirkung |
| postgres_exporter | Devel-Unix-Socket, Loopback-Metriklistener | read-only Rolle, kein externer Listener |

Jede Ausnahme benoetigt eine eigene systemd-Unit, nichtproduktive Credentials,
positive Soll- und negative Produktivtests sowie kontrollierte Logs ohne freie
Payloads.


## 15. Security-State beim Cutover

### 15.1 Bewusst verworfener Kurzzeitstate

Bei Devel- und spaeter Live-Cutover werden nicht migriert:

- Browser-Sessions;
- Loginlimits;
- abgelaufene Idempotenzoperationen;
- fluechtige Caches;
- offene Worker-Leases;
- fluechtige Pollingzustaende.

Alle Benutzer melden sich nach dem jeweiligen Cutover einmal neu an.
Beim Live-Cutover werden keine SQLite-Sessionzeilen, Cookie-Token-Hashes oder
historischen Loginlimits nach PostgreSQL uebernommen. Die sichtbare Auswirkung
ist eine einmalige Neuanmeldung aller Benutzer; bestehende Klartextcookies werden
serverseitig wertlos. Credentials und Konten werden davon unabhaengig nach dem
festgelegten Identity-Vertrag migriert.

### 15.2 Vorher zu klaerende Zustaende

Vor jedem finalen Cutover muessen abgeschlossen oder eindeutig geklaert sein:

- `pendingMetadataIntents`;
- Operationen mit Ergebnis `unknown`;
- offene Recovery-Plaene;
- laufende Fachwrites;
- unklare Google-Sheets-Mutationen;
- noch nicht bestaetigte Messaging- oder Auditabschluesse.

### 15.3 Live-Monitore

Produktive Monitorgeraete bleiben beim Live-Cutover provisioniert. Token-Hashes,
Widerruf und Geraetestatus werden kontrolliert migriert; Klartexttokens sind
nicht erforderlich.

Der Import prueft Eindeutigkeit, Hashformat, Widerrufsstatus und Zielgeraet. Eine
nicht eindeutig validierbare Monitoridentitaet wird nicht stillschweigend
aktiviert, sondern muss kontrolliert neu provisioniert werden. Erfolgreich
migrierte Token-Hashes bleiben nur in `epiber_askoe` gueltig.

Development uebernimmt keine produktiven Monitorcredentials.


## 16. Secrets und Datenbankrollen

### 16.1 Nicht in PostgreSQL gespeicherte Geheimnisse

- DB-Passwoerter;
- private Schluessel;
- Verschluesselungsschluessel;
- Google-Service-Account-Dateien;
- API-, SMTP- und Push-Tokens;
- Backup-Schluessel;
- Klartextpasswoerter;
- produktive externe Credentials.

In PostgreSQL zulaessig sind:

- Passwort-Hashes;
- Sessiontoken-Hashes;
- Monitor-Token-Hashes;
- kontrollierte Secret-Referenzen;
- Rotationsstatus und Zeitpunkte;
- nicht geheime Integrationskonfiguration.

Aktive PostgreSQL-Datenverzeichnisse, WAL, temporaere Datenbankdateien und
sonstige persistente Datenvolumes werden auf verschluesseltem Storage betrieben.
Vor dem Start von `epiber_devel` ist die Verschluesselung des vorgesehenen
Volumes nachzuweisen oder ein geeignetes verschluesseltes Volume bereitzustellen.
Reales Migrations-Staging und `epiber_askoe` duerfen ohne diesen Nachweis nicht
gestartet werden.

Der bestehende Host erfuellt diesen Nachweis fuer sein Root-Dateisystem nicht:
`/dev/sda3` ist direkt als `ext4` eingebunden und besitzt kein sichtbares
LUKS-/dm-crypt-Layer. Fuer `epiber_devel` wird deshalb ein separates manuell
eingerichtetes Hetzner-Volume mit initial 10 GB vollstaendig als LUKS2-Volume
verschluesselt. Es enthaelt ausschliesslich PostgreSQL-Daten, WAL und temporaere
Datenbankdateien und kostet zum Entscheidungszeitpunkt rund 0,44 EUR netto pro
Monat.

Das LUKS2-Mapping heisst `epiber-devel-db` und wird als ext4 unter
`/var/lib/epiber-postgresql-devel` mit `noatime,nodev,nosuid,noexec` eingebunden.
PostgreSQL-Daten, WAL, Temp und pgBackRest-Status erhalten getrennte
Unterverzeichnisse und minimale Dateirechte. Dauerhaftes Mount-`discard` wird
nicht aktiviert; ein kontrollierter periodischer `fstrim` uebernimmt die
Freigabe ungenutzter Bloecke.

Systemd-Abhaengigkeiten verhindern den Start von PostgreSQL, App und Worker vor
erfolgreicher Entsperrung und Mountpruefung. Eigentum, Modus, Mapping, Mountquelle
und freie Reserve werden vor dem Datenbankstart verifiziert. XFS oder Btrfs
werden fuer diesen kleinen ersten Cluster nicht als zusaetzliche
Betriebsvariante eingefuehrt.

Mangels voll nutzbarem virtuellem TPM wird das Volume nach einem Hostneustart
bewusst manuell per SSH mit einer ausserhalb des Hosts verwahrten Passphrase
entsperrt. PostgreSQL und davon abhaengige Dienste starten erst nach erfolgreichem
Mount. Eine Schluesseldatei auf dem unverschluesselten Root-Dateisystem ist
ausgeschlossen. Der Entsperrweg wird in Restore- und RTO-Tests einbezogen.

Die bestehende 4-GB-Swap-Partition `/dev/sda2` wird vor dem PostgreSQL-Start bei
jedem Boot mit einem neuen zufaelligen dm-crypt-Schluessel als ephemerer Swap
geoeffnet. Hibernation/Resume ist ausgeschlossen; Swapinhalt ist nach Neustart
absichtlich nicht wiederherstellbar. Unverschluesselter Swap ist mit dem
At-rest-Vertrag nicht vereinbar.

PostgreSQL erhaelt zusaetzlich initial `MemorySwapMax=0`, damit sein regulaeres
Arbeitsset nicht ausgelagert wird. Core Dumps werden fuer PostgreSQL, App,
Worker, Migration, Export und Backup deaktiviert. OOM-, MemoryHigh- und
Swapgesamtmetriken bleiben alarmiert; die ephemere Verschluesselung ersetzt
nicht die konservativen Speicherlimits.

Die 10-GB-Startgroesse wird ueber freien Speicher, WAL-Wachstum, temporaere
Importspitzen und Tablespacebedarf alarmiert und vor jedem realen Staginglauf per
Kapazitaets-Preflight geprueft. Reicht die Reserve nicht aus, wird das Volume vor
dem Import erweitert; ein teilweise gestarteter Import ist kein
Kapazitaetstest. Reales Staging verwendet innerhalb des Volumes einen
zusaetzlichen kurzlebigen verschluesselten Container mit eigenem Schluessel.

Am 25.09.2026 belegt die lokale PAJ-SQLite-Persistenz insgesamt rund 3,2 MiB:
State rund 1,65 MiB, Audit 0,59 MiB, Messaging 0,39 MiB und Scorelog 0,20 MiB
zuzueglich kleiner WAL-/SHM-Dateien. Dieser Istwert spricht fuer ausreichend
Startreserve, umfasst aber weder Google-Sheets-Daten noch PostgreSQL-
Grundbestand, WAL, Indizes, temporaere Importkopien oder reales Staging und
ersetzt deshalb kein Kapazitaetsgate.

Das LUKS2-Volume ist ausschliesslich aktiver PostgreSQL-Blockstorage fuer
Datendateien, aktuelles beziehungsweise noch nicht erfolgreich archiviertes WAL,
temporaere Datenbankdateien und die kleinen pgBackRest-Spool-Statusdateien.
S3-Object-Storage kann wegen fehlender POSIX-, Random-I/O- und `fsync`-Semantik
kein PostgreSQL-Datenverzeichnis ersetzen.

Physische pgBackRest-Sicherungen und logische Exporte werden zusaetzlich mit
einem vom Datenvolume unabhaengigen Backupschluessel verschluesselt. Volume-,
Backup- und Off-site-Zugangsschluessel liegen ausserhalb von Datenbank,
Repository und Backupnutzdaten und besitzen getrennte Restoreverfahren.

Fuer das Scaleway-Repository ist ausschliesslich die clientseitige
pgBackRest-Repositoryverschluesselung autoritativ; Scaleway SSE-KMS wird nicht
verwendet. Der Anbieter erhaelt damit nur bereits verschluesselte Backupobjekte.
Die Repository-Passphrase wird als getrenntes systemd-Credential sowie in einem
vom Host und Scaleway-Konto unabhaengigen Offline-Recoveryweg gehalten. Alte
Schluessel bleiben bis zum Ablauf aller damit verschluesselten Backupzyklen
restorefaehig; Rotation und Verlustfall werden praktisch getestet.

LUKS-, pgBackRest- und `age`-Recoveryschluessel werden als getrennte Eintraege
primaer in einem verschluesselten persoenlichen Passwortmanager und zusaetzlich
in einer davon getrennten verschluesselten Offlinekopie gehalten. Beide Kopien
bleiben unter der festgelegten Einzelverantwortung; dies fuehrt kein personelles
Zweitfreigabeverfahren ein.

Mindestens halbjaehrlich wird die Lesbarkeit beider Recoverywege kontrolliert
geprueft. Rotation aktualisiert beide Kopien und wird erst nach erfolgreichem
Entsperr-/Restoretest abgeschlossen. Hetzner-/Scaleway-Notizen,
unverschluesselte Runbooks und Git enthalten kein Schluesselmaterial.

Eine allgemeine anwendungsseitige Feldverschluesselung fuer Namen, Kontakt- oder
Matchdaten wird nicht eingefuehrt. Zugriffsschutz, minimale DB-Rollen,
verschluesselte Volumes und Backups bilden deren Schutzschichten. Passwoerter,
Session- und Geraetetokens bleiben unabhaengig davon ausschliesslich als sichere
Hashes gespeichert.

Fuer die erste Stufe koennen Geheimnisse ueber root- und systemd-geschuetzte
Credentials bereitgestellt werden. Ein zentraler Secret Manager ist noch keine
Voraussetzung.

Diese systemd-Credentials sind fuer die erste PostgreSQL-Stufe verbindlich.
App, Worker, Migration Runner und `pgBackRest` erhalten je Umgebung getrennte,
minimal berechtigte Credentials. Datenbankpasswoerter werden nicht in `.env`,
Git, OCI-Artefakten, Prozessargumenten oder Logs gespeichert. Rotation und
Widerruf muessen dienstweise moeglich sein. SOPS/age oder ein zentraler Secret
Manager werden erst mit der spaeteren deklarativen Cell- und
Provisionierungsplattform eingefuehrt.

Dienstdatenbankrollen authentifizieren sich auch ueber den lokalen Unix-Socket
ausschliesslich mit `scram-sha-256`; `password_encryption` ist entsprechend
gesetzt. App, Worker, Migrator, Monitoring und Backup erhalten getrennte
systemd-Credentials sowie explizite datenbank- und rollengebundene
`pg_hba.conf`-Regeln. `trust`, MD5 und allgemeine Peer-Regeln fuer Dienstrollen
sind ausgeschlossen.

Nur die eng begrenzte lokale PostgreSQL-Administration darf Peer-Authentisierung
verwenden. Socket-Dateirechte bleiben eine erste Schutzschicht, ersetzen aber
nicht die getrennte Datenbankauthentisierung. HBA-Verifikation prueft positive
Sollverbindungen und negative Rollen-/Datenbankkombinationen.

Fuer persoenliche privilegierte PostgreSQL-Administration werden in der ersten
Stufe weder ein zusaetzlicher Adminwrapper noch `pgaudit` eingefuehrt. Zugriff ist
nur nach persoenlicher SSH-Anmeldung und lokaler Rechteerhoehung moeglich; die
normalen SSH-/sudo-Journale bilden den dafuer festgelegten Zugriffsnachweis.

Bootstrap, Migration Runner, Backup, Restore und weitere kontrollierte One-shots
behalten unabhaengig davon ihre strukturierten Start-/Abschlusslogs. Freies
manuelles Produktions-DML und manuell eingegebenes DDL sind kein regulaerer
Betriebsweg und werden durch diese Entscheidung nicht freigegeben.

### 16.2 Rollentrennung

Mindestens vorzusehen sind getrennte Rollen fuer:

- normale Appzugriffe ohne DDL;
- Workerzugriffe;
- Schemamigrationen;
- Backup und Restore;
- kontrollierte Devel-Refreshs;
- persoenlichen Betreiber-/Entwicklerzugriff.

Die normale Anwendung darf keine allgemeinen Schemaaenderungsrechte besitzen.

Jede Umgebung besitzt eine nicht anmeldbare Eigentuemerrolle, fuer Development
`epiber_devel_owner NOLOGIN`. Sie besitzt Schemas, Tabellen, Sequenzen und
Funktionen und definiert die Default Privileges. Der anmeldbare
`epiber_devel_migrator` darf ausschliesslich fuer kontrollierte Migrationen
`SET ROLE epiber_devel_owner` ausfuehren.

App, Worker, Monitoring und Backup koennen die Eigentuemerrolle nicht uebernehmen
und erhalten nur explizite minimale Rechte. Live verwendet spaeter vollstaendig
getrennte Rollen mit Praefix `epiber_live_*`; Rollen, Passwoerter und
systemd-Credentials werden nicht umgebungsuebergreifend wiederverwendet.

Live erhaelt zusaetzlich `epiber_live_app_readonly` mit ausschliesslich den fuer
Abnahmeprojektionen erforderlichen `SELECT`-/`EXECUTE`-Rechten. Diese Rolle kann
keine Fach-, Audit-, Idempotenz-, Job- oder Outboxwrites ausfuehren und ist vom
normalen Read-write-Appcredential getrennt.

### 16.3 Einzelverantwortung fuer privilegierte Betriebsaktionen

Fuer ASKÖ und die spaetere Mandantenplattform ist keine personelle
Zweitfreigabe vorgesehen. Eine benannte verantwortliche Person darf alle
privilegierten Betreiberrollen wahrnehmen. Getrennte technische Dienstrollen und
Credentials bleiben trotzdem verpflichtend und duerfen nicht zu einer
gemeinsamen unbeschraenkten App-Identitaet zusammengelegt werden.

Kritische Aktionen wie Live-Cutover, Restore, riskante Contract-Migration,
Backup-Prune und endgueltige Archivloeschung verlangen stattdessen:

- starke persoenliche Authentifizierung und keine gemeinsame Betreiberidentitaet;
- automatisierte Preflight-, Backup-, Kompatibilitaets- und Integritaetsgates;
- eine explizite aktionsbezogene Bestaetigung der verantwortlichen Person;
- unveraenderliche strukturierte Protokollierung von Aktion, Ziel, Version,
  Zeitpunkt und Ergebnis;
- ein vorab bestimmtes Abbruch-, Restore- oder Fix-forward-Verfahren.

Eine zweite Person ist keine technische oder organisatorische
Freigabevoraussetzung.


## 17. Versionierung und Schemamigrationen

### 17.1 App-Version

Die Anwendungsversion bleibt eine SemVer-Version. Ihre einzige Quelle im
Checkout bleibt `Backend/package.json`; Git-Commit und spaeter Image-Digest
identifizieren das exakte Artefakt.

### 17.2 Unabhaengige DB-Migrationsversion

Die Datenbank verwendet davon unabhaengige, streng fortlaufende und
unveraenderliche Migrations-IDs, beispielsweise:

```text
202609250001_initial_core
202609250002_identity
202609250003_play
202609250004_venue
```

Jede angewendete Migration dokumentiert mindestens:

- ID und Name;
- Pruefsumme;
- Start und Abschluss;
- Git-Commit;
- App-Version;
- Laufdauer;
- Ergebnis.

`epiber_askoe` und `epiber_devel` fuehren ihren Migrationsstand unabhaengig.

### 17.3 Kompatibilitaetsvertrag

Jede App-Version definiert einen minimal und maximal unterstuetzten
DB-Schemastand. Eine inkompatible Anwendung startet nicht normal gegen die
Datenbank.

Schemaaenderungen folgen Expand/Contract:

1. neue Tabellen, Spalten oder Indizes additiv einfuehren;
2. alte und neue Appversion fuer ein Uebergangsfenster kompatibel halten;
3. Daten idempotent backfillen;
4. neuen Lesepfad kontrolliert aktivieren;
5. alte Strukturen erst in einem spaeteren Release entfernen.

Ein Image-Rollback ist nur zulaessig, solange die vorherige App-Version mit dem
aktuellen Schema kompatibel ist. Ein destruktiver Down-Migrationsautomatismus ist
kein Ersatz fuer Backup und Restore.

### 17.4 Expliziter Migration-One-shot

Schemamigrationen werden vor dem Appstart durch ein separates CLI-
beziehungsweise systemd-One-shot ausgefuehrt:

```text
Preflight
  -> Backupstatus und Kompatibilitaet
  -> Advisory Lock
  -> Migration mit eigener Rolle
  -> Schemaverifikation
  -> Appstart
```

Die App migriert das Schema nicht selbsttaetig beim normalen Start. Manuell frei
eingegebenes Produktions-SQL ist ebenfalls nicht der regulaere Migrationsweg.

Der Migration Runner wird als projektspezifisches Node.js-CLI auf Basis des
PostgreSQL-Treibers `pg` umgesetzt. Schemaaenderungen liegen als streng
fortlaufende, unveraenderliche SQL-Dateien im Repository; ein ORM oder eine
zusaetzliche Java-basierte Migrationstoolchain wird nicht eingefuehrt.

Die Dateien liegen gemeinsam unter `Backend/db/migrations/` und verwenden eine
globale sechsstellige Sequenz ueber alle Schemas, zum Beispiel
`000001_bootstrap.sql`. Die Nummer ist die stabile Migrations-ID; der restliche
Dateiname dient nur der Lesbarkeit. Getrennte Domaenennummernkreise sind wegen
schemauebergreifender Fremdschluessel und Transaktionen ausgeschlossen.

Noch nicht in einer offiziellen gemeinsamen Devel-Baseline angewendete
Erstentwurfsmigrationen duerfen waehrend lokaler Entwicklung und kurzlebiger
Testcluster bereinigt werden. Mit dem ersten freigegebenen gemeinsamen Aufbau von
`epiber_devel` werden alle bis dahin enthaltenen IDs und SHA-256-Pruefsummen
unveraenderlich eingefroren.

Ab diesem Freeze darf auch in Devel keine bereits angewendete SQL-Datei geaendert
werden; jede Korrektur erhaelt eine neue fortlaufende Migration. Reales Staging
und Live verwenden ausschliesslich eingefrorene Dateien. Lokale Testanwendung vor
dem Freeze begruendet keinen Anspruch, spaeter bereits gemeinsam angewendete
Historie umzuschreiben.

Der CLI-Einstieg liegt unter `Backend/scripts/db-migrate.js`. Standardmaessig
laeuft genau eine SQL-Datei in einer Transaktion. Zwingend nichttransaktionale
Schritte benoetigen explizite versionierte Metadaten, einen gesonderten
Preflight-/Verifikationspfad und duerfen nicht durch eine Namenskonvention allein
freigeschaltet werden. Automatische Down-Migrationen bleiben ausgeschlossen;
umfangreiche Backfills sind getrennte versionierte Jobs.

Der minimale CLI-Vertrag lautet:

```text
db-bootstrap.js check|apply
db-migrate.js status
db-migrate.js plan --target-generation <n>
db-migrate.js up --target-generation <n>
db-migrate.js verify
```

`status`, `plan` und `verify` schreiben nicht. `up` benoetigt die explizite
Zielgeneration und laeuft fuer systemd als eigener One-shot. Secrets werden nur
ueber systemd-Credentials beziehungsweise geschuetzte lokale Credentialdateien
eingelesen, niemals als Prozessargument.

Fehlt in einer frisch gebootstrappten Datenbank das Migrationsjournal, prueft der
Runner zuerst, dass keine unbekannten Anwendungsschemas oder -objekte vorhanden
sind. Nur dann darf `000001_bootstrap.sql` in einer Transaktion `ops`, das
Journal und die initiale Generation anlegen und sich selbst mit Pruefsumme
registrieren. Teilweise oder manuell vorangelegte Strukturen fuehren zum Abbruch,
nicht zu einer vermeintlichen Adoption.

Der Runner uebernimmt mindestens:

- Berechnung und Vergleich der SHA-256-Pruefsumme jeder SQL-Datei;
- exklusives PostgreSQL-Advisory-Lock je Tenant-Datenbank;
- geordnetes Planen, Anwenden und Verifizieren ausstehender Migrationen;
- Journal mit Migrations-ID, Pruefsumme, Git-Commit, App-Version, Start,
  Abschluss, Laufdauer und Ergebnis;
- standardmaessig transaktionale Ausfuehrung je Migration;
- kontrollierte Kennzeichnung und gesonderte Behandlung spaeterer zwingend
  nichttransaktionaler Schritte;
- Abbruch bei unbekannten IDs, geaenderten Pruefsummen, inkompatiblem
  Schemastand oder bereits laufender Migration;
- strukturierte Abschlusslogs ausschliesslich mit kontrollierten Versionen,
  Phasen, Dauern und Fehlercodes.

Die autoritative Schemaquelle ist ausschliesslich die geordnete eingefrorene
Migrationskette. Aus einer damit frisch aufgebauten leeren Datenbank wird
automatisiert ein kanonischer `pg_dump --schema-only`-Snapshot fuer Review und
Driftvergleich erzeugt. Er wird nie manuell editiert und kann keine Migration
ersetzen.

CI beziehungsweise der lokale Verifikationsworkflow vergleicht den neu
generierten Snapshot mit dem erwarteten Stand und erkennt nicht versionierte
DDL-Abweichungen. Tabellen-/Beziehungsdokumentation und optionale ER-Diagramme
sind abgeleitete Ansichten des freigegebenen Schemas, keine zweite DDL-Quelle.

Schemaaenderungen besitzen zusaetzlich eine fortlaufende
Kompatibilitaetsgeneration. App und Worker deklarieren im Artefakt jeweils die
minimal und maximal unterstuetzte Generation. Readiness verlangt eine Generation
innerhalb dieses Bereichs, alle Pflichtmigrationen mit unveraenderten
Pruefsummen und das erfolgreiche Import-/Seed-Freigabegate.

Additive Expand-Migrationen duerfen einen Bereich unterstuetzen, in dem alte und
neue Artefakte parallel kompatibel sind. Eine Contract-Migration wird erst
freigegeben, wenn keine alte App- oder Worker-Version mehr auf die entfernte
Struktur zugreift. Der Migration Runner prueft die Zielgeneration des
bereitzustellenden Artefakts vorab. Fuer den ersten PostgreSQL-Cutover sind
minimale und maximale Generation identisch.

Die normale App-Rolle besitzt keine DDL-Rechte. Der Runner verwendet eine eigene
Migrationrolle und wird fuer Produktion ausschliesslich als kontrollierter
One-shot vor dem Appstart ausgefuehrt. Automatische Down-Migrationen sind kein
Produktions-Rueckfallweg. Umfangreiche fachliche Backfills laufen als getrennte,
idempotente und wiederaufnehmbare Jobs statt als unbegrenzt blockierende
Startmigration.

Vor dem Schema-Runner steht ein getrennter Infrastruktur-Bootstrap. Er laeuft
lokal unter der PostgreSQL-Administrationsidentitaet und legt Datenbank,
Eigentuemer-/Migration-, App-, Worker-, Backup- und Monitoringrollen,
Unix-Socket-Zugriff, Basisgrants sowie die freigegebenen Extensions an. Er
verarbeitet keine Fachdaten und wird nicht beim normalen Appstart ausgefuehrt.

Der regulaere Schema-Runner verbindet sich ausschliesslich mit der eigenen
nichtprivilegierten DDL-Rolle. Sie darf Objekte in den ePiber-Schemas verwalten,
aber keine Datenbanken, Rollen oder beliebigen Extensions anlegen und besitzt
keine PostgreSQL-Superuserrechte. Bootstrap und Runner sind beide idempotent
pruefbar; App und Worker behalten ausschliesslich ihre minimalen DML-/Execute-
Rechte.


## 18. Repository- und Transaktionsarchitektur

Alle PostgreSQL-Repositories werden asynchron. Direkte SQL-Zugriffe bleiben auf
Repository- beziehungsweise Migrationsmodule begrenzt.

Die Anwendung verwendet den Node.js-Treiber `pg` mit handgeschriebenen,
parametrisierten SQL-Statements. Ein ORM und ein allgemeiner Query Builder werden
nicht eingefuehrt. SQL ist ausschliesslich in Repository-, Migrations-, Import-
und eng begrenzten Reportingmodulen zulaessig; Controller, WebSocket-Routing und
Fachservices erhalten keinen direkten Datenbankzugriff. Eingaben werden vor dem
Repository nach den geschlossenen Fachvertraegen und Datenbankresultate an der
Repositorygrenze validiert.

PostgreSQL erzwingt alle lokal strukturell beweisbaren Invarianten ueber Typen,
`NOT NULL`, Checks, Fremdschluessel, Eindeutigkeit sowie partielle und bei
spaeterem Bedarf Exclusion-Indizes. Komplexe Tennisregeln,
Berechtigungsentscheidungen, Projektionen und benutzergerichtete Fehler bleiben
in versionierten Node-Fachservices und werden als vollstaendiger Plan innerhalb
der Repositorytransaktion ausgefuehrt.

Umfangreiche Geschaeftslogik in Triggern oder Stored Procedures wird nicht
eingefuehrt. Trigger sind nur fuer eine eng lokale technische Invariante nach
ausdruecklicher Dokumentation und direktem Test zulaessig. Umgekehrt darf eine
rein im Service gepruefte Regel, die mit einem Datenbankconstraint eindeutig
absicherbar ist, nicht ungeschuetzt bleiben.

Veraenderliche Aggregate verwenden eine explizite `revision bigint`. Neue
vorhandene Aggregate starten bei 1; importierte nichtnegative Legacyrevisionen
bleiben fuer Projektionsparitaet erhalten. Eine tatsaechlich wirksame
Fachmutation erhoeht die Revision genau einmal, No-op und idempotente
Wiederholung nicht. Optimistische Updates binden die erwartete Revision in ihre
`WHERE`-Bedingung und liefern bei Abweichung den kontrollierten
Revisionskonflikt.

PostgreSQL-`xmin` und `updated_at` sind keine externen Konkurrenzvertraege.
Untertabellen werden innerhalb der Aggregattransaktion und ueber die festgelegte
Lockreihenfolge geschuetzt. Wo eine Projektion mehrere Aggregate zusammenfasst,
verwendet sie einen eigenen monotonen Projektionscursor statt eine zufaellige
Einzelrevision umzudeuten.

App und erster Worker verbinden sich fuer ASKÖ-Devel und den ersten Live-Cutover
direkt ueber getrennte, klein und fest begrenzte `pg.Pool`-Instanzen. Poolgroesse,
Wartezeit, Verbindungslebensdauer und Leerlaufabbau werden konfiguriert, gegen das
PostgreSQL-Verbindungslimit budgetiert und ueber Readiness sowie Metriken
beobachtet. Der Migration Runner und Backup-/Restorewerkzeuge verwenden eigene
direkte Verbindungen und keine App-Pools.

`LISTEN/NOTIFY` verwendet je App-/Workerprozess eine eigene, nicht aus dem
Requestpool entliehene Verbindung. Diese Verbindungen sind im
`max_connections`-Budget enthalten, besitzen Reconnect-/Resync-Vertrag und
duerfen einen Poolslot nicht dauerhaft blockieren.

PgBouncer ist noch nicht Teil des ersten ASKÖ-Cutovers. Er wird verpflichtend vor
dem zweiten produktiven Tenant oder vor mehreren App-/Worker-Replikaten derselben
Cell eingefuehrt und zuvor mit Prepared Statements, Transaktionen,
Advisory Locks und gegebenenfalls `LISTEN/NOTIFY` im tatsaechlichen Poolmodus
getestet.

Empfohlenes Muster:

```text
withTransaction(requestContext, async transaction => {
  Fachwrite
  abhaengige Ranking-/Bracket-Aenderung
  Fachereignis
  Outbox-Eintrag
  Idempotenzabschluss
  kontrollierter Auditabschluss
})
```

Nach dem Commit erfolgen nur wiederholbare Nebenwirkungen:

- WebSocket-Invalidierung;
- Push oder E-Mail;
- externe Exporte;
- Suchindexaktualisierung;
- weitere asynchrone Jobs.

Die persistente Outbox ist die autoritative Quelle fuer nachgelagerte
Invalidierungen und Workerarbeit. PostgreSQL `LISTEN/NOTIFY` wird in der ersten
Stufe zusaetzlich ausschliesslich als schneller, verlierbarer Weckhinweis
verwendet. Seine Payload ist auf kontrollierte Ereignisart, Objekt-ID und
Revision begrenzt und enthaelt keine freien Fach- oder Personenwerte.

App und Worker lesen nach jedem Hinweis den autoritativen Datenbankstand
beziehungsweise die Outbox. Nach Verbindungsverlust, Prozessneustart oder
verpasstem Hinweis erfolgt dieselbe Resynchronisierung; die Korrektheit darf nie
von der Zustellung eines `NOTIFY` abhaengen. Eine Redis-, NATS- oder andere
Backplane wird erst mit mehreren App-Replikaten bewertet.

Der bisherige Last-good-Fallback fuer Sheet-Fachdaten entfaellt vollstaendig.
Ist PostgreSQL nicht erreichbar oder nicht freigegeben, liefert die Anwendung
einen kontrollierten `unavailable`-/`not-ready`-Zustand und keine scheinbar
aktuellen Prozesssnapshots aus einer zweiten Wahrheit.

Zulaessig sind nur kleine bounded Caches fuer unveraenderliche oder explizit
revisionierte Kataloge wie Matchformat-Versionen. Jeder Eintrag bindet
Schemageneration und Fachrevision, wird ueber Outbox/`NOTIFY` invalidiert und
kann nach verpasstem Hinweis aus PostgreSQL neu aufgebaut werden. Writes gegen
Cache, ungeprueftes spaeteres Flushen und breite persistente App-Caches bleiben
ausgeschlossen.

Pflichten:

- kurze Transaktionen;
- feste Lockreihenfolge;
- Statement-, Lock- und Transaction-Timeouts;
- Retry nur fuer ausdruecklich sichere idempotente Transaktionen;
- keine offene DB-Transaktion waehrend externer Netzwerkwarten;
- strukturierte Abschlusslogs und Audit ohne freie Payloads.

Standardisolation ist `READ COMMITTED`. Eindeutige, partielle und spaetere
fachliche Exclusion-Constraints bleiben die letzte Integritaetsgrenze. Bestehende
Aggregate werden mit gezielten `SELECT ... FOR UPDATE`-Sperren in dokumentierter
fester Reihenfolge geschuetzt. Nur benannte Mehrzeilenplaner mit nicht anders
auszuschliessendem Phantomrisiko, insbesondere komplexe Ranglisten- und
KO-Planungen, verwenden `SERIALIZABLE`.

Automatische Transaktionswiederholungen sind ausschliesslich fuer erkannte
Serialization- und Deadlockfehler, mit begrenzter Versuchszahl und unter
derselben bereits gebundenen Operation-ID erlaubt. Fachablehnungen,
Constraintverletzungen und unbekannte Fehler werden nicht blind wiederholt.

Die Grenze betraegt drei Gesamtversuche einschliesslich Erstversuch. Jeder Retry
fuehrt den vollstaendigen Fachtransaktions-Callback unter derselben Operation-ID
und demselben Request-Hash nach vollstaendigem Rollback auf einer sauberen
Verbindung erneut aus; zwischen den Versuchen liegt kurzer zufaelliger Backoff.
Nach dem dritten Konflikt endet der Vorgang kontrolliert mit einem stabilen
Concurrency-Fehlercode.

Constraint-, Validierungs-, Statement-/Locktimeout- und unbekannte
Verbindungsfehler werden nicht durch diesen Mechanismus wiederholt. Externe
Nebenwirkungen liegen ausserhalb des Retrycallbacks und entstehen nur aus der
nachweislich committeten Outbox.

Development-App-Verbindungen starten mit `statement_timeout = 30s`,
`lock_timeout = 5s` und `idle_in_transaction_session_timeout = 15s`.
Workerverbindungen verwenden standardmaessig 60 Sekunden Statement-, fuenf
Sekunden Lock- und 30 Sekunden Idle-in-Transaction-Timeout. Einzelne registrierte
Jobtypen duerfen nur ausdruecklich begruendete abweichende Zeitbudgets setzen.

Ein PostgreSQL-Timeout bricht die Fachtransaktion vollstaendig ab; es gibt keinen
Teilcommit. Statement- und Locktimeouts werden von Appwrites nicht blind
automatisch wiederholt. Derselbe Request kann unter derselben Operation-ID erneut
eingereicht und idempotent aufgeloest werden. Automatische App-Retries bleiben
auf Serialization- und Deadlockfehler begrenzt; Worker folgen ihrem registrierten
idempotenten Retryvertrag. Bei verlorenem Verbindungsausgang wird vor jeder
Wiederholung der Operationstatus nachgelesen.

Nach vier Wochen Development-Messung wird fuer die App ein Zielwert von 15
Sekunden anhand von p99, Lock-, Import- und Lasttests bewertet und vor Live
ausdruecklich freigegeben. Migration und Import verwenden eigene CLI-/Runbook-
Zeitbudgets statt des App-Timeouts, behalten aber einen begrenzten Locktimeout.


## 19. Google Sheets und SQLite aus der Laufzeit entfernen

Die neue PostgreSQL-Version fuer `epiber_devel` enthaelt keinen aktiven
Google-Sheets- oder SQLite-Pfad mehr.

Zu entfernen sind insbesondere:

- `SheetService` und Sheets-API-Aufrufe;
- Data Poller und Last-good-Sheet-Cache;
- Developer-Metadata-Verarbeitung;
- Metadata-Intents;
- Sheet-Fingerprints und Bestaetigungsreads;
- Sheet-Recovery-Plaene;
- `SHEET_ID` und Google-Service-Account aus der Laufzeit;
- Sheet-spezifische Readiness- und Statuswerte;
- SQLite-Repositories und SQLite-Laufzeitkonfiguration;
- der Admin-Gesamtimport aus Google Sheets.

Live bleibt bis zu seinem eigenen Cutover auf dem bisherigen freigegebenen
Legacyrelease. Der neue PostgreSQL-only-Code kann deshalb zunaechst nur in
Development betrieben werden.

Beim Live-Cutover wird ein frischer Gesamtimport ausgefuehrt und anschliessend
die PostgreSQL-only-Version ausgerollt. Nach dem ersten PostgreSQL-Live-Write ist
der alte Sheetstand kein unmittelbarer Rueckfallpfad mehr.

Sobald Quellarchiv, age-Entschluesselungstest, Scaleway-Upload und Pruefsummen
verifiziert sind und der erste PostgreSQL-Live-Write den Point of no Return
ueberschritten hat, wird der Google-Service-Account aus den Sheets entfernt
beziehungsweise vollstaendig widerrufen. Service-Account-Datei und `SHEET_ID`
werden aus der Live-Konfiguration entfernt; ein read-only Laufzeitzugriff bleibt
nicht bestehen.

SQLite-Dateien werden nach bestaetigter Archiv- und PostgreSQL-Validierung aus
den aktiven Statepfaden entfernt. Das Google Sheet selbst bleibt waehrend der
Archivfrist unveraendert unter normalem Eigentuemerzugriff, ist aber keine
Anwendungsintegration mehr. Damit kann ein altes Binary oder versehentlich
gestarteter Legacydienst keinen Split Brain erzeugen.


## 20. Backup, Restore und Disaster Recovery

Fuer die erste Stufe gelten folgende Zielwerte:

| Datenbank | RPO | RTO |
|---|---:|---:|
| `epiber_devel` | 24 Stunden | 8 Stunden |
| `epiber_askoe` | 15 Minuten | 4 Stunden |

Devel und Live verwenden denselben grundsaetzlichen Backup-, WAL-Archiv- und
Restorevertrag, duerfen aber unterschiedliche Sicherungsintervalle und
Ressourcenprioritaeten besitzen. Vor dem Live-Cutover muss ein praktischer
Restore von `epiber_askoe` das Live-Ziel nachweislich einhalten. Dauerhafte
fachliche Aufbewahrung schuetzt vor regulaerer Loeschung; erst Backup und PITR
begrenzen den moeglichen Datenverlust nach Ausfall oder Korruption.

`pgBackRest` uebernimmt physische PostgreSQL-Backups, kontinuierliche
WAL-Archivierung, Retention und Point-in-Time Recovery. Development und Live
erhalten getrennte Stanzas, Repositories beziehungsweise Backupidentitaeten,
Credentials, Aufbewahrungsregeln und Monitoringzustaende. Backupverschluesselung
und Off-site-Kopie sind verpflichtend; Schluessel und Repository-Credentials
liegen nicht in PostgreSQL, Git oder Anwendungslogs.

Fuer `epiber_devel` gilt mindestens ein wochenliches Full- und taegliches
Differential-Backup bei kontinuierlicher WAL-Archivierung. Das Repository behaelt
mindestens zwei vollstaendige Backupzyklen. Ein praktischer Development-Restore
wird mindestens vierteljaehrlich ausgefuehrt und gegen das RTO von acht Stunden
gemessen.

Scaleway ist fuer Development das einzige vollstaendige pgBackRest-Repository.
Weder das unverschluesselte Root-Dateisystem noch dasselbe 10-GB-Datenvolume
halten eine zweite Full-/Differential-/Incremental-Kopie. WAL-Archivierung startet
synchron: PostgreSQL betrachtet ein Segment erst nach erfolgreichem
Scaleway-Upload als archiviert. Bei einem Ausfall bleibt es in `pg_wal`; die
pgBackRest-Spool enthaelt nur kleine Statusdateien.

Ein Queue-Limit, das WAL als archiviert bestaetigt und danach verwirft, ist
ausgeschlossen. Scaleway-Ausfall alarmiert und stoppt den Fortschritt der
Backupkette. Bei kritischer Speicherreserve aktiviert das Runbook den
Wartungsmodus und stoppt neue Fachwrites, bevor das Volume voll laeuft.
Asynchroner Push wird nur bei gemessenem Durchsatzbedarf und ebenfalls ohne
verlustbehaftete Drop-Grenze neu bewertet.

Fuer `epiber_askoe` gilt mindestens ein woechentliches Full-, ein taegliches
Differential- und alle sechs Stunden ein inkrementelles Backup. WAL wird
kontinuierlich mit `archive_timeout` von hoechstens fuenf Minuten archiviert; das
Repository behaelt mindestens vier vollstaendige Backupzyklen. Ein praktischer
Restore beziehungsweise Point-in-Time-Recovery-Test erfolgt mindestens
monatlich und wird gegen das Vier-Stunden-RTO gemessen.

Ueberwacht werden nicht nur Backupjobs, sondern insbesondere Alter des letzten
erfolgreichen Backups, Verzug des letzten archivierten WAL, Repositoryfehler,
Pruefsummen und Zeitpunkt sowie Dauer des letzten erfolgreichen Restoretests.
Retention darf nach Messung erweitert, aber nicht unter die festgelegten
Mindestzyklen reduziert werden.

Mindestens eine Off-site-Kopie liegt bei einem vom Produktionshost und dessen
Infrastrukturprovider unabhaengigen Anbieter in einer freigegebenen EU-
Datenregion. Das Ziel muss S3-kompatiblen Zugriff fuer den festgelegten
`pgBackRest`-Betrieb sowie Object Lock oder einen gleichwertigen
Unveraenderlichkeitsschutz bieten. Anbieter-/Administrationskonto,
Backupcredentials und MFA-/Break-glass-Zugriff werden von den normalen
Produktionszugriffen getrennt. Der konkrete Anbieter wird vor der ersten
produktiven Sicherung anhand von Region, Immutability, Restoreweg, Kosten und
Auftragsverarbeitung freigegeben.

Als primaeres Ziel ist Scaleway Object Storage in `fr-par` mit der
Storageklasse Standard Multi-AZ festgelegt. OVHcloud in einer franzoesischen
EU-Region bleibt dokumentierter Ausweichkandidat. Vor Betriebsfreigabe muss ein
PoC Backup, kontinuierlichen WAL-Push, Retention/Prune, vollstaendigen Restore,
Object-Lock-Wirkung, Credentialentzug und Kostenmessung erfolgreich nachweisen.

Zum Entscheidungszeitpunkt kostet Standard Multi-AZ laut Scaleway-Preisliste
rund 0,0146 EUR je GB und Monat netto; Requests und Ingress sind enthalten, 75
GB Egress pro Monat frei. Diese Werte sind vor Einrichtung erneut zu pruefen.
Fuer die erste Stufe gilt eine Kostenwarnung bei 5 EUR und eine verpflichtende
Kapazitaets-/Retentionspruefung ab 10 EUR netto pro Monat. pgBackRest-Bundling
wird im PoC aktiviert und gemessen, um die Abrechnung vieler kleiner
Objekteinheiten zu vermeiden.

Der erste Scaleway-Bucket wird mit Versionierung und Object Lock im Modus
Governance sowie 35 Tagen Default-Retention angelegt. Backup-, WAL- und regulaere
Prune-Credentials erhalten kein `BypassGovernanceRetention`. Dieses Recht liegt
ausschliesslich bei einer getrennten persoenlichen Notfallidentitaet mit MFA;
seine Nutzung verlangt explizite aktionsbezogene Bestaetigung und
unveraenderlichen Auditnachweis.

Die 35 Tage decken vier woechentliche Live-Backupzyklen mit Reserve ab.
pgBackRest darf fachlich laenger aufbewahren, aber keine gesperrte Objektversion
vorzeitig entfernen. Nach erfolgreichem Langzeit-PoC kann fuer Live ein Wechsel
zu Compliance bewertet werden; er ist keine Voraussetzung des ersten Cutovers.

In der ersten Stufe wird genau ein eigener Devel-Bucket fuer `epiber_devel`
angelegt. Erst vor dem Aufbau von `epiber_askoe` entsteht ein zweiter separater
Live-Bucket mit eigenen S3-Credentials, Bucket-Policies, Object-Lock-
Einstellungen, pgBackRest-Repositoryschluessel und Restoreberechtigungen. Devel-
und Live-Identitaeten duerfen den jeweils anderen Bucket weder schreiben noch
prunen.

Ein dauerhaft gemeinsamer Bucket mit Praefixtrennung ist ausgeschlossen. Die
Staffelung verursacht nach aktueller Scaleway-Preisstruktur keinen relevanten
Mehrpreis, weil Speicher und Egress statt einer Bucketgrundgebuehr berechnet
werden, und vermeidet anfangs trotzdem unnoetige Live-Infrastruktur.

Logische `pg_dump`-Exporte bleiben als zusaetzliche portable Tenant-Exporte und
fuer kontrollierte Migrationspruefungen vorgesehen. Sie ersetzen weder
`pgBackRest` noch WAL-Archivierung und PITR.

Fuer den reproduzierbar aus Migrationen und `full-devel`-Seeds aufbaubaren
Development-Bestand werden keine regelmaessigen logischen Exporte aufbewahrt.
Der `pg_dump`-/Restoreweg wird vor Live mindestens einmal mit synthetischem Devel
praktisch geprueft; das erzeugte Testartefakt wird danach kontrolliert geloescht.
Die physischen Devel-Backups bleiben fuer RPO, manuelle Teststaende und die
fruehe Erprobung des spaeteren Live-Backupwegs bestehen.

`epiber_askoe` erhaelt spaeter monatlich sowie unmittelbar vor jedem Major- und
riskanten Contract-Migrationsschritt einen clientseitig verschluesselten
logischen Custom-Format-Export. Die letzten drei erfolgreichen Live-Exporte
bleiben erhalten und werden regelmaessig in einer leeren Testdatenbank
restauriert. Sie sind ein Portabilitaets- und Strukturpruefweg, kein Ersatz fuer
das 15-Minuten-RPO aus WAL/PITR.

Bereits vor dem ersten Live-Cutover erforderlich:

- getrennte Live- und Devel-Backups;
- kontinuierliche WAL-Archivierung;
- PostgreSQL Point-in-Time Recovery;
- verschluesseltes Off-site-Ziel;
- immutable beziehungsweise append-only Schutz;
- markierter Pre-Cutover-Recovery-Point einschliesslich LSN;
- logischer Export von `epiber_askoe`;
- automatisierte Integritaetspruefungen;
- praktischer Restoretest;
- getrennte Backup-, Prune- und Restoreberechtigungen.

Ein `pg_dump` allein ist kein vollstaendiges PITR-Konzept.

Nach einem Restore muessen mindestens geprueft oder invalidiert werden:

- Sessions;
- Monitor- und spaetere Pushgeraete;
- offene Jobs und Leases;
- Idempotenzoperationen mit unklarem Ausgang;
- externe Zustellungen;
- zwischenzeitlich angeordnete Loeschungen.

Nach jedem produktiven Restore werden alle Browser-Sessions zwingend widerrufen
und die Konto-`auth_revision`-Werte in einer kontrollierten Recoveryoperation
erhoeht. Dadurch kann kein nach dem Restorepunkt widerrufener Cookiezustand aus
dem Backup wieder gueltig werden.

Monitor-Tokens duerfen nur erhalten bleiben, wenn eine ausserhalb des
Restorepunkts belegte aktuelle Geraeteliste den Status jedes betroffenen Geraets
eindeutig bestaetigt. Fehlt dieser Nachweis, werden die betreffenden, im Zweifel
alle Monitor-Tokens widerrufen und die Geraete neu provisioniert. Offene Jobs,
Outbox, Idempotenz, externe Zustellungen und zwischenzeitliche Loeschanordnungen
werden vor Wiederaufnahme reconciled; erst danach ist der Restore fachlich
freigegeben.


## 21. Observability und Readiness

Bereits in der ersten Stufe zu beobachten sind:

- Erreichbarkeit der richtigen PostgreSQL-Instanz;
- Connection-Pool-Auslastung;
- Query- und Transaktionsdauer;
- Deadlocks, Lockwaits und Timeouts;
- fehlgeschlagene Transaktionen;
- offene und alte Jobs beziehungsweise Outbox-Eintraege;
- Schemamigrationsstand und App-Kompatibilitaet;
- Backupalter und letzter erfolgreicher WAL-Archivtransfer;
- Zeitpunkt und Ergebnis des letzten Restoretests;
- Import- und Validierungsstatus.

Ein eigener gehaerteter `postgres_exporter`-systemd-Dienst liefert direkte
PostgreSQL-Metriken an das bestehende lokale Prometheus-Pull-System. Er verbindet
sich ausschliesslich ueber den geschuetzten Unix-Socket mit einer eigenen
read-only Monitoringrolle und lauscht fuer Metriken nur auf Loopback. Devel und
Live erhalten spaeter getrennte Targets, Credentials und Deploymentlabels.

Die bestehende Alloy-Pipeline bleibt fuer Journaldaten und Loki zustaendig und
wird nicht fuer eine neue interne PostgreSQL-Remote-Write-Strecke umgebaut.
Metriken und Dashboards duerfen keine Queryparameter, SQL-Ergebnisse,
Personenwerte oder freien Texte als Labels enthalten. `pg_stat_statements` wird
nur aggregiert ueber kontrollierte Query-ID-, Datenbank-, Dauer- und
Zaehlerdimensionen ausgewertet; freies SQL wird nicht in Dashboards oder Alerts
projiziert.

Readiness verlangt mindestens erreichbaren Pool, kompatible Schemaversion,
erforderliche Extensions und keine fehlgeschlagene Pflichtmigration.

App-Readiness wird nur bei unmittelbar unsicherem Anwendungsbetrieb negativ:
nicht erreichbare oder falsche Instanz/Tenantidentitaet, inkompatible
Schemageneration, ungueltiges Import-/Seed-Gate, fehlende Pflicht-Extension,
Checksum-/Integritaetsfehler oder unmoegliche atomare Persistenz von Fachwrite,
Idempotenz und Outbox.

Ueberfaellige Backups oder Restoretests, WAL-Verzug, Worker-Ausfall, begrenzter
Job-/Outboxrueckstand, erhoehte Latenz und Pooldruck erzeugen zunaechst einen
separaten `degraded`-Status mit Alarm und lassen Reads sowie Statuszugriff
erreichbar. Ueberschreitet Speicher-, WAL-, Job- oder Outboxzustand die
festgelegte Sicherheitsgrenze, werden nur betroffene neue Fachwrites
kontrolliert gesperrt. Ein Betriebsalarm schaltet die gesamte Anwendung nicht
automatisch ab, darf aber auch nicht als gruene Readiness verborgen werden.

App und Worker besitzen getrennte Readiness-, Status- und Shutdownvertraege. Ein
voruebergehender Worker-Ausfall setzt die Kern-App nicht automatisch auf
`not-ready`, solange Fachwrites ihre Outbox- und Jobabsicht weiterhin atomar und
sicher persistieren koennen. Offene Anzahl und Alter von Jobs und Outbox,
abgelaufene Leases sowie letzter erfolgreicher Workerzyklus erzeugen einen
kontrollierten Degradationsstatus und Alerts.

Nur ausdruecklich workerabhaengige Funktionen werden bei ueberschrittenen
fachlichen Grenzen gezielt abgewiesen. Ist die sichere Persistenz neuer
Outbox-/Jobabsichten oder die Datenbankkapazitaet nicht mehr gewaehrleistet,
lehnen betroffene Writes kontrolliert ab. Ein dauerhafter Rueckstand darf nicht
durch scheinbar gruene Gesamtreadiness verdeckt werden.

Strukturierte Betriebsereignisse duerfen nur kontrollierte IDs, Statuswerte,
Dauern, Zaehler und Fehlercodes enthalten. Personen-, Nachrichten-, Import- und
Secretwerte bleiben ausgeschlossen.

Initial gelten fuer Development folgende Alarmgrenzen:

- PostgreSQL oder Exporter laenger als zwei Minuten nicht erreichbar: kritisch;
- Verbindungsnutzung ab 70 Prozent: Warnung, ab 85 Prozent: kritisch;
- Poolwartezeit p95 ueber 250 ms fuer fuenf Minuten: Warnung;
- jeder Deadlock sowie Lockwait ueber fuenf Sekunden: Warnung;
- freier Speicher des LUKS2-Volumes unter 30 Prozent: Warnung, unter 20 Prozent:
  kritisch;
- Devel-WAL-Verzug ueber sechs Stunden: Warnung, ueber 24 Stunden: kritisch;
- letztes erfolgreiches Devel-Backup aelter als 26 Stunden: kritisch;
- letzter praktischer Devel-Restoretest aelter als 100 Tage: Warnung;
- fehlgeschlagene Pflichtmigration, ungueltiges Importgate oder
  Pruefsummenabweichung: sofort kritisch.

Job- und Outboxalter werden von Beginn an gemessen; jeder registrierte
Pflichtjobtyp erhaelt vor Aktivierung eine eigene fachliche Warn- und
Sperrgrenze. Fuer Live gelten mindestens WAL-Warnung ueber fuenf und kritischer
Alarm ueber 15 Minuten. Alle initialen Schwellen werden nach vier Wochen
gemessener Development-Nutzung ueberprueft und nur begruendet angepasst.

PostgreSQL protokolliert initial Statements ab einer Laufzeit von einer Sekunde,
Lockwaits bei `deadlock_timeout = 1s`, Deadlocks, Checkpoints, Autovacuumfehler
und Verbindungsfehler. Erfolgreiche Verbindungsauf- und -abbauten werden nicht
einzeln geloggt. App, Worker, Migration, Backup und Monitoring verwenden jeweils
einen geschlossenen kontrollierten `application_name`.

Anwendungs-SQL bleibt parametrisiert; Bindparameter, Ergebniszeilen und freie
Fachwerte duerfen nicht im PostgreSQL- oder Betriebslog erscheinen. Langsame
Queries werden ueber Query-ID, Application-Name und kontrollierte
Modul-/Operationsbezeichnung korreliert. Auch der Ein-Sekunden-Schwellenwert wird
nach vier Wochen anhand der gemessenen Verteilung ueberprueft.


## 22. Migrationswerkzeug und Validierung

Der Import ist kein einmaliges freies Skript, sondern ein wiederholbarer,
versionierter Prozess mit Dry Run.

### 22.1 Technische Pruefungen

- Counts je Quelltabelle und Zielentitaet;
- eindeutige Legacy-IDs;
- keine verwaisten Fremdschluessel;
- alle bekannten State-Keys zugeordnet;
- Zielsequenzen mindestens auf bisherigem Maximum;
- keine unerwarteten Quarantaeneobjekte;
- kanonische Record- und Aggregatpruefsummen;
- wiederholter Import erzeugt keine Dubletten.

Zusaetzlich ist fuer jede bestehende HTTP-/WebSocket-Readprojektion ein exakter
Legacy-/PostgreSQL-Vergleich erforderlich. Beide Seiten werden auf dieselbe
kontrollierte Feldmenge, stabile Sortierung und kanonische Zeit-/Leerwertform
gebracht; danach muss die Projektion datensatzgenau uebereinstimmen. Reine Counts
und Stichproben genuegen nicht.

Die kanonische Form ist JSON mit festgelegter Feldreihenfolge, stabil sortierten
Datensaetzen sowie eindeutiger Darstellung von `NULL`, Datum und Zeit. Interne
UUIDs, Importzeitpunkte und andere ausdruecklich erlaubte technische
Laufunterschiede werden ausgeschlossen oder durch stabile Vertrags-IDs
repraesentiert. Je Projektion und fuer das Gesamtmanifest wird SHA-256 gebildet.

Detaillierte Recordhashes bleiben ausschliesslich im geschuetzten
Migrations-Staging und duerfen keine zusaetzlichen Klartextexporte erzeugen.
Betriebsbericht und Logs enthalten nur Projektionsname, Anzahl, Gesamthash und
kontrollierten Abweichungscode. Pruefsummen ergaenzen Constraints,
Fremdschluessel- und Fachinvarianten; sie ersetzen diese Pruefungen nicht.

Jede erwartete Abweichung steht vor der Freigabe in einem versionierten
Ausnahmemanifest mit Grund, betroffener Projektion und Validierungsregel. Erlaubt
sind nur bereits freigegebene Migrationsfolgen wie Retention, verworfene Sessions
oder die kontrollierte Typisierung von Zeitwerten. Eine unbekannte Abweichung
blockiert den Gesamtimport.

### 22.2 Personen und Auth

- mindestens ein aktiver Admin;
- Login eindeutig und kanonisch;
- doppelte Kontakt-E-Mails weiterhin zulaessig;
- Credentials vollstaendig und nur als Hash vorhanden;
- ClubDesk-ID eindeutig;
- effektive Rollenprojektion identisch;
- keine unbekannte Rolle stillschweigend als Spieler uebernommen.

### 22.3 Spielbetrieb

- alle Matchteilnehmer aufgeloest oder ausdruecklich als BYE/PRE transformiert;
- Ranglistenmitgliedschaft pro Person eindeutig;
- aktive Raenge je Bewerb eindeutig;
- Ergebnis-, Ranking- und KO-Zusammenhaenge plausibel;
- historische Rang-Snapshots erhalten;
- Zeitwerte korrekt nach dem UTC-/Vienna-Vertrag konvertiert.

### 22.4 Messaging, Audit und Score

- Ereignis-/Empfaenger-/Receipt-Relationen vollstaendig;
- Ungelesenzaehler und Revisionen reproduzierbar;
- neueste Scoresequenz je Court identisch;
- Auditanzahl und Ergebnisverteilung innerhalb der Retention plausibel;
- alte Scorequellen ohne ungeklaerte Dubletten;
- keine personenbezogenen Inhalte in Migrationslogs.

### 22.5 Hallenzeiten

- Raster, Teilnehmer, Slots und Eintraege vollstaendig;
- Kapazitaets- und Wartelistenregeln erfuellt;
- Fachhistorie und Batchdeltas erhalten;
- keine unzulaessige doppelte Person-/Slotbelegung.

### 22.6 Automatisierte PostgreSQL-Testumgebung

Automatisierte Repository-, Service- und Integrationstests starten einen
kurzlebigen lokalen PostgreSQL-Cluster in einem zugriffsgeschuetzten temporaeren
Verzeichnis. Er verwendet einen eigenen Unix-Socket ohne TCP-Listener, wird aus
den versionierten Migrationen vollstaendig aufgebaut und laedt nur die fuer die
jeweilige Suite erforderlichen Seed-Pakete.

Nach dem Lauf werden Cluster und Datenverzeichnis kontrolliert beendet und
entfernt. Browser-Smokes verwenden eine eigene vollstaendig aufgebaute
Testdatenbank beziehungsweise einen eigenen Testcluster. Das gemeinsame
`epiber_devel` bleibt manueller und systemischer Abnahmebestand und wird nicht
von parallelen automatisierten Tests veraendert.

SQL-Repositories werden in Integrationspfaden nicht durch ein vermeintlich
kompatibles In-Memory- oder SQLite-Modell ersetzt. Reine Fachfunktionen duerfen
weiterhin ohne Datenbank getestet werden; Constraints, Locks, Isolation,
Migrationen und Wiederholungen benoetigen echtes PostgreSQL.

Jeder migrierte Kernablauf erhaelt zunaechst Repository-/Service-/Endpointtests
gegen den kurzlebigen PostgreSQL-Cluster. Die browserrelevanten Kernablaeufe fuer
Auth, Profile/Favoriten, Bewerbe/Matches/Ergebnisse, Messaging, Courts/Scoreboard
und Hallenzeiten laufen danach mindestens im `core`-Profil mit Chromium, WebKit
und Firefox.

Vor vollstaendiger Devel-Abnahme ist wegen des breiten Persistenzwechsels und der
sichtbar aufgehobenen Favoritengrenze die versionierte volle Acht-Profil-
Smokesuite aus Desktop, Android, Samsung-, iPhone- und iPad-Naeherungen Pflicht.
Die vollstaendige Chromium-Browsersuite bleibt zusaetzlich erforderlich. Keine
Engine darf als erfolgreich uebersprungen werden; unbeabsichtigte Darstellungs-
und Bedienabweichungen blockieren die Freigabe ebenso wie Fachfehler.


## 23. Migrations- und Cutover-Reihenfolge

### Phase 0: Entscheidungs- und Freigabebasis fuer `epiber_devel`

- [x] Vollstaendige Migration zuerst nach Devel, danach ohne
      dazwischengeschobene Featureentwicklung nach Live priorisiert; keine harte
      kalendarische Frist.
- [x] PostgreSQL-only-Ziel ohne Dual-Write oder produktiven Domaenenmischbetrieb
      festgelegt.
- [x] Dauerhaft synthetischer Devel-Bestand, getrennte reale Stagingprobe und
      unveraenderliches Quellpaket beschlossen.
- [x] Erste Development-Instanz auf dem bestehenden Host und verpflichtendes
      Kapazitaets-/Isolationsgate vor der Live-Instanz festgelegt.
- [x] PostgreSQL 18, native UUIDv7, interne UUID plus Legacy-/Public-ID und
      `pg_stat_statements` als initiale Extension festgelegt.
- [x] Personen-, Rollen- und State-Normalisierung bei unveraendertem sichtbarem
      Fachverhalten beschlossen.
- [x] Striktes Zeitmodell, dauerhafte Ergebnishistorie, dauerhafter getrennter
      Court-Scoreverlauf sowie Audit-, Messaging- und Archivretention festgelegt.
- [x] Node.js-/SQL-Migration Runner, `pg`-Repositories, begrenzte direkte Pools,
      gemischte Transaktionsisolation und Audit-/Idempotenzvertrag festgelegt.
- [x] Separater Einzel-Worker, persistente Jobs/Outbox und `LISTEN/NOTIFY` nur als
      Weckhinweis festgelegt.
- [x] RPO/RTO, pgBackRest, unabhaengiges EU-Off-site-Ziel, EU-/EWR-Datenregion,
      Volume-/Backupverschluesselung und systemd-Credentials festgelegt.
- [x] Unix-Socket-only, getrennte App-/Worker-Readiness, Einzelverantwortung mit
      technischen Gates und systemd statt gleichzeitiger Containerisierung
      festgelegt.
- [x] Gesamtimportblocker, exakte Projektionsparitaet, vollstaendige
      Wartungsseite, Sessionneustart und Monitor-Token-Migration festgelegt.

**Exit Phase 0:** Die Grundentscheidungen fuer Detailentwurf, Infrastruktur und
Umsetzung von `epiber_devel` sind am 25.09.2026 vollstaendig. Offene exakte
Tabellen-, Parameter-, Mess-, Deduplizierungs- und Runbookdetails gehoeren zu
Phase 1 und aendern die hier festgelegten Architektur- und Fachgrenzen nicht.

### Phase 1: Detailentwurf

- finales relationales Schema;
- vollstaendige Source-to-Target-Matrix;
- UUID-/Legacy-ID-Regeln;
- Zeitkonvertierung;
- Retentionfilter;
- synthetische Seed- und Szenariomatrix;
- Sicherheitsvertrag und Phase-3-Analyseplan fuer Score-Deduplizierung;
- Integrations-Isolationsmatrix.

**Exit Phase 1:** Vor Beginn des breiten Repository-/Serviceumbaus liegen alle
initialen SQL-Migrationen fuer das Vollschema einschliesslich Constraints,
Indizes, Rollen- und Kompatibilitaetsgeneration vor. Ein kurzlebiger
PostgreSQL-Cluster wurde damit aus leerem Zustand erfolgreich aufgebaut,
verifiziert und als kanonischer `pg_dump --schema-only`-Snapshot geprueft.

Die Source-to-Target- und Seedvertraege muessen jede initiale Tabelle erreichen;
unbekannte Schemaobjekte, unqualifizierte Referenzen, unerwartete Grants und
Drift blockieren den Exit. Bis zum ersten offiziellen gemeinsamen
`epiber_devel`-Aufbau bleibt der Erstentwurf gemaess Freezevertrag korrigierbar;
danach sind die angewendeten Migrationen unveraenderlich.

### Phase 2: PostgreSQL-Grundlage

- erste Development-Instanz; spaetere getrennte Live-Instanz erst nach dem
  Kapazitaets-/Isolationsgate;
- Rollen und Rechte;
- Migration-One-shot;
- Schema-Kompatibilitaetspruefung;
- Backup, WAL und Restore;
- Readiness und Metriken.

### Phase 3: Importwerkzeuge

- vollstaendiger Export;
- unveraendertes Staging;
- Transformation und Bereinigung;
- synthetischer Seed-Runner und getrennte reale Stagingprobe;
- reale Strukturanalyse beider historischen Scorequellen, versionierte
  Dublettenregel und synthetische Regressionen;
- Validierung;
- Importprovenienz;
- datensparsamer Abgleichbericht.

### Phase 4: Anwendungsumbau

- vollstaendiges relationales Zielschema und alle schemauebergreifenden
  Abhaengigkeiten vor dem Anwendungsumbau festschreiben;
- asynchrone PostgreSQL-Repositories;
- gemeinsame Transaktionsgrenzen;
- normalisierter State statt `app_state`;
- Jobs und Outbox;
- vollstaendige Live-Score-Persistenz;
- Entfernung von Sheets und SQLite aus dem neuen Code.

Phase 4 ist ein einziges integriertes PostgreSQL-only-Migrationsprojekt. Die
interne Implementierung besitzt wegen ihrer Abhaengigkeiten eine technische
Reihenfolge, aber keine fachlich freigegebenen oder ausgerollten
Zwischenwellen. Der laufende PAJ-Legacydienst bleibt bis zum Gesamtcutover
vollstaendig auf dem alten Stand.

Neue Repositories, Services und Transaktionsverbunde werden waehrend der
Entwicklung sofort fokussiert gegen kurzlebige PostgreSQL-Cluster getestet.
Abhaengige Tests laden ihre vollstaendige transitive Schema- und Seedkette;
domaenenuebergreifende Ablaeufe wie Ergebnis, Rangliste, KO, Messaging, Outbox und
Audit werden gemeinsam geprueft. Diese Zwischenpruefungen sind
Entwicklungsfeedback und keine Teilabnahme.

Der neue Server darf im PostgreSQL-Modus erst starten, wenn alle verpflichtenden
Domaenenrepositories registriert sind. Eine fehlende Domaene fuehrt zum
kontrollierten Startabbruch, nicht zum Rueckfall auf Sheets oder SQLite. Erst der
vollstaendige Gesamtstand durchlaeuft Systemregression, reale Stagingprobe,
Browsermatrix und Betriebsabnahme und wird danach in genau einem Devel-Cutover
auf Port 8081 freigegeben.

### Phase 5: Devel-Cutover

1. Frische `epiber_devel`-Datenbank durch alle Schemamigrationen aufbauen.
2. Versionierte synthetische Seeds laden und vollstaendig validieren.
3. Einen konsistenten realen Export getrennt in das geschuetzte, kurzlebige
   Migrations-Staging laden und den Import samt Abgleichbericht pruefen.
4. Relevante reale Sonderfaelle als minimale synthetische Regressionstests
   nachbilden und das reale Staging kontrolliert entfernen.
5. PostgreSQL-only-Anwendung gegen `epiber_devel` kontrolliert starten.
6. Login, Profile, Bewerbe, Matches, Ranglisten, Messaging, Hallenzeiten,
   Courts und Monitore pruefen.
7. Neuaufbau, Backup, Restore, Restart, Shutdown, Last und Fehlerpfade
   wiederholbar pruefen. Mindestens zwei vollstaendige Neuaufbauten aus leerer
   Datenbank muessen bei identischer Seedversion und identischem `as_of`
   dieselben kanonischen Projektionen liefern.
8. Entwicklungs- und Testbetrieb bis zum vollstaendigen Erreichen aller
   Freigabegates durchfuehren; es gilt keine kalendarische Mindestdauer.

Zum Exit gehoeren zusaetzlich ein vollstaendiger Backup-Restore, ein PITR-Test,
ein bewusst abgebrochener Import mit anschliessendem sauberen Neuaufbau,
Restart-/Shutdown-/Worker-Recovery, alle festgelegten Backend- und Browserprofile
sowie null Blocker, null ungeklaerte Operationen und null unerwartete
Projektionsabweichungen.

### Phase 6: Live-Vorbereitung

- zwei vollstaendige reproduzierbare Devel-Neuaufbauten;
- Shadow-Read-Vergleiche kontrollierter Projektionen;
- Last-, Restart-, Shutdown- und Restoretests;
- geklaerte Intents, Unknown-Operationen und Recovery-Plaene;
- benanntes Wartungsfenster, verantwortliche Person und ausdrueckliche
  aktionsbezogene Freigabe;
- bestaetigter Pre-Cutover-Backupstatus.

### Phase 7: Live-Cutover

1. Benutzer informieren, alle Courts kontrolliert deaktivieren und offene
   Zuweisungen schliessen; ein aktiver Court blockiert den Start.
2. Eine statische Wartungsseite in Caddy aktivieren;
   alle HTTP-/WebSocket-Fachreads und -writes sperren.
3. Backend kontrolliert drainieren und stoppen.
4. Vollstaendiges unveraendertes Quellarchiv erzeugen.
5. Frische `epiber_askoe`-Datenbank migrieren.
6. Finalen Gesamtbestand transformieren und importieren.
7. Technische und fachliche Validierung ausfuehren.
8. PostgreSQL-only-Version zunaechst read-only starten.
9. Fachliche Abnahme ohne riskante Writes durchfuehren.
10. Finalen PostgreSQL-Recovery-Point markieren und die Rueckfallbereitschaft des
   unveraenderten Legacyrelease letztmalig bestaetigen.
11. Writes als eigenen ausdruecklich bestaetigten Point of no Return
    kontrolliert freigeben.
12. Einen rein technischen `ops`-Smoke fuer Commit, Idempotenz, Outbox und
    Worker ausfuehren, ohne synthetische Fachobjekte anzulegen.
13. Die ersten natuerlichen Fachwrites je kritischer Domaene eng ueberwachen.
14. Fehlerquote, DB-Latenz, Pool, Outbox, Jobs und Datenabweichungen eng
    nachbeobachten.

Die Read-only-Phase verwendet gleichzeitig den Anwendungsmode fuer kontrollierte
Writeablehnungen und die technisch nicht schreibberechtigte
`epiber_live_app_readonly`-Rolle; der Worker bleibt gestoppt. Vor Schritt 11 wird
die App drainiert und mit dem getrennten Read-write-Credential neu gestartet.
Erst nach bestaetigter Writefreigabe startet der Worker. Damit kann ein
uebersehener Anwendungspfad die Rueckfallphase nicht vorzeitig durch einen
Datenbankwrite beenden.

Waehrend des gesamten finalen Exports, Imports und der internen Read-only-Abnahme
bleibt fuer Benutzer ausschliesslich die statische Wartungsseite erreichbar. Der
Legacybestand wird nicht parallel lesend angeboten, weil er nach dem finalen
Export veraltet waere. Die Wartungsseite enthaelt keine technischen Interna oder
personenbezogenen Angaben und gibt nur den kontrollierten Wartungsstatus aus.

`epiber_askoe` erhaelt keine kuenstlichen Matchresultate, Ranglistenbewegungen,
Meldungen oder Hallenzeitenbuchungen fuer Cutovertests. Der technische Smoke
schreibt ausschliesslich kontrollierte `ops`-Testobjekte und prueft Transaktion,
Idempotenz, Outbox, Worker und Bereinigung. Vollstaendige Fachwritepfade muessen
vorher in Devel und Migrations-Staging nachgewiesen sein. Nach Oeffnung werden die
ersten realen Operationen je Domaene als kontrollierter Betriebsstatus
ueberwacht; ein Fehler fuehrt zu Ablehnung, gegebenenfalls erneuter Wartungsseite
und Fix-forward, nicht zu Fake-Fachdaten.

Die Live-Migration gilt ohne kalendarische Mindestdauer als stabil abgeschlossen,
wenn technischer Write-Smoke und vorhandene natuerliche Kernoperationen
erfolgreich sind, keine ungeklaerten Writes oder kritischen Alarme bestehen,
Pool/Locks/Worker/Outbox/Latenz innerhalb ihrer Grenzen liegen, WAL und erstes
Live-Backup erfolgreich sind, Restore/PITR des unveraenderten Live-Stands
nachgewiesen wurde und Projektionen sowie Counts weiterhin stimmen.

Seltene Fachaktionen werden fuer dieses Gate nicht kuenstlich erzeugt; ihre
vollstaendigen Devel-/Staging-Nachweise gelten bis zur ersten natuerlichen
Nutzung. Erst nach diesem evidenzbasierten Exit endet die Migrationsprioritaet und
darf weitere Featureentwicklung beginnen.


## 24. Rueckfallgrenzen

### Vor dem ersten PostgreSQL-Live-Write

Der alte Live-Release und die unveraenderten Legacyquellen koennen wieder
aktiviert werden, wenn der PostgreSQL-Cutover noch keinen neuen Fachwrite
angenommen hat.

### Nach PostgreSQL-Writes bei intaktem Schema

Bevorzugt wird ein Code-Rollback auf eine mit dem aktuellen PostgreSQL-Schema
kompatible App-Version. Expand/Contract muss diesen Weg ermoeglichen.

### Rueckfall des Datastores nach PostgreSQL-Writes

Mit dem ersten bestaetigten PostgreSQL-Fachwrite ist die Rueckkehr zu Google
Sheets oder SQLite endgueltig ausgeschlossen, weil deren Stand ab dann veraltet
ist und ein Umschalten Datenverlust oder Split Brain verursachen wuerde. Es wird
kein Reverse-Replay oder Deltaexport zurueck in die Legacyquellen gebaut.

Bei einem anschliessenden Problem wird die Wartungsseite erneut aktiviert.
Zulaessig sind ausschliesslich Fix-forward, ein mit der aktuellen
Schemageneration kompatibler Code-Rollback oder PostgreSQL-Restore/PITR nach dem
festgelegten Recoveryvertrag. Legacyquellen bleiben Quellarchiv und
Migrationsnachweis, werden aber nicht erneut System of Record.


## 25. Bewusst nicht im ersten Schritt enthalten

Fuer die naechsten 10 bis 20 Mandanten derzeit nicht erforderlich sind:

- Kubernetes oder k3s;
- Service Mesh;
- Multi-Region-Betrieb;
- automatische PostgreSQL-Hochverfuegbarkeit;
- Read Replicas;
- Sharding;
- gemeinsame Tenanttabellen mit Row-Level Security;
- vollstaendige Control Plane;
- globale Benutzeridentitaet ueber mehrere Vereine;
- automatische Tenantprovisionierung;
- automatischer Flotten-Release-Controller;
- Redis-/NATS-Backplane;
- verteilte Workerflotte;
- Billing- und Tarifverwaltung;
- vollstaendige Vereinsbuchfuehrung;
- pgvector und Assistant-Tabellen;
- automatische Tenantverschiebung zwischen Clustern.

Das Datenmodell soll diese spaeteren Schritte nicht verhindern, sie aber auch
nicht vor ihrer fachlichen oder betrieblichen Notwendigkeit implementieren.


## 26. Verbleibende Artefakte und spaetere Konkretisierung

Die Architektur- und Fachentscheidungen fuer Phase 1 sind abgeschlossen. Vor
dem in Abschnitt 23 definierten Phase-1-Exit muessen noch folgende pruefbare
Artefakte erstellt werden:

1. Vollstaendige initiale SQL-Migrationskette mit allen Tabellen, Spalten,
   Constraints, Indizes, Rollen-/Grantannahmen und Beziehungen.
2. Vervollstaendigte Source-to-Target-Feldmatrix fuer die noch nicht feldgenau
   ausformulierten SQLite-Messaging-, Audit-, Score- und `app_state`-Strukturen
   sowie das versionierte Ausnahmemanifestformat.
3. Exakter synthetischer Szenariokatalog mit Paketabhaengigkeiten, Rollen-,
   Alters-, Zeit-, Ergebnis-, Fehler- und Berechtigungskonstellationen.
4. Erfolgreicher Leeraufbau in einem kurzlebigen PostgreSQL-Cluster,
   Schema-/Grantverifikation und generierter kanonischer
   `pg_dump --schema-only`-Snapshot ohne Drift.

Die bereits fachlich entschiedenen, aber erst mit ihrer Umsetzungsphase zu
erzeugenden Betriebsartefakte bleiben davon getrennt:

- Phase 2: systemd-Units, LUKS-/Swap-/Socketkonfiguration, Rollen/HBA,
  pgBackRest-/Scaleway-PoC, postgres_exporter, Dashboards und Alarmregeln;
- Phase 3: reale Scorequellenanalyse, Dublettenregel, Import-/Export-CLI und
  datensparsamer Abgleichbericht;
- Phase 5/6: gemessene Last-, Pool-, Import-, Backup- und Restorewerte sowie
  Devel-/Live-Runbooks;
- nach Live: kontrollierter Loeschlauf fuer das 370-Tage-Compliance-Archiv.

Diese spaeteren Artefakte aendern die festgelegten Vertraege nicht. Zeigt ihre
Umsetzung einen echten Widerspruch, wird die betroffene Entscheidung erneut
ausdruecklich vorgelegt, statt stillschweigend abgewandelt.


## 27. Spaetere kanonische Dokumentationsziele

Vor beziehungsweise mit der jeweiligen Umsetzung sind die bestaetigten Teile
nach gesonderter Freigabe in folgende kanonische Dokumente zu uebernehmen:

| Zieldatei | Vorgesehener Inhalt |
|---|---|
| `Project/FACHKONZEPT.txt` | Personen-/Mitgliedschaftstrennung, Vereinsverrechnung und Benutzergruppen |
| `Project/software/ARCHITEKTUR.txt` | PostgreSQL-Repositories, Transaktionen, Jobs, Outbox, State, Caches und Cutover |
| `Project/software/DATENBANK.txt` | finales PostgreSQL-Schema, Constraints, IDs, Zeitmodell und Retention |
| `Project/software/ENDPOINTS.txt` | geaenderte Projektionen, IDs, Status- und Fehlervertraege |
| `Project/server-configs/SERVER-DOKU.txt` | PostgreSQL-Instanzen, Rollen, Ports und Laufzeitzuordnung |
| `Project/server-configs/BACKUP-RESTORE-KONZEPT.md` | WAL, PITR, logische Exporte, Tenantrestore und Quellarchiv |
| `Project/server-configs/ROLLOUT-CHECKLIST.md` | Migration-One-shot, Schema-Gates, Devel- und Live-Cutover |
| `Project/2do/MANDANTEN-PLATTFORM-UND-RELEASEARCHITEKTUR.md` | Abgrenzung zwischen erster ASKÖ-Migration und spaeterer Plattformautomatisierung |

Diese Arbeitsgrundlage selbst ersetzt keine der genannten kanonischen
Dokumentationen.
