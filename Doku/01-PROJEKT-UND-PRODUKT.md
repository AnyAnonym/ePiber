# Projekt und Produkt

## 1. Ausgangslage

ePiber wurde fuer den Tennisbetrieb des ASKOE Piberbach aufgebaut. Das Produkt
verbindet oeffentliche Information, sportliche Ablaeufe, interne Kommunikation,
Platzbetrieb und Administration in einer Webanwendung. Es wird mobil von
Spielern und Zuschauern, am Desktop durch Funktionaere und auf grossen Anzeigen
am Tennisplatz genutzt.

Die Anwendung ist heute kein allgemeines Vereins-ERP. Ihr Schwerpunkt ist der
Tennisbetrieb. Mitglieder- und Personendaten werden nur soweit verwaltet, wie
sie fuer Anmeldung, Berechtigungen, Kommunikation und sportliche Prozesse
benoetigt werden.

## 2. Produktnutzen

ePiber schafft eine gemeinsame Sicht auf:

- aktive, bevorstehende und beendete Bewerbe,
- Nennlisten, KO-Raster, Gruppenphasen und Ranglisten,
- offene, terminierte und abgeschlossene Matches,
- persoenliche Termine, Ergebnisse und Meldungen,
- Live-Spielstaende und Courtbelegung,
- Mitgliederprofile und Kontaktdaten fuer angemeldete Mitglieder,
- administrative Datenqualitaet und Mitgliederabgleich,
- Monitor- und Anzeigesteuerung.

Der Kernnutzen liegt nicht nur in der Darstellung, sondern in der kontrollierten
Durchfuehrung von Fachwrites. Termin-, Ergebnis-, Ranglisten-, Personen- und
Geraeteaenderungen werden serverseitig autorisiert, validiert, protokolliert und
gegen Doppelverarbeitung abgesichert.

## 3. Zielgruppen

### 3.1 Anonyme Besucher

Anonyme Besucher koennen Dashboard, Bewerbe, Raster, Gruppen, Ranglisten,
Matchlisten und Live-Scoreboard sehen. Personenprofile, Kontaktdaten,
persoenliche Meldungen und schreibende Aktionen sind nicht oeffentlich.

### 3.2 Spieler

Spieler koennen sich fuer Bewerbe an- und abmelden, Ranglistenforderungen
aussprechen, eigene Matchtermine pflegen, Ergebnisse eintragen, sich temporaer
aus einer Rangliste nehmen, Profile anderer aktiver Mitglieder ansehen,
Meldungen quittieren und persoenliche Favoriten verwalten.

`player`, `player A` und `player B` besitzen dieselben technischen Rechte. Die
Zusatzbezeichnungen sind Mitgliederklassifikationen und keine hoeheren Rollen.

### 3.3 Operatoren

Operatoren steuern Courts, Scoreboards und Monitore. Sie duerfen keine
allgemeinen Personen-, Bewerbs-, Ergebnis- oder Rangkorrekturen vornehmen. Die
Rolle ist bewusst vom sportlichen und administrativen Entscheidungsrecht
getrennt.

### 3.4 Administratoren

Administratoren verwalten Personen, Rollen, Passwortfreigaben, Datenimporte,
Monitorgeraete, Diagnoseeinstellungen sowie begruendete Match- und
Ranglistenkorrekturen. Administratoren besitzen zugleich Operatorrechte.

### 3.5 Sportliche Leitung und Turnierleitung

Diese Funktionen sind fachliche Verantwortlichkeiten, keine eigenen technischen
Rollen. Fuer administrative Eingriffe benoetigen die handelnden Personen die
Adminrolle. Die sportliche Leitung entscheidet insbesondere bei
Fristueberschreitungen und strittigen Korrekturen. Auslosung und Setzung bleiben
in Teilen manuelle Organisationsaufgaben.

### 3.6 Monitorgeraete

Monitorgeraete besitzen eine eigene Geraetesitzung. Sie empfangen nur
adressierte Anzeige- und Scrollbefehle, bestaetigen Ladephasen und treffen keine
fachlichen Entscheidungen.

## 4. Produktbereiche

