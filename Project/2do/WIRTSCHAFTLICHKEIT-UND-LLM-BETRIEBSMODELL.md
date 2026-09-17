# Wirtschaftlichkeit und LLM-gestuetztes Betriebsmodell

Stand: 15.09.2026
Status: Nicht-kanonische kaufmaennische und technische Arbeitsgrundlage; keine
verbindliche Preis-, Steuer-, Rechts-, Personal- oder Investitionsberatung
Gegenstand: Wirtschaftliche Planung einer zentral betriebenen ePiber-SaaS fuer
Tennisvereine mit LLM-gestuetzter Entwicklung, Organisation und Kundenservice

Diese Datei ist eine nicht-kanonische Arbeitsgrundlage unter `Project/2do/`.
Sie dokumentiert Planungsannahmen und Rechenmodelle fuer die geplante
Mandantenplattform. Alle Betragswerte sind bewusst Bandbreiten und muessen vor
einer Produkt-, Preis- oder Investitionsentscheidung mit Angeboten, realen
Nutzungsdaten, Steuerberatung, Datenschutzberatung und Kundeninterviews
validiert werden.

Die Betrachtung setzt voraus, dass ePiber zentral als SaaS betrieben wird. Ein
Mandant ist ein Tennisverein mit Mitgliedern, Funktionaeren, mehreren Anlagen
und Plaetzen. Die technische Zielarchitektur ist die in
`Project/2do/MANDANTEN-PLATTFORM-UND-RELEASEARCHITEKTUR.md` beschriebene
Vereins-Cell auf gemeinsam genutzter, gemanagter Plattforminfrastruktur.

## 1. Kernannahmen

### 1.1 Preisannahme

Der aktuelle Diskussionsrahmen lautet:

```text
800 bis 1.000 EUR brutto je Verein und Jahr
```

Fuer die Beispielrechnung wird von 20 Prozent Umsatzsteuer ausgegangen. Der
Nettoumsatz ist fuer Kosten, Deckungsbeitrag und Personal relevant.

| Bruttopreis/Jahr | Umsatzsteuer | Nettoumsatz/Jahr | Netto/Monat |
|---:|---:|---:|---:|
| 800 EUR | 133,33 EUR | 666,67 EUR | 55,56 EUR |
| 900 EUR | 150,00 EUR | 750,00 EUR | 62,50 EUR |
| 1.000 EUR | 166,67 EUR | 833,33 EUR | 69,44 EUR |

Die Umsatzsteuer ist kein Ertrag. Rechnungen, Reverse Charge, Kleinunternehmer-
Grenzen, Auslandskunden, Vorsteuer und konkrete Steuerpflichten sind mit einer
Steuerberatung zu klaeren.

### 1.2 Durchschnittlicher Umsatz pro Tenant

Der Listenpreis darf nicht mit dem langfristig realisierten Umsatz verwechselt
werden. Rabatte, Pilotpreise, Jahreswechsel, Kuendigungen und eingeschlossene
Leistungen senken den Durchschnitt.

Fuer die konservative Erstplanung wird verwendet:

```text
Durchschnittlicher Nettoumsatz pro aktivem Tenant und Jahr: 750 EUR
Durchschnittlicher Nettoumsatz pro aktivem Tenant und Monat: 62,50 EUR
```

Dieses Modell unterstellt einen Brutto-Durchschnittspreis von 900 EUR/Jahr. Ein
spaeteres Preis- und Paketmodell soll den durchschnittlichen Nettojahresumsatz
durch Add-ons, Onboarding und groessere Vereine erhoehen, ohne die Basis fuer
kleine Vereine unzugaenglich zu machen.

### 1.3 Zielgroesse und Betriebsform

Planungsstufen:

| Stufe | Aktive Vereine | Betriebscharakter |
|---|---:|---|
| Validierung | 1 bis 20 | Pilot und Produktfindung |
| Nebenbetrieb | 20 bis 100 | One-Man-Show im bestehenden Unternehmen |
| Tragfaehige Einzelunternehmung | 100 bis 200 | hohe Automatisierung, externe Spezialisten |
| Kleine Produktorganisation | 200 bis 500 | erste feste Rollen und Vertretung |
| Skalierter SaaS-Betrieb | ueber 500 | strukturierte Produkt-, Support- und Operationsorganisation |

Das Ziel der ersten Phase ist nicht, bei 20 Vereinen eine Vollzeitorganisation
zu finanzieren. Es ist, das Produkt, den Vertriebskanal, die Zahlungsbereitschaft
und den tatsaechlichen Supportaufwand mit begrenztem Risiko zu validieren.

## 2. Umsatzszenarien

### 2.1 Basisrechnung bei 900 EUR brutto pro Jahr

| Vereine | Bruttoumsatz/Jahr | Nettoumsatz/Jahr | Netto/Monat |
|---:|---:|---:|---:|
| 20 | 18.000 EUR | 15.000 EUR | 1.250 EUR |
| 50 | 45.000 EUR | 37.500 EUR | 3.125 EUR |
| 100 | 90.000 EUR | 75.000 EUR | 6.250 EUR |
| 150 | 135.000 EUR | 112.500 EUR | 9.375 EUR |
| 200 | 180.000 EUR | 150.000 EUR | 12.500 EUR |
| 300 | 270.000 EUR | 225.000 EUR | 18.750 EUR |
| 500 | 450.000 EUR | 375.000 EUR | 31.250 EUR |

### 2.2 Preissensitivitaet

