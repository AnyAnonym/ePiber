# Notifications, persoenliche Inbox und Web Push

Stand: 15.09.2026
Status: Fachliche und technische Arbeitsgrundlage; noch nicht implementiert,
freigegeben oder kanonisch dokumentiert
Gegenstand: Zentrales Meldungs-, Erinnerungs- und Web-Push-System fuer ePiber

Diese Datei ist eine nicht-kanonische Arbeitsgrundlage unter `Project/2do/`.
Sie fasst die im Planungsgespraech getroffenen Entscheidungen, den Sollaufbau,
Abgrenzungen und offene Punkte zusammen. Die dauerhaften fachlichen Regeln,
die technische Sollarchitektur und Datenvertraege werden erst vor einer
freigegebenen Umsetzung in den dafuer vorgesehenen kanonischen Dokumenten
abgestimmt und gepflegt.

Der geplante Umstieg von Google Sheets und mehreren SQLite-Dateien nach
PostgreSQL wird hier nur insoweit beschrieben, wie er den Aufbau des
Notification-Systems bestimmt. Die Datenbankmigration selbst ist ein
abgetrennter spaeterer Arbeitsauftrag.


## 1. Zielbild

Die bisherige WhatsApp-Gruppe fuer Forderungen, Terminvereinbarungen,
Ergebnisse und Bewerbskommunikation wird durch ePiber abgeloest. Die bereits
vorhandene Bewerbshistorie mit Kommentaren und Reaktionen bleibt die zentrale
fachliche Kommunikation zum Bewerb.

Ergaenzt wird sie durch ein einheitliches Benachrichtigungssystem:

```text
Fach- oder Zeitereignis
  -> zentrales Ereignisjournal
  -> Berechtigung, Zielgruppe und Benutzereinstellungen
  -> persoenliche Inbox-Meldung
  -> optionaler Web Push auf freigegebenen Geraeten
  -> ausdrueckliche Kenntnisnahme
```

Die persoenliche Inbox ist die verbindliche Quelle. Ein Push ist ausschliesslich
ein zusaetzlicher Zustellweg fuer eine bereits gespeicherte Inbox-Meldung.
Es darf keine nicht nachvollziehbare Push-Nachricht ohne zugehoerige Meldung
geben.

Das System soll ohne native Android- oder iOS-App funktionieren. Es wird als
installierbare Web-App (PWA) mit standardsbasiertem Web Push umgesetzt.


## 2. Plattform und Einrichtung

### 2.1 Android

Ein angemeldeter Benutzer aktiviert im Profil die gewuenschten Inhalte und
waehlt anschliessend `Push auf diesem Geraet aktivieren`. Der Browser zeigt die
vom Betriebssystem vorgeschriebene Berechtigungsabfrage. Danach verhaelt sich
ePiber wie eine normale App-Benachrichtigung.

### 2.2 iPhone und iPad

Auf iOS/iPadOS ist Web Push nur fuer eine zum Home-Bildschirm hinzugefuegte
Web-App verfuegbar. ePiber fuehrt den Benutzer deshalb schrittweise:

1. `Teilen` waehlen.
2. `Zum Home-Bildschirm` waehlen.
3. ePiber ueber das neue Symbol oeffnen.
4. `Push auf diesem Geraet aktivieren` waehlen.
5. Betriebssystemfreigabe bestaetigen.

Die einmalige Home-Bildschirm-Installation ist akzeptiert. Eine vollstaendig
einstellungsfreie Aktivierung ist weder auf Android noch auf iOS technisch oder
datenschutzrechtlich moeglich, weil das Betriebssystem eine ausdrueckliche
Zustimmung verlangt.

### 2.3 Geraet und Benutzerkonto

Inhaltliche Einstellungen gehoeren zum Benutzerkonto. Die technische
Push-Freigabe gehoert immer zum einzelnen Geraet beziehungsweise Browser.

