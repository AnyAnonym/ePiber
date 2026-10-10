# Spielunterbrechung und spaetere Fortsetzung

Stand: 10.10.2026
Status: Fachliche und technische Arbeitsgrundlage; noch nicht implementiert,
freigegeben oder kanonisch dokumentiert
Gegenstand: Unterbrechen eines begonnenen Matches mit vollstaendiger
Spielstandsicherung und spaeterer Fortsetzung ueber ein favoritenfaehiges Overlay

Diese Datei ist eine nicht-kanonische Arbeitsgrundlage unter `Project/2do/`.
Sie dokumentiert das bestaetigte Zielbild, die derzeit erkennbaren Auswirkungen
und die vor einer Umsetzung noch zu klaerenden Punkte. Sie beschreibt keine
bereits vorhandene Funktion und keinen aktuellen Datenvertrag. Die kanonischen
Fach-, Software-, Datenbank-, Endpoint- und Seitendokumente werden erst im Zuge
einer spaeter freigegebenen Implementierung angepasst.

In diesem Dokument verwendete Feld-, Endpoint- und Overlaynamen sind
Arbeitsbezeichnungen. Sie legen noch kein Speicherschema und keine konkrete API
fest. Insbesondere wird mit dieser Planung keine Aenderung an Google Sheets,
SQLite, PostgreSQL, Backend oder Frontend vorgenommen.


## 1. Anlass und Ziel

Ein bereits begonnenes Match kann beispielsweise wegen Regen oder anderer
aeusserer Umstaende nicht fertig gespielt werden. Der bis dahin erreichte Stand
soll vollstaendig gesichert werden. Das Match bleibt fachlich offen, erhaelt
jedoch den sichtbaren Zustand `Unterbrochen` und kann zu einem spaeteren,
terminlich unabhaengigen Zeitpunkt fortgesetzt werden.

Das Ziel ist ein durchgaengiger Ablauf:

```text
laufendes Match
  -> Spiel unterbrechen
  -> exakten Stand sichern und bisherigen Termin entfernen
  -> unter offenen Spielen als unterbrochen darstellen
  -> optional neuen Termin vereinbaren
  -> ueber das Overlay "Fortsetzbare Spiele" auswaehlen
  -> gespeicherten Stand fuer das Scoreboard und die physische Anlage vorbereiten
  -> Fortsetzung kontrolliert starten
  -> Match spaeter regulaer abschliessen oder erneut unterbrechen
```

Die Unterbrechung ist weder ein regulaerer Matchabschluss noch ein Walkover
(`[wo]`) oder Retirement (`[ret]`). Sie bestimmt keinen Gewinner, veraendert
keine Rangfolge und darf keine KO-Fortschreibung oder Gruppenwertung ausloesen.


## 2. Bestaetigte fachliche Entscheidungen

Folgende Anforderungen sind fuer die spaetere Umsetzung bestaetigt:

1. Beteiligte Spieler und Administratoren duerfen ein Match unterbrechen und
   seine Fortsetzung ausloesen. Ein Administrator darf dies fuer jedes fachlich
   zulaessige Match; ein Spieler nur fuer ein eigenes Match.
2. Das Match bleibt waehrend der Unterbrechung offen.
3. Beim Unterbrechen wird der bisherige vereinbarte Spieltermin entfernt.
4. Unterbrechungszustand und gesicherter Spielstand sind vom Spieltermin
   unabhaengig. Ein neuer Termin darf den Unterbrechungszustand und den
   gespeicherten Stand nicht loeschen oder stillschweigend als fortgesetzt
   behandeln.
5. Ohne neuen Termin wird das Match als `Unterbrochen - Termin offen`
   dargestellt. Mit neuem Termin wird die geplante Fortsetzung sichtbar, ohne
   dass das Match schon als tatsaechlich fortgesetzt gilt.
6. Der Zwischenstand muss vollstaendig gespeichert werden. Dazu gehoeren alle
   Satz- beziehungsweise Gamewerte, der laufende Punktestand und die exakte
   Person, die zum Sicherungszeitpunkt Aufschlag hat.
7. Fuer die Fortsetzung ist eine eigene Aktion vorgesehen. Die blosse Vergabe
   eines neuen Termins ist keine Fortsetzungsaktion.
8. Die Fortsetzungsaktion wird als eigenes Overlay angeboten und kann wie die
   vorhandenen direkten Matchaktionen als Favorit gespeichert werden.
9. Das Overlay traegt fachlich die Bezeichnung `Fortsetzbare Spiele` und zeigt
   alle vom aktuellen Benutzer fortsetzbaren Matches. Nach Auswahl eines Matches
   soll der kontrollierte Ablauf zum Laden des Matches in das Scoreboard starten.