| Vereine | 800 EUR brutto | 900 EUR brutto | 1.000 EUR brutto |
|---:|---:|---:|---:|
| 20 | 13.333 EUR netto | 15.000 EUR netto | 16.667 EUR netto |
| 50 | 33.333 EUR netto | 37.500 EUR netto | 41.667 EUR netto |
| 100 | 66.667 EUR netto | 75.000 EUR netto | 83.333 EUR netto |
| 200 | 133.333 EUR netto | 150.000 EUR netto | 166.667 EUR netto |
| 300 | 200.000 EUR netto | 225.000 EUR netto | 250.000 EUR netto |

Eine Preisdifferenz von 100 EUR brutto pro Jahr bewirkt bei 100 Vereinen nur
8.333 EUR zusaetzlichen Jahresnettoumsatz. Viel wichtiger als ein geringer
Preisaufschlag sind daher:

- niedrige Kuendigungsrate;
- standardisiertes Onboarding;
- geringe manuelle Supportzeit je Verein;
- keine kundenspezifischen Forks;
- kostenpflichtige Sonderleistungen;
- funktionierende Add-ons mit erkennbarem Nutzen.

### 2.3 Einmalige Umsaetze

Die wiederkehrende Jahresgebuehr soll nicht alle einmaligen Einfuehrungsarbeiten
querfinanzieren. Sinnvolle separat kalkulierte Leistungen sind:

| Leistung | Planungsbandbreite netto | Bemerkung |
|---|---:|---|
| Standard-Onboarding | 400 bis 1.000 EUR | Einrichtung, Konfiguration, Schulung |
| Datenmigration | 500 bis 2.500 EUR | abhaengig von Qualitaet und Quelle |
| Vor-Ort-Schulung | nach Aufwand | Reise und Durchfuehrung getrennt |
| Individuelle Datenbereinigung | nach Aufwand | kein Bestandteil des Basispakets |
| Sonderintegration | nach Aufwand | nur bei wiederverwendbarem Nutzen priorisieren |
| Custom Domain oder Premium-Setup | 100 bis 500 EUR | je nach Automatisierungsgrad |

Einmalige Umsaetze verbessern Liquiditaet, duerfen aber nicht zur Deckung
laufender Fixkosten eingeplant werden. Sie sind kein Ersatz fuer ausreichend
hohen wiederkehrenden Umsatz.

## 3. Preis- und Paketmodell

### 3.1 Grundsatz

800 bis 1.000 EUR brutto pro Jahr kann ein marktfaehiger Einstiegspreis sein,
wenn der Verein einen klaren, wiederkehrenden Nutzen erkennt. Er ist kein Preis
fuer unbegrenzte individuelle Entwicklung, permanente manuelle Datenpflege oder
Support ohne Grenzen.

Das Produkt muss als Vereinsbetriebsplattform positioniert werden, nicht nur als
Scoreboard oder einzelne Turnierseite:

- Platzreservierung;
- Mitglieder- und Stammdatenverwaltung;
- Spielbetrieb, Ranglisten und Turniere;
- Monitor- und Scoreboard-Funktionen;
- Rollen, Kommunikation und Selbstverwaltung;
- Datenschutz, Backup und wartbarer Betrieb.

### 3.2 Moegliche Pakete

Die folgenden Preise sind keine Freigabe, sondern eine Hypothese fuer
Kundeninterviews und Pilotangebote:

| Paket | Brutto/Jahr | Zielgruppe | Kernumfang |
|---|---:|---|---|
| Basis | 800 bis 1.000 EUR | kleiner Verein | Kernplattform, definierte Limits, Standard-Support |
| Professional | 1.200 bis 1.800 EUR | typischer aktiver Verein | Reservierung, erweiterte Verwaltung, mehr Plaetze/Geraete |
| Premium | 2.000 bis 4.000 EUR | grosse Anlage | erweiterte Integrationen, priorisierter Support, mehr Limits |
| Enterprise | individuell | besondere Anforderungen | dedizierte Cell/DB-Cluster, SSO, SLA, Custom Domain |

Moegliche Add-ons:

- Reservierungsmodul;
- zusaetzliche Anlage oder viele Plaetze;
- zusaetzliche Monitore/Geraete;
- Premium-Support;
- Custom Domain;
- Datenimport und Migration;
- zusaetzliche Kommunikations- oder Reportingfunktionen.

### 3.3 Preisvalidierung

Vor einem verbindlichen Preis sollten mindestens 15 bis 20 Vereine strukturiert
befragt werden. Nicht nur nach "waere das interessant?", sondern nach:

- welcher konkrete Prozess heute Zeit oder Geld kostet;
- welche bestehenden Werkzeuge bezahlt werden;
- wer im Verein das Budget entscheidet;
- welches Jahresbudget fuer Vereinssoftware vorhanden ist;
- welche Funktion den Kauf ausloest;
- welche Support- und Einfuehrungserwartung besteht;
- ob 800, 1.200 oder 1.500 EUR als realistische Jahresinvestition gelten;
- ob ein einmaliges Onboarding akzeptiert wird.

Zahlungsbereitschaft ist erst bestaetigt, wenn ein Verein einen Pilotvertrag,
eine Anzahlung oder eine verbindliche Bestellabsicht abgibt.

## 4. Kostenmodell ohne LLM-Unterstuetzung

Diese Vergleichsrechnung zeigt, warum ein klassisches personalintensives
Modell bei dem Preisrahmen erst bei sehr vielen Vereinen funktioniert.

### 4.1 Jaehrliche Sachkosten, konservativer professioneller Betrieb