- Ein Benutzer kann mehrere Geraete aktivieren.
- Ein Benutzer kann Push auf einem einzelnen Geraet deaktivieren, ohne seine
  inhaltlichen Abonnements zu verlieren.
- Ungueltige, abgelaufene oder vom Betriebssystem widerrufene Abonnements
  werden kontrolliert entfernt.
- Das Profil zeigt den Status des aktuellen Geraets und kann spaeter eine Liste
  weiterer registrierter Geraete anbieten.


## 3. Inbox und Kenntnisnahme

Jede erzeugte persoenliche Inbox-Meldung muss weiterhin ausdruecklich quittiert
werden. Die bisherige Funktion `Zur Kenntnis genommen` bleibt damit ein
zentraler Bestandteil des neuen Systems.

| Benutzerhandlung | Meldungsstatus |
|---|---|
| Push wird zugestellt | unquittiert |
| Push wird auf dem Sperrbildschirm angezeigt | unquittiert |
| Push wird weggewischt | unquittiert |
| Push wird angetippt | Meldungsdetail wird geoeffnet, weiterhin unquittiert |
| `Zur Kenntnis genommen` wird gewaehlt | zentral quittiert |
| Unterstuetzte Push-Aktion `Zur Kenntnis genommen` wird gewaehlt | zentral quittiert |

Das reine Anzeigen, Wegwischen oder Oeffnen darf keine automatische
Kenntnisnahme ausloesen. Die Formulierung `Zur Kenntnis genommen` bleibt
fachlich genauer als `Gelesen`, weil das System ein tatsaechliches Lesen nicht
beweisen kann.

Nach erfolgreicher Quittierung werden Inbox, Ungelesenanzahl, offene Browser
und registrierte Geraete synchronisiert. Eine Anzeige auf weiteren Geraeten
kann geschlossen oder als erledigt markiert werden. Scheitert die Speicherung,
bleibt die Meldung sichtbar unquittiert.

Push-Aktionsbuttons sind nicht auf allen Browsern und Betriebssystemen
einheitlich verfuegbar. Der verlaessliche Standardablauf ist daher immer:

```text
Push antippen -> passende ePiber-Inbox-Meldung oeffnen -> Zur Kenntnis nehmen
```


## 4. Keine ueberfluesslichen Eigenmeldungen

Die aktuelle Inbox erzeugt teilweise Meldungen fuer die Person, die eine Aktion
selbst soeben ausgefuehrt hat. Das fuehrt zu negativen Reaktionen, weil der
Benutzer beispielsweise eine eigene Forderung, einen selbst gespeicherten
Termin oder ein selbst eingetragenes Ergebnis nochmals quittieren muss.

Fuer neu erzeugte Ereignisse gilt deshalb:

> Der handelnde Benutzer erhaelt fuer eine erfolgreich selbst ausgefuehrte
> normale Fachaktion keine persoenliche Inbox-Meldung und keinen Push.

Die Aktion bleibt trotzdem in der neutralen Bewerbshistorie sichtbar. Die
unmittelbare Rueckmeldung erfolgt durch die Erfolgsmeldung der gerade verwendeten
Oberflaeche.

| Aktion | Inbox-/Push-Empfaenger |
|---|---|
| Spieler spricht Forderung aus | nur geforderte Person |
| Spieler setzt, aendert oder sagt Matchtermin ab | alle anderen Matchbeteiligten |
| Spieler traegt Ergebnis ein oder korrigiert es | alle anderen Matchbeteiligten |
| Spieler haengt sich selbst aus Rangliste raus | keine eigene Inbox-Meldung |
| Administrator aendert Fachdaten | betroffene Personen, nicht der handelnde Admin selbst |
| Kommentar oder Reaktion | interessierte andere Benutzer, nie Verfasser/Reaktor selbst |

Die Regel darf nicht pauschal nur `actor_id = recipient_id` vergleichen. Der
Ereigniskatalog muss pro Typ festlegen, ob der Akteur eine Meldung erhalten
kann:

