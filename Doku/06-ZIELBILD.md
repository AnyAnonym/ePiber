# Zielbild

## 1. Vision

ePiber entwickelt sich von einer einzelnen Tennisanwendung zu einer zentral
betriebenen Vereinsplattform. Der erste fachliche Schwerpunkt bleibt Tennis.
Die Plattform soll Mitglieder, Spielbetrieb, Reservierung, Kommunikation,
Geraete und Betrieb in einer standardisierten Loesung verbinden, ohne
Vereinsdaten oder Verantwortlichkeiten zu vermischen.

Das Ziel ist keine einzelne grosse Multi-Tenant-Anwendung, in der lediglich ein
`tenantId` an bestehende Tabellen angehaengt wird. Ziel ist eine Cell-
Architektur mit mehreren unabhaengigen Isolationsschichten.

## 2. Produktziel

Langfristige Produktbereiche:

- Personen, Mitgliedschaften, Konten und Rollen,
- Tennisbewerbe, Matches, Ranglisten und Turniere,
- Hallen- und Platzreservierung,
- Scoreboard, Courts, Monitore und Geraete,
- Inbox, PWA, Web Push und spaeter optionale externe Kanaele,
- Backup, Export, Loeschung, Support und Audit,
- spaeter optional weitere Vereinssektionen.

Weitere Sektionen werden strukturell vorbereitet, aber erst fachlich aktiviert,
wenn Rollen, Datenverantwortung und Sektionsgrenzen geklaert sind.

## 3. Mandantenmodell

Fuer die erste Plattformstufe gilt als Zielrichtung:

- Ein Mandant entspricht genau einem Verein.
- Ein Verein startet mit einer aktiven Sektion Tennis.
- Ein Verein kann mehrere Anlagen besitzen.
- Eine Anlage kann mehrere Plaetze besitzen.
- Plaetze koennen mehrere Scorequellen und Geraete besitzen.
- Personen, Konten, Mitgliedschaften und Rollen sind vereinslokal.
- Eine globale Mitgliederidentitaet ist zunaechst nicht vorgesehen.
- Ein Benutzer wechselt nicht tenantuebergreifend innerhalb derselben Sitzung.

Diese Begrenzung reduziert Datenschutz-, Berechtigungs- und
Identitaetskopplungen. Eine spaetere freiwillige Kontoverknuepfung bleibt eine
separate Produktentscheidung.

## 4. Control Plane und Data Plane

### 4.1 Control Plane

Die Control Plane verwaltet:

- Tenant Registry,
- Domains und Routing,
- Tarife und Entitlements,
- Provisionierung und Lifecycle,
- Releasezuordnung,
- zentrale Secrets und Schluessel,
- Backup-/Restoresteuerung,
- zeitlich begrenzte Supportfreigaben.

Sie verarbeitet keine normalen Vereinsfachdaten ohne ausdruecklichen,
auditierten Zweck.

### 4.2 Tenant Data Plane

Die Tenant Data Plane verarbeitet:

- Personen, Mitgliedschaften, Konten und Rollen,
- Spielbetrieb und Reservierungen,
- Geraete, WebSockets und Monitorstate,
- Nachrichten, Jobs und Outbox,
- Scorehistorie und Audit,
- tenantbezogene Datenbank und Objektspeicher.

Eine Data Plane darf keine anderen Vereine und keine globalen Vertragsdaten
lesen.

## 5. Vereins-Cell

Eine Vereins-Cell besteht mindestens aus:

- `epiber-app`,
- `epiber-worker`,
- eigener Tenantdatenbank,
- eigener minimal berechtigter DB-Rolle,
- eigenem Storage-Namespace,
- eigenen Tenant-Secrets,
- eigenem Domainrouting,
- eigenen Backup-/Restoreobjekten.

PostgreSQL-Cluster, Registry, Object Storage und Observability duerfen geteilt
werden, muessen aber Mandantengrenzen technisch erzwingen.

Isolationsebenen:

1. eigener Deployment-Scope,
2. eigene Datenbank und Rolle,
3. eigene Secrets und Storagepraefixe,
4. Tenantkontext in Request, WebSocket, Job, Event und Audit,
5. minimale Netzwerk- und IAM-Rechte,
6. tenantbezogene Backups und Restores,
7. negative Cross-Tenant-Tests,
8. kontrollierte betreiberseitige Observability.

## 6. PostgreSQL als System-of-Record

Fuer 20 bis 50, zunaechst maximal etwa 100 Vereine ist ein zentral betriebener
PostgreSQL-Cluster je Umgebung mit eigener Datenbank und Rolle je Verein die
bevorzugte Richtung. Test und Produktion verwenden getrennte Cluster.

PostgreSQL wird langfristig autoritativ fuer:

- Verein, Sektion, Anlagen und Plaetze,
- Personen, Mitgliedschaften, Konten und Rollen,
- Reservierungen,
- Bewerbe, Matches und Ranglisten,
- Sessions, Idempotenz und Security-State,
- Messaging, Quittierung und Outbox,
- Audit und Scorehistorie,
- Geraete und Monitorstate,
- Jobs und Migrationen.

Google Sheets bleibt zeitlich begrenzte Legacy-, Import- oder
Exportschnittstelle. Pro Domaene gibt es einen kontrollierten Cutover, keinen
dauerhaften Dual-Write.

PgBouncer oder ein gleichwertiger Pooler, kleine begrenzte Pools,
Migrationsorchestrierung und Flotteninventar sind bei vielen Tenantdatenbanken
notwendig.

## 7. Identitaetszielbild