| Kostenblock | 20 Tenants | 50 Tenants | 100 Tenants |
|---|---:|---:|---:|
| Produktion: Compute, DB, Storage, Netzwerk | 8.000 bis 16.000 EUR | 14.000 bis 28.000 EUR | 24.000 bis 50.000 EUR |
| Test, CI, Registry und Entwicklungsdienste | 2.000 bis 6.000 EUR | 3.000 bis 8.000 EUR | 4.000 bis 12.000 EUR |
| Backups, Monitoring, Logging, Mail, Domains | 3.000 bis 8.000 EUR | 5.000 bis 12.000 EUR | 8.000 bis 20.000 EUR |
| Recht, Datenschutz, Buchhaltung, Versicherung | 5.000 bis 15.000 EUR | 7.000 bis 20.000 EUR | 10.000 bis 25.000 EUR |
| **Sachkosten gesamt** | **18.000 bis 45.000 EUR** | **29.000 bis 68.000 EUR** | **46.000 bis 107.000 EUR** |

Die Spannen enthalten bewusst einen professionellen Anspruch mit Backups,
Monitoring, Security und getrennten Umgebungen. Sie sind keine Anbieterangebote.
Mit schlankerem Managed-Cloud-Setup und moderatem Logvolumen koennen die Werte
niedriger liegen; mit Hochverfuegbarkeit, vielen Daten, 24/7-Alerting oder
umfangreichen Integrationen deutlich hoeher.

### 4.2 Personalvollkosten

Typische Jahresvollkosten im deutschsprachigen Raum, stark abhaengig von Region,
Anstellung, Erfahrung und externem Modell:

| Rolle | Grobe Vollkosten/Jahr | Bemerkung |
|---|---:|---|
| Gruender/Produkt und Entwicklung | 70.000 bis 120.000 EUR | auch bei Eigenleistung wirtschaftlich ansetzen |
| Full-stack-/Backend-Engineer | 85.000 bis 130.000 EUR | inklusive Arbeitgeber- und Nebenkosten |
| DevOps/SRE extern oder Teilzeit | 20.000 bis 70.000 EUR | fuer Plattform, Security und Incident-Unterstuetzung |
| Customer Success/Support | 50.000 bis 85.000 EUR | ab groesserer Kundenflotte |
| Vertrieb/Onboarding | 50.000 bis 100.000 EUR | Fixum, Provision und Reisekosten variieren |
| Datenschutz/Recht/Security extern | 10.000 bis 50.000 EUR | nach Vertrag, Audit und Regulierung |

Ohne Automatisierung laesst sich bei 800 bis 1.000 EUR brutto pro Jahr kein
hochbetreutes, personalintensives Modell finanzieren.

## 5. LLM als Produktivitaetshebel

### 5.1 Grundsatz

LLM-Unterstuetzung wird in diesem Modell nicht als Marketingfunktion, sondern
als operative Produktivitaetskomponente geplant. Sie soll Entwicklung,
Dokumentation, Test, Support-Triage, Onboarding und interne Organisation
beschleunigen.

Sie ersetzt nicht:

- fachliche Verantwortung;
- Architekturentscheidungen;
- Sicherheits- und Datenschutzfreigaben;
- Produktionsfreigaben;
- rechtliche Entscheidungen;
- menschliche Eskalation bei kritischen Kundenfaellen;
- Urlaubs-, Krankheits- und Notfallvertretung.

### 5.2 Erwartete Effizienzgewinne

| Bereich | Moeglicher Produktivitaetsgewinn | Zwingende menschliche Kontrolle |
|---|---:|---|
| Codeanalyse und Implementierung | 30 bis 60 % | Architektur, Review, Tests |
| Testentwurf und Regressionserkennung | 25 bis 60 % | Aussagekraft, Testdaten, Freigabe |
| Dokumentation und Release Notes | 50 bis 80 % | fachliche Korrektheit |
| Support-Triage | 50 bis 80 % der Standardfaelle | Eskalation und Datenschutz |
| Wissensantworten | 30 bis 70 % Ticketvermeidung | Quellen, Aktualitaet, Qualitaet |
| Onboarding und Schulungsunterlagen | 40 bis 70 % | Datenpruefung und Kundenfreigabe |
| Ticketzusammenfassung und Reporting | 40 bis 70 % | Priorisierung und Entscheidung |
| Incident-Voranalyse | 20 bis 50 % | Incident Command und Massnahmen |

Diese Werte sind Planungsannahmen. Ein LLM schafft nur dann Nutzen, wenn
Arbeitsablaeufe standardisiert, Dokumentation aktuell und Diagnoseinformationen
kontrolliert zugaenglich sind.

### 5.3 Entwicklereinsatz

Ein Coding-Agent kann unter anderem:

- Architektur und Abhaengigkeiten analysieren;
- kleine, klar abgegrenzte Implementierungen vorbereiten;
- Unit-, Integrations- und Browsertests ergaenzen;
- Code- und Sicherheitsrisiken suchen;
- Migrationsentwuerfe und Runbooks vorbereiten;
- Dokumentation, Changelogs und Release Notes aktualisieren;
- CI-Fehler klassifizieren;
- Supportfehler mit Code, Vertrag und kontrollierten Logs korrelieren.

Die Produktivitaet einer starken Einzelperson kann dadurch zeitweise der von
ungefaehr 1,5 bis 2,5 klassisch arbeitenden Entwicklern entsprechen. Das ist
nicht als dauerhafte Personalrechnung oder Ersatz unabhaengiger Kontrolle zu
verstehen. Besonders kritische Bereiche brauchen menschliches Review und
explizite Tests:

- Authentifizierung und Autorisierung;
- Mandantentrennung;
- Reservierungs- und Zahlungslogik;
- Datenbankmigrationen;
- Backups und Restore;
- Secrets und Kryptografie;
- Datenloeschung und Datenschutz;
- Produktionsinfrastruktur.