```text
actor_notification = never | required_only | always
```

Beispiele fuer notwendige Ausnahmen:

- Eine selbst gewuenschte Termin- oder Reservierungserinnerung wird immer an
  den Benutzer zugestellt.
- Ein verpflichtender administrativer Handlungsbedarf kann auch den handelnden
  Administrator betreffen.
- Ein Systemproblem wie eine fehlende KO-Fortschreibung muss die zustaendigen
  Personen erreichen, auch wenn eine von ihnen das vorausgehende Ergebnis
  eingetragen hat.

Bei der spaeteren PostgreSQL-Migration werden bereits vorhandene persoenliche
Eigenmeldungen entfernt. Das betrifft nur bekannte, ueberfluessliche
Eigenprojektionen wie `challenge_confirmation`, Termin-, Ergebnis- und
Raushaenge-Bestaetigungen. Neutrale Fachereignisse, Bewerbshistorie, Kommentare
und Reaktionen bleiben bestehen. Vor dem produktiven Lauf ist ein Dry Run mit
Anzahlen nach Ereignistyp Pflicht; freie Texte, Namen oder Kontaktwerte duerfen
nicht in dessen Bericht erscheinen.


## 5. Pflichtmeldungen und freiwillige Meldungen

### 5.1 Pflichtmeldungen

Eine Pflichtmeldung wird fuer alle fachlich berechtigten Empfaenger unabhaengig
von deren freiwilligen Abonnements in die Inbox eingestellt und muss quittiert
werden. Ist auf einem Geraet Push erlaubt, wird der Push dort zusaetzlich
versucht.

Das Betriebssystem kann Push jedoch jederzeit verbieten. Eine Pflichtmeldung
garantiert daher die Inbox, nicht eine externe Anzeige auf einem bestimmten
Telefon.

### 5.2 Freiwillige Meldungen

Eine freiwillige Meldung entsteht nur, wenn der Benutzer eine passende
Benachrichtigungsregel aktiviert hat. Auch diese Meldung muss nach der
getroffenen Entscheidung ausdruecklich quittiert werden.

### 5.3 Wer Pflichtmeldungen veroeffentlichen darf

Eine verpflichtende Kennzeichnung darf nicht beliebig gesetzt werden. Sie ist
im Ereigniskatalog und durch fachliche Zustaendigkeiten beschraenkt:

- Administratoren duerfen innerhalb freigegebener globaler Bereiche handeln.
- Funktionaere duerfen nur fuer ihre zugewiesenen Kalender, Bewerbe oder
  Organisationsbereiche handeln.
- Normale Spieler duerfen keine Pflichtmeldungen erzeugen.
- Die Berechtigung zum Verfassen einer Meldung ist getrennt von der Berechtigung
  zum Anzeigen ihres Inhalts beim Empfaenger.


## 6. Individuelle Einstellungen

Neue Benutzer erhalten standardmaessig keine freiwilligen Inbox-Meldungen und
keine Push-Freigabe. Es gibt keine stillschweigende Aktivierung neuer Kategorien.

Die Profilseite bietet zunaechst einfache Voreinstellungen:

- Keine Benachrichtigungen
- Nur was mich betrifft
- Meine ausgewaehlten Bewerbe
- Alles
- Individuell einstellen

Die Detailansicht trennt Inhalt, Geltungsbereich und Zustellweg.

### 6.1 Inhalt

- Forderungen und Ranglistenereignisse
- Matchtermine, Aenderungen und Absagen
- Match- und Reservierungserinnerungen
- Ergebnisse und Ergebniskorrekturen
- neue Paarungen und Auslosungen
- Eintragungsbeginn und Eintragungsschluss
- Bewerbsbeginn und Bewerbsende
- Platzreservierungen und Platzsperren
- Kalendertermine
- Geburtstage und Vereinsleben
- allgemeine Vereinsmeldungen
- Kommentare, Antworten, Erwaehnungen und Reaktionen
- spaetere persoenliche Nachrichten

