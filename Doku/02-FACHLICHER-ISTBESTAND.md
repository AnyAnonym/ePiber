# Fachlicher Istbestand

## 1. Identitaet, Konto und Rollen

Eine Person besitzt Stammdaten, Kontaktwerte, Aktivstatus, Login und Rollen.
Login und Kontakt-E-Mail sind getrennte Felder. Eine Kontakt-E-Mail darf fehlen
oder von mehreren Personen geteilt werden; ein belegter Login muss
case-insensitiv eindeutig sein.

Das aktuelle Rollenmodell trennt:

- `Mitglied`: Spielerrecht und fachliche Klasse,
- `Operator`: Platz- und Anzeigebetrieb,
- `Admin`: umfassende Verwaltung und implizites Operatorrecht.

Sobald eines der neuen Rollenfelder belegt ist, wird das historische Feld
`Role` ignoriert. Andernfalls dient es als Legacy-Fallback. Aenderungen an
Login, Aktivstatus oder Rollen koennen Sitzungen widerrufen. Eine inaktive
Person kann sich nicht anmelden.

## 2. Bewerbsanmeldung

Die Bewerbsuebersicht ordnet Bewerbe nach Phase. Vor Bewerbsbeginn fuehrt eine
offene Anmeldephase zur Eintragungsliste, gestartete Bewerbe zur jeweiligen
Ranglisten-, Gruppen- oder KO-Darstellung.

Ein Spieler kann ausschliesslich sich selbst anmelden oder abmelden. Der Server
leitet die Person aus der Sitzung ab und prueft Bewerb, Frist und bestehenden
Eintrag. Die Nennliste zeigt keinen Zahlungsstatus.

## 3. Matchlebenszyklus

Ein Match ist offen, solange kein regulaeres Ergebnis, Walkover oder Retirement
vorliegt. Ein Match kann aus einem Einzel oder zwei Doppelpartnern je Seite
bestehen. BYE ist ein Freilos und keine Person.

### 3.1 Termin

Beteiligte duerfen fuer ein eigenes, offenes und vollstaendig besetztes Match
einen Termin setzen oder aendern. Administratoren duerfen dies fuer jedes
zulaessige Match mit Begruendung. Termine liegen auf vollen Stunden zwischen
06:00 und 23:00 Uhr.

Ranglistenforderungen besitzen zusaetzlich:

- sieben mal 24 Stunden bis zur Terminvereinbarung,
- vierzehn mal 24 Stunden bis zur Austragung und zum Abschluss.

Ein bestehender Termin kann durch Beteiligte abgesagt werden. Das Match bleibt
offen. Fristueberschreitungen fuehren nicht automatisch zu Wertung oder
Rangverschiebung; die sportliche Leitung entscheidet.

### 3.2 Ergebnis

Jede beteiligte Person kann das Ergebnis fuer beide Seiten eintragen. Eine
Gegenbestaetigung ist nicht erforderlich. Der Server prueft das Ergebnis gegen
den wirksamen Matchtyp, darunter Gewinnsaetze, Satzlaenge, Tie-Break und
Entscheidungssatz.

Beim ersten regulaeren Ergebnis oder Retirement muessen tatsaechlicher Start und
tatsaechliches Ende erfasst werden. Start muss vor Ende liegen, Ende darf nicht
in der Zukunft liegen und die Dauer darf sechs Stunden nicht ueberschreiten.

Beteiligte koennen bis einschliesslich 60 Minuten nach dem ersten serverseitigen
Erfassungszeitpunkt korrigieren. Diese Frist verlaengert sich durch eine
Korrektur nicht. Administrative Korrekturen benoetigen eine Begruendung und
koennen durch abhaengige KO- oder Ranglistenzustaende gesperrt sein.

### 3.3 Walkover und Retirement

`[wo]` kennzeichnet Nichtantritt vor Spielbeginn. Es gibt keinen tatsaechlichen
Start und kein Satzergebnis. Die markierte Seite verliert.

`[ret]` kennzeichnet Aufgabe nach Spielbeginn. Ein plausibler Teilstand kann
gespeichert werden, darf aber noch keinen regulaeren Matchgewinner ergeben. Die
markierte Seite verliert.

