# Grenzen, Risiken und offene Fragen

## 1. Zweck

Dieses Dokument trennt bekannte Grenzen des Iststands von noch nicht
entschiedenen Zukunftsfragen. Eine offene Frage ist keine implizite
Anforderung. Vor Umsetzung muss sie fachlich, technisch oder organisatorisch
entschieden werden.

## 2. Kritische technische Grenzen

### 2.1 Google Sheets als Transaktionsgrenze

Google Sheets bietet keine atomare Compare-and-set-Transaktion fuer mehrere
Zeilen, Eindeutigkeitsregeln und lokale SQLite-Zustaende. Queues, Fingerprints,
Developer Metadata und Bestaetigungsreads reduzieren Risiken, ersetzen aber
keine Datenbanktransaktion.

Folgen:

- kontrollierter Single-Writer-Betrieb,
- komplexe Recoveryplaene,
- keine sichere horizontale Skalierung,
- eingeschraenkte Eignung fuer parallele Reservierungen,
- schwierige konsistente Gesamtsicherung.

### 2.2 Prozesslokale Koordination

Locks, Queues, WebSockets, Cooldowns und Live-Scores sind prozesslokal. Ein
zweiter aktiver Backendprozess wuerde diese Koordination nicht teilen.

### 2.3 Datenaktualitaet

Nach erfolgreichem Bootstrap gibt es kein allgemeines periodisches Polling der
Sheet-Grunddaten. Ein Last-good-Snapshot verfaellt nicht. Externe Aenderungen
koennen daher bis zum naechsten Import, Neustart oder gezielten Refresh fehlen.

### 2.4 Wiederanlauf des Live-Scores

Das ScoreLog ist Historie, nicht Wiederanlaufquelle. Nach Prozessneustart muss
die externe Courtquelle erneut eine gueltige Baseline liefern.

## 3. Produkt- und Regelluecken

Offen oder unvollstaendig sind:

- zulaessige KO-Rastergroessen und vollstaendige Rundenfolgen,
- Setzung und Freilosverteilung,
- Gleichstandsentscheidung in Gruppen,
- direkter Vergleich und Match-Tie-Break-Wertung in Gruppen,
- automatische Ueberleitung von Gruppenaufsteigern,
- fachlicher Abschluss bei beidseitiger Ranglistensanktion,
- vollstaendige Bewerbs- und Auslosungsadministration,
- Verantwortlichkeit fuer Bewerbsanlage und Teilnahmevoraussetzungen,
- Prioritaet der Informationen auf Mobilgeraet und Grossanzeige.

## 4. Betriebsrisiken

| Risiko | Auswirkung | Aktuelle Gegenmassnahme | Notwendige Zielmassnahme |
|---|---|---|---|
| kein aktiver Alarmkanal | Ausfaelle bleiben unbemerkt | manuelle Kontrolle | Pager/E-Mail/anderer getesteter Kanal |
| kein nachgewiesenes Off-site-Backup | Hostverlust kann Totalausfall bedeuten | manuelle lokale Sicherung | verschluesselte immutable Off-site-Sicherung |
| RPO/RTO offen | keine belastbare Wiederanlaufzusage | Restorekonzept | freigegebene Ziele und Messung |
| Git-Checkout-Deployment | Drift und schwerere Flottenpromotion | PAJ vor Live | signierte OCI-Artefakte und Ringe |
| Arch Rolling Release | unerwartete Plattformaenderung | manuelle Rolloutpruefung | reproduzierbarer Host-/Imageprozess |
| personeller Single Point of Failure | Support- und Wiederanlaufrisiko | Dokumentation | Stellvertretung, Runbooks, Uebungen |

## 5. Sicherheits- und Datenschutzrisiken

- Der clientseitige Passwort-Hash ist ein Passwortaequivalent.
- Lokale Prozesse liegen innerhalb der Loopback-/Forwarded-For-Vertrauensgrenze.
- Adminstatus kann personenbezogene Diagnosedaten enthalten.
- Audit- und Scorehistorie besitzen noch keine verbindliche Retention.
- Plattform-Supportzugriff, MFA/Passkeys und Access Reviews sind offen.
- Datenregion, AVV, Subprozessoren und Loeschkonzept fuer immutable Backups sind
  vor externer Vermarktung zu klaeren.
