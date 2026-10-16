================================================================================
PostgreSQL Development-Cluster - Installation und Betrieb
================================================================================

Status:

- Der gemeinsame PostgreSQL-18-Development-Cluster ist auf dem bestehenden Host
  technisch aufgebaut und erfolgreich gestartet, gestoppt und neu gestartet.
- Er ist produktneutral und darf getrennte Datenbanken fuer `epiber_devel`,
  Gitea und eine kleine spezifische Development-Anwendung enthalten.
- Der Cluster besitzt noch kein Off-host- oder Off-site-Backup. Gitea und die
  kleine Anwendung duerfen aufgrund einer ausdruecklich akzeptierten
  Risikoausnahme voruebergehend ohne Sicherung betrieben werden. Vollstaendiger
  Verlust ihres Zwischenstands ist akzeptiert.
- Fuer `epiber_devel` ist eine eng begrenzte Ausnahme freigegeben: Eine exakte,
  credentialbereinigte Live-Fachdatenkopie darf ohne vorherigen Backup-/Restore-
  Nachweis betrieben werden. Ihr vollstaendiger Verlust ist akzeptiert; Live
  bleibt autoritativ. Die Ausnahme ist keine Wiederherstellungszusage und gilt
  fuer kein anderes System.
- Der erste vollstaendige Hostneustart mit lokaler LUKS-Schluesseldatei wurde am
  13.10.2026 erfolgreich nachgewiesen: Cryptsetup-Unit und Mount wurden ohne
  Passworteingabe aktiv, danach starteten PostgreSQL, Gitea, M365-Konnektor,
  PAJ-PostgreSQL-App und Worker automatisch. `epiber-paj.service` blieb
  deaktiviert und inaktiv. PostgreSQL-Readiness sowie PAJ-, Gitea- und
  M365-HTTP-Pruefungen waren erfolgreich; die beteiligten Units erzeugten im
  Boot keine Warnung oder Fehlermeldung.


1. Installierte Grundlage
================================================================================

  PostgreSQL                 18.6
  pgBackRest                 2.59.1, noch nicht konfiguriert
  systemd-Dienst             postgresql-devel.service
  Unix-Systembenutzer        postgres-devel, nologin
  Eigentuemerguppe           postgres-devel
  Socket-Clientgruppe        postgres-devel-client
  Datenbankport              5433, ausschliesslich 127.0.0.1
  Unix-Socket                /run/postgresql/devel
  Clusterkennung             shared-devel
  Datenverzeichnis           /var/lib/development-data/postgresql/18/data
  WAL-Verzeichnis            /var/lib/development-data/postgresql/18/wal
  temporaeres Verzeichnis    /var/lib/development-data/postgresql/18/tmp
  pgBackRest-Spool           /var/lib/development-data/postgresql/pgbackrest-spool

Der Arch-Standarddienst `postgresql.service` ist deaktiviert und inaktiv. Der
eigene PostgreSQL-Dienst, Gitea, der M365-Konnektor, PAJ-PostgreSQL-App und Worker sind fuer den
automatischen Bootstart aktiviert und haengen vom automatisch entsperrten Mount
ab. Der deaktivierte Legacydienst `epiber-paj.service` startet nur noch auf
ausdruecklichen manuellen Auftrag.

Der Cluster wurde mit `C.utf8`, UTF-8 und Datenseitenpruefsummen initialisiert.
Das initiale Ressourcenprofil verwendet unter anderem 30 Verbindungen,
128 MiB `shared_buffers`, `MemoryHigh=768M`, `MemoryMax=1G`,
`MemorySwapMax=0` und `CPUQuota=150%`.


2. Verschluesseltes Development-Volume
================================================================================

  Hetzner-Volume             development-data, 10 GiB
  stabile Geraete-ID         /dev/disk/by-id/scsi-0HC_Volume_106975159
  LUKS-UUID                  77e54240-7e46-43dc-a41a-3e1a778df078
  LUKS-Mapping               development-data
  Dateisystem                ext4, Label development-data
  Mountpunkt                 /var/lib/development-data
  Mountoptionen              nofail,noatime,nodev,nosuid,noexec
  PostgreSQL-Bereich         /var/lib/development-data/postgresql
  Gitea-Dateibereich         /var/lib/development-data/gitea

