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
2. Alle heutigen Persistenzquellen uebernehmen.
3. Bestehendes Verhalten auf PostgreSQL stabilisieren.
4. Den neuen Stand bis mindestens Mai 2027 praktisch erproben.
5. Neue Personenverwaltung, Vereinsverrechnung und Tenantautomatisierung in
   getrennten Fachauftraegen darauf aufbauen.

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

### 3.1 Erste Betriebsstufe

Auf dem bestehenden Host werden zwei getrennte PostgreSQL-Instanzen betrieben:

```text
PostgreSQL-Live-Instanz
  -> Datenbank epiber_askoe

PostgreSQL-Development-Instanz
  -> Datenbank epiber_devel
```

Die beiden Instanzen erhalten getrennte:

- Listener beziehungsweise Unix-Sockets und Ports;
- Datenverzeichnisse;
- WAL-Verzeichnisse und WAL-Archive;
- systemd-Units;
- PostgreSQL-Rollen und Credentials;
- Ressourcenlimits;
- Backupsaetze;
- Readiness- und Monitoringzustaende.

Damit teilen Live und Development anfangs noch den physischen Host, aber nicht
denselben PostgreSQL-Prozess, dasselbe Datenverzeichnis oder dieselbe
Backupidentitaet.

### 3.2 Development-Bestand

`epiber_devel` ist fuer die naechsten sechs bis zwoelf Monate der einzige
bestaendige Entwicklungs- und Abnahmebestand.

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
- `identity.person_external_identifiers`
- `identity.memberships`
- `identity.user_accounts`
- `identity.credentials`
- `identity.role_assignments`
- `identity.sessions`
- `identity.login_rate_limits`

### 6.2 Fachliche Regeln

- Nicht jede Person oder Mitgliedschaft benoetigt ein Benutzerkonto.
- Kontakt-E-Mail und Login bleiben verschiedene Angaben.
- Eine Kontakt-E-Mail darf leer oder mehrfach verwendet sein.
- Ein belegter kanonischer Login muss innerhalb der Tenant-Datenbank eindeutig
  sein.
- Mitgliedsklassifikation `player`, `player A` oder `player B` und technische
  Berechtigungen bleiben getrennt.
- Bestehendes Rollenverhalten wird bei der Erstmigration erhalten. Neue
  Rollenklassen werden nicht gleichzeitig eingefuehrt.
- Inaktive und technische Personen werden vollstaendig migriert und nicht wegen
  ihres Status geloescht.
- Historische Referenzen bleiben erhalten.

### 6.3 Aktuelle Dokumentationsabweichung

Eine aeltere Mitgliederabgleich-Arbeitsgrundlage bezeichnet `E-Mail` noch als
Login. Massgeblich fuer das Zielmodell sind aktueller Code und kanonische
Datenbankdokumentation:

- `E-Mail` ist optionale, nicht eindeutige Kontaktinformation.
- `Login` ist die vereinslokal eindeutige Anmeldekennung.

Der Import muss ausserdem das aktuelle neue Rollenmodell aus `Mitglied`, `Admin`
und `Operator` sowie den Legacy-Fallback `Role` korrekt zu einer eindeutigen
Zielprojektion zusammenfuehren.


## 7. Spielbetrieb

### 7.1 Katalog und Bewerbe

Vorgesehene logische Tabellen:

- `play.competition_types`
- `play.match_formats`
- `play.competitions`
- `play.competition_entries`

Alle bisherigen IDs und fachlichen Eigenschaften bleiben ueber Legacy-ID und
typisierte Zielspalten nachvollziehbar.

### 7.2 Matches und Ergebnisse

Vorgesehene logische Tabellen:

- `play.matches`
- `play.match_sides`
- `play.match_participants`
- `play.match_results`
- `play.match_result_sets`
- `play.match_progressions`

Verbesserungen gegenueber dem Sheetmodell:

- `PRE` wird als offener Bracket-Slot und nicht als Personen-ID modelliert.
- `BYE` wird als eigener Slot- beziehungsweise Teilnehmertyp modelliert.
- Walkover und Retirement werden als Abschlussart gespeichert.
- `[wo]` und `[ret]` werden nicht dauerhaft an Personenreferenzen angehaengt.
- Satzresultate werden strukturiert gespeichert; der bisherige Ergebnisstring
  kann fuer kompatible Projektionen erzeugt werden.