## 3. Fachliche Zustaende

Die spaetere Umsetzung muss mindestens folgende sichtbaren Zustaende
unterscheiden. Ob sie als einzelnes persistentes Statusfeld oder aus mehreren
Fakten abgeleitet werden, wird erst mit dem Datenmodell festgelegt.

| Zustand | Bedeutung |
|---|---|
| `offen` | Noch nicht abgeschlossen und derzeit ohne aktive Unterbrechung. |
| `unterbrochen` | Begonnen, mit gesichertem Zwischenstand pausiert und noch nicht wieder gestartet. |
| `fortsetzbar` | Projektion eines unterbrochenen Matches, das fuer den aktuellen Principal und den aktuellen Systemzustand fortgesetzt werden darf. |
| `Fortsetzung wird vorbereitet` | Temporaerer technischer Zustand waehrend Court-Zuordnung und Wiederherstellung des gespeicherten Standes. |
| `fortgesetzt` | Der gespeicherte Stand wurde kontrolliert hergestellt und die weitere Live-Erfassung wurde freigegeben. Das Match bleibt offen. |
| `abgeschlossen` | Regulaeres Ergebnis, Walkover oder Retirement nach den bestehenden Abschlussregeln. |

`fortsetzbar` ist principal- und situationsbezogen. Ein Match kann fachlich
unterbrochen sein, fuer einen bestimmten Benutzer aber wegen fehlender Rechte,
ungueltiger Teilnehmer, eines Datenkonflikts oder eines bereits anderweitig
belegten Courts momentan keine Fortsetzungsaktion anbieten.

Ein neu eingetragener Termin veraendert `unterbrochen` nicht. Erst die
ausdrueckliche, erfolgreich bestaetigte Fortsetzungsaktion darf den Zustand auf
`fortgesetzt` ueberfuehren. Ein erneutes Unterbrechen eines fortgesetzten Matches
erzeugt einen neuen Unterbrechungsvorgang und ersetzt nicht die fachliche
Historie der vorherigen Unterbrechung.


## 4. Vollstaendig zu sichernder Spielstand

Der gespeicherte Stand muss die spaetere eindeutige Wiederherstellung ermoeglichen
und mindestens folgende kontrollierte Informationen enthalten:

- Match-ID und Bewerbs-ID,
- Zeitpunkt der Unterbrechung in Wiener Lokalzeit sowie eindeutiger technischer
  Zeitstempel,
- Court beziehungsweise Quelle des uebernommenen Standes,
- Revision der Court-Zuweisung und Revision des gelesenen Scores,
- Zuordnung von Heim- und Gastseite zu den Matchteilnehmern,
- alle drei rohen Satz-/Gamepaare,
- Punkte von Heim und Gast im laufenden Game, einschliesslich der vom externen
  System verwendeten Werte wie `A` beziehungsweise `AD`,
- die fuer die Anzeige wirksame Matchtyp-ID und der fixierte Regelsnapshot,
- die aus den Rohwerten abgeleitete semantische Anzeige, insbesondere bei
  Satz-Tie-Break und entscheidendem Match-Tie-Break,
- die exakte Personen-ID des aktuellen Aufschlaegers,
- den Akteur, der die Unterbrechung bestaetigt hat,
- eine Version des Snapshotvertrags fuer spaetere kompatible Erweiterungen.

Als konzeptionelles, noch nicht verbindliches Modell gilt:

```text
InterruptionSnapshot
  schemaVersion
  matchId
  competitionId
  court
  capturedAt
  assignmentRevision
  scoreRevision
  matchTypeId
  displayRules
  homeParticipantIds[]
  guestParticipantIds[]
  rawScore
    set1Home / set1Guest
    set2Home / set2Guest
    set3Home / set3Guest
    pointsHome / pointsGuest
  displayScore
  serverPersonId
```

Der Rohstand und die Anzeigeprojektion haben unterschiedliche Aufgaben. Der
Rohstand wird fuer eine moeglichst genaue Wiederherstellung der externen
Drehwerte benoetigt. Die Anzeigeprojektion verhindert, dass beispielsweise die
im Satz-Tie-Break physisch anders verwendete dritte Drehspalte spaeter als echter
dritter Satz missverstanden wird.

Bei einem Doppel muss `serverPersonId` eine der vier konkreten beteiligten
Personen bezeichnen; nur die Angabe der Teamseite reicht nicht aus. Beim Einzel
muss sie einen der beiden Hauptspieler bezeichnen. Der Serverwert darf nie als
freier Name gespeichert werden.