Die LUKS-Passphrase liegt ausschliesslich in Keeper und in dem getrennt
vorgesehenen verschluesselten Offline-Recoveryweg. Sie darf nicht in Git,
Shell-History, Runbooks oder Konfigurationsdateien stehen.

Aktiver `/etc/crypttab`-Eintrag:

  development-data UUID=77e54240-7e46-43dc-a41a-3e1a778df078 /etc/cryptsetup-keys.d/development-data.key luks

Aktiver `/etc/fstab`-Eintrag:

  /dev/mapper/development-data /var/lib/development-data ext4 nofail,noatime,nodev,nosuid,noexec,x-systemd.device-timeout=120s 0 2

Das Volume wird beim Boot durch eine lokale, ausschliesslich root-lesbare
Schluesseldatei automatisch geoeffnet. Die bestehende Passphrase bleibt in einem
getrennten LUKS-Keyslot als Recoveryweg erhalten. Die Schluesseldatei liegt unter
`/etc/cryptsetup-keys.d/development-data.key` mit `root:root:0400`, darf niemals
in Git, Chat, Shellargumente oder unverschluesselte Sicherungen gelangen und wird
in dieser Dokumentation nicht ausgegeben.

Die automatische lokale Entschluesselung schuetzt weiterhin ein isoliert
entwendetes Development-Volume. Ein vollstaendiger Server- oder Root-Disk-
Snapshot enthaelt jedoch auch die Schluesseldatei und ist dadurch kein durch
diese LUKS-Schicht geschuetztes Szenario.

Falls die automatische Aktivierung fehlschlaegt, lautet der kontrollierte
manuelle Recoveryweg als root:

  cryptsetup open /dev/disk/by-id/scsi-0HC_Volume_106975159 development-data
  mount /var/lib/development-data
  findmnt /var/lib/development-data
  systemctl start postgresql-devel.service
  systemctl is-active postgresql-devel.service

Vor dem Start weiterer datenabhaengiger Dienste muessen Quelle, ext4 und die
Optionen `nosuid,nodev,noexec,noatime` nachgewiesen sein.


3. Ephemer verschluesselter Swap
================================================================================

Die bestehende 4-GiB-Partition `/dev/sda2` wird bei jedem Boot mit einem neuen
Zufallsschluessel als Plain-dm-crypt-Mapping `cryptswap` geoeffnet. Hibernation
ist ausgeschlossen; frueherer Swapinhalt ist nach einem Neustart absichtlich
nicht wiederherstellbar.

Aktiver `/etc/crypttab`-Eintrag:

  cryptswap /dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_40945166-part2 /dev/urandom swap,cipher=aes-xts-plain64,size=256

Aktiver `/etc/fstab`-Eintrag:

  /dev/mapper/cryptswap none swap defaults 0 0

Der Neustarttest muss `cryptswap` automatisch in `dmsetup ls --tree` und nur das
zugehoerige `/dev/dm-*` in `swapon --show` ausweisen. Die unverschluesselte
Partition `/dev/sda2` darf nicht direkt als Swap aktiv sein.


4. Rollen und Administration
================================================================================

Der lokale Unix-Benutzer `postgres-devel` wird ueber das Mapping `devel-admin`
auf die PostgreSQL-Superuserrolle `postgres` abgebildet. Andere Socket- und alle
Loopback-Verbindungen verlangen SCRAM-SHA-256.

Fuer DBeaver bestehen zwei getrennte Loginrollen:

  paj_devel_ro       Standardverbindung mit SELECT auf allen Tabellen und
                     Spalten der ePiber-Schemas
  paj_devel_admin    derselbe vollstaendige Lesezugriff plus INSERT, UPDATE,
                     DELETE und Sequenznutzung

Beide Rollen erhalten CONNECT auf `epiber_devel`, USAGE aber kein CREATE auf den
ePiber-Schemas und weder Superuser, CREATEDB, CREATEROLE, Replication, BYPASSRLS
noch eine Eigentuemerrollen-Mitgliedschaft. TRUNCATE, TRIGGER und freies DDL
bleiben auch fuer `paj_devel_admin` ausgeschlossen.

