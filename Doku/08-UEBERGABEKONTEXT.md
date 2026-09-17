# Uebergabekontext fuer Folgeprojekte

## 1. Verwendung

Dieses Dokument ist der komprimierte Einstieg fuer ein separates Analyse- oder
Planungsprojekt. Detailaussagen muessen gegen die uebrigen Dateien in `Doku/`
und bei Implementierungsentscheidungen gegen die kanonischen Quellen unter
`Project/` geprueft werden.

## 2. Gesicherte Fakten

- ePiber ist heute Single-Tenant fuer einen Tennisverein.
- Frontend: statisches HTML/CSS und Vanilla-JavaScript-Module.
- Backend: ein Node.js-26-Prozess mit HTTP und WebSocket v2.
- Google Sheets ist autoritativ fuer acht Fach- und Stammdatentabellen.
- Vier SQLite-Datenbanken halten State, Messaging, Scorehistorie und Audit.
- Caddy bildet TLS-, Routing- und Static-File-Grenze.
- systemd verwaltet getrennte Instanzen und State-Verzeichnisse.
- Rollen sind Spieler, Operator, Admin und Monitorgeraet.
- Der Server prueft Rollen und Fachregeln; Browserflags sind keine Autoritaet.
- Kritische Writes verwenden operationIds, Recoveryplaene und Audit.
- Das System ist auf einen Backendprozess und Single Writer ausgelegt.
- Inbox, Fachereignisse, Kommentare, Reaktionen und Quittierung existieren.
- Web Push, PWA und produktive externe Zustellkanaele existieren nicht.
- Hallenreservierung und Mandantenplattform existieren nicht.
- Backup-/Restorekonzepte existieren, automatisierter Off-site-Nachweis und
  aktiver Alarmweg fehlen.

## 3. Fest geplante Richtung, noch kein Iststand

- PostgreSQL wird langfristig System-of-Record.
- Ein Verein entspricht einem Mandanten.
- Jeder Verein erhaelt eine isolierte Cell mit eigener Datenbank und DB-Rolle.
- Control Plane und Tenant Data Plane werden getrennt.
- Personen, Mitgliedschaften, Konten und Rollen werden getrennte Konzepte.
- Hallenreservierung ist der erste neue transaktionale Produktbereich.
- Inbox bleibt autoritativ; Push ist nur optionaler Kanal.
- OCI-Images werden signiert und durch Release-Ringe promoviert.
- Erste kommerzielle Betriebsstufe nutzt Rebuild-and-Restore statt aktiver HA.
- Skalierung und Orchestratorwahl folgen Messwerten.

## 4. Noch zu validierende Annahmen

- 20 bis 50 Vereine innerhalb von drei bis vier Jahren.
- erste Architekturgrenze von etwa 100 Vereinen.
- 70 bis 250 Mitglieder und 35 bis 125 Konten je Verein.
- Preise um 800 bis 1.000 EUR brutto pro Verein und Jahr.
- geringer manueller Support durch Standardisierung und Self-Service.
- Hetzner, Arch, OpenTofu, Ansible und Podman bleiben geeigneter Zielstack.
- eine Datenbank je Tenant ist bei der Zielgroesse wirtschaftlich betreibbar.

## 5. Entscheidungen mit hoechster Prioritaet

1. Personen-/Mitgliedschafts-/Konto-/Rollenmodell freigeben.
2. Reservierungsregeln fuer den MVP festlegen.
3. RPO, RTO, Retention und Datenregion entscheiden.
4. aktiven Alarmkanal und Off-site-Backup umsetzen.
5. PostgreSQL-Migrations- und Cutoverstrategie bestaetigen.
6. Supportzugriff, MFA und Betreiberrollen definieren.
7. Produktpakete, Limits und Pilotkriterien festlegen.

## 6. Architekturregeln fuer neue Konzepte

- Kein dauerhaftes Dual-Write fuer dieselbe Domaene.
- Keine Mandantenfaehigkeit nur durch ungeprueftes `tenantId`.
- Tenantkontext muss in Request, WS, Job, Event, Audit und Cache gelten.
- Jede Cell besitzt eigene DB-Rolle, Secrets und Backupobjekte.
- Cross-Tenant-Negativtests sind Pflicht.
- Keine fachliche Speicherung nur im Browser oder App-Container.
- Reservierungen benoetigen Datenbankconstraints gegen Doppelbuchung.
- Inbox ist System-of-Record; Push ist ein abgeleiteter Kanal.
- Approllback ist kein Datenbankrollback.
- Restorefaehigkeit und Observability sind Teil der Funktion.
- Freie Payloads, Secrets und unnoetige Personendaten gehoeren nicht in Logs.
- Keine Kundenforks; Unterschiede werden ueber Konfiguration und Entitlements
  abgebildet.