## 5. Derzeitige Grenzen der Scorequelle

Die externe Scoreboard-Einheit ist aktuell eine reine Datenquelle fuer ePiber.
ePiber kann ihre Drehfelder oder die externe Ticker-App nicht beschreiben. Das
heutige JSON liefert Satz-/Gamewerte und Punkte, aber keine dokumentierte
Information darueber, welche konkrete Person Aufschlag hat.

Daraus folgen zwei zwingende Grenzen fuer die spaetere Umsetzung:

1. `In das Scoreboard laden` kann zunaechst nur bedeuten, dass ePiber das Match
   einem Court zuordnet und den gespeicherten Stand als
   Wiederherstellungsanzeige bereitstellt. Es bedeutet ohne eine neue externe
   Schnittstelle nicht, dass ePiber die physische Anlage automatisch verstellt.
2. Der Aufschlaeger muss vorerst im Unterbrechungsdialog ausdruecklich ausgewaehlt
   und bestaetigt werden. Eine spaetere technische Quelle darf diese Eingabe nur
   ersetzen, wenn Herkunft, Aktualitaet und Eindeutigkeit verlaesslich nachweisbar
   sind.

Vor der Implementierung ist erneut zu pruefen, ob der Anbieter inzwischen eine
kontrollierte Schreibschnittstelle oder ein Aufschlagfeld bereitstellt. Ohne
eine solche Schnittstelle bleibt die manuelle Einstellung der physischen Tafel
und Ticker-App Teil des Betriebsablaufs.


## 6. Ablauf "Spiel unterbrechen"

### 6.1 Einstieg

Die gemeinsame Matchaktionsauswahl soll fuer ein eigenes, begonnenes und noch
nicht abgeschlossenes Match zusaetzlich `Spiel unterbrechen` anbieten.
Administratoren erhalten dieselbe Aktion fuer jedes zulaessige Match. Der
Einstieg kann aus einer Matchkarte oder dem gemeinsamen Profil erfolgen.

Die Aktion darf nur angeboten werden, wenn der Server sie principalbezogen
freigibt. Eine rein im Browser aus Teilnehmer-IDs abgeleitete Berechtigung reicht
nicht aus.

### 6.2 Ermittlung des Standes

Der Server muss den Stand aus genau einer aktuellen Court-Zuordnung fuer die
betroffene Match-ID ermitteln. Match-ID, Court-Zuweisungsrevision, Aktivstatus,
Score-Revision und Quellenalter werden gemeinsam geprueft. Mehrere passende
Courts, ein unzugeordneter Court, eine veraltete Quelle oder eine waehrend des
Dialogs geaenderte Zuweisung muessen den Vorgang kontrolliert stoppen.

Ein historischer ScoreLog-Eintrag darf nicht stillschweigend als aktueller
Unterbrechungsstand verwendet werden. Ob er in einem gesonderten, deutlich
gekennzeichneten Recovery-Ablauf angeboten werden darf, ist vor der Umsetzung
zu entscheiden.

### 6.3 Bestaetigungsdialog

Der Dialog zeigt mindestens:

- Bewerb, Runde und beide Seiten,
- Court und Alter der Scorequelle,
- semantisch dargestellte Saetze/Games und laufende Punkte,
- den auszuwaehlenden beziehungsweise zu bestaetigenden Aufschlaeger,
- den Hinweis, dass der bisherige Termin entfernt wird,
- den Hinweis, dass das Match offen und als unterbrochen sichtbar bleibt.

Der Browser sendet keinen frei veraenderbaren Score als autoritative Wahrheit.
Der Server liest den durch Revisionen gebundenen Stand beim Write erneut und
vergleicht ihn mit dem vom Dialog erwarteten Snapshot-Fingerprint. Die
Aufschlaeger-ID muss zu den aktuellen Teilnehmern gehoeren.

### 6.4 Persistenter Fachwrite

Unterbrechungszustand, vollstaendiger Snapshot, Unterbrechungszeitpunkt und das
Leeren des bisherigen `MatchDate` bilden fachlich einen gemeinsamen Write. Es
darf kein erfolgreicher Zustand sichtbar werden, in dem nur der Termin entfernt,
der Zwischenstand aber nicht gesichert wurde oder umgekehrt.

Der Write muss idempotent, anhand einer `operationId` wiederholbar und bei
unklarem externem Ausgang bestaetigbar sein. Er muss vor der Mutation Teilnehmer,
Matchoffenheit, fehlenden Abschluss, Matchtyp, erwarteten Matchfingerprint und
Court-/Score-Revision erneut pruefen.