Der bewusst vollstaendige Lesezugriff umfasst auch technische Credential-,
Session- und Audit-Sicherheitstabellen. Die Rollen sind deshalb persoenlich,
ihre Passwoerter getrennt verwahrt und ihre Verwendung auf den SSH-Tunnel
begrenzt. `paj_devel_admin` kann mit direktem DML Anwendungsvalidierung und
Fachaudit umgehen; diese Verbindung ist nur fuer ausdruecklich beabsichtigte
Development-Arbeiten und nicht als regulaerer Anwendungspfad vorgesehen.

Die Passwoerter liegen ausschliesslich in Keeper. DBeaver verwendet einen
externen SSH-Tunnel vom lokalen Windows-Port 15433 auf Server-Loopback 5433. SSL
in DBeaver und dessen eigener SSH-Tunnel bleiben dabei deaktiviert; die
Transportverschluesselung uebernimmt SSH.

Die Rechte werden idempotent und einschliesslich der Default Privileges fuer
zukuenftige Tabellen mit folgendem kontrollierten One-shot angewendet und
verifiziert:

  runuser -u postgres-devel -- env \
    PGHOST=/run/postgresql/devel PGPORT=5433 PGDATABASE=epiber_devel PGUSER=postgres \
    EPIBER_DB_NAME=epiber_devel EPIBER_DB_OWNER_ROLE=epiber_devel_owner \
    EPIBER_DB_PERSONAL_READER_ROLE=paj_devel_ro \
    EPIBER_DB_PERSONAL_ADMIN_ROLE=paj_devel_admin \
    node /srv/http/ePiber/paj/Backend/scripts/db-personal-access.js apply

`verify` anstelle von `apply` prueft Rollenattribute, CONNECT, Schemas, alle
aktuellen Tabellen und Sequenzen, ohne Rechte zu veraendern.

Jede Anwendung erhaelt spaeter eine eigene Datenbank, Eigentuemer-, Migrations-
und Laufzeitrolle. Keine normale Anwendungsrolle erhaelt Zugriff auf eine andere
Anwendungsdatenbank. DDL erfolgt regulaer ueber den jeweiligen Migration Runner
und nicht frei aus der DBeaver-Standardverbindung.


5. Installations- und Driftpruefung
================================================================================

Die versionierten Vorlagen liegen in diesem Verzeichnis sowie unter
`Project/server-configs/systemd/` und `Project/server-configs/tmpfiles/`.
Installierte Konfigurationen duerfen keine Secrets enthalten. Vor einem Start
oder Reload sind mindestens auszufuehren:

  systemd-analyze verify /etc/systemd/system/postgresql-devel.service
  runuser -u postgres-devel -- /usr/bin/postgres -D /var/lib/development-data/postgresql/18/data -c config_file=/etc/postgresql-devel/postgresql.conf -C data_directory
  findmnt --verify

Nach dem Start sind Listener, Socketrechte, HBA-/Ident-Regeln, Checksums,
Zeitzone, Ressourcenlimits und `pg_stat_statements` praktisch zu pruefen. Der
erfolgreich gemessene systemd-Securitywert der installierten Unit betrug 3.4
(`OK`). Dieser Wert ist ein Diagnosehinweis und ersetzt keine Einzelpruefung der
Schutzmassnahmen.


6. Automatischer Boot und manueller Recovery-Stack
================================================================================

Nach einem regulaeren Hostneustart werden Volume, PostgreSQL, Gitea, der
ebenfalls auf dem Volume persistierende M365-Konnektor,
`epiber-devel.service` und `epiber-devel-worker.service` automatisch gestartet.
Schnelldiagnose bei nicht erreichbarem PAJ:

  findmnt /var/lib/development-data
  systemctl is-active postgresql-devel.service
  systemctl is-active epiber-devel.service
  systemctl is-active epiber-devel-worker.service

Fehlt der Mount oder ist einer der PostgreSQL-Dienste inaktiv, wird nicht
einzeln improvisiert gestartet, sondern der vollstaendige kontrollierte
Recoveryablauf verwendet. Er fragt bei geschlossenem Volume die bestehende
Recovery-Passphrase interaktiv ab:

  development-services-start