## 7. Hauptabhaengigkeiten

```text
Fachmodell + Betriebsbasis
  -> PostgreSQL + Identitaet
      -> Reservierungs-MVP
      -> Messaging/Outbox/Worker
          -> PWA/Web Push
      -> restliche Domaenenmigration
          -> Vereins-Cells
              -> Release-Ringe
                  -> externer Pilot
                      -> kommerzielle Skalierung
```

Die reproduzierbare Infrastruktur kann parallel aufgebaut werden, darf aber
nicht als Ersatz fuer Fachmodell, Datenmigration oder Restorefaehigkeit
verstanden werden.

## 8. Begriffe

| Begriff | Bedeutung |
|---|---|
| Mandant | ein Verein |
| Sektion | fachlicher Vereinsbereich, anfangs nur Tennis |
| Cell | isolierte App-/Worker-/DB-/Secret-/Backup-Einheit eines Vereins |
| Control Plane | Provisionierung, Domains, Releases, Entitlements und Lifecycle |
| Data Plane | Vereinsfachdaten und deren Verarbeitung |
| Last-good | letzter vollstaendig validierter Sheet-Snapshot |
| operationId | stabile ID fuer Idempotenz und Recovery eines Writes |
| Unknown | Writeausgang kann nicht sicher als Erfolg oder Fehler bestaetigt werden |
| Outbox | transaktional gespeicherte, spaeter zu verarbeitende Ereignisse |
| PITR | Point-in-time Recovery einer PostgreSQL-Datenbank |
| RPO | maximal akzeptierter Datenverlustzeitraum |
| RTO | maximal akzeptierte Wiederanlaufzeit |
| Release-Ring | gestufte Zielgruppe fuer Promotion desselben Artefakts |

## 9. Fragen fuer ein separates Planungsprojekt

### Produkt

- Welches konkrete Problem loest ePiber besser als bestehende Vereinssoftware?
- Welche Funktionen gehoeren verpflichtend ins Basispaket?
- Welche Vereinsgroesse und Organisationsform ist der ideale erste Kunde?
- Welche manuellen Ablaeufe sollen bewusst manuell bleiben?

### Reservierung

- Welche Regeln gelten fuer Zeitraster, Vorlauf, Kontingent und Stornierung?
- Welche Rolle spielen Gaeste, Training, Turniere, Zahlung und No-show?
- Wie werden Konflikte und Adminuebersteuerungen kommuniziert?

### Plattform

- Welche Isolation ist regulatorisch und wirtschaftlich erforderlich?
- Wer darf wann auf Tenantdaten zugreifen?
- Wie werden Provisionierung, Export, Suspendierung und Loeschung abgenommen?
- Welche Messwerte loesen den naechsten Skalierungsschritt aus?

### Betrieb

- Wer reagiert auf Alerts, Sicherheitsvorfaelle und Restorebedarf?
- Welche RPO/RTO werden vertraglich zugesagt?
- Wie oft werden Restore, Tenantumzug und Host-Rebuild geuebt?
- Welche Abhaengigkeiten benoetigen einen Exit- oder Ersatzplan?

### Wirtschaft

- Welche Supportzeit ist pro Verein realistisch?
- Welche Kosten entstehen pro Cell, Datenbank, Backup und Pushvolumen?
- Wie viele Pilotvereine sind fuer Markt- und Betriebsvalidierung notwendig?
- Welche Leistungen werden explizit nicht als 24/7-Service angeboten?

## 10. Erwartete Ergebnisse eines Folgeprojekts

Ein nachgelagertes Projekt sollte seine Ergebnisse nicht nur als Ideenliste,
sondern mindestens in folgender Form liefern:

- bestaetigte Ziele und Nichtziele,
- Entscheidungen mit Begruendung und Verantwortlichem,
- fachliche Modelle und Invarianten,
- Architektur und Vertrauensgrenzen,
- Datenklassifikation und Retention,
- Migrations- und Rueckfallstrategie,
- messbare Akzeptanz- und Exitkriterien,
- Risiken mit Gegenmassnahme,
- Betriebs- und Supportmodell,
- priorisierte Roadmap mit Abhaengigkeiten.