Die Deaktivierung eines Courts bleibt nach der derzeit bestaetigten
Rollenverteilung eine Aufgabe von Operatoren und Administratoren. Eine spaetere
Verknuepfung von Fachwrite und Court-Deaktivierung benoetigt deshalb einen
ausdruecklichen rollen- und recovery-sicheren Vertrag und darf nicht nebenbei
allgemeine Court-Rechte an Spieler vergeben.


## 7. Darstellung waehrend der Unterbrechung

### 7.1 Offene Spiele

Ein unterbrochenes Match bleibt in der Kategorie `Offen`. Die Matchkarte zeigt:

- ein deutliches Badge `Unterbrochen`,
- den gesicherten Satz-/Gamestand,
- den laufenden Punktestand,
- eine kontrollierte Aufschlagmarkierung bei der betreffenden Person,
- ohne `MatchDate` den Text `Termin offen`,
- mit neuem `MatchDate` den Text `Fortsetzung am <Datum und Uhrzeit>`.

Der Zwischenstand darf nicht als Ergebnis und keine Seite als Gewinner
dargestellt werden. Filter und Trefferzahlen muessen das Match weiterhin als
offen behandeln.

### 7.2 Profil und persoenliche Matchansichten

Das gemeinsame Profil zeigt denselben fachlichen Zustand und stellt fuer
berechtigte Principals die Aktionen fuer Termin, Unterbrechung beziehungsweise
Fortsetzung bereit. Nicht berechtigte angemeldete Benutzer duerfen den
oeffentlich vorgesehenen Zustand sehen, aber keine Aktion erhalten.

### 7.3 Live-Scoreboard

Ein deaktivierter Court kann den zuletzt gespeicherten Unterbrechungsstand mit
einem sichtbaren Hinweis `Unterbrochen` darstellen. Die konkrete Entscheidung,
ob und wie lange dies anstelle einer freien Courtanzeige geschieht, ist noch
offen. Ein Backendneustart darf einen fachlich gespeicherten
Unterbrechungsstand nicht allein deshalb verlieren, weil aktuelle Live-Scores
heute nur im Prozessspeicher liegen.


## 8. Terminierung bleibt unabhaengig

Beim Unterbrechen wird der bisherige Termin entfernt. Danach gelten folgende
Zustaende:

```text
unterbrochen + MatchDate leer
  -> Unterbrochen - Termin offen

unterbrochen + neuer MatchDate-Wert
  -> Unterbrochen - Fortsetzung am <Termin>

neuer Termin
  - loescht keinen Zwischenstand
  - setzt das Match nicht fort
  - aendert keinen Aufschlaeger
  - aktiviert keinen Court
```

Die bestehende Terminaktion soll auch fuer unterbrochene Matches nutzbar bleiben.
Fristen von Ranglistenforderungen und die Frage, wie eine wetterbedingte
Unterbrechung auf bestehende Spielschlussfristen wirkt, sind vor der Umsetzung
fachlich festzulegen. Die Anwendung darf eine Frist nicht allein aus der
Unterbrechung heraus eigenmaechtig verlaengern.


## 9. Favoritenoverlay "Fortsetzbare Spiele"

### 9.1 Favoritenziel

Es ist ein neues kontrolliertes Overlayziel vorgesehen. Arbeitsbezeichnung:

```text
{ type: "overlay", overlay: "match-resume" }
```

Sichtbare Favoritenbezeichnung:

```text
Fortsetzbare Spiele
```

Das Ziel muss in dieselbe serverseitige Favoriten-Allowlist und sichere
Startseitenprojektion aufgenommen werden wie die vorhandenen Overlays fuer
Matchergebnis und Termin. Freie URLs, Match-IDs oder Beschriftungen werden nicht
im Favoritenziel gespeichert. Das Overlay ermittelt die aktuell zulaessigen
Matches bei jedem Oeffnen neu.

### 9.2 Inhalt

Das Overlay listet ausschliesslich Matches, die:

- fachlich unterbrochen und noch nicht abgeschlossen sind,
- einen vollstaendigen und gueltigen Unterbrechungssnapshot besitzen,
- den aktuellen Benutzer beteiligen oder fuer einen Administrator zulaessig
  sind,
- keine ungeklaerte gleichzeitige Fortsetzung besitzen.

Jeder Eintrag zeigt Bewerb, Runde, Teilnehmer, Zwischenstand, Punkte,
Aufschlaeger, Unterbrechungszeitpunkt und gegebenenfalls den neuen Termin.
Administratoren benoetigen eine eindeutige Kennzeichnung, wenn mehrere Matches
dieselben Personen oder denselben Bewerb betreffen.