Die versionierten Skripte unter `Project/server-configs/bin/` werden root-owned
mit Modus 0755 nach `/usr/local/sbin/` installiert:

  development-services-start
  development-services-stop

Das Startskript entsperrt und prueft das Volume, startet PostgreSQL, wartet auf
dessen Readiness und startet danach Gitea sowie den M365-Konnektor. Anschliessend stoppt es den
Legacydienst fail-closed, startet `epiber-devel.service`, prueft dessen lokale
Readiness und startet erst danach `epiber-devel-worker.service`. Es gibt keinen
automatischen Rueckfall auf Legacy.

Das Stoppskript beendet zuerst Worker, App und M365-Konnektor, danach Gitea und PostgreSQL und
schliesst das Volume nur nach erfolgreichem Unmount. Beide Skripte schreiben
strukturierte Start-/Abschlussereignisse ohne Geheimnisse.

Der manuelle Worst-Case-Rueckfall lautet, solange kein PostgreSQL-Fachwrite einen
neueren autoritativen Stand erzeugt hat:

  systemctl stop epiber-devel-worker.service epiber-devel.service
  systemctl start epiber-paj.service

`epiber-paj.service` bleibt dabei deaktiviert und wird durch diesen manuellen
Start nicht wieder bootaktiviert.

Rueckkehr vom manuell gestarteten Legacydienst zum PostgreSQL-Standard:

  development-services-start

Das Startskript stoppt `epiber-paj.service`, startet App und Worker und gibt erst
nach erfolgreicher Readiness einen Erfolg aus. Einzelne Dienste sollen fuer
diesen Standardwechsel nicht von Hand kombiniert werden.


7. Bewusst akzeptierte Backup-Luecke
================================================================================

Der Cluster besitzt derzeit weder pgBackRest-Repository noch WAL-Archivierung,
Off-site-Sicherung oder Restoretest. Bis zu deren spaeterer Einrichtung gilt:

- Gitea und die kleine Development-Anwendung duerfen betrieben werden;
- ihr vollstaendiger Datenverlust ist bewusst akzeptiert;
- lokale Dateien oder Datenbankexports gelten nicht als zugesichertes Backup;
- `epiber_devel` darf aufgrund der ausdruecklichen PAJ-Ausnahme eine jederzeit
  aus Live neu erzeugbare, credentialbereinigte Echtdatenkopie enthalten;
- reale ePiber-Migrationsproben verwenden keinen gemeinsamen Cluster;
- vor Live, geschaeftskritischer Nutzung oder einer Wiederherstellungszusage
  bleibt der Backup-/Restore-Nachweis verpflichtend.

Diese Ausnahme ist kein Praezedenzfall fuer Live oder spaetere produktive
Plattformdienste. Die PAJ-Kopie bleibt personenbezogen und ist trotz ersetzter
Zugangsdaten entsprechend zu schuetzen.


8. Credentialbereinigter Live-zu-PAJ-Refresh
================================================================================

Der wiederholbare Refresh und die PAJ-Passwortpflege bestehen aus den
versionierten Skripten `epiber-paj-refresh-credential-set`,
`epiber-paj-password-rotate-all`, `epiber-paj-refresh-run` und den intern
verwendeten `epiber-migration-staging-run` sowie
`Backend/scripts/db-paj-refresh-swap.js`. Die Shellwerkzeuge werden root-owned mit Modus 0755
nach `/usr/local/sbin/` installiert. Die Ausfuehrung ist kein normaler
Deployment-Schritt und benoetigt fuer jeden Lauf eine neue ausdrueckliche
Freigabe.

Das Testpasswort wird niemals als Argument, in Git, Dokumentation oder Chat
uebergeben. Ein Administrator setzt es interaktiv mit:

  epiber-paj-refresh-credential-set

Das Werkzeug verlangt mindestens 10 Zeichen sowie Gross-, Kleinbuchstaben,
Ziffer und Sonderzeichen. Es schreibt ausschliesslich den clientseitigen
SHA-256-Wert nach
`/etc/epiber-devel/credentials/paj-refresh-password-hash` mit
`root:root:0400`. Dieser Wert ist credentialaequivalent und wird wie ein
Passwort geschuetzt.

