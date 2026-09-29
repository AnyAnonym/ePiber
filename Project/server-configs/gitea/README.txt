================================================================================
Interne Gitea-Development-Instanz - Installation und Betrieb
================================================================================

1. Zweck und Zugriff
================================================================================

Gitea 1.27.3 dient ausschliesslich der internen Entwicklung. Der Dienst lauscht
nur auf `127.0.0.1:3002` und besitzt keine DNS-, Caddy- oder Firewallfreigabe.
Windows erreicht ihn ausschliesslich ueber den bestehenden persoenlichen
SSH-Tunnel:

  LocalForward 127.0.0.1:13002 127.0.0.1:3002

Browser- und HTTP-Git-URL:

  http://127.0.0.1:13002/

Das HTTP-Stueck liegt nur auf den Loopbackstrecken; der Transport zwischen
Windows und Server ist durch SSH verschluesselt. Giteas eigener SSH-Server,
OpenSSH-Integration fuer Git, Caddy und externe Listener bleiben deaktiviert.


2. Laufzeit und Persistenz
================================================================================

  Paket                       gitea 1.27.3
  systemd-Dienst              gitea-devel.service, nicht aktiviert
  Unix-Benutzer               gitea, nologin
  Arbeitsverzeichnis          /var/lib/development-data/gitea
  Repositories                /var/lib/development-data/gitea/repositories
  Anwendungsdaten             /var/lib/development-data/gitea/data
  temporaere Daten            /var/lib/development-data/gitea/tmp
  Basiskonfiguration          /etc/gitea/app.ini, root:gitea 0640
  Runtimekonfiguration        /run/gitea-devel/app.ini, fluechtig 0600
  Datenbank                   gitea auf 127.0.0.1:5433
  DB-Eigentuemer              gitea_owner, NOLOGIN
  DB-Laufzeitrolle            gitea_app, LOGIN, maximal 5 Verbindungen

Die Datenbankrolle ist durch HBA und Datenbankrechte auf `gitea` begrenzt. Die
Anwendung verwendet SCRAM-SHA-256 und kein allgemeines Development-Admin-
Credential.


3. Secrets
================================================================================

Keeper ist die manuelle Verwaltungsquelle fuer:

- `gitea_app`-Datenbankpasswort;
- Gitea `SECRET_KEY`;
- Gitea `INTERNAL_TOKEN`;
- Gitea `LFS_JWT_SECRET`;
- Gitea `OAUTH2_JWT_SECRET`;
- das Passwort des ersten Administrators `paj-admin`.

Die root-only Quelldateien liegen verschluesselt unter:

  /var/lib/development-data/secrets/gitea/

`LoadCredential` stellt sie dem Dienst unter `/run/credentials/` bereit. Die
geheimnisfreie `/etc/gitea/app.ini` bleibt schreibgeschuetzt. Vor jedem Start
kopiert systemd sie nach `/run/gitea-devel/app.ini`; nur diese fluechtige Datei
erhaelt ueber `gitea config edit-ini --apply-env` das Datenbankpasswort. Der
Gitea-Hauptprozess erbt keine Passwortvariable. Die fluechtige Datei wird mit dem
RuntimeDirectory beim Stop entfernt.

Secretwerte duerfen weder in Git, Dokumentation, Journald, Prozessargumenten
noch Supportausgaben erscheinen.


4. Funktions- und Sicherheitsprofil
================================================================================

Aktiviert sind Repositories, Issues, Pull Requests, Projekte, Wiki, Releases,
HTTP-Git und Git LFS. Deaktiviert sind insbesondere:

- oeffentliche Registrierung und anonyme Ansichten;
- Gitea-/OpenSSH-Gittransport;
- Actions und Package-/OCI-Registry;
- Mail, Mirrors, Webhooks, lokale Importe, OpenID, OAuth2-Provider,
  Federation, Swagger und Metrikendpoint;
- externe Updatepruefung und Profiling.

Repositories und Benutzer-/Organisationssichtbarkeit sind standardmaessig
privat. Uploadgrenzen betragen 20 MiB fuer Web- und Issue-/PR-Anhaenge,
250 MiB fuer Releaseanhaenge und 512 MiB je LFS-Datei. Pro Benutzer oder
Organisation sind hoechstens 100 Repositories vorgesehen.

Die systemd-Unit begrenzt Gitea auf `MemoryHigh=384M`, `MemoryMax=512M`,
`MemorySwapMax=0` und `CPUQuota=100%`. `IPAddressDeny=any` mit ausschliesslicher
Loopbackfreigabe erzwingt die interne Netzgrenze zusaetzlich zur
Gitea-Listenerkonfiguration.


5. Manueller Start und Stop
================================================================================

Nach einem Hostneustart bleiben Volume, PostgreSQL und Gitea absichtlich
inaktiv. Root startet den Stack mit:

  /usr/local/sbin/development-services-start

Das Skript fragt die LUKS-Passphrase interaktiv ab, mountet und prueft das
Volume, startet PostgreSQL, wartet auf dessen Readiness und startet danach
Gitea. Die Passphrase steht weder im Skript noch in der Shell-History.

Kontrollierter Stop:

  /usr/local/sbin/development-services-stop

Das Stoppskript beendet Gitea vor PostgreSQL, leert Schreibpuffer, haengt das
Volume aus und schliesst danach das LUKS-Mapping. Ein belegtes Volume fuehrt zum
Abbruch statt zu einem erzwungenen Unmount.

Die versionierten Skripte liegen unter `Project/server-configs/bin/` und werden
root-owned mit Modus 0755 nach `/usr/local/sbin/` installiert.


6. Bewusst fehlendes Backup
================================================================================

Gitea besitzt aktuell weder lokales zugesichertes noch Off-site-Backup. Der
vollstaendige Verlust von Datenbank, Repositories, LFS, Anhaengen,
Konfiguration und Zwischenstand ist ausdruecklich akzeptiert. Keeper erhaelt nur
Secrets und ist kein Gitea-Datenbackup.

Vor geschaeftskritischer Nutzung werden Datenbank und Dateibestand koordiniert
gesichert und praktisch gemeinsam restauriert. Diese temporaere Ausnahme gilt
nicht fuer reale ePiber-Migrationsdaten oder Live.