- Historische Rang-Snapshots bleiben am Matchresultat erhalten.
- KO-Fortschreibung wird relational und transaktional an das Ergebnis gebunden.

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


## 8. Anlagen, Hallenzeiten, Courts, Monitore und Scores

### 8.1 Anlagen und Courts

Vorgesehene logische Tabellen:

- `venue.sites`
- `venue.courts`
- `venue.score_sources`
- `venue.court_assignments`
- `venue.court_live_state`
- `venue.score_events`
- `venue.monitor_devices`
- `venue.monitor_commands`
- `venue.navigation_presets`

Die heutige feste Begrenzung auf Court `1` und `2` wird nicht als dauerhaftes
Schema-Constraint uebernommen.

### 8.2 Hallenzeiten

Der JSON-State `hall-times:v1` wird relational normalisiert:

- `venue.hall_time_grids`
- `venue.hall_time_grid_participants`
- `venue.hall_time_slots`
- `venue.hall_time_allocations`
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


## 9. Messaging, Outbox, Jobs und Audit

### 9.1 Messaging

Vorgesehene logische Tabellen:

- `messaging.events`
- `messaging.event_recipients`
- `messaging.receipts`
- `messaging.deliveries`
- `messaging.comments`
- `messaging.reactions`
- `messaging.user_revisions`

Spaetere Notifications koennen ergaenzen:

- `messaging.notification_preferences`
- `messaging.push_devices`
- `messaging.reminder_jobs`
- `messaging.delivery_attempts`

Fachwrite, zentrales Ereignis, Empfaengerprojektion und Outbox-Eintrag muessen
gemeinsam gespeichert werden koennen. Externe Zustellung findet erst nach Commit
durch einen Worker statt und rollt den Fachwrite bei einem externen Fehler nicht
zurueck.

### 9.2 Idempotenz und Jobs

Vorgesehene logische Tabellen:

- `ops.idempotency_operations`
- `ops.jobs`
- `ops.outbox`

Eine Idempotenzoperation bindet Akteur, Operation-ID, Endpoint beziehungsweise
Command, Request-Hash, Status und kontrolliertes Ergebnis. `unknown` bleibt fuer
wirklich unklare externe oder Commit-Ausgaenge erhalten, wird fuer rein lokale
erfolgreiche PostgreSQL-Transaktionen aber wesentlich seltener benoetigt.

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

### 9.3 Audit

Empfohlen ist die logische Trennung in:

- `ops.audit_operations` fuer den aktuellen zusammengefassten Zustand;
- `ops.audit_transitions` fuer append-only Start- und Abschlussphasen.

Die Semantik `started -> success|failed|unknown` bleibt erhalten. Kontrollierte
Vorher-/Nachher-Projektionen duerfen als validiertes `jsonb` gespeichert werden;
freie Fachpayloads, Passwoerter und Tokens bleiben ausgeschlossen.


## 10. Zeit- und Datentypen

Fuer eindeutige fachliche Zeitpunkte gilt:

- Speicherung als `timestamptz`;
- intern eindeutige UTC-Zeit;
- Eingabe und Anzeige standardmaessig in `Europe/Vienna`.

Reine Kalendertage wie Geburtsdaten bleiben `date`. Wiederkehrende lokale
Uhrzeiten werden getrennt von absoluten Zeitpunkten modelliert.

Bestehende Formate wie `YYMMDD-HHMM` werden kontrolliert konvertiert. Ungueltige
oder bei Sommer-/Winterzeit nicht eindeutig interpretierbare Werte werden nicht
geraten und blockieren bis zur freigegebenen Korrektur den finalen Import.

Weitere Grundregeln:

- PLZ, Telefonnummern und externe IDs bleiben Text.
- Aktivitaet wird als Boolean oder kontrollierter Status gespeichert.
- `jsonb` wird nur fuer versionierte Konfiguration, kontrollierte Snapshots und
  technische Metadaten verwendet, nicht als Ersatz fuer Kernrelationen.
- PostgreSQL-native Enums werden zurueckhaltend eingesetzt, damit
  Expand/Contract-Migrationen moeglich bleiben.


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
| `operations` | nur notwendige autoritative Zustaende; offene oder `unknown` Operationen vor Cutover klaeren |
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

Das Archiv wird verschluesselt, zugriffsgeschuetzt und manipulationsgeschuetzt
abgelegt. Seine endgueltige Aufbewahrungsfrist bleibt als eigene Datenschutz- und
Betriebsentscheidung offen.

### 12.2 Vollstaendig operativ uebernommene Daten