### 5.4 Organisationsunterstuetzung

LLMs koennen auch folgende wiederkehrende Arbeiten vorbereiten:

- Onboardingchecklisten und Statusberichte;
- kundenbezogene Schulungsunterlagen aus freigegebenen Vorlagen;
- Zusammenfassung von Beta-Feedback;
- Ticketduplikate und wiederkehrende Problemgruppen;
- Entwurf von Kunden- und Incidentkommunikation;
- Aufbereitung von Releaseinformationen nach Zielgruppe;
- Vorpruefung strukturierter Importdaten;
- Kontrolllisten fuer Datenschutz- und Betriebsaufgaben;
- Vorbereitung von Nutzungs- und Kapazitaetsberichten.

Freie Kunden-, Vertrags- und Personendaten duerfen nur nach dokumentierter
Datenschutzpruefung an einen LLM-Anbieter uebermittelt werden. Wo moeglich,
sind Daten zu minimieren, zu pseudonymisieren oder lokal beziehungsweise in
einer vertraglich geeigneten Umgebung zu verarbeiten.

## 6. LLM-gestuetzter Support

### 6.1 Ziel

Der Support soll bei dem Preisniveau stark self-service-orientiert sein. Der
LLM-Assistent reduziert Standardanfragen und verbessert die Qualitaet von
Tickets, darf aber keine unkontrollierten Aenderungen an Vereinsdaten ausfuehren.

```text
Benutzeranfrage
  -> Tenant und Identitaet pruefen
  -> Inhalt klassifizieren und sensible Daten minimieren
  -> freigegebene Wissensbasis durchsuchen
  -> kontrollierte technische Diagnose lesen
  -> Antwort mit Quellen oder strukturiertes Ticket
  -> menschliche Eskalation bei Unsicherheit oder Risiko
```

### 6.2 Reifestufen

#### Stufe 1: Wissensassistent

Der Bot beantwortet ausschliesslich Fragen auf Basis freigegebener,
versionierter Benutzerdokumentation.

Geeignete Fragen:

- Wie reserviere ich einen Platz?
- Wie aendere ich einen Matchtermin?
- Welche Rolle benoetigt eine bestimmte Funktion?
- Wie richte ich einen Monitor ein?
- Warum sehe ich eine bestimmte Funktion nicht?

Pflichten:

- Quellen oder konkrete Hilfeseiten nennen;
- bei fehlender Grundlage Unsicherheit benennen;
- keine erfundenen Fachregeln;
- keine personenbezogenen Daten oder Tenantdiagnosen lesen;
- klarer Uebergang zu menschlichem Support.

#### Stufe 2: Kontrollierte Diagnose

Nach expliziter Berechtigung kann der Assistent nur allowlist-basierte Daten
lesen:

- Tenantstatus;
- App-Version und Release-Ring;
- bekannte Plattformstoerung;
- Health- und Readinessstatus;
- kontrollierte Fehlercodes und Support-ID;
- Feature-Flag-Status;
- Status eines eigenen asynchronen Jobs;
- Browser- und Verbindungsstatus ohne freie Payloads.

Nicht erlaubt sind:

- Shellzugriff;
- Rohzugriff auf PostgreSQL;
- Rohzugriff auf Loki oder Prometheus;
- Secrets, Token, Cookies oder Passwortaequivalente;
- freie Audittexte;
- fremde Personendaten;
- Zugriff auf andere Tenants.

#### Stufe 3: Ticket-Triage

Der Bot kann:

- Anfrage kategorisieren;
- fehlende, nicht sensible Angaben gezielt abfragen;
- bekannte Stoerungen erkennen;
- Ticket mit Tenant, Version, Kategorie, Fehlercode und Support-ID anlegen;
- Prioritaet nach kontrollierten Regeln vorschlagen;
- Duplikate erkennen;
- Sicherheits-, Datenschutz- und Verfuegbarkeitsfaelle sofort eskalieren.

#### Stufe 4: Kontrollierte risikoarme Aktionen

Erst nach stabiler Basis und separaten Sicherheitspruefungen koennen
deterministische Aktionen angeboten werden:

- eigene Anleitung erneut bereitstellen;
- eigenen Exportauftrag beantragen;
- Status eines eigenen Jobs abfragen;
- fehlgeschlagenen ungefaehrlichen Job erneut einreihen;
- zeitlich begrenzte Browserdiagnose beantragen;
- Supporttermin buchen.

Der LLM-Teil entscheidet nie selbst ueber eine Fachmutation. Jede Aktion ruft
eine explizite, berechtigte, validierte und auditierte Backendfunktion auf.

### 6.3 Nicht automatisierbare oder besonders geschuetzte Vorgange

Folgende Vorgange benoetigen menschliche Verantwortung beziehungsweise eine
explizite fachliche Freigabe:

- Rollen- und Adminrechte aendern;
- Vereins- oder Tenantkonfiguration aendern;
- Reservierungen anderer Personen aendern oder loeschen;
- Match- und Ranglistenentscheidungen korrigieren;
- Zahlungen oder Rueckerstattungen ausloesen;
- Datenexporte mit fremden Personendaten freigeben;
- Support-Impersonation;
- Secrets rotieren;
- Daten wiederherstellen oder loeschen;
- Produktionsreleases und Datenbankmigrationen freigeben.

## 7. LLM-Kostenmodell

### 7.1 Direkte Kosten