### 9.3 Auswahl und Laden

Nach Auswahl eines Matches soll der Fortsetzungsablauf beginnen und das Match in
das Scoreboard geladen werden. Diese Zielaussage ist bestaetigt; die genaue
Court- und Rollenmechanik ist noch festzulegen.

Die spaetere Loesung muss gleichzeitig folgende Grenzen einhalten:

- Spieler duerfen nur ein eigenes, serverseitig als fortsetzbar projiziertes
  Match auswaehlen.
- Die Auswahl darf ihnen keine allgemeine Court-Zuweisungs- oder
  Scoreboard-Betriebsberechtigung verleihen.
- Operatoren und Administratoren behalten ihre bestehende Verantwortung fuer
  Courts und Anzeigen.
- Ein bereits anderweitig aktiver oder zwischenzeitlich neu belegter Court darf
  nicht ueberschrieben werden.

Als bevorzugt zu pruefendes Modell gilt eine eng begrenzte Fortsetzungsoperation:
Ein Beteiligter darf nur fuer das eigene Snapshot-Match eine
Fortsetzungsanforderung erzeugen. Die tatsaechliche Court-Zuordnung erfolgt je
nach spaeterer Rollenentscheidung entweder nach Operatorfreigabe oder durch eine
auf genau dieses Match begrenzte serverseitige Operation. Die Entscheidung muss
vor Implementierungsbeginn fachlich bestaetigt werden.


## 10. Wiederherstellungs- und Fortsetzungsablauf

Wegen der rein lesenden externen Scorequelle ist ein kontrollierter Handshake
erforderlich:

1. Berechtigter Benutzer waehlt das Match im Overlay `Fortsetzbare Spiele`.
2. Der Server prueft Matchstatus, Snapshotfingerprint, Teilnehmer, Termin,
   bestehende Fortsetzungsanforderungen und Courtzustand erneut.
3. Ein zulaessiger Court wird ausgewaehlt beziehungsweise durch den zustaendigen
   Operator bestaetigt.
4. ePiber ordnet das Match dem Court in einem besonderen Zustand
   `Fortsetzung wird vorbereitet` zu. Normale externe Scoreaenderungen duerfen
   den gespeicherten Stand in dieser Phase nicht unbemerkt ersetzen.
5. Das Scoreboard zeigt den gesicherten Stand und eine Einstellhilfe fuer alle
   physischen Drehwerte, die Punkte in der Ticker-App und den Aufschlaeger.
6. Die physische Tafel und die externe Ticker-App werden manuell auf diesen Stand
   gebracht, solange keine freigegebene externe Schreibschnittstelle existiert.
7. Der hergestellte externe Stand wird gegen den Snapshot verglichen. Die
   Aufschlaegerinformation wird separat bestaetigt, solange sie nicht extern
   lesbar ist.
8. Erst nach eindeutiger Bestaetigung wird die neue externe Baseline angenommen,
   der Court aktiviert und das Match als `fortgesetzt` markiert.
9. Ab diesem Zeitpunkt werden weitere externe Aenderungen wieder normal als
   Live-Score verarbeitet und protokolliert.

Der Ablauf muss bei Abbruch vor Schritt 8 in einen sicheren Zustand zurueckkehren:
Der gespeicherte Snapshot bleibt erhalten, das Match bleibt unterbrochen und ein
fremdes Match darf nicht beeinflusst werden. Bei einem unklaren Ausgang muss der
Server den tatsaechlichen Zustand nachlesen und darf weder blind erneut zuweisen
noch den Snapshot loeschen.


## 11. Mehrfache Unterbrechungen und Abschluss

Ein Match kann mehrmals unterbrochen werden. Jede Unterbrechung erzeugt ein
eigenes unveraenderliches Fachereignis mit Zeitpunkt, Akteur und kontrollierter
Snapshotreferenz. Der aktuelle Matchzustand verweist auf den neuesten gueltigen
Snapshot; aeltere Unterbrechungen bleiben in der Historie nachvollziehbar.

Ein spaeterer regulaerer Abschluss verwendet die bestehenden Ergebnisregeln. Der
Zwischenstand ist kein automatisch gueltiges Endergebnis. Er kann wie der heutige
Scoreboard-Vorschlag als kontrollierte Eingabehilfe dienen, muss beim Abschluss
aber erneut gegen den Matchtyp validiert werden.