- aktive, inaktive und technische Personen;
- alle fachlichen Referenzen;
- Bewerbe, EntryList, Matches und Ranglisten;
- alle fachlich zuordenbaren Matchresultate;
- vollstaendige Scorehistorie;
- Hallenzeiten und deren Fachhistorie;
- neutrale Bewerbs- und Matchereignisse;
- Kommentare und Reaktionen.

### 12.3 Audit

In den operativen PostgreSQL-Bestand werden die letzten 24 Monate der
Audithistorie uebernommen. Aeltere Auditdaten bleiben ausschliesslich im
vollstaendigen geschuetzten Quellarchiv.

### 12.4 Messaging

Neutrale Fachereignisse, Bewerbs-/Matchhistorie, Kommentare und Reaktionen werden
vollstaendig uebernommen. Persoenliche Zustell- und Quittierungsdetails werden
auf die letzten 24 Monate begrenzt.

### 12.5 Altes Sheet-Logging

Das fruehere freie Sheet-`Logging` wird nicht in operative PostgreSQL-Tabellen
und nicht in das neue Auditmodell importiert. Es bleibt ausschliesslich im
vollstaendigen geschuetzten Quellarchiv.

### 12.6 Historische Scores und Dubletten

- `scorelog.sqlite` ist bei sicher erkannter Ueberschneidung autoritativ.
- Zusaetzliche aeltere Sheet-Scoreereignisse werden transformiert.
- Sichere Dubletten werden nicht als zwei Fachereignisse gespeichert.
- Quellkennung, Quellschluessel und Importprovenienz bleiben erhalten.
- Unklare Ueberschneidungen blockieren den finalen Import.

Die konkreten Deduplizierungsregeln werden erst nach gesonderter Strukturanalyse
der historischen Scorequellen festgelegt.


## 13. Datenbereinigung und Migrationsprovenienz

Die bestehenden Quellen werden fuer die Migration nicht veraendert. Korrekturen
werden als versionierte, deterministische Transformationsregeln im
Migrationslauf ausgefuehrt.

Jede relevante Transformation dokumentiert mindestens:

- Importlauf-ID;
- Quelltyp und Quellobjekt;
- stabile Quellreferenz;
- Quellpruefsumme;
- kontrollierten Problemcode;
- angewendete Regelversion;
- Zielobjekt beziehungsweise Ausschlussgrund;
- Validierungsergebnis.

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


## 14. Live-nach-Development-Refresh

### 14.1 Ziel

`epiber_devel` wird initial und spaeter bei Bedarf aus einer kontrollierten,
pseudonymisierten Live-Kopie aufgebaut. Dadurch bleiben reale Datenmengen,
Beziehungen, Rollen und fachliche Konstellationen testbar, ohne produktive
Credentials oder unnoetige personenbezogene Klarwerte an Development zu geben.

### 14.2 Ablauf

```text
kontrollierter manueller Start
  -> Live-Backup beziehungsweise konsistenter Export
  -> isolierte Staging-Wiederherstellung
  -> Retention und Pseudonymisierung
  -> Entfernung produktiver Credentials und Kurzzeitstate
  -> Ersetzung externer Integrationen
  -> Validierungsbericht
  -> atomarer Austausch von epiber_devel
```

Der Refresh wird in der ersten Stufe ausschliesslich manuell gestartet. Eine
naechtliche, woechentliche oder releasegebundene Automatik ist nicht vorgesehen.

### 14.3 Pseudonymisierung

Stabile IDs und Beziehungen bleiben erhalten. Mindestens folgende Werte werden
nach einer noch festzulegenden, reproduzierbaren Policy ersetzt oder geleert:

- Vor- und Nachname;
- Login;
- Kontakt-E-Mail;
- Telefonnummer;
- Adresse und Ort;
- Geburtsdatum unter Erhaltung der fuer Altersregeln benoetigten
  Testeigenschaften;
- IP-Adressen;
- freie sensible Texte;
- persoenliche Audit- und Nachrichteninhalte, soweit fuer Tests nicht notwendig.

Die konkrete Feldmatrix muss vor dem ersten Refresh freigegeben und automatisiert
getestet werden.

### 14.4 Testkonten

Jedes pseudonymisierte Konto erhaelt einen eindeutigen Development-Login. Alle
Testkonten erhalten denselben starken Development-Testcredential.