| Bereich | 20 Tenants/Jahr | 50 Tenants/Jahr | 100 Tenants/Jahr |
|---|---:|---:|---:|
| Coding-Agenten und Entwicklerwerkzeuge | 2.000 bis 8.000 EUR | 3.000 bis 10.000 EUR | 4.000 bis 15.000 EUR |
| Wissensassistent und Support-Triage | 500 bis 3.000 EUR | 1.500 bis 6.000 EUR | 3.000 bis 15.000 EUR |
| Evaluation, Guardrails, Observability | 1.000 bis 5.000 EUR | 2.000 bis 8.000 EUR | 4.000 bis 15.000 EUR |
| **LLM-bezogene Gesamtkosten** | **3.500 bis 16.000 EUR** | **6.500 bis 24.000 EUR** | **11.000 bis 45.000 EUR** |

Der groesste Kostenfaktor ist meist nicht Tokenverbrauch, sondern Aufbau und
Pflege von Wissensbasis, Integrationen, Evaluation, Guardrails, Monitoring und
fachlicher Qualitaetssicherung.

### 7.2 Kostenkontrolle

Pflichtmechanismen:

- monatliches Budget je Umgebung und Tenant;
- harte Limits pro Benutzer, Ticket und Anfrage;
- Modellwahl nach Risiko und Aufgabe;
- Caching von Wissensantworten, wo Datenschutz dies erlaubt;
- Retrieval vor grossen Kontexten;
- keine vollstaendigen Logs oder Datenbankauszuege in Prompts;
- Token-, Fehler- und Eskalationsmonitoring;
- Abschaltung oder Degradierung bei Budgetueberschreitung;
- regelmaessige Evaluation gegen bekannte Testfragen;
- klare Datenverarbeitungsvertraege mit Anbietern.

### 7.3 LLM-Margenregel

Bei durchschnittlich 750 EUR Nettoumsatz pro Tenant und Jahr soll die direkte
LLM-Nutzung langfristig nicht mehr als etwa 5 bis 12 Prozent des Nettoumsatzes
eines Standardtenants verbrauchen:

```text
Ziel: 40 bis 90 EUR direkte LLM-Kosten je Tenant und Jahr
```

Hoehere zentrale Entwicklungskosten sind moeglich, muessen aber durch
Produktivitaetsgewinn, geringere externe Entwicklungszeit oder schnelleres
Wachstum begruendet werden.

## 8. Zielkosten pro Tenant

### 8.1 Direkte variable Kosten

Bei 900 EUR brutto/Jahr soll der Zielwert fuer direkte Kosten pro Verein sein:

| Kostenblock | Ziel/Jahr netto | Bemerkung |
|---|---:|---|
| Compute- und Datenbankanteil | 40 bis 100 EUR | gemeinsame Hosts/Cluster, eigene DB je Tenant |
| Storage, Backup und Netzwerk | 15 bis 50 EUR | abhaengig von Retention und Datenmenge |
| Monitoring, Logging und externe Dienste | 15 bis 45 EUR | Loglimits entscheidend |
| LLM-Supportanteil | 40 bis 90 EUR | nur kontrollierte Nutzung |
| Zahlungsabwicklung, Domains, Mail | 10 bis 40 EUR | je nach Vertrag und Features |
| Menschlicher Standard-Support | 50 bis 150 EUR | stark von Self-Service abhaengig |
| **Direkte Kosten gesamt** | **170 bis 475 EUR** | Zielbereich, keine Garantie |

Bei 750 EUR Nettoumsatz verbleiben damit 275 bis 580 EUR Deckungsbeitrag je
Verein und Jahr fuer zentrale Entwicklung, Vertrieb, Verwaltung, Ruecklagen und
Gewinn.

### 8.2 Supportzeit als entscheidende Kennzahl

Serverkosten sind planbar. Manueller Support ist bei niedrigen Jahrespreisen
der groesste Margentreiber.

Zielwerte pro aktivem Verein und Jahr:

| Kennzahl | Ziel |
|---|---:|
| Menschliche Supportzeit | unter 60 Minuten |
| Standardfragen durch Self-Service/LLM geloest | mindestens 60 % |
| Onboardingzeit nach Automatisierung | unter 2 Stunden |
| manuelle Konfigurationsaenderungen | nahe 0 |
| individuelle Sonderentwicklung | 0 im Basisvertrag |
| kritische Incidents | unter 1 je 50 Tenants/Jahr |

Bei einem kalkulatorischen Satz von 80 EUR pro Stunde bedeuten zwei Stunden
manueller Support bereits 160 EUR Kosten je Tenant und Jahr. Das kann einen
grossen Teil des Deckungsbeitrags aufzehren.

## 9. Szenarien mit LLM-Unterstuetzung

### 9.1 Cash-Break-even ohne Gruendervergutung

Beispielhafte Jahreskosten inklusive Infrastruktur, externer Dienste,
LLM-Werkzeuge, Recht, Verwaltung und kleiner Sicherheitsreserve:

| Szenario | Kosten/Jahr | Benoetigte Tenants bei 750 EUR netto |
|---|---:|---:|
| sehr schlanker Pilotbetrieb | 25.000 EUR | 34 |
| professioneller Nebenbetrieb | 45.000 EUR | 60 |
| robuster Betrieb mit externer Hilfe | 65.000 EUR | 87 |

Der reine Cash-Break-even liegt damit grob bei 35 bis 90 Vereinen. In der
Pilotphase kann ein bestehendes Unternehmen einzelne Kosten mittragen; diese
Quersubventionierung muss in der Planung sichtbar bleiben.

### 9.2 Nachhaltige One-Man-Show