- Cross-Tenant-Isolation existiert noch nicht und muss spaeter negativ getestet
  werden.

## 6. Wartbarkeit

`sheetService.js` und `dataProvider.js` buendeln viele Verantwortlichkeiten.
Auch zentrale Integrations- und Browsertests sind gross. Das ist heute durch
gute Testabdeckung beherrschbar, erhoeht aber bei Plattformumbau und
Parallelentwicklung die kognitive Last.

Weitere Schulden:

- keine statischen Typen,
- keine standardisierte Migrationsplattform,
- synchrone SQLite-Zugriffe im Node-Eventloop,
- Gruppenwertung nur clientseitig,
- Browsertests nicht im Standard-Build,
- harte Frontend-/Backend-Versionskopplung.

## 7. Dokumentationsabweichungen

Zum Erstellungszeitpunkt sind folgende Abweichungen relevant:

- Der Code verwendet Messaging-Schema 10; einzelne kanonische Texte nennen
  noch Schema 9.
- `acknowledgeAllMessages` und Teile des Topics `competition-history` sind im
  Code weiter als einzelne Referenzabschnitte.
- Die nicht-kanonische Notificationplanung bezeichnet Teile als nicht
  implementiert, obwohl Inbox, Ereignisse, Quittierung, Kommentare und
  Reaktionen bereits existieren.
- Aeltere 2do-Unterlagen zum Mitgliederabgleich bilden nicht den vollstaendigen
  aktuellen CSV-Abgleich ab.

Fuer diese Gesamtdokumentation wurde der Code-Iststand verwendet. Die
Abweichungen sollten bei der naechsten kanonischen Main-Dokumentation
bereinigt werden.

## 8. Offene Entscheidungen vor Hallenreservierung

- Anzahl und Typ der Plaetze,
- Zeitslot und Buchungsdauer,
- Buchungsvorlauf,
- Kontingente,
- Stornofrist,
- Mitspielerpflicht,
- Gastregeln,
- Trainings- und Turniersperren,
- wiederkehrende Buchungen,
- Prioritaeten,
- Zahlung und Erstattung,
- No-show-Regeln.

## 9. Offene Entscheidungen vor Mandantenbetrieb

- genaue Definition von Mandant und Sektion,
- Trennung von Person, Mitgliedschaft, Konto und Rolle,
- Tenant-, Sektions-, Sport- und Contentrollen,
- Supportfreigabe und zeitliche Begrenzung,
- Custom Domains,
- Suspendierungs- und Offboardingverhalten,
- Datenexport und Einzeltentant-Restore,
- Datenregion und Subprozessoren,
- Produktpakete und Entitlements,
- Ressourcenlimits und Fairness,
- SLA, Supportzeit und Eskalation.

## 10. Offene Technologieentscheidungen

Die Richtung ist beschrieben, konkrete Auswahl teilweise offen:

- Registryanbieter,
- Secret Manager/KMS,
- pgBackRest oder WAL-G,
- Object-Storage-Anbieter,
- Redis, NATS oder alternative Backplane,
- WAF-/DDoS-Anbieter,
- DNS-/Domainanbieter,
- Schwelle fuer getrennten DB-Host,
- Schwelle fuer PostgreSQL-HA,
- Schwelle fuer k3s/Kubernetes, Nomad oder Managed Container Service.

## 11. Wirtschaftliche Annahmen

Planungen mit 20 bis 50, spaeter maximal etwa 100 Vereinen und Preisen um
800 bis 1.000 EUR brutto pro Verein und Jahr sind Annahmen, keine
Marktbestaetigung. Sie setzen geringe Supportzeit, standardisiertes Onboarding,
Self-Service und keine Kundenforks voraus.

Vor breitem Vertrieb sollten zahlende Pilotvereine, positiver Deckungsbeitrag,
messbare Supportlast, automatisierte Provisionierung sowie erfolgreiche
Restore- und Isolationstests nachgewiesen sein.