Das nur vorbereitende `epiber-paj-refresh-credential-set` aendert keine bereits
aktiven PAJ-Konten. Soll das gemeinsame Testpasswort des laufenden PAJ-Bestands
sofort fuer alle Konten mit Login ersetzt werden, lautet der interaktive
root-Aufruf:

  sudo epiber-paj-password-rotate-all

Das Werkzeug verlangt dieselbe Passwortstaerke und Wiederholung sowie die
ausdrueckliche Eingabe `ROTIEREN`. Das bisherige Testpasswort wird dafuer nicht
benoetigt. Damit kann ein vergessenes gemeinsames PAJ-Testpasswort jederzeit
durch ein neues ersetzt werden, sofern administrativer Root-Zugriff auf den
PAJ-Server besteht. Live und seine Credentials bleiben unberuehrt.

Die Rotation ersetzt in einer serialisierbaren PostgreSQL-Transaktion alle
aktiven Passwortcredentials der PAJ-Konten mit Login durch individuell
gesalzene scrypt-Credentials, erhoeht deren Authrevision und widerruft alle
aktiven Sitzungen sowie offenen Passwortfreigaben. Loginlimits werden geleert,
damit das neue Passwort unmittelbar verwendet werden kann. Andere Fachdaten
werden nicht geaendert. Start, Erfolg, Ablehnung und unklarer Commit-Ausgang
werden ohne Login- oder Credentialwerte strukturiert protokolliert; der
Fachwrite besitzt einen kontrollierten System-Auditdatensatz mit ausschliesslich
Anzahlfeldern.

Erst nach erfolgreichem Datenbankcommit wird derselbe credentialaequivalente
SHA-256-Wert root-only nach
`/etc/epiber-devel/credentials/paj-refresh-password-hash` uebernommen. Dadurch
verwendet auch ein spaeterer Live-zu-PAJ-Refresh das neue Testpasswort. Meldet
die anschliessende Dateisynchronisierung ausnahmsweise `result=unknown`, wird
der Befehl mit demselben neuen Passwort wiederholt; die Wiederholung erzeugt
erneut konsistente Credentials und synchronisiert die Datei.

Vor jedem echten Lauf werden Verantwortlicher, UTC-Zeitfenster und eindeutige
Lauf-ID festgelegt. Erst nach der gesonderten aktionsbezogenen Zustimmung wird
dieselbe Lauf-ID einmalig und mit `root:root:0400` in
`/etc/epiber-devel/paj-refresh-live-export-approved` geschrieben. Danach lautet
der kontrollierte Aufruf:

  epiber-paj-refresh-run /srv/http/ePiber/paj <lauf-id>

Das Freigabefile wird vor dem ersten Livezugriff verbraucht. Der Ablauf stoppt
den Legacy-Livedienst fuer den konsistenten SQLite-/Sheet-Doppelread, startet ihn
unmittelbar danach wieder und fuehrt alle weiteren Schritte auf kurzlebigem,
verschluesseltem Storage aus. Das Profil `paj-refresh-v1`:

- ersetzt jeden Loginhash bereits beim CSV-Schreiben durch einen pro Konto
  gesalzenen scrypt-Hash des gemeinsamen Testcredentials;
- leert Passwortfreigaben, Sessions, Loginlimits und Legacy-Idempotenzstate;
- ersetzt Monitorhashes und widerruft alle importierten Monitore;
- deaktiviert produktive Court-Quellen und operative Court-Aktivzustaende bei
  unveraenderter Uebernahme von Zuordnung, Teilnehmern, letztem Score und
  Scorehistorie;
- setzt externe E-Mail-/WhatsApp-Zustellungen auf `not_configured`;
- uebernimmt keine produktiven Jobs, Outboxeintraege oder offenen Leases;
- behaelt historische fachliche Meldungs-, Receipt- und Auditdaten unabhaengig
  von den regulaeren Import-Retentiongrenzen;