### 6.2 Geltungsbereich

- nur mich betreffende Ereignisse
- alle Bewerbe
- ausgewaehlte Bewerbe
- zukuenftige neue Bewerbe automatisch einschliessen
- nur eigene Platzreservierungen
- ausgewaehlte Kalender
- Vereinsleben

Eine Oberkategorie wie `Vereinsleben` kann bewusst auch zukuenftige Untertypen
umfassen. Ein einzelner Untertyp aktiviert nur genau diesen Typ. Die Einstellung
`Alle aktuellen und zukuenftigen Benachrichtigungen` muss ausdruecklich so
bezeichnet werden.

### 6.3 Zustellweg

- persoenliche Inbox
- Push auf diesem Geraet
- spaeter optional E-Mail

E-Mail bleibt eine moegliche spaetere Erweiterung, ist aber nicht Teil der
aktuellen Push-Umsetzung.


## 7. Ereigniskatalog

Der Katalog verwendet stabile technische Schluessel und keine sichtbaren Texte
als Identitaet. Jeder Eintrag beschreibt mindestens:

```text
Ereignistyp
Kategorie
Quelle und stabile Quell-ID
Zeitpunkt
Bezugsart und Bezugs-ID
fachliche Zielgruppe
erlaubte Rollen/Zustaendigkeiten
Pflichtstatus moeglich oder nicht
Akteur-Benachrichtigungsregel
Titel- und Textvorlage
Zielseite
Prioritaet
Ablaufregel
Deduplizierungsschluessel
```

Vorgesehene Kategorien und Beispiele:

| Bereich | Beispiele fuer stabile Ereignistypen |
|---|---|
| Spielbetrieb | `play.match.pairing_created`, `play.match.appointment_changed`, `play.match.result_recorded` |
| Rangliste | `play.ranking.challenge_created`, `play.ranking.withdrawn`, `play.ranking.deadline` |
| Bewerbe | `competition.registration.opens`, `competition.registration.closes`, `competition.starts`, `competition.ends` |
| Platzreservierung | `reservation.court.created`, `reservation.court.changed`, `reservation.court.reminder`, `reservation.court.blocked` |
| Kalender | `calendar.event.published`, `calendar.event.changed`, `calendar.event.cancelled`, `calendar.event.reminder` |
| Vereinsleben | `club.birthday.today`, `club.event.reminder`, `club.announcement.published` |
| Interaktion | `interaction.comment.created`, `interaction.comment.reply`, `interaction.comment.mentioned`, `interaction.reaction.received` |
| Persoenlich | `personal.message.received`, `personal.message.official` |
| System | `system.ko_progression_required`, `system.security.required_action` |

Nicht jedes Fachereignis erzeugt automatisch eine persoenliche Meldung. Erst
Zielgruppe, Berechtigung, Pflichtstatus und Benutzerregeln bestimmen die
persoenlichen Projektionen.


## 8. Spielbetrieb und Bewerbe

Der Spielbetrieb ist ein zentraler Notification-Bereich und umfasst Rangliste,
KO-Bewerbe, Round Robin, Gruppenbewerbe, Einzel- und Doppelmatches.

### 8.1 Forderungen und Rangliste

- Neue Ranglistenforderung: verpflichtende Meldung fuer den Geforderten;
  keine Eigenmeldung fuer den Forderer.
- Terminfrist einer offenen Forderung: opt-in oder festgelegte Pflichtregel fuer
  Beteiligte und bei Bedarf zustaendige sportliche Leitung.
- Austragungsfrist: opt-in oder festgelegte Pflichtregel fuer Beteiligte und
  bei Bedarf zustaendige sportliche Leitung.
- Raushaengen: neutrale Historie; keine Meldung an die selbst handelnde Person.
  Eine freiwillig abonnierte Ranglisteninformation fuer andere Berechtigte kann
  spaeter gesondert modelliert werden.