| Kostenblock | Schlank | Robust |
|---|---:|---:|
| Infrastruktur, Backups, Monitoring | 20.000 EUR | 35.000 EUR |
| LLM, Entwickler- und Supportwerkzeuge | 8.000 EUR | 20.000 EUR |
| Recht, Datenschutz, Buchhaltung, Versicherung | 10.000 EUR | 20.000 EUR |
| externer DevOps/Security-Support | 10.000 EUR | 30.000 EUR |
| Vertrieb, Reisen, Ruecklagen | 12.000 EUR | 25.000 EUR |
| kalkulatorische Gruenderverguetung | 60.000 EUR | 90.000 EUR |
| **Gesamt/Jahr** | **120.000 EUR** | **220.000 EUR** |

Bei 750 EUR Nettoumsatz je Verein entspricht das:

| Szenario | Benoetigte Tenants |
|---|---:|
| schlanke Vollzeit-One-Man-Show | 160 |
| robuste Vollzeit-One-Man-Show | 294 |

Die sinnvolle Planungsannahme lautet daher:

```text
100 Tenants: tragfaehiger, professioneller Nebenbetrieb
160 bis 250 Tenants: moegliche Vollzeit-One-Man-Show
ueber 250 Tenants: erste feste Unterstuetzung und Vertretung einplanen
```

### 9.3 Kleine Produktorganisation

Ein kleines Team aus Gruender, zusaetzlicher Entwicklung/Operations und
Teilzeit-Kundenbetreuung kann inklusive Infrastruktur, Vertrieb und Ruecklagen
etwa 280.000 bis 450.000 EUR pro Jahr benoetigen.

| Jaehrlicher Bedarf | Tenants bei 750 EUR netto |
|---:|---:|
| 280.000 EUR | 374 |
| 350.000 EUR | 467 |
| 450.000 EUR | 600 |

Hoehere durchschnittliche Umsaetze durch Professional-, Premium- und
Onboardingpakete verschieben diese Schwellen deutlich nach unten.

## 10. Personalmodell mit LLM

### 10.1 0 bis 50 Vereine

Modell:

- Gruender nebenberuflich im bestehenden Unternehmen;
- LLM-gestuetzte Entwicklung und Dokumentation;
- externer DevOps-/Security-Partner nur punktuell;
- klare Geschaeftszeiten und kein 24/7-SLA;
- stark standardisiertes Onboarding;
- kein individueller Kunden-Code.

Ziel: Produkt-Market-Fit, Zahlungsbereitschaft und operative Kennzahlen
validieren.

### 10.2 50 bis 100 Vereine

Modell:

- Gruender verantwortet Produkt, Architektur, Vertrieb und Eskalationen;
- LLM-Wissensassistent und Ticket-Triage aktiv;
- regelmaessiger externer DevOps-/Security-Support;
- strukturierter Supportprozess und Wissensdatenbank;
- Beta-Ring mit wenigen freiwilligen Vereinen;
- automatisierte Provisionierung, Backups und Releases.

Ziel: Ein professioneller Nebenbetrieb ohne dauerhafte Ueberlastung.

### 10.3 100 bis 200 Vereine

Modell:

- Gruender kann schrittweise in Vollzeit wechseln;
- LLM-Agenten reduzieren Entwicklungs- und Supportroutine;
- mindestens vertraglich gesicherte Vertretung fuer Infrastruktur und Incidents;
- Teilzeitunterstuetzung fuer Onboarding, Kundenbetreuung oder Administration;
- regelmaessige Security- und Restoreuebungen.

Ziel: Wiederholbarer Betrieb mit Ausfallsicherheit fuer die Person hinter dem
Produkt.

### 10.4 Ueber 200 Vereine

LLMs verschieben die Einstellungsschwelle, beseitigen sie aber nicht. Mindestens
folgende Verantwortungen duerfen nicht dauerhaft an einer Person haengen:

- Produktionsbereitschaft und Incidentreaktion;
- Sicherheits- und Access Reviews;
- Kundenkommunikation bei Stoerungen;
- Datenmigrationen und Releases;
- Vertrieb und Onboarding;
- Produktentwicklung und Architektur.

Sinnvoller erster Ausbau:

1. Teilzeit Customer Success/Support oder Onboarding;
2. fester DevOps/SRE-Partner oder technischer Mitarbeiter;
3. weiterer Produkt-/Full-stack-Engineer;
4. je nach Wachstum Vertrieb und Administration.

## 11. Voraussetzungen fuer das Niedrigpreismodell

Das Jahrespreismodell funktioniert nur, wenn die Plattform gezielt auf niedrige
Grenzkosten und geringen Betreuungsaufwand gebaut wird.

### 11.1 Produkt

- Self-Service fuer Vereinsadmins;
- gefuehrte Einrichtung und Datenimporte;
- Standardrollen und Standardprozesse;
- klare Funktions- und Tarifgrenzen;
- keine kundenspezifischen Forks;
- wenige gleichzeitig unterstuetzte Versionen;
- wiederverwendbare Integrationen statt Einzelprojekte;
- gute mobile Bedienbarkeit und kontextbezogene Hilfe.

### 11.2 Betrieb

- containerisierte Cells auf gemeinsam genutzter Infrastruktur;
- eigene Datenbank und DB-Rolle je Tenant, aber kein eigener DB-Server;
- zentrale Registry, Secretverwaltung und Release-Automation;
- automatisierte Backups, Restoretests, Provisionierung und Deprovisionierung;
- Managed Services statt selbst betriebener Infrastruktur, wo wirtschaftlich;
- definierte Quoten und Ressourcenlimits;
- Release-Ringe statt individuelle Updatezeitpunkte.

### 11.3 Support

- Wissensassistent mit freigegebenen Quellen;
- gefuehrte Fehleraufnahme;
- Ticket-Triage und Duplikaterkennung;
- Support nur zu vereinbarten Zeiten im Basispaket;
- Premium-Support als Add-on;
- Statusseite und proaktive Stoerungsinformation;
- klare Grenze zwischen Produktfehler, Bedienfrage und kostenpflichtiger
  Beratung;