Beide Abschlussarten loesen dieselben bewerbsspezifischen Folgen wie ein
regulaeres Ergebnis aus.

## 4. KO-Bewerbe

Der KO-Baum unterstuetzt Einzel und Doppel. Gewinner werden anhand von Runde und
Slot in das Folgematch uebernommen. Alle relevanten Rastermatches muessen dafuer
mit stabiler Match-ID und bekanntem Rundencode existieren.

Fehlt ein Folgematch, bleibt der Abschluss gueltig und aktive Administratoren
erhalten einen Reparaturhinweis. Eine Ruecknahme ist gesperrt, wenn ein
Folgematch bereits terminiert, abgeschlossen oder abweichend besetzt ist.

Sondermarker:

- `BYE`: Freilos, kein Profil und kein echtes Match.
- `PRE`: aktuell zu besetzende Position einer manuellen Auslosung.
- Setzmarker: Darstellung einer gesetzten Position, keine eigene Person.

Rastergroessen, vollstaendige Setzregeln und Freilosverteilung sind noch nicht
umfassend fachlich festgelegt.

## 5. Gruppenbewerbe

Round Robin zeigt Gruppen, Paarungen und Tabellen fuer Einzel oder Doppel. Die
Tabelle wird im Frontend sortiert nach:

1. Siegen,
2. Satzdifferenz,
3. Gamedifferenz.

Walkover wird aus Verlierersicht als `0-6/0-6` gewertet. Bei Retirement bleiben
gespielte Games erhalten; ein gefuehrter unvollstaendiger Satz kann als
Satzgewinn zaehlen. Direkter Vergleich und vollstaendige Gleichstandsregeln sind
nicht verbindlich festgelegt. Gruppenaufsteiger werden nicht automatisch in
einen KO-Bewerb uebernommen.

## 6. Ranglistenbetrieb

Jede Rangliste ist ein eigener Bewerb. Forderbarkeit, Sperren und Schonzeiten
wirken nur innerhalb dieses Bewerbs.

### 6.1 Forderung

Ein gereihter Spieler darf grundsaetzlich Gegner links in derselben
Pyramidenzeile und ab der eigenen Spalte rechts in der Zeile darueber fordern;
Rang 3 darf zusaetzlich Rang 1 fordern. Offene Forderungen, Schonzeit des
Geforderten und Sperrzeit des Forderers blockieren eine neue Forderung.

Eine angelegte Forderung ist verbindlich und kann nicht von den Spielern
abgebrochen werden. Nur Administratoren koennen eine fehlerhafte offene
Forderung begruendet loeschen; das ist kein sportlicher Abschluss.

### 6.2 Rangfolge

Gewinnt der Geforderte, bleibt die Rangfolge gleich. Gewinnt der Forderer,
uebernimmt er den Zielrang und die dazwischenliegenden Spieler ruecken zurueck.
Ergebnis und Rangverschiebung werden als zusammenhaengender Fachvorgang
behandelt.

Nach Matchabschluss gelten sieben Tage:

- Schonzeit fuer den Gewinner: nicht forderbar, aber selbst forderungsberechtigt.
- Sperrzeit fuer den Verlierer: nicht forderungsberechtigt, aber forderbar.

### 6.3 Neueinsteiger

Teilnahmeberechtigte, noch nicht gereihte Spieler duerfen jeden Rang fordern.
Bei Sieg uebernehmen sie den Zielrang. Bei Niederlage bleiben sie grundsaetzlich
ausserhalb und erhalten Sperrzeit. Gibt es weniger als zehn nachgelagerte
Positionen, werden sie am Ende eingereiht.

### 6.4 Temporaeres Raushaengen und Rueckkehr

Ein Spieler kann sich mit Grund selbst aus der aktiven Rangliste nehmen, sofern
keine offene Forderung besteht. Der bisherige Rang und Zeitpunkt werden
gespeichert. Der Rueckkehranspruch gilt zwoelf Kalendermonate.

Innerhalb der Frist darf der Rueckkehrer die Person auf dem frueheren Rang oder
eine dahinter gereihte Person fordern. Bei Sieg uebernimmt er den Rang, bei
Niederlage wird er direkt dahinter eingereiht. Nach Ablauf gilt er wieder als
Neueinsteiger.