- Schonzeit, Sperrzeit, Rueckkehranspruch: nur dann persoenlich melden, wenn
  ein konkreter fachlicher Nutzen und eine freigegebene Regel bestehen.

### 8.2 Matches

- Neue Paarung beziehungsweise Auslosung: an beteiligte Personen und optional
  an Abonnenten des Bewerbs.
- Termin gesetzt, geaendert oder abgesagt: an alle anderen Beteiligten; der
  handelnde Benutzer ist ausgenommen.
- Match-Erinnerung: an die Beteiligten nach deren individuellen Einstellungen.
- Ergebnis, Walkover, Retirement, Korrektur oder Ruecknahme: an alle anderen
  Beteiligten und optional an Bewerbsabonnenten.
- Fehlende KO-Fortschreibung: Pflichtmeldung an zustaendige Administratoren
  oder Funktionaere.

### 8.3 Bewerbsphasen

- Eintragungsliste oeffnet.
- Eintragungsschluss naht oder endet.
- Bewerb beginnt.
- Bewerb endet.
- Auslosung beziehungsweise neue Paarungen werden veroeffentlicht.

Die bestehenden Werte `EntryStart`, `EntryDeadline`, `Bewerbsbeginn` und
`Bewerbsende` muessen fuer zeitgesteuerte Erinnerungen als vollstaendige,
eindeutige Zeitpunkte vorliegen. Bei einem bisherigen reinen Datum ohne Uhrzeit
ist vor der Umsetzung verbindlich eine Standarduhrzeit festzulegen oder das
Datenmodell zu erweitern.


## 9. Kalender, Reservierungen und Vereinsleben

Kalender und Platzreservierung sind noch nicht implementiert. Sie werden keine
eigene Notification-Technik erhalten, sondern kuenftige Ereignisproduzenten des
zentralen Katalogs sein.

### 9.1 Kalender

- Funktionaere verwalten nur die Kalender, fuer die sie zustaendig sind.
- Termine koennen veroeffentlicht, geaendert und abgesagt werden.
- Berechtigte Benutzer koennen Kalender und einzelne Terminarten abonnieren.
- Verantwortliche koennen in ihrem Bereich offizielle oder verpflichtende
  Erinnerungen definieren, soweit der Katalog dies erlaubt.
- Benutzer koennen zusaetzlich eigene Erinnerungen fuer abonnierte Termine
  setzen.

### 9.2 Platzreservierungen

- Reservierung erstellt, geaendert oder storniert: Meldung an die betroffenen
  Reservierungsinhaber, ausgenommen der handelnde Benutzer bei der eigenen
  Aktion.
- Beginnende Reservierung: individuelle Erinnerung an den Reservierungsinhaber.
- Platzsperre oder organisatorische Aenderung: an betroffene Reservierungen und
  gegebenenfalls nach Regel an weitere berechtigte Empfaenger.
- Die spaetere Reservierungslogik benoetigt konfliktfreie Buchung, klare
  Zeitgrenzen, Berechtigungen und eine eindeutige Storno-Semantik. Diese Punkte
  sind getrennt fachlich zu definieren.

### 9.3 Vereinsleben

- Geburtstage: nur an Benutzer mit ausdruecklichem Opt-in und nur mit einer
  datenschutzrechtlich freigegebenen Projektionsregel.
- Allgemeine Termine und Veranstaltungen: opt-in nach Kalender oder
  Vereinsbereich, ausser bei freigegebenen Pflichtmeldungen.
- Allgemeine Meldungen: nur durch zustaendige Rollen veroeffentlichbar.
- Auf Push-Sperrbildschirmen sind sensible Inhalte minimal zu halten. Ein
  Geburtstag kann beispielsweise neutral als `Geburtstag im Verein` erscheinen;
  Name oder Alter werden erst nach dem Oeffnen und einer Berechtigungspruefung
  gezeigt.


## 10. Kommentare, Reaktionen und spaetere Direktnachrichten