- Messung von Erstloesungsquote, Eskalationsquote und Zeitaufwand.

## 12. Qualitaet, Sicherheit und LLM-Governance

### 12.1 Grundregeln

- Das LLM ist kein Autorisierungssystem.
- Jede Fachmutation erfolgt ueber deterministische Backendvertraege.
- Toolzugriffe des Assistenten sind allowlist-basiert und tenantgebunden.
- Der Assistent erhaelt kein Shell-, Datenbank- oder Secretzugriff.
- Prompts und Antworten enthalten nur datensparsame kontrollierte Felder.
- Produktionsaenderungen brauchen menschliche Freigabe.
- Jede relevante Toolaktion wird mit Tenant, Akteur, Zweck und Ergebnis auditiert.
- Unsichere Antworten eskalieren statt zu raten.

### 12.2 Wissensbasis

Die Wissensbasis muss versioniert sein und mindestens unterscheiden:

- Benutzerdokumentation;
- Administratorhandbuch;
- Rollen- und Rechtebeschreibung;
- bekannte Stoerungen und Runbooks;
- Release Notes je Version;
- Feature-Flag- und Tarifdokumentation;
- Datenschutz- und Supportgrenzen.

Der Assistent soll seine Antwort auf konkrete, freigegebene Quellen stuetzen und
keine Fachregeln aus allgemeinem Sprachwissen erfinden.

### 12.3 Evaluation

Vor und nach jeder bedeutenden Aenderung am Supportassistenten werden getestet:

- korrekte Antworten auf bekannte Bedienfragen;
- korrekte Ablehnung nicht erlaubter Datenzugriffe;
- Tenanttrennung;
- Rollentrennung;
- Erkennen von Unsicherheit;
- korrekte Ticketklassifikation;
- Eskalation von Security- und Datenschutzfaellen;
- Kosten pro geloester Anfrage;
- Halluzinations- und Fehlberatungsquote.

## 13. Messsystem und Entscheidungskennzahlen

### 13.1 Kommerzielle Kennzahlen

| Kennzahl | Ziel oder Beobachtung |
|---|---|
| MRR/ARR netto | Wachstum und Planbarkeit |
| durchschnittlicher Nettoumsatz pro Tenant | Preis- und Add-on-Wirkung |
| Churn | Kundenbindung |
| Net Revenue Retention | Wachstum im Bestand |
| Customer Acquisition Cost | Vertriebseffizienz |
| Payback-Zeit | Dauer bis Vertriebskosten gedeckt sind |
| Gross Margin | Skalierbarkeit des Betriebs |
| Onboarding-Umsatz und -Aufwand | Einfuehrung wirtschaftlich oder Verlustbringer |

### 13.2 Betriebskennzahlen

| Kennzahl | Ziel fuer Basisangebot |
|---|---:|
| manuelle Supportzeit/Tenant/Jahr | unter 60 Minuten |
| Supportanfragen, die Bot/Self-Service loest | mindestens 60 % |
| Zeit bis Erstreaktion | innerhalb vereinbarter Geschaeftszeit |
| Provisionierungszeit | unter 30 Minuten ohne manuelle Infrastrukturarbeit |
| Rolloutfehler | unter 1 % der Tenants je Welle |
| erfolgreicher Backup-/Restoretest | 100 % nach Plan |
| aktive Sicherheitsluecken hoher Kritikalitaet | 0 ausserhalb definierter Frist |
| LLM-Kosten/Tenant/Jahr | 40 bis 90 EUR Zielbereich |

### 13.3 Stop-/Investitionskriterien

Bevor mehr Vertrieb oder Personal finanziert wird, sollten folgende Punkte
nachgewiesen sein:

- mindestens 20 zahlende Vereine oder gleichwertige verbindliche Pilotvertraege;
- dokumentierte Zahlungsbereitschaft fuer wiederkehrenden Jahrespreis;
- standardisierte Provisionierung und Releasefaehigkeit;
- gemessener Supportaufwand unter Zielwert;
- Backups und Restoretests erfolgreich;
- keine unvertretbaren Cross-Tenant- oder Datenschutzrisiken;
- Churn- und Feedbackdaten ueber mindestens eine relevante Saison;
- positiver Deckungsbeitrag pro aktivem Standardtenant.

## 14. Risiken fuer die Wirtschaftlichkeit

### 14.1 Unterpreisung

Ein Basispreis von 800 bis 1.000 EUR brutto ist nur tragfaehig, wenn Umfang und
Support klar begrenzt sind. Gefaehrlich sind insbesondere:

- kostenlose individuelle Datenbereinigung;
- kostenfreie Vor-Ort-Termine;
- unbegrenzter Telefonsupport;
- kundenspezifische Featurewuensche;
- kostenlose Migration komplexer Altdaten;
- zu viele inkludierte externe Nachrichtendienste;
- hohe Log-, Speicher- oder Medienmengen ohne Quoten.

### 14.2 LLM-Illusion

LLMs machen eine Einzelperson produktiver, aber sie erzeugen neue Aufgaben:

- Prompt- und Tool-Sicherheit;
- Wissensbasis-Pflege;
- Evaluation und Fehlermonitoring;
- Anbieter- und Datenschutzpruefung;
- Kostenkontrolle;
- menschliche Eskalation;
- Nachvollziehbarkeit von Botantworten.

Ein schlecht abgesicherter Bot kann Datenschutz-, Reputations- und Supportkosten
erhoehen statt senken.