- Der Klarwert wird nicht in PostgreSQL gespeichert.
- PostgreSQL enthaelt nur normale sichere Passwort-Hashes.
- Das Testpasswort bleibt ueber Refreshs hinweg gleich.
- Bei Verdacht oder Berechtigungswechsel muss eine kontrollierte Rotation
  moeglich sein.
- Developer-/Operator-Konten verwenden weiterhin persoenliche Credentials und
  nicht das gemeinsame Testpasswort.

### 14.5 Zugriffsschutz

Development lauscht ausschliesslich auf Loopback. Der Entwickler baut einen
SSH-Tunnel auf und greift lokal auf die Development-Origin zu. Eine frei
oeffentliche Development-Origin mit dem gemeinsamen Testpasswort ist nicht
vorgesehen.

Unbereinigte Produktivkopien duerfen kuenftigen weiteren Entwicklern nicht als
normaler Entwicklungsbestand bereitgestellt werden.

### 14.6 Externe Wirkungen

Alle produktiven externen Schreibwirkungen muessen vor Freigabe eines Refreshs
gesperrt sein. Dazu gehoeren insbesondere E-Mail, Push, Webhooks sowie spaetere
Finanz- und Buchhaltungsexporte.

Die genaue Behandlung folgender Integrationen bleibt vor dem ersten Refresh
noch festzulegen:

- produktive Courtquellen;
- Monitorcredentials und Monitorverbindungen;
- Datei- und Object-Storage-Ziele;
- weitere lesende oder schreibende externe Dienste.

Es darf keine stillschweigende Uebernahme einer produktiven Integration geben.


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

Fuer die erste Stufe koennen Geheimnisse ueber root- und systemd-geschuetzte
Credentials bereitgestellt werden. Ein zentraler Secret Manager ist noch keine
Voraussetzung.

### 16.2 Rollentrennung

Mindestens vorzusehen sind getrennte Rollen fuer:

- normale Appzugriffe ohne DDL;
- Workerzugriffe;
- Schemamigrationen;
- Backup und Restore;
- kontrollierte Devel-Refreshs;
- persoenlichen Betreiber-/Entwicklerzugriff.

Die normale Anwendung darf keine allgemeinen Schemaaenderungsrechte besitzen.


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


## 18. Repository- und Transaktionsarchitektur

Alle PostgreSQL-Repositories werden asynchron. Direkte SQL-Zugriffe bleiben auf
Repository- beziehungsweise Migrationsmodule begrenzt.

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

Pflichten:

- kurze Transaktionen;
- feste Lockreihenfolge;
- Statement-, Lock- und Transaction-Timeouts;
- Retry nur fuer ausdruecklich sichere idempotente Transaktionen;
- keine offene DB-Transaktion waehrend externer Netzwerkwarten;
- strukturierte Abschlusslogs und Audit ohne freie Payloads.


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


## 20. Backup, Restore und Disaster Recovery

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

Readiness verlangt mindestens erreichbaren Pool, kompatible Schemaversion,
erforderliche Extensions und keine fehlgeschlagene Pflichtmigration.

Strukturierte Betriebsereignisse duerfen nur kontrollierte IDs, Statuswerte,
Dauern, Zaehler und Fehlercodes enthalten. Personen-, Nachrichten-, Import- und
Secretwerte bleiben ausgeschlossen.


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


## 23. Migrations- und Cutover-Reihenfolge

### Phase 1: Detailentwurf

- finales relationales Schema;
- vollstaendige Source-to-Target-Matrix;
- UUID-/Legacy-ID-Regeln;
- Zeitkonvertierung;
- Retentionfilter;
- Pseudonymisierungsmatrix;
- Score-Deduplizierung;
- Integrations-Isolationsmatrix.

### Phase 2: PostgreSQL-Grundlage

- zwei getrennte PostgreSQL-Instanzen;
- Rollen und Rechte;
- Migration-One-shot;
- Schema-Kompatibilitaetspruefung;
- Backup, WAL und Restore;
- Readiness und Metriken.

### Phase 3: Importwerkzeuge

- vollstaendiger Export;
- unveraendertes Staging;
- Transformation und Bereinigung;
- Pseudonymisierung;
- Validierung;
- Importprovenienz;
- datensparsamer Abgleichbericht.

### Phase 4: Anwendungsumbau

- asynchrone PostgreSQL-Repositories;
- gemeinsame Transaktionsgrenzen;
- normalisierter State statt `app_state`;
- Jobs und Outbox;
- vollstaendige Live-Score-Persistenz;
- Entfernung von Sheets und SQLite aus dem neuen Code.