| Bereich | Heutiger Umfang |
|---|---|
| Information | Dashboard, Bewerbe, Matches, Profile, Historien |
| Spielbetrieb | Anmeldung, Rangliste, KO, Gruppen, Termine, Ergebnisse |
| Kommunikation | Persoenliche Inbox, Bewerbshistorie, Kommentare, Reaktionen |
| Livebetrieb | Zwei Courts, externe Scores, Scoreboard, Scorehistorie |
| Anzeige | Monitorplayer, Navigator, Sponsorenanzeige |
| Administration | Personen, ClubDesk-Abgleich, Datenimport, Diagnose |
| Sicherheit | Konten, Sitzungen, Rollen, Passwortablaeufe, Audit |

## 5. Seitenlandschaft

| Seite | Aufgabe | Zugang |
|---|---|---|
| `index.html` | Dashboard, Login, Profil, Geburtstage, Favoriten | oeffentlich/personalisiert |
| `Bewerbe.html` | Bewerbsuebersicht und Historien | oeffentlich, Interaktion angemeldet |
| `bewerbsRaster.html` | KO-Baum | oeffentlich |
| `Matches1.html` | offene und gespielte Matches mit Filtern | oeffentlich |
| `players.html` | Mitgliederverzeichnis und Profile | angemeldet |
| `entryList.html` | Nennliste, eigene An-/Abmeldung | Liste oeffentlich, Write angemeldet |
| `rangliste.html` | Pyramide, Forderung, Fristen, Rueckkehr | oeffentlich/angemeldet/admin |
| `RoundRobin.html` | Gruppen und Paarungen | oeffentlich |
| `scoreboard.html` | Liveanzeige fuer zwei Courts | oeffentlich |
| `monitor.html` | ferngesteuerter Vollbildplayer | Geraetesitzung |
| `navigator.html` | Regie, Court- und Monitorsteuerung | Operator/Admin |
| `Sponsoren.html` | statische Vollbildanzeige | Monitorziel |
| `servicebereich.html` | Snapshotstatus und Gesamtimport | Admin |
| `personenNormalisieren.html` | kontrollierte Stammdatenkorrektur | Admin |
| `mitgliederAbgleichen.html` | lokaler ClubDesk-CSV-Abgleich | Admin |
| `adminLogging.html` | Browserdiagnose konfigurieren | Admin |

Ergebnis- und Terminpflege sind keine getrennten Seiten. Sie werden ueber das
gemeinsame Profilmodal und direkte Favoritenaktionen ausgefuehrt.

## 6. Produktprinzipien

- Mobile Nutzung ist gleichwertig, nicht nachtraeglich ergaenzt.
- Oeffentliche Daten und Mitgliederdaten werden klar getrennt.
- Der Browser zeigt Berechtigungen an, der Server entscheidet sie erneut.
- Kritische Writes sind idempotent und nachvollziehbar.
- Ein unklarer Write-Ausgang darf nicht blind wiederholt werden.
- Fachhistorie, persoenliche Inbox, Betriebslog und Audit haben getrennte Zwecke.
- Externe Systeme und manuelle Arbeit werden als Systemgrenze benannt.
- Verfuegbarkeit darf nicht durch ungepruefte Teilimporte erkauft werden.

## 7. Bewusste Abgrenzungen

Heute nicht vollstaendig abgebildet sind:

- allgemeine Vereinsbuchhaltung und Zahlungsverwaltung,
- vollstaendige Bewerbs- und Turnieradministration,
- grafische KO-Auslosungsbearbeitung,
- automatische Gruppen-zu-KO-Ueberleitung,
- verbindliche automatische Sanktionen bei Ranglistenfristverletzung,
- native Android- oder iOS-App,
- produktive externe E-Mail-, WhatsApp- oder Pushzustellung,
- Hallen- und Platzreservierung,
- Mehrvereins- beziehungsweise Mandantenbetrieb.

## 8. Strategische Entwicklung

Die geplante Reise fuehrt von einer einzelnen Tennisvereinsanwendung zu einer
standardisierten Vereinsbetriebsplattform. Der Ausbau soll nicht durch
unkontrolliertes Hinzufuegen von Funktionen erfolgen. Zuerst werden
Transaktionsfaehigkeit, Identitaetsmodell, Backup/Restore und reproduzierbarer
Betrieb geschaffen. Darauf bauen Reservierung, PWA/Push, Mandantenfaehigkeit und
spaeter weitere Vereinsbereiche auf.