Kommentare und Reaktionen bleiben Bestandteil der Bewerbshistorie. Sie werden
nicht wieder in externe Chatgruppen verlagert.

Benutzer koennen getrennt opt-in aktivieren fuer:

- alle neuen Kommentare in ausgewaehlten Bewerben,
- Antworten auf eigene Kommentare,
- Erwaehnungen,
- Reaktionen auf eigene Kommentare oder Ereignisbeitraege.

Der Autor eines Kommentars und der Benutzer, der selbst reagiert, erhalten
keine Meldung ueber ihre eigene Aktion. Ausgeblendete Kommentare duerfen normale
Benutzer weder als Text noch als Reaktion per Push erhalten.

Spaetere direkte Mitgliedernachrichten werden als eigener Ereignisbereich
modelliert. Sie duerfen nicht mit Bewerbskommentaren oder allgemeinen
Vereinsmeldungen vermischt werden. Eine direkte Nachricht ist grundsaetzlich
persoenlich und kann je nach fachlicher Regel freiwillig oder verpflichtend
sein.


## 11. Zeitgesteuerte Erinnerungen

Ein Benutzer kann pro Termin maximal drei eigene Erinnerungen einstellen. Die
Bedienung verwendet einen Halbstundenraster, technisch werden aber Minutenwerte
gespeichert.

Vorgesehene Auswahlwerte:

```text
0, 30, 60, 90, 120, 1440, 2880, 10080 Minuten vorher
```

Das entspricht beispielsweise `zum Beginn`, `30 Minuten vorher`, `60 Minuten
vorher`, `24 Stunden vorher`, `2 Tage vorher` und `7 Tage vorher`.

Sinnvolle Vorschlaege nach Bereich:

| Bereich | Vorschlaege |
|---|---|
| Platzreservierung | 30, 60 oder 120 Minuten vorher |
| Eigenes Match | 60 Minuten, 24 Stunden, 2 Tage vorher |
| Kalendereintrag | 60 Minuten, 24 Stunden, 7 Tage vorher |
| Eintragungsschluss | 24 Stunden, 3 Tage, 7 Tage vorher |
| Geburtstag | am selben Tag oder einen Tag vorher |

Der Server darf nicht nur alle 30 Minuten alle Daten durchsuchen. Beim Anlegen
oder Aendern eines Terminobjekts werden stattdessen persistierte,
deduplizierte Erinnerungsauftraege angelegt:

```text
Termin 18:00
Vorlauf 60 Minuten
Faelligkeit 17:00
```

Ein Scheduler verarbeitet indexiert faellige Auftraege. Eine kurze
Sicherheitspruefung, beispielsweise jede Minute, erkennt nach Neustart oder
voruebergehendem Ausfall ueberfaellige Auftraege. Sie ersetzt keine Vollsuche.

Bei Terminverschiebung oder Storno werden noch offene alte Auftraege storniert
und bei einem neuen Termin neu berechnet. Jeder Auftrag besitzt mindestens:

```text
Auftrags-ID
Quellart und Quell-ID
Empfaenger-ID
Ereignistyp
Terminzeitpunkt
Vorlauf in Minuten
Faelligkeitszeitpunkt
Status
Deduplizierungsschluessel
Ablaufzeitpunkt
```

Alle fachlichen Zeitpunkte werden intern als eindeutiger UTC-Zeitpunkt
gespeichert und mit der Zeitzone `Europe/Vienna` eingegeben und angezeigt.
Damit bleiben Sommer- und Winterzeit korrekt.

Jeder Erinnerungstyp benoetigt eine Ablaufregel. Nach laengerem Serverausfall
darf beispielsweise eine Stunden-vorher-Erinnerung nicht fuenf Stunden nach
Matchbeginn nachgesendet werden.


## 12. Rollen und Zustaendigkeiten

Die geplante Rolle `Funktionaer` darf nicht pauschal globale
Benachrichtigungsrechte erhalten. Das Modell benoetigt fachlich begrenzte
Zustaendigkeiten oder Faehigkeiten, beispielsweise:

```text
calendar.club.manage
calendar.competition.manage
competition.manage
courtReservation.manage
notification.club.publish
notification.competition.publish
notification.mandatory.publish
```

Die konkrete Rollen- und Berechtigungsstruktur ist vor Einfuehrung der Rolle
fachlich festzulegen. Das Notification-System muss jedoch von Beginn an drei
getrennte Fragen behandeln:

1. Wer darf das Quellereignis erzeugen oder aendern?
2. Wer ist fachlich als Empfaenger berechtigt?
3. Wer darf den vollstaendigen Inhalt beim Oeffnen sehen?

Eine gespeicherte Benachrichtigungseinstellung verleiht niemals eine fachliche
Berechtigung. Bei Rollen- oder Zustaendigkeitsverlust werden zukuenftige
Zustellungen gesperrt; vorhandene Meldungen sind nach einer festzulegenden
Datenschutzregel zu pruefen.


## 13. Datenschutz, Sicherheit und Observability

- Push-Abonnements werden als personenbezogene Geraetedaten geschuetzt
  gespeichert und nicht in Browser-Logs, Audittexten oder Metriklabels
  ausgegeben.
- Push-Text ist datensparsam. Sperrbildschirmvorschauen enthalten keine freien
  Kommentartexte, Gruende, Kontaktwerte oder unnoetigen Personendaten.
- Nach Antippen prueft ePiber erneut Session, Rolle und Zugriffsrecht, bevor
  Detailinhalte angezeigt werden.
- Zustellversuche verwenden kontrollierte Statuswerte und deduplizierte
  Wiederholungen. Ein externer Push-Fehler veraendert nie den Fachwrite.
- Einstellungen, Push-Geraete, Pflichtmeldungen, Quittierungen und fachliche
  Notification-Writes benoetigen strukturierte Abschlusslogs; fachliche Writes
  benoetigen Auditphasen `started`, `success`, `failed` und `unknown`.
- Audit und Betriebslogs verwenden nur kontrollierte IDs, Typen, Statuswerte,
  Zeitwerte und Anzahlen. Keine Passwoerter, Tokens, Push-Endpunkte, freien
  Payloads, Kommentartexte oder unnoetigen Personendaten.
- Neue Browserdiagnosen benoetigen einen bekannten Seitentyp, eine serverseitige
  Event-Allowlist und Tests.
- Tests muessen neben Zustellungs- und Fehlerpfaden auch Berechtigungswechsel,
  Eigenmeldungsunterdrueckung, Deduplizierung, Neustart-Recovery und
  iOS-/Android-PWA-Ablauf abdecken.


## 14. E-Mail und WhatsApp

E-Mail bleibt als spaeter moeglicher externer Zustellkanal denkbar, ist aber
ausdruecklich nicht Bestandteil des aktuellen Push-Auftrags.

WhatsApp wird nicht umgesetzt und soll vollstaendig aus dem aktuellen
Anwendungsstand entfernt werden. Das betrifft bei einem gesonderten
Umsetzungsauftrag insbesondere:

- WhatsApp-Adapter und dessen Serverinitialisierung,
- erlaubte externe Kanaele und die alte Sheetspalte `Notification`,
- Profilprojektionen, Tests und Testdaten,
- aktuelle technische Dokumentation und Rollout-Checklisten,
- nicht konfigurierte WhatsApp-Zustellstatus bei der Datenmigration.

Ein alter Wert wie `Email|Whatsapp` darf bei einer Migration nicht dazu fuehren,
dass der weiterhin erlaubte E-Mail-Anteil verloren geht. Historische Erwaehnungen
in bereits veroeffentlichten Changelogs bleiben als korrekte Historie bestehen
und werden nicht nachtraeglich umgeschrieben.


## 15. PostgreSQL-Abhaengigkeit und Abgrenzung