### 6.5 Korrekturen

Automatische Rangfolgen speichern Provenienz mit Vorher-/Nachherstand. Eine
automatische Rueckabwicklung ist nur moeglich, wenn der aktuelle Stand noch
exakt passt. Sonst muss ein Administrator einen vollstaendigen Rangplan
angeben.

## 7. Historie und Meldungen

Fachereignisse erzeugen getrennte Projektionen:

- Bewerbshistorie aus neutraler Bewerbssicht,
- persoenliche Inbox je Empfaenger,
- strukturierte Betriebslogs,
- Audit fuer den Fach- oder Sicherheitswrite.

Eigene Termin- und Ergebnisaktivitaeten koennen sichtbar, aber bereits gelesen
gespeichert werden. Andere Beteiligte erhalten ihre Projektion ungelesen.
Meldungen lassen sich einzeln oder gesammelt quittieren.

Die Bewerbshistorie unterstuetzt Kommentare, Bearbeitung und Loeschung eigener
Kommentare, Adminmoderation sowie sieben Reaktionstypen. Normale Benutzer sehen
bei moderierten Inhalten einen neutralen Pruefhinweis statt des Inhalts.

## 8. Favoriten

Favoriten sind kontogebunden, revisioniert und pro Benutzer gespeichert.
Unterstuetzt werden erlaubte Seiten sowie direkte Aktionen fuer Spieleingabe und
Terminpflege. Die mobile Reihenfolge ist bearbeitbar. Direkte Matchaktionen
zeigen auch fuer Administratoren nur eigene offene Matches, fuer die die
jeweilige Teilnehmeraktion erlaubt ist.

## 9. Court- und Scoreboardbetrieb

Operatoren und Administratoren koennen einen Court einem offenen Match, einer
individuellen Einzel-/Doppelpaarung oder keiner Paarung zuweisen. Eine neue
Zuweisung setzt den sichtbaren Score zurueck und friert die aktuell geltenden
Matchtyp-Anzeigeregeln fuer diesen Court ein.

Ein inaktiver Court behaelt seinen letzten sichtbaren Stand und wird nicht
weiter gepollt. Bei Aktivierung oder Reset ist der erste externe Stand nur die
Baseline; erst eine spaetere Aenderung wird sichtbar und protokolliert.

Das Scoreboard zeigt zwei Courts, Saetze, Punkte, Namen, Bewerb/Runde sowie auf
grossen Ansichten naechste und letzte Matches. Tie-Break- und Match-Tie-Break-
Darstellung werden aus den persistierten Anzeigeregeln abgeleitet.

## 10. Monitorbetrieb

Der Navigator steuert mehrere registrierte Monitorgeraete. Ein Monitor behaelt
seinen bisherigen Inhalt, bis die neue Zielseite geladen ist und explizit
Bereitschaft meldet. Navigation und Scrollen sind korreliert und werden vom
Geraet bestaetigt.

Administratoren provisionieren, rotieren und widerrufen Geraete. Operatoren und
Administratoren duerfen Anzeigen steuern. Die Sponsorenansicht ist ein lokales,
statisches Vollbildziel ohne fachliche Datenzugriffe.

## 11. Personenpflege

### 11.1 Normalisierung

Die Normalisierung korrigiert vorhandene Personen in einer kontrollierten
Vorschau. Bearbeitbar ist eine geschlossene Menge von Stamm-, Kontakt- und
Rollenfeldern. Passwort-, Sicherheits- und ClubDesk-Felder bleiben
ausgeschlossen. Writes laufen personweise und stoppen beim ersten Fehler, ohne
bereits erfolgreiche Aenderungen zurueckzurollen.

### 11.2 ClubDesk-Abgleich

Ein lokaler Windows-1252-/Semikolon-CSV-Export wird im Browser verarbeitet. Die
vollstaendige Datei wird nicht hochgeladen. Nur bestaetigte, normalisierte
Zielwerte werden an das Backend gesendet.

Moeglich sind Zuordnung, Aktualisierung, Neuanlage und kontrollierte
Deaktivierung. Bestehende Logins werden nie aus dem Import ueberschrieben;
Admin- und Operatorrechte werden nicht aus ClubDesk abgeleitet.