- bindet den Vertrag und seine kontrollierten Anzahlen in
  `metadata/paj-refresh.json` und die Paketpruefsumme ein.

Im produktiven Reiter `EntryList` existiert rechts neben den fuenf benannten
Fachspalten ein unbenannter Nebenblock. Der Legacybetrieb ordnet ausschliesslich
die benannten Spalten `ID`, `BewerbID`, `PersonenID`, `Entrydate` und
`GebuehrBezahlt` dem EntryList-Vertrag zu. Der Export uebernimmt deshalb nur
diese fuenf Spalten. Diese Ausnahme gilt ausschliesslich fuer `EntryList`; bei
jedem anderen Pflichtreiter blockiert eine Datenzeile rechts der Kopfbreite den
Export. Der Quellfingerprint umfasst weiterhin den vollstaendigen Google-Read
einschliesslich des Nebenblocks und erkennt Aenderungen waehrend des Exports.

Das produktive `messaging.sqlite` besitzt noch die Quellstruktur vor Einfuehrung
des optionalen Feldes `event_participants.inbox_visible`. In dieser Struktur ist
jeder gespeicherte Teilnehmer zugleich ein sichtbarer Inboxempfaenger und wird
entsprechend importiert. Ist das Feld in einer neueren Quelle vorhanden, bleibt
sein expliziter Wert massgeblich. Andere fehlende oder unbekannte SQLite-Felder
blockieren weiterhin den Lauf.

Fehlt im Live-State der fuer den PostgreSQL-Appstart verpflichtende globale
Frontend-Diagnose-Datensatz, erzeugt ausschliesslich das PAJ-Refreshprofil einen
sicheren technischen Default: Diagnose deaktiviert, Mindestlevel `error`, Info-
und Debug-Sampling `0` sowie keine Zielpersonen. Ein vorhandener Live-Datensatz
hat Vorrang und wird nicht ueberschrieben.

Nach isoliertem Import, Replay und Sechs-Domaenen-Shadow-Read wird im gemeinsamen
Cluster eine frische Datenbank `epiber_devel_refresh_<hash>` aufgebaut. Erst wenn
Migrationen, technischer Seed, PAJ-Profil, Counts, Hashes, Sicherheitsinvarianten,
Shadow Read, Runtime-Grants und beide persoenlichen DBeaver-Rollen erfolgreich
geprueft sind, werden App und Worker gestoppt und die Kandidatendatenbank per
Datenbankumbenennung aktiviert. Danach startet zuerst nur die App. Readiness,
Importfingerprint, Sicherheitsinvarianten und DBeaver-Grants werden erneut
geprueft, bevor der Worker startet. So bleiben importierte Live-Jobs vom danach
regulaer neu erzeugten PAJ-Wartungsstate unterscheidbar. Bei einem Fehler
waehrend dieses Fensters wird auf die bisherige Datenbank zurueckbenannt; bei
einem frueheren Fehler bleibt sie unangetastet. Erst nach erfolgreicher
Nachpruefung und aktivem Worker wird die alte Datenbank entfernt.

Kann selbst der kataloggepruefte Rollback nicht eindeutig bestaetigt werden,
endet der Lauf mit `result=unknown`, App und Worker bleiben gestoppt und keine
der beteiligten Datenbanken wird automatisch geloescht. Dieser Zustand verlangt
eine manuelle Katalogpruefung; ein automatisches Weiterlaufen ist verboten.

Alle entschluesselten Pakete, die temporaere Datenbank und der kurzlebige
Verschluesselungsschluessel werden bei Erfolg und Fehler entfernt. Unter
`/var/lib/epiber-migration-results/<lauf-id>/` bleiben nur root-/PiberDevel-
geschuetzte, datensparsame JSONL-/Pruefnachweise ohne Passwort, Token oder freie
Fachpayloads. Produktive E-Mail-, WhatsApp-, Push-, Webhook-, Court- und
Monitorzugriffe duerfen in PAJ weiterhin nicht konfiguriert oder aktiviert sein.

Der erste reale Export und jede Ersetzung von `epiber_devel` bleiben trotz
installierter Werkzeuge bis zur jeweils neuen ausdruecklichen Lauf-Freigabe
gesperrt.