Die getroffene Zielentscheidung ist PostgreSQL als neue autoritative
Anwendungsdatenbank. Google Sheets wird nach einem erfolgreich verifizierten
Cutover nur archiviert und nicht parallel fortgefuehrt oder ruecksynchronisiert.

Die Datenbankmigration wird spaeter separat geplant. Fuer Notifications ergeben
sich daraus bereits folgende verbindliche Architekturvorgaben:

- Fachwrite, zentrales Ereignis und Erinnerungsauftrag muessen in einer
  PostgreSQL-Transaktion entstehen koennen.
- Push-Zustellung erfolgt anschliessend asynchron aus einer persistenten Outbox.
- Ein Push-Fehler darf keinen fachlichen Write zurueckrollen.
- Das Zielmodell braucht Tabellen fuer Ereignisse, persoenliche
  Meldungsprojektionen, Quittierungen, Abonnements, Push-Geraete,
  Erinnerungsauftraege, Zustellversuche und Idempotenz.
- Kalender, Platzreservierung und spaetere Funktionaerszustaendigkeiten werden
  direkt auf diesem Modell aufbauen.
- Die bestehende Aufteilung Google Sheets plus mehrere SQLite-Dateien wird nicht
  zuerst fuer Push erweitert.

Ausdruecklich nicht Gegenstand dieser Datei sind das konkrete PostgreSQL-Schema,
das Hosting, Backup/Restore, die Datenuebernahme, Cutover-Ablauf, Rueckfallplan
und die Ausserbetriebnahme der Google-API. Diese Themen werden in einem eigenen
Migrationsauftrag behandelt.


## 16. Vorgesehene Umsetzungsreihenfolge

1. PostgreSQL-Migration als getrennten Auftrag planen und umsetzen; dabei das
   Notification-Grundmodell im Zielschema vorsehen.
2. WhatsApp aus dem aktuellen Sollstand und der Laufzeit entfernen.
3. Generischen Ereigniskatalog, Berechtigungsmodell und
   Eigenmeldungsunterdrueckung implementieren.
4. Bestehende Forderungs-, Termin-, Ergebnis- und Bewerbsereignisse an den
   zentralen Verteiler anbinden.
5. Bestehende ueberfluessliche Eigenmeldungen im verifizierten Migrationslauf
   kontrolliert bereinigen.
6. Profilregeln fuer freiwillige und verpflichtende Meldungen umsetzen.
7. Persistente Erinnerungsauftraege und Scheduler ergaenzen.
8. PWA, Service Worker, Web Push und Geraeteverwaltung umsetzen.
9. Spielbetrieb und Bewerbsphasen vollstaendig abnehmen.
10. Kalender, Platzreservierung, Funktionaersrollen und persoenliche Nachrichten
    in spaeteren Fachauftraegen als neue Ereignisproduzenten anschliessen.


## 17. Noch offene fachliche Entscheidungen

- Welche Ereignistypen sind neben einer neuen Forderung tatsaechlich
  verpflichtend und welche ausschliesslich opt-in?
- Welche Funktionaersrollen und Zustaendigkeitsbereiche existieren genau?
- Welche Kalender sind oeffentlich, mitgliederintern oder nur fuer bestimmte
  Funktionaere sichtbar?
- Welche Daten duerfen bei Geburtstagen auf Sperrbildschirm und nach dem Oeffnen
  angezeigt werden?
- Welche Standarduhrzeit gilt fuer bisher nur datumsgenaue Eintragungs- und
  Bewerbsgrenzen?
- Welche Ablaufzeit gilt je Erinnerungsart nach einem Serverausfall?
- Duerfen offizielle Erinnerungen durch Benutzer stummgeschaltet werden, solange
  sie keine Pflichtmeldung sind?
- Welche Moderations- und Datenschutzregeln gelten fuer spaetere direkte
  Mitgliedernachrichten?
- Wie werden vorhandene, bereits quittierte Eigenmeldungen im Migrations-Dry-Run
  genau abgegrenzt und freigegeben?
