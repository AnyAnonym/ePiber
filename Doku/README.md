# ePiber Gesamtdokumentation

## Zweck

Diese Dokumentation beschreibt den aktuellen fachlichen und technischen Stand
von ePiber und ein detailliertes, aber noch nicht durchgehend freigegebenes
Zielbild. Sie ist als zusammenhaengende Wissensbasis fuer Analysen, Workshops,
Architekturentscheidungen und die Uebergabe an separate Projekte vorgesehen.

Die Dokumentation ersetzt nicht die kanonischen Fach-, Software- und
Betriebsdokumente unter `Project/`. Sie verdichtet deren Inhalte und den
nachweisbaren Code-Iststand zu einem Gesamtbild.

## Bezugsstand

- Erstellungsdatum: 2026-09-17
- Repository-Branch: `4.9.9-paj-1`
- Arbeitsversion bei Erstellung: `4.9.9-paj-1-7-x`
- Letzter gesicherter Stand: `4.9.9-paj-1-7`
- Produktiver Laufzeitstand: nicht Gegenstand dieser Bestandsaufnahme

Die im jeweiligen Checkout gueltige Version steht ausschliesslich in
`Backend/package.json`. Ein installierter Laufzeitstand muss ueber `GET /version`
ermittelt werden.

## Lesereihenfolge

1. [Projekt und Produkt](01-PROJEKT-UND-PRODUKT.md)
2. [Fachlicher Istbestand](02-FACHLICHER-ISTBESTAND.md)
3. [Technischer Istbestand](03-TECHNISCHER-ISTBESTAND.md)
4. [Sicherheit, Betrieb und Qualitaet](04-SICHERHEIT-BETRIEB-QUALITAET.md)
5. [Grenzen, Risiken und offene Fragen](05-GRENZEN-RISIKEN-OFFENE-FRAGEN.md)
6. [Zielbild](06-ZIELBILD.md)
7. [Roadmap](07-ROADMAP.md)
8. [Uebergabekontext fuer Folgeprojekte](08-UEBERGABEKONTEXT.md)

## Verbindlichkeit der Aussagen

Jede Aussage ist gedanklich einer der folgenden Klassen zuzuordnen:

| Klasse | Bedeutung |
|---|---|
| Iststand | Durch aktuelle Implementierung oder kanonische Dokumentation belegt |
| Sollstand | Versionierte Konfiguration oder Betriebsdokumentation, nicht automatisch installierter Laufzeitstand |
| Zielrichtung | Ausgearbeitete Planung, aber noch keine vollstaendig freigegebene Sollarchitektur |
| Annahme | Plausible Planungsgrundlage, die validiert werden muss |
| Offen | Fachliche, technische, organisatorische oder wirtschaftliche Entscheidung fehlt |

Bei Widerspruechen gilt fuer das Laufzeitverhalten der Code. Fuer Fachregeln
gelten die spezialisierten Regeldateien unter `Project/Regelwerk/`. Dokumente
unter `Project/2do/` sind nicht kanonisch und werden hier nur als Zielrichtung
oder Annahme verwendet.

## System in einem Satz

ePiber ist derzeit eine vereinsbezogene Tennis-Webanwendung mit statischem
Vanilla-JavaScript-Frontend, Node.js-Backend, HTTP/WebSocket-Kommunikation,
Google Sheets als autoritativer Fachdatenquelle und SQLite fuer lokalen
Anwendungs-, Messaging-, Score- und Auditstate; langfristig soll daraus eine
mandantenfaehige, PostgreSQL-basierte Vereinsplattform mit isolierten
Vereins-Cells, Hallenreservierung, PWA/Notifications und reproduzierbarem
Plattformbetrieb werden.

## Quellenhierarchie

Wesentliche Quellen dieser Verdichtung:

- `AGENTS.md`
- `Project/FACHKONZEPT.txt`
- `Project/Regelwerk/`
- `Project/software/SOFTWARE-DOKU.txt`
- `Project/software/ARCHITEKTUR.txt`
- `Project/software/DATENBANK.txt`
- `Project/software/ENDPOINTS.txt`
- `Project/software/WEBSOCKET-CLOSE-CODES.txt`
- `Project/software/seiten/`
- `Project/server-configs/`
- `Project/2do/MANDANTEN-PLATTFORM-UND-RELEASEARCHITEKTUR.md`
- `Project/2do/NOTIFICATIONS-UND-PUSH.md`
- `Project/2do/EMAIL-DIREKTZUSTELLUNG.md`
- `Project/2do/WIRTSCHAFTLICHKEIT-UND-LLM-BETRIEBSMODELL.md`
- aktuelle Implementierung in `Frontend/` und `Backend/`

`Project/archive/` und lokale Geheimnisdateien wurden nicht als Quelle
verwendet.

## Pflegehinweis

Diese Sammlung ist eine datierte Gesamtaufnahme. Sie sollte bei wesentlichen
Architektur-, Produkt- oder Betriebsentscheidungen als Ganzes ueberprueft
werden. Detailaenderungen werden weiterhin zuerst in den dafuer kanonischen
Dateien unter `Project/` dokumentiert.