### 14.3 Personenrisiko

Eine One-Man-Show hat ein Ausfallrisiko. Vor groesserem Vertrieb notwendig:

- dokumentierte Betriebsablaeufe;
- Passwort-, Secret- und Break-glass-Nachfolge;
- externe technische Vertretung;
- Zugriff und Rollen nach Vier-Augen-Prinzip;
- getestete Wiederherstellung ohne Gruenderzugriff;
- klare Kundenkommunikation im Notfall.

### 14.4 Saison- und Vertriebsrisiko

Tennisvereine entscheiden oft saisonal und ehrenamtlich. Das Modell muss daher
beachten:

- lange Entscheidungswege;
- Budgetfreigabe durch Vorstand;
- konzentriertes Onboarding vor Saisonbeginn;
- Supportspitzen bei Saisonstart und Turnieren;
- moegliche Kuendigungen zum Jahresende;
- Bedarf an einfacher Nutzen- und Kostenargumentation.

## 15. Empfohlene wirtschaftliche Zielwerte

### Phase A: 1 bis 20 Pilotvereine

- Basispreis validieren, nicht dauerhaft unter Wert rabattieren.
- Onboarding separat bepreisen oder klar als begrenzte Pilotinvestition erfassen.
- Manuelle Supportzeit, LLM-Kosten und Infrastrukturkosten pro Tenant messen.
- Keine Vollzeitpersonalkosten aus diesem Umsatz ableiten.
- Ziel: belastbares Nutzenversprechen und wiederholbarer Einfuehrungsprozess.

### Phase B: 20 bis 50 Vereine

- Cash-Break-even fuer technische und organisatorische Sachkosten anstreben.
- Standardisierung vor Vertriebsgeschwindigkeit priorisieren.
- Wissensassistent und Ticket-Triage einfuehren.
- Externen DevOps-/Security-Support vertraglich absichern.
- Ziel: professioneller Nebenbetrieb ohne verdeckte Ueberlastung.

### Phase C: 50 bis 100 Vereine

- Zielwert: 37.500 bis 83.333 EUR Nettoumsatz, abhaengig vom Preis.
- Automatisierung von Provisionierung, Releases, Backups und Support pruefen.
- Beta-Ring und Feature Flags kontrolliert betreiben.
- Teilzeitunterstuetzung nur bei messbar wiederkehrender Last einstellen.
- Ziel: stabiler Nebenbetrieb und Nachweis positiver Unit Economics.

### Phase D: 100 bis 200 Vereine

- Zielwert: 75.000 bis 166.667 EUR Nettoumsatz, abhaengig vom Preis.
- Vollzeitwechsel nur mit ausreichender Liquiditaet, Ruecklagen und Vertretung.
- Durchschnittsumsatz durch wertvolle Add-ons erhoehen.
- Support- und Onboardingrolle vorbereiten.
- Ziel: nachhaltige One-Man-Show mit vertraglich abgesicherter externer Hilfe.

### Phase E: Ueber 200 Vereine

- Personenausfall und Supportlast nicht mehr allein tragen.
- Erste feste Rolle nach dem groessten Engpass besetzen.
- Produkt-, Plattform- und Kundenverantwortung organisatorisch trennen.
- Ziel: kleine, belastbare Produktorganisation statt ueberlasteter Einzelperson.

## 16. Offene Entscheidungen

1. Welcher Funktionsumfang ist verbindlich im Basispreis enthalten?
2. Wird ein Reservierungsmodul bereits im Basispreis oder als Add-on verkauft?
3. Wie hoch ist eine akzeptierte einmalige Onboarding- und Migrationspauschale?
4. Welche Supportzeiten gelten im Basispaket und was kostet Premium-Support?
5. Welche LLM-Anbieter, Datenregionen und Auftragsverarbeitungsvertraege sind
   datenschutzrechtlich akzeptabel?
6. Darf der Supportassistent fuer angemeldete Benutzer kontrollierte
   tenantbezogene Diagnosedaten lesen?
7. Wie werden Botfehler gemeldet, bewertet und korrigiert?
8. Welche Kennzahl beendet einen zu stark rabattierten Pilotvertrag?
9. Ab welcher Umsatz-, Liquiditaets- und Supportschwelle erfolgt der
   Vollzeitwechsel?
10. Welche externe Vertretung ist vor dem ersten zahlenden Produktionskunden
    verbindlich organisiert?

## 17. Zusammenhang mit spaeterer kanonischer Dokumentation

Vor einer verbindlichen Umsetzung sind Vorschlaege fuer folgende Dokumente
abzustimmen:

| Zieldatei | Vorgesehener Inhalt |
|---|---|
| `Project/FACHKONZEPT.txt` | Produktpakete, Benutzergruppen, Support- und Self-Service-Grenzen |
| `Project/software/MANDANTENARCHITEKTUR.txt` | LLM-Toolgrenzen, Tenant-Kontext und Supportassistenten-Architektur |
| `Project/software/ARCHITEKTUR.txt` | kontrollierte Diagnoseschnittstellen, Audit und Observability fuer Bots |
| `Project/software/ENDPOINTS.txt` | sichere Bot- und Supportaktionen, Berechtigungen und Fehlervertraege |
| `Project/server-configs/PLATTFORM-UND-RELEASEARCHITEKTUR.md` | Kostenrelevante Plattformdienste, CI/CD und Betriebsgrenzen |
| neues kaufmaennisches Planungsdokument | Preislisten, Kalkulation, Liquiditaet, Vertriebs- und Personalplanung |

Diese Datei ersetzt weder eine detaillierte Finanzplanung noch steuerliche,
rechtliche oder datenschutzrechtliche Beratung.