Bei zuvor unterbrochenen Matches ist die heutige Anzeige einer einfachen Dauer
`MatchEnde - MatchStart` moeglicherweise irrefuehrend, weil sie die Regenpause
einschliesst. Vor der Umsetzung ist zu entscheiden, ob:

- nur erster Beginn und endgueltiges Ende ohne berechnete Dauer gezeigt werden,
- aktive Spielsegmente mit Start und Ende gespeichert werden, oder
- eine ausdruecklich als verstrichene Gesamtzeit bezeichnete Dauer angezeigt
  wird.

Eine Unterbrechung darf nicht allein wegen eines grossen Zeitabstands als
Retirement behandelt werden. Beim Ergebnisabschluss muss der aktuelle
Unterbrechungs- beziehungsweise Fortsetzungszustand kontrolliert beendet werden.


## 12. Ereignisse und Benachrichtigungen

Mindestens folgende neutrale Fachereignisse sind vorgesehen:

- `match_interrupted`,
- `match_resume_requested`, falls eine getrennte Operatorfreigabe eingefuehrt
  wird,
- `match_resumed`,
- gegebenenfalls `match_resume_cancelled`.

Andere Matchbeteiligte sollen ueber Unterbrechung, neuen Fortsetzungstermin und
tatsaechliche Fortsetzung informiert werden. Der handelnde Benutzer erhaelt nach
dem geplanten allgemeinen Notification-Zielbild keine unnoetige eigene
Pflichtmeldung; seine direkte Erfolgsanzeige und die neutrale Bewerbshistorie
bleiben bestehen. Die endgueltige Empfaenger- und Zustellmatrix ist mit dem
separaten Konzept `Project/2do/NOTIFICATIONS-UND-PUSH.md` abzugleichen.

Freie Gruende fuer eine administrative Handlung gehoeren nur in die dafuer
freigegebene Fachhistorie und private Meldungsprojektion, nicht in Betriebslogs,
Browserdiagnosen oder unkontrollierte Auditfelder.


## 13. Sicherheit, Konsistenz und Datenschutz

Die spaetere Implementierung muss mindestens folgende Regeln erfuellen:

- Jeder Fachwrite verwendet eine UUID-`operationId` und einen persistenten
  Recoveryvertrag.
- Matchzeile und Court-Zuweisung werden ueber stabile IDs und Revisionen
  gebunden; Tabellenzeilennummern sind keine dauerhafte Identitaet.
- Ein Fingerprint umfasst alle fuer Unterbrechung und Fortsetzung relevanten
  Match- und Snapshotfelder.
- Teilnehmer, Teamseiten, Aufschlaeger, Matchtyp und Abschlussstatus werden vor
  jedem Write serverseitig frisch geprueft.
- Gleichzeitige Unterbrechungs-, Termin-, Ergebnis-, Court- und
  Fortsetzungsaktionen duerfen keinen gemischten Zustand erzeugen.
- Oeffentliche Projektionen enthalten nur die fuer sichtbaren Matchstatus und
  Spielstand erforderlichen kontrollierten Felder.
- Audit und Betriebslogs enthalten IDs, kontrollierte Zustandswerte,
  Revisionen, Recoverystatus und Grundvorhandenheit, aber keine Namen, freien
  Texte oder unkontrollierten Request-/Snapshotpayloads.
- Ein gespeicherter Aufschlaeger ist eine bereits am oeffentlichen Match
  beteiligte Personen-ID; trotzdem wird er in Audit und Betriebslog nur dann
  ausgegeben, wenn dies fuer den kontrollierten Vertrag erforderlich ist.
- Alte Clients duerfen neue Statuswerte nicht als abgeschlossenes Match oder
  Ergebnis interpretieren.


## 14. Observability

Unterbrechen und Fortsetzen sind Fachwrites. Beide benoetigen:

- Audit `started` vor der Mutation,
- Auditabschluss `success`, `failed` oder `unknown`,
- strukturierte Abschlusslogs mit Endpoint, Match-ID, Bewerbs-ID, Akteur-ID,
  kontrolliertem altem/neuem Zustand, Court, Revisions- und Recoverystatus,
- getrennte Warnungen fuer Konflikt, veralteten Score, fehlenden Aufschlaeger,
  unklare Sheet-/Datenbankmutation und gescheiterte Courtphase,
- Metriken fuer erfolgreiche, abgelehnte und unklare Unterbrechungen sowie
  Fortsetzungen,
- Browserdiagnosen fuer fehlgeschlagene sichtbare Aktionen.