Das heutige Personenblatt muss in eigenstaendige Konzepte zerlegt werden:

- Person: Stammdaten und Kontakt,
- Mitgliedschaft: Beziehung zum Verein beziehungsweise zur Sektion,
- Konto: Login und Credential,
- Rolle: Berechtigung in klar definiertem Scope,
- externe Identitaet: zum Beispiel ClubDesk-ID.

Privilegierte Rollen sollen spaeter MFA oder Passkeys verwenden. Supportzugriff
muss freigegeben, zeitlich begrenzt, minimal berechtigt und vollstaendig
auditiert sein.

## 8. Hallenreservierung

Der erste neue transaktionale Produktbereich soll ein begrenztes
Hallenreservierungs-MVP fuer den Heimatverein sein:

- Anlagen und Hallenplaetze,
- Oeffnungszeiten und Sperrzeiten,
- Anzeige freier Zeiten,
- eigene Reservierung und Stornierung,
- Buchungsvorlauf, Kontingent und Stornofrist,
- Datenbankconstraint gegen Doppelbuchung,
- begruendete Adminaenderungen,
- mobile Bedienung,
- interne Meldungen,
- strukturierte Logs und Audit.

Gaeste, Zahlungen, Warteliste, No-show, wiederkehrendes Training und komplexe
Prioritaeten gehoeren nur nach ausdruecklicher Fachentscheidung in den MVP.

## 9. Notification- und PWA-Zielbild

```text
Fach- oder Zeitereignis
  -> transaktionales Ereignisjournal und Outbox
  -> Berechtigung, Zielgruppe und Kontoeinstellung
  -> persoenliche Inbox
  -> optionaler Kanal wie Web Push
  -> ausdrueckliche Kenntnisnahme
```

Die Inbox bleibt verbindliche Quelle. Push ist optional und darf nie ohne
persistente Inboxmeldung entstehen. Anzeige oder Antippen eines Push quittiert
die Meldung nicht automatisch.

Zielkomponenten:

- generischer Ereigniskatalog,
- kontobezogene Abonnements,
- geraetebezogene Pushfreigaben,
- persistente Reminderjobs,
- transaktionale Outbox,
- idempotenter Worker mit Retry und Dead-Letter-Status,
- PWA-Manifest und Service Worker,
- datensparsame Sperrbildschirmtexte,
- erneute Rechtepruefung beim Oeffnen,
- Bereinigung ungueltiger Pushsubscriptions.

Eine native App ist nicht erforderlich. E-Mail kann spaeter als optionaler
Kanal hinzukommen; direkter Mailbetrieb benoetigt ein eigenes Reputations-,
Bounce-, DNS- und Betriebsmodell.

## 10. Release- und Plattformziel

Ziel ist eine Artefaktkette mit:

- reproduzierbaren OCI-Images,
- externer Registry,
- SBOM,
- Signatur und Provenance,
- unveraenderlichem Image-Digest,
- Promotion desselben Builds durch alle Ringe,
- wenigen gleichzeitig unterstuetzten Versionen,
- keinen Kundenforks.

Release-Ringe:

1. Development,
2. Internal Integration,
3. Test Users,
4. Production Pilot,
5. Production Beta,
6. Production Stable.

Datenbankmigrationen folgen Expand/Contract. Approllback und
Datenbankrollback werden nie gleichgesetzt.

## 11. Infrastrukturziel

Vorlaeufige Referenzrichtung:

- Hetzner Cloud,
- Arch Linux,
- OpenTofu fuer Ressourcen,
- Cloud-init nur fuer Bootstrap,
- Ansible fuer Hostkonfiguration,
- Podman und systemd-Quadlets,
- Caddy,
- PostgreSQL und PgBouncer,
- SOPS/age oder kontrollierter Secretdienst,
- pgBackRest oder WAL-G fuer PITR,
- Restic fuer geeignete Datei-/Konfigurationssicherungen,
- Prometheus, Loki, Alloy und Grafana.

Kubernetes ist keine Voraussetzung. Erst bei gemessenem Bedarf kommen mehrere
App-Nodes, WebSocket-Backplane, verteilter Workerbetrieb oder ein Orchestrator
hinzu.

## 12. Backup- und DR-Ziel

Die erste kommerzielle Stufe setzt bewusst auf Rebuild-and-Restore statt aktive
Hochverfuegbarkeit:

- vertrauenswuerdiges nacktes Image,
- deklarativer Hostaufbau,
- bekannte signierte OCI-Artefakte,
- kontrolliert bereitgestellte oder rotierte Secrets,
- verschluesselte Off-site-Backups,
- immutable/Object-Lock-Ziel,
- PostgreSQL-PITR,
- logische Tenantexporte,
- automatisierte Restoretests,
- Einzeltenant-Restore und Tenantumzug,
- verbindliche und gemessene RPO/RTO,
- Sicherheitsbereinigung nach Restore.

HA wird erst eingefuehrt, wenn Verfuegbarkeitszusage, Ausfallkosten oder
Messwerte den zusaetzlichen Betriebsaufwand rechtfertigen.

## 13. Nichtziele der ersten Plattformstufe

- unbegrenzte horizontale Skalierung,
- globale Vereinsidentitaet,
- Kundenforks,
- beliebige kundenspezifische Deployments,
- sofortige Kubernetesmigration,
- aktive Multi-Region-HA,
- alle denkbaren Vereinssektionen,
- vollstaendige Buchhaltung oder Paymentplattform,
- 24/7-SLA ohne personelle und technische Betriebsbasis.