### Phase 5: Devel-Cutover

1. Vollstaendigen Live-Ausgangsstand sichern und exportieren.
2. Quellen in isoliertes Staging laden.
3. Retention, Transformation und Pseudonymisierung ausfuehren.
4. Frische `epiber_devel`-Datenbank migrieren und laden.
5. Vollstaendige Validierung ausfuehren.
6. PostgreSQL-only-Anwendung zunaechst kontrolliert starten.
7. Login, Profile, Bewerbe, Matches, Ranglisten, Messaging, Hallenzeiten,
   Courts und Monitore pruefen.
8. Mehrmonatigen Entwicklungs- und Testbetrieb durchfuehren.

### Phase 6: Live-Vorbereitung

- mehrere reproduzierbare Devel-Migrationslaeufe;
- Shadow-Read-Vergleiche kontrollierter Projektionen;
- Last-, Restart-, Shutdown- und Restoretests;
- geklaerte Intents, Unknown-Operationen und Recovery-Plaene;
- benanntes Wartungsfenster und Vier-Augen-Freigabe;
- bestaetigter Pre-Cutover-Backupstatus.

### Phase 7: Live-Cutover

1. Benutzer informieren und Writes stoppen.
2. Backend kontrolliert drainieren und stoppen.
3. Vollstaendiges unveraendertes Quellarchiv erzeugen.
4. Frische `epiber_askoe`-Datenbank migrieren.
5. Finalen Gesamtbestand transformieren und importieren.
6. Technische und fachliche Validierung ausfuehren.
7. PostgreSQL-only-Version zunaechst read-only starten.
8. Fachliche Abnahme ohne riskante Writes durchfuehren.
9. Writes kontrolliert freigeben.
10. Einen geplanten Testwrite pro kritischer Domaene pruefen.
11. Fehlerquote, DB-Latenz, Pool, Outbox, Jobs und Datenabweichungen eng
    nachbeobachten.


## 24. Rueckfallgrenzen

### Vor dem ersten PostgreSQL-Live-Write

Der alte Live-Release und die unveraenderten Legacyquellen koennen wieder
aktiviert werden, wenn der PostgreSQL-Cutover noch keinen neuen Fachwrite
angenommen hat.

### Nach PostgreSQL-Writes bei intaktem Schema

Bevorzugt wird ein Code-Rollback auf eine mit dem aktuellen PostgreSQL-Schema
kompatible App-Version. Expand/Contract muss diesen Weg ermoeglichen.

### Rueckfall des Datastores nach PostgreSQL-Writes

Ein direktes Umschalten auf Sheets oder SQLite ist unzulaessig, weil dabei neue
PostgreSQL-Writes verloren gingen oder Split Brain entstuende. Erforderlich
waeren Schreibstopp, Ermittlung und kontrollierter Reverse-Replay aller neuen
Aenderungen, fachlicher Abgleich und ausdrueckliche Freigabe.

Dieser Pfad wird nicht automatisch ausgefuehrt. Fix-forward oder ein
PostgreSQL-kompatibler Code-Rollback ist vorzuziehen.


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


## 26. Noch offene Detailentscheidungen

Vor der konkreten Umsetzung sind mindestens zu klaeren:

1. Exakte Tabellen, Spalten, Constraints und Beziehungen je Domaene.
2. Pseudonymisierungsregel je Personen-, Datums- und Freitextfeld.
3. Erhaltung sinnvoller Alters- und Berechtigungskonstellationen im
   Development-Bestand.
4. Vollstaendige Isolationsmatrix fuer Court, Monitor, Storage und weitere
   Integrationen.
5. Konkrete PostgreSQL-Hauptversion und notwendige Extensions.
6. Konkreter Migration Runner und sein Pruefsummen-/Lockvertrag.
7. Ports, Ressourcenlimits, WAL- und Backupziele beider Instanzen.
8. Detaillierte historische Score-Deduplizierung nach Sichtung beider Quellen.
9. Laufende Retention nach der Erstmigration.
10. Endgueltige Aufbewahrungsfrist des vollstaendigen Quellarchivs.
11. Fachliches Modell der Vereinsverrechnung.
12. Live-Wartungsfenster, Verantwortliche und Rueckfallentscheidung nach ersten
    PostgreSQL-Writes.
13. Exakte Observability-Metriken, Alarmgrenzen und Restoreintervalle.


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