Vorgesehene Browserdiagnosen wie `match_interruption_failed` und
`match_resume_failed` muessen vor Verwendung in die serverseitige Event-Allowlist
aufgenommen, einem bekannten Seitentyp zugeordnet und mit kontrollierten Feldern
getestet werden. Spielstaende, Namen, freie Gruende und ganze Payloads duerfen
nicht als Diagnosedaten uebertragen werden.


## 15. Fehler- und Randfaelle

Mindestens folgende Faelle muessen vor einer Freigabe definiert und getestet
sein:

- Match ist bereits abgeschlossen, ignoriert, BYE oder unvollstaendig besetzt.
- Akteur ist nicht beteiligt und kein Administrator.
- Match ist keinem Court oder mehreren Courts zugeordnet.
- Court wurde waehrend des Dialogs neu zugewiesen oder deaktiviert.
- Scorequelle ist veraltet, nicht erreichbar oder hat seit dem Dialog ihren
  Stand geaendert.
- Noch keine protokollpflichtige Scoreraenderung ist vorhanden.
- Aufschlaeger fehlt, ist kein Teilnehmer oder passt nicht zur dargestellten
  Teamseite.
- Matchtyp oder Displayregeln fehlen beziehungsweise haben sich gegenueber der
  laufenden Zuweisung unerlaubt geaendert.
- Terminloeschung oder Snapshotspeicherung hat einen unklaren Ausgang.
- Unterbrechung und Ergebniseintrag laufen gleichzeitig.
- Unterbrechung und Terminwrite laufen gleichzeitig.
- Zwei Benutzer starten gleichzeitig die Fortsetzung.
- Vorgesehener Court ist bereits durch ein anderes Match belegt.
- Externe Tafel laesst sich nicht exakt auf den gespeicherten Stand einstellen.
- Backend oder Browser startet waehrend der Wiederherstellung neu.
- Match wird nach einer Fortsetzung erneut unterbrochen.
- Satz-Tie-Break oder Match-Tie-Break verwendet physische Felder anders als die
  semantische Anzeige.
- Ein Doppel wechselt den Aufschlaeger innerhalb derselben Teamseite.
- Der neue Termin liegt nach einer heute geltenden Ranglistenfrist.


## 16. Test- und Abnahmeumfang

Die spaetere Umsetzung benoetigt mindestens:

### Fach- und Servicetests

- Zustandsuebergaenge fuer normale, unterbrochene, fortgesetzte und
  abgeschlossene Matches,
- vollstaendige Score- und Aufschlaegervalidierung fuer Einzel und Doppel,
- Terminloeschung und neue Terminvergabe ohne Verlust des Snapshots,
- mehrfache Unterbrechungen,
- Matchtyp-Projektion fuer normale Saetze, Satz-Tie-Break, MT7 und MT10,
- Teilnehmer- und Adminrechte sowie negative Operator-/Fremdspielerfaelle,
- Idempotenz, Fingerprintkonflikte und Unknown-Write-Recovery,
- Rennen zwischen Termin, Ergebnis, Court-Zuweisung, Unterbrechung und
  Fortsetzung,
- Audit-, Logging-, Metrik-, Messaging- und Datenschutzprojektionen.

### Browsertests

- Matchaktionsauswahl mit `Spiel unterbrechen`,
- Unterbrechungsdialog mit Tastatur, Touch und Screenreader-Beschriftung,
- Matchkarten mit Badge, Termin offen, Fortsetzungstermin, Punkten und
  Aufschlagmarkierung,
- favoritenfaehiges Overlay `Fortsetzbare Spiele`, leere Liste, mehrere Matches
  und Authwechsel,
- Wiederherstellungsanzeige und alle Fehler-/Retryzustaende,
- unveraenderte Darstellung regulaer offener und abgeschlossener Matches.

Die Aenderung betrifft einen Kernablauf und fuegt Touch-, Dialog- und
Navigationsverhalten hinzu. Deshalb ist neben den Backendtests die
Drei-Engine-Kernsmoke und die festgelegte Android-, iPhone- und iPad-Matrix in
frischen Browsercontainern erforderlich.

### Abnahmekriterien

Die Funktion ist erst abnahmefaehig, wenn mindestens nachgewiesen ist:

1. Ein Unterbrechungswrite verliert weder Score noch Terminstatus und kann nach
   unklarem Ausgang sicher wiederholt werden.
2. Offene Spiele zeigen Stand, Punkte, Aufschlaeger und Terminstatus eindeutig,
   ohne einen Gewinner anzudeuten.
3. Ein neuer Termin laesst Unterbrechung und Snapshot unveraendert.
4. Das Favoritenoverlay zeigt nur die principalbezogen fortsetzbaren Matches.
5. Ein ausgewaehltes Match kann ohne Ueberschreiben eines fremden Courts in den
   kontrollierten Wiederherstellungszustand gebracht werden.
6. Live-Erfassung beginnt erst nach bestaetigter Wiederherstellung des
   gespeicherten Standes.
7. Fehler und Neustarts lassen das Match sicher unterbrochen und erhalten den
   Snapshot.
8. Audit, Logs, Diagnosen und Meldungen enthalten keine unkontrollierten oder
   unnoetigen personenbezogenen Daten.


## 17. Vor Implementierungsbeginn offene Entscheidungen

Folgende Punkte sind absichtlich noch nicht festgelegt:

1. Endgueltiges Persistenzmodell und Zielsystem im Zusammenhang mit der geplanten
   Datenbankmigration.
2. Herkunft der Aufschlaegerinformation: verpflichtende manuelle Auswahl oder
   neue externe Quelle.
3. Ob eine externe Schreibschnittstelle fuer Tafel und Ticker-App verfuegbar und
   betrieblich freigegeben werden kann.
4. Exakte Rollenfolge zwischen beteiligtem Spieler und Operator beim Laden auf
   einen Court.
5. Auswahlregel, wenn mehrere Courts frei oder geeignet sind.
6. Darstellung eines unterbrochenen Matches auf einem deaktivierten Court und
   Dauer dieser Anzeige.
7. Behandlung von Ranglistenfristen nach wetterbedingter Unterbrechung.
8. Modell fuer aktive Spielzeit und Pausendauer bei einem ueber mehrere Termine
   verteilten Match.
9. Recoveryregel fuer einen vorhandenen ScoreLog-Eintrag ohne aktuelle
   Court-Zuordnung.
10. Endgueltige Endpoint-, Status-, Fehlercode- und Feldnamen.

Diese Entscheidungen muessen vor der Implementierung mit den fachlichen
Verantwortlichen geklaert und anschliessend in die kanonischen Regeln und
Softwarevertraege uebernommen werden.


## 18. Spaetere kanonische Dokumentationsziele

Erst mit der freigegebenen Implementierung sind mindestens folgende Dokumente
anzupassen:

- `Project/FACHKONZEPT.txt`: Nutzungsszenario und fachliche Anforderungen fuer
  Unterbrechung, Fortsetzung und favoritenfaehige Direktaktion.
- `Project/Regelwerk/Spielbetrieb/ALLGEMEINE-MATCHREGELN.txt`: Abgrenzung zu
  regulaerem Abschluss, Walkover und Retirement sowie Termin- und Zeitregeln.
- `Project/Regelwerk/Organisation/PLATZ-UND-ANZEIGEBETRIEB.txt`: Rollenfolge
  zwischen Beteiligten, Operatoren und Administratoren.
- `Project/software/DATENBANK.txt`: persistente Status-, Snapshot-, Aufschlag-,
  Historien- und Recoverydaten.
- `Project/software/ENDPOINTS.txt`: Read-/Writevertraege, Projektionen,
  Aktionsbooleans, Fehlercodes und Favoritenziel.
- `Project/software/ARCHITEKTUR.txt`: Datenfluss, Fingerprints, Court-Fencing,
  Wiederherstellung, Messaging, Audit und Observability.
- `Project/software/seiten/matches1.txt`: sichtbare offene Matchzustaende und
  Bedienung.
- `Project/software/seiten/scoreboard.txt`: Unterbrechungs- und
  Wiederherstellungsanzeige.
- die Seitendokumentation des gemeinsamen Profil-/Favoritenmodals:
  Matchaktionen, Overlay `Fortsetzbare Spiele` und Favoritenintegration.
- `Project/Scoreboard-Funktion.md`: externe Lese-/Schreibgrenzen,
  Aufschlaegerquelle und physischer Wiederherstellungsablauf.


## 19. Abgrenzung dieses Auftrags

Dieser Auftrag erstellt nur die vorliegende Planungsdokumentation. Nicht Teil
dieses Auftrags sind:

- Aenderungen an Tabellen oder Datenbanken,
- neue Spalten, Tabellen, Migrationen oder Seed-Daten,
- Backendendpoints oder Berechtigungen,
- Frontenddialoge, Overlays, Favoriten oder Scoreboardanzeigen,
- Aenderungen an der externen Scoreboard-Einheit,
- Deployment, Dienstneustart oder produktive Datenkorrektur.

Der aktuell eingetretene reale Unterbrechungsfall wird durch diese Dokumentation
nicht technisch veraendert. Bis zur spaeteren Implementierung bleibt seine
operative Behandlung ein manueller Vereinsablauf.
