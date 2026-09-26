# LLM-Orchestrator und Agentensteuerung fuer Chat-Systeme

Stand: 26.09.2026
Status: Nicht-kanonische technische Arbeitsgrundlage; noch nicht implementiert
oder als verbindliche Sollarchitektur freigegeben
Gegenstand: Kontextfuehrung, Aufgabenverteilung, Policy Enforcement,
LLM-Entscheidungen, agentische Ausfuehrung und latenzarme Chat-Orchestrierung

Diese Datei konserviert die vollstaendige konzeptionelle Diskussion ueber die
spaetere Abloesung einer rein durch OpenCode und `AGENTS.md` gesteuerten
Arbeitsweise durch einen zentralen Orchestrator. Sie ergaenzt die fachliche
Chat-Assistentenplanung in `CHAT-ASSISTENT-VECTOR-RAG.md`, ohne deren derzeitige
Entscheidungen zu ersetzen. Die hier beschriebenen Grenzen gelten sowohl fuer
einen technischen Entwicklungsassistenten als auch, in entsprechend engerer
Form, fuer einen fachlichen Benutzerassistenten.

Der Text trennt bewusst:

- allgemeines trainiertes Modellwissen;
- den aktuellen Modellkontext;
- dauerhaftes Projektwissen;
- maschinell erzwingbare Regeln;
- qualitative LLM-Entscheidungen;
- menschliche Freigaben;
- agentische Ausfuehrung durch OpenCode oder andere Werkzeuge.

## 1. Ausgangslage und Ziel

Eine grosse `AGENTS.md` kann einem LLM Projektregeln, Dokumentationsrouting,
Freigabegrenzen und Arbeitsablaeufe mitteilen. Sie ersetzt aber keine
deterministische Workflow-Engine. Jede Regel bleibt natuerliche Sprache, die das
Modell bei einem Aufruf erneut lesen, kontextualisieren und richtig anwenden
muss.

Das Zielbild ist deshalb ein hybrides System:

- Ein zentraler Orchestrator besitzt Prozesszustand, Policy, Budgets,
  Freigaben und Nachweise.
- Ein Lead-LLM versteht mehrdeutige Benutzerauftraege, erkennt Zusammenhaenge,
  entwirft Plaene und interpretiert Ergebnisse.
- Deterministische Software erledigt Routing, Berechtigungen, Zustandswechsel,
  Validierungen, Tests und andere exakt formulierbare Arbeit.
- Spezialisierte Agenten, darunter optional OpenCode, fuehren klar begrenzte
  agentische Aufgaben aus.
- Menschen bestaetigen riskante, irreversible oder fachlich unklare Schritte.

OpenCode bleibt damit nuetzlich, ist aber nicht mehr Eigentuemer des gesamten
Geschaefts- und Freigabeprozesses. Es wird zu einer kontrollierten
Ausfuehrungskomponente fuer Aufgaben, bei denen Dateierkundung, Codeaenderungen,
Tests oder technische Analyse benoetigt werden.

## 2. Modellwissen und Kontext sind verschiedene Speicherarten

### 2.1 Trainiertes Modellwissen

Die Modellparameter enthalten verteilte, generalisierte Muster aus dem
Training, beispielsweise:

- Sprache und Begriffe;
- Programmier- und Architekturwissen;
- typische Fehlerbilder;
- uebliche Problemloesungsstrategien;
- allgemeine Zusammenhaenge zwischen Anforderungen, Code und Betrieb.

Dieses Wissen ist keine exakt durchsuchbare Datenbank. Das Modell ruft nicht
einen einzelnen gespeicherten Datensatz ab, sondern erzeugt eine Antwort aus
den gelernten mathematischen Mustern.

### 2.2 Aktueller Kontext

Der Kontext ist das Arbeitsgedaechtnis des konkreten Vorgangs. Er enthaelt je
nach System:

- System- und Developer-Anweisungen;
- `AGENTS.md` und andere aktive Projektanweisungen;
- aktuelle Benutzeranfragen;
- relevante Teile des Gespraechsverlaufs;
- gelesene Dokumente und Dateien;
- Toolergebnisse;
- Zustands- und Policyinformationen des Orchestrators.

Das allgemeine Modellwissen liefert die Kompetenz. Der Kontext liefert die
konkrete Wahrheit des aktuellen Falls. Ein Modell kann aus seinem Training viel
ueber PostgreSQL wissen, aber nicht ohne Kontext wissen, welche Version, welche
Schluesselstrategie oder welche Cutovergrenze ein konkretes Projekt beschlossen
hat.

### 2.3 Groesse ist nicht direkt vergleichbar

Die Anzahl der Modellparameter und die Zahl der Kontexttokens messen
unterschiedliche Dinge. Ein sehr grosses Modell macht projektspezifischen
Kontext nicht entbehrlich. Verlorene konkrete Informationen koennen nicht
zuverlaessig aus dem allgemeinen Modellwissen rekonstruiert werden.

Wenn nach einer Verdichtung nur das Ergebnis einer Entscheidung erhalten bleibt,
kann das Modell eine plausible Begruendung ergaenzen. Diese Begruendung muss
aber nicht der tatsaechlich vom Benutzer genannten Begruendung entsprechen.

### 2.4 Eine Sitzung trainiert das Modell nicht neu

Eine Information aus einem Chat wird nicht waehrend der Sitzung dauerhaft in
die Modellparameter eingebaut. Sie bleibt nur verfuegbar, solange sie:

- im aktiven Kontext steht;
- in einer Kompaktierungszusammenfassung erhalten bleibt;
- in einem dauerhaften Projektartefakt gespeichert wurde;
- oder spaeter erneut geladen wird.

## 3. Kontextlaenge, Effizienz und Qualitaet

### 3.1 Verfuegbare und belegte Kontextlaenge

Ein Modell mit einem moeglichen Kontextfenster von 200.000 Tokens ist nicht
allein deshalb ineffizient. Entscheidend ist, wie viele Tokens tatsaechlich in
einen Aufruf eingehen.

- 200.000 Tokens Kapazitaet, aber 20.000 Tokens belegt: kein wesentlicher
  Nachteil allein durch die Kapazitaet.
- Tatsaechlich 200.000 Tokens Eingabekontext: regelmaessig mehr Prefill-Arbeit,
  Kosten und Latenz als bei 20.000 Tokens.

Provider koennen Prompt-Caching oder andere Optimierungen verwenden. Diese
koennen wiederholte Praefixe guenstiger oder schneller machen, beseitigen aber
weder die semantische Komplexitaet noch garantieren sie perfekte Beachtung
jedes Details.

### 3.2 Ein langer Kontext ist nicht automatisch besser

Relevanter Kontext verbessert die Qualitaet, etwa:

- verbindliche Entscheidungen;
- aktuelle Anforderungen;
- bekannte Randfaelle;
- Architektur- und Sicherheitsgrenzen.

Irrelevanter oder ueberholter Kontext kann dagegen konkurrierende Signale
erzeugen, etwa:

- verworfene Alternativen;
- abgeschlossene Zwischenschritte;
- alte Annahmen;
- wiederholte Toolausgaben;
- grosse Logs ohne Bezug zur aktuellen Aufgabe.

Das Modell erhaelt grundsaetzlich den verfuegbaren Kontext. Das bedeutet aber
nicht, dass jede enthaltene Information in jedem Generierungsschritt gleich
praesent oder gleich stark gewichtet wird. Ein wichtiger einzelner Nebensatz
kann in einem sehr langen, heterogenen Verlauf weniger zuverlaessig in die
Antwort einfliessen als eine kurze eindeutige Festlegung.

Das Ziel ist daher nicht der kuerzeste oder der laengste Kontext, sondern der
kleinste vollstaendige Kontext fuer die konkrete Aufgabe.

## 4. Kompaktierung und Informationsverlust

Kompaktierung ist eine verlustbehaftete Verdichtung. Sie kann typischerweise
gut erhalten:

- Ziele und Anforderungen;
- getroffene Entscheidungen;
- aktuellen Arbeitsstand;
- relevante Dateien;
- bekannte Blocker;
- naechste Schritte.

Verloren gehen koennen:

- exakte Begruendungsketten;
- verworfene Alternativen und deren Ablehnungsgruende;
- Bedeutungsnuancen;
- Beispiele und seltene Randfaelle;
- zwischenzeitliche Beobachtungen;
- exakte Formulierungen;
- Details, die beim Verdichten faelschlich als unwichtig bewertet wurden.

Nach einer Kompaktierung steht nicht mehr automatisch der vollstaendige
urspruengliche Verlauf zur Verfuegung. Der verbleibende Arbeitskontext besteht
aus der Zusammenfassung, neueren Nachrichten, weiterhin aktiven Anweisungen und
neu geladenen Projektartefakten.

Fuer eine robuste Orchestrierung folgt daraus:

1. Verbindliche Entscheidungen duerfen nicht nur im Chat bestehen.
2. Der Orchestrator speichert strukturierte Ziele, Entscheidungen, Freigaben,
   Nachweise und offene Fragen.
3. Fachliche Wahrheit bleibt in versionierten Dokumenten oder Datenvertraegen.
4. Eine Kompaktierung darf den kanonischen Workflowzustand nicht ersetzen.
5. Vor einer spaeteren Fortsetzung werden benoetigte Quellen gezielt neu
   geladen, statt auf vermutete Erinnerung vertraut.

## 5. Rolle und Grenzen von `AGENTS.md`

### 5.1 Wirkung in OpenCode

OpenCode V2 laedt `AGENTS.md` als privilegierte Projektanweisung. Sie wird mit
System-, Umgebungs-, Skill- und anderen Instruktionen kombiniert und besitzt
gegenueber gewoehnlichem Benutzertext eine hohe formale Prioritaet. Ein langer
Chat hebt diese Prioritaet nicht auf.

OpenCode kann globale, projektweite und bei Erkundung entdeckte verschachtelte
`AGENTS.md`-Dateien laden. Konflikte zwischen ihnen werden nicht automatisch
fachlich aufgeloest. Eine klare Scope-Trennung bleibt daher erforderlich.

Auch eine privilegierte Anweisung ist keine mathematische Garantie, dass ein
Modell bei einer komplexen Aufgabe jede einzelne Regel fehlerfrei anwendet. Mit
steigender Zahl, Verzweigung und Spezialisierung der Regeln steigt das Risiko
einer fehlerhaften oder unvollstaendigen Anwendung.

### 5.2 Wann eine `AGENTS.md` zu gross wird

Es existiert keine harte universelle Tokengrenze. Als nicht bindende
Arbeitsheuristik gelten:

| Umfang | Praktische Einschaetzung |
|---|---|
| unter 2.000 Tokens | meistens unkompliziert |
| 2.000 bis 5.000 Tokens | gut moeglich, wenn klar strukturiert |
| 5.000 bis 8.000 Tokens | Aufteilung und Software-Enforcement pruefen |
| ueber 8.000 bis 10.000 Tokens | meist ein Architekturhinweis, nicht nur ein Textproblem |

Wichtiger als die reine Laenge sind folgende Warnzeichen:

- viele Regeln gelten nur fuer seltene Spezialfaelle;
- Regeln besitzen zahlreiche Ausnahmen und Zustandsuebergaenge;
- dieselbe Wahrheit wird in mehreren Dokumenten wiederholt;
- Reihenfolgen muessen exakt eingehalten werden;
- Sicherheits- oder Produktionsrisiken haengen von fehlerfreier Beachtung ab;
- Regeln waeren maschinell pruefbar, sind aber nur als Prosa formuliert;
- Aenderungen am Regelwerk sind nicht automatisiert testbar;
- Modelle uebersehen trotz klarer Formulierung wiederholt einzelne Regeln;
- haeufig ist unklar, welche Regel im aktuellen Zustand greift.

Der zentrale Leitsatz lautet:

> Wenn eine Regel deterministisch geprueft oder ausgefuehrt werden kann, darf sie
> nicht ausschliesslich in `AGENTS.md` stehen.

### 5.3 Sinnvolle Restfunktion

Auch mit zentralem Orchestrator bleibt eine kurze `AGENTS.md` als Adapter fuer
OpenCode sinnvoll. Sie kann enthalten:

- Projektueberblick und Arbeitsbereich;
- qualitative Architekturgrundsaetze;
- Dokumentationsrouting;
- Hinweis, dass Freigaben und irreversible Aktionen dem Orchestrator gehoeren;
- Pflicht zur Meldung von Widerspruechen;
- Format- und Uebergabevertraege fuer Agentenergebnisse.

Sie soll nicht die gesamte Workflow-Engine in natuerlicher Sprache duplizieren.

## 6. Verteilung der Verantwortlichkeiten

### 6.1 Deterministische Software

Software ist vorzuziehen fuer:

- Authentifizierung und Autorisierung;
- Branch-, Versions- und Pfadregeln;
- Zustandsmaschinen und erlaubte Uebergaenge;
- Commit-, Push- und Deployment-Gates;
- Rate Limits und Kostenbudgets;
- Dateityp- und Aenderungspfadklassifikation, soweit eindeutig;
- Pflichtpruefungen und Testprofile;
- Pruefsummen und Driftpruefung;
- Schema- und Formatvalidierung;
- Geheimnis-, Binaer- und Allowlist-Pruefungen;
- Wiederholungsgrenzen und Timeouts;
- Audit- und Evidenzspeicherung.

### 6.2 LLM

Ein LLM ist besonders geeignet fuer:

- mehrdeutige Benutzerabsichten;
- Aufgabenklassifizierung, wenn Regeln allein nicht ausreichen;
- Querverbindungen zwischen Anforderungen, Dokumenten und Code;
- Auswirkungs- und Risikoanalyse;
- Erkennen fehlender Informationen;
- Entwurf und Vergleich von Loesungsvarianten;
- Code- und Dokumententwurf;
- qualitative Reviews;
- Interpretation heterogener Ergebnisse;
- verstaendliche Benutzerkommunikation.

Ein LLM ist nicht die ideale alleinige Instanz fuer:

- irreversible Freigaben;
- exakte Berechtigungspruefungen;
- garantiert vollstaendige Policy-Anwendung;
- dauerhafte Prozesszustandsfuehrung;
- unbeschraenkte Tool- oder Shellausfuehrung;
- Fristen, Zaehler und harte Wiederholungsbudgets;
- alleinige Verifikation seiner eigenen Arbeit.

### 6.3 Mensch

Eine ausdrueckliche menschliche Freigabe bleibt erforderlich, wenn:

- eine Aktion irreversibel oder produktionskritisch ist;
- fachliche Alternativen keine technisch eindeutige Rangfolge besitzen;
- Risiken ausserhalb vorher genehmigter Grenzen liegen;
- Daten geloescht oder produktive Systeme umgeschaltet werden;
- Policy oder vorhandene Dokumente einen Widerspruch nicht aufloesen.

## 7. Keine parallelen Wahrheiten

Folgender Zustand ist zu vermeiden:

```text
AGENTS.md sagt A
Orchestrator erzwingt B
Workflowdokument sagt C
```

Empfohlen ist ein versionierter strukturierter Regelkatalog. Jede Regel besitzt
mindestens:

- stabile Regel-ID;
- Scope;
- Trigger;
- Vorbedingungen;
- Enforcement-Art;
- erlaubte oder verbotene Aktion;
- erforderliche Evidenz;
- Fehler- oder Eskalationspfad.

Beispiel:

```yaml
rules:
  - id: GIT-001
    scope: repository
    trigger: fachliche_aenderung
    enforcement: hard
    condition: branch != main
    failure: block

  - id: TEST-004
    scope: frontend
    trigger: browserrelevante_aenderung
    enforcement: workflow
    requires: [browser-core]

  - id: ARCH-007
    scope: architecture
    trigger: neue_browser_api
    enforcement: llm-review
    instruction: Pruefe Feature Detection und Fallback.
```

Moegliche Enforcement-Arten:

- `hard`: technisch erzwungene Regel;
- `workflow`: Zustands- oder Gatebedingung;
- `validator`: maschinelle Ergebnispruefung;
- `human`: ausdrueckliche Freigabe;
- `llm`: qualitative Bewertung;
- `informational`: bereitgestellter Kontext.

Aus dem Katalog koennen aufgabenspezifische Agentenanweisungen und bei Bedarf
Teile einer `AGENTS.md` erzeugt werden. Eine generierte Ansicht darf nicht zur
zweiten manuell gepflegten Wahrheit werden.

## 8. Zielarchitektur des Orchestrators

```text
Benutzer / Chatoberflaeche
        |
        v
Input Gateway und Sessionverwaltung
        |
        v
Technischer Fast Path / Auth / Limits
        |
        v
Task Classifier und Policy Engine
        |
        v
Context Builder und Retrieval
        |
        v
Lead-LLM fuer Verstehen und Planung
        |
        v
Plan Validator und Workflow Engine
        |
        +--> Deterministische Funktionen
        +--> Spezialisierte Agenten / OpenCode
        +--> Menschliche Freigabe
        |
        v
Result Normalizer und Evidence Store
        |
        v
Lead-LLM fuer Interpretation, falls erforderlich
        |
        v
Validierte Antwort / Streaming zum Benutzer
```

Der Orchestrator ist Eigentuemer von:

- kanonischem Workflowzustand;
- Aufgaben-ID und Ziel;
- Policy- und Berechtigungsentscheidung;
- genehmigtem Plan;
- erlaubten Faehigkeiten;
- ausgefuehrten Schritten;
- Freigaben und Ablehnungen;
- Kosten-, Zeit- und Schleifenbudgets;
- Test- und Evidenznachweisen;
- Abschlussstatus.

Das LLM darf neu gestartet oder ausgetauscht werden, ohne dass dieser Zustand
verloren geht.

## 9. Erfassung und Bewertung einer Benutzeraufgabe

### 9.1 Technische Vorpruefung

Nicht jede erste Anfrage muss sofort ein LLM erreichen. Der Orchestrator prueft
zunaechst schnell und deterministisch:

- Authentifizierung und Rolle;
- Session- und Projektzuordnung;
- Rate-, Kosten- und Groessenlimits;
- explizite bekannte Kommandos;
- aktuellen Workflowzustand;
- grundsaetzlich verbotene Aktionen;
- notwendige Datenschutzgrenzen.

Eindeutige Anfragen wie Statusabfrage, bekannte Workflowaktion oder Abruf eines
bereits berechneten Ergebnisses koennen ohne LLM beantwortet werden.

### 9.2 Lead-LLM

Bei semantisch offeneren Auftraegen erhaelt ein zuerst beauftragtes Lead-LLM:

- aktuelle Benutzeranfrage;
- relevanten Chatverlauf oder strukturierte Zusammenfassung;
- aktuellen kanonischen Zustand;
- anwendbare Policy-IDs und qualitative Regeln;
- bereits vorgeroutete Dokumente;
- verfuegbare Faehigkeiten;
- ausdruecklich verbotene Aktionen;
- verlangtes strukturiertes Ausgabeformat.

Das Lead-LLM bewertet in einem gebuendelten Schritt:

- Absicht und Ziel;
- betroffene Fach- und Technikbereiche;
- fehlende Informationen;
- sichtbare Auswirkungen;
- Risiken;
- notwendige deterministische Aufgaben;
- notwendige agentische Aufgaben;
- notwendige menschliche Entscheidungen;
- erwartete Nachweise.

Es gibt nicht unkontrollierte Shellbefehle aus, sondern einen Plan aus einer
versionierten Allowlist typisierter Faehigkeiten.

Beispiel:

```json
{
  "intent": "database_schema_review",
  "needsClarification": false,
  "tasks": [
    {
      "type": "read_files",
      "paths": [
        "Project/2do/DB Migaration.md",
        "Backend/db/migrations"
      ]
    },
    {
      "type": "inspect_git_status"
    },
    {
      "type": "run_verification",
      "profile": "docs"
    }
  ],
  "requiresHumanApproval": false,
  "expectedResult": "Schemaentwurf und offene Punkte bewerten"
}
```

## 10. Planpruefung und Ausfuehrung

Der Orchestrator behandelt den LLM-Plan als Vorschlag und prueft mindestens:

- Ist jeder Aktionstyp bekannt und in dieser Version erlaubt?
- Sind Pfade, Projekt und Mandant korrekt begrenzt?
- Besitzt der Benutzer die notwendige Rolle?
- Ist die Aktion im aktuellen Workflowzustand zulaessig?
- Ist eine menschliche Freigabe vorgeschrieben?
- Kann die Aktion parallel ausgefuehrt werden?
- Werden Zeit-, Kosten- und Schleifenbudgets eingehalten?
- Verlangt die Aktion einen spezialisierten Agenten oder nur Software?

Nach erfolgreicher Validierung koennen drei Klassen von Arbeit entstehen:

1. **Deterministische Funktionen**, etwa Git-Status, Dateilesen, Suche,
   Datenbankabfrage, Testausfuehrung und Validierung.
2. **Agentische Aufgaben**, etwa Codeaenderung, komplexe Repositoryerkundung,
   Review oder technische Fehleranalyse durch OpenCode.
3. **Menschliche Gates**, etwa Commit, Push, Deployment, Datenloeschung oder
   fachliche Richtungsentscheidung.

Unabhaengige Aufgaben werden parallelisiert. Abhaengige Aufgaben werden als
gerichteter Ablauf mit expliziten Ein- und Ausgaben modelliert.

## 11. Ergebnisnormalisierung und Interpretation

Tool- und Agentenergebnisse werden nicht unkontrolliert als lange Logs in den
naechsten Modellaufruf kopiert. Der Orchestrator normalisiert sie, bewahrt aber
die Originale als Evidenz auf.

Beispiel:

```json
{
  "completedTasks": [],
  "failedTasks": [],
  "changedFiles": [],
  "testResults": [],
  "warnings": [],
  "evidence": []
}
```

Wenn eine rein deterministische Antwort ausreicht, antwortet der Orchestrator
direkt, beispielsweise:

```text
Alle 42 Tests erfolgreich. Keine Dateien geaendert.
```

Wenn fachliche Interpretation, Erklaerung oder ein Folgeplan erforderlich ist,
erhaelt das Lead-LLM:

- das urspruengliche Ziel;
- den genehmigten Plan;
- die ausgefuehrten Aktionen;
- normalisierte Ergebnisse;
- relevante Evidenzauszuege;
- Fehler und offene Fragen.

Das Lead-LLM formuliert daraus die Benutzerantwort oder einen begruendeten
Replan. Es darf fehlende Evidenz nicht als Erfolg darstellen.

## 12. Workflow als Zustandsmaschine

Ein moeglicher Ablauf ist:

```text
TASK_RECEIVED
  -> PRECHECKED
  -> CLASSIFIED
  -> CONTEXT_READY
  -> PLAN_PROPOSED
  -> PLAN_VALIDATED
  -> APPROVAL_REQUIRED oder EXECUTING
  -> VERIFYING
  -> RESULT_READY
  -> COMPLETED
```

Jeder Uebergang besitzt:

- erlaubte Ausgangszustaende;
- Vorbedingungen;
- erlaubte Aktionen;
- benoetigte Evidenz;
- Timeout;
- Fehlerzustand;
- Abbruch- und Wiederaufnahmevertrag.

Zustandsuebergaenge sollen grundsaetzlich monoton sein. Ein Replan erzeugt eine
neue Planrevision und ueberschreibt nicht stillschweigend die bereits
protokollierte Historie.

## 13. Schleifen und ihre Begrenzung

Ein schlecht aufgebautes Hybridsystem kann langsames Pingpong erzeugen:

```text
Software -> LLM -> Software -> LLM -> Software -> LLM
```

Jeder Modellaufruf verursacht erneut Transport-, Provider-, Prefill- und
Generierungslatenz. Deshalb werden LLM-Aufrufe nach semantischen
Arbeitseinheiten gebuendelt und nicht nach jedem kleinen Workflowzustand
ausgefuehrt.

Ein erneuter LLM-Aufruf ist nur gerechtfertigt, wenn mindestens eines gilt:

- neue relevante Information ist eingetroffen;
- ein Test oder Tool ist unerwartet fehlgeschlagen;
- der Plan ist nachweislich unvollstaendig oder widerspruechlich;
- eine echte qualitative Abwaegung ist entstanden;
- der Benutzer hat Ziel oder Grenzen geaendert.

Beispielhafte harte Budgets:

```yaml
limits:
  max_llm_calls: 4
  max_tool_rounds: 12
  max_replans: 1
  max_validation_retries: 1
```

Die konkreten Werte muessen je Aufgabentyp gemessen werden. Zusaetzlich gelten:

- Keine Wiederholung derselben Anfrage bei identischem Zustand.
- Jeder Replan benennt die neue ausloesende Evidenz.
- Deterministisch korrigierbare Formatfehler erzeugen keinen neuen
  vollstaendigen Planungszyklus.
- Nach ausgeschoepftem Budget folgt kontrollierte Eskalation an den Benutzer.
- Ein Agent darf seine Schleifenlimits nicht selbst erhoehen.

## 14. Latenz und wahrgenommene Geschwindigkeit

### 14.1 Ursachen

LLM-Latenz entsteht insbesondere durch:

- Verbindungs- und Providerlatenz;
- Queueing oder Cold Start;
- Verarbeitung des Eingabekontexts;
- Laenge der generierten Ausgabe;
- separate Tool- und Modellrunden;
- externe Agenten- und Testlaeufe.

Eine grosse `AGENTS.md` kann einen externen Nachschritt vermeiden, vergroessert
aber den regelmaessig zu interpretierenden Prompt. Sie ist daher nicht per se
schneller als gutes Software-Routing.

### 14.2 Drei Ausfuehrungspfade

**Schneller deterministischer Pfad**

```text
User -> Orchestrator -> Antwort oder bekannte Aktion
```

Geeignet fuer Status, bekannte Befehle, gespeicherte Ergebnisse und klar
definierte Workflows.

**Einmaliger LLM-Pfad**

```text
User
  -> Software sammelt Zustand, Regeln und Kontext
  -> ein gebuendelter LLM-Aufruf
  -> Software validiert
  -> Antwort
```

Dies soll der haeufigste intelligente Pfad sein.

**Begrenzter agentischer Pfad**

```text
Planung -> Ausfuehrung -> Verifikation -> maximal begrenzter Replan
```

Er ist fuer komplexe Implementierung, Recherche oder Fehleranalyse vorgesehen.

### 14.3 Benutzeroberflaeche

Der Benutzer erhaelt frueh eine kontrollierte Rueckmeldung, wenn eine Aufgabe
laenger dauert. Streaming kann die wahrgenommene Latenz reduzieren, ersetzt aber
keine Optimierung der tatsaechlichen Modell- und Toolrunden. Technische
Zwischenmeldungen duerfen nicht faelschlich einen fachlichen Erfolg behaupten.

## 15. Informationsrouting

Mehrstufiges manuelles Routing kann selbst Latenz erzeugen:

```text
Anfrage verstehen
  -> AGENTS.md auswerten
  -> Dokumentationsindex lesen
  -> Detaildokument lesen
  -> Code suchen
  -> weitere Abhaengigkeit erkennen
  -> weiteres Dokument lesen
```

Der Orchestrator soll deterministisch vorladen, was aus Projekt, Pfaden,
Aufgabentyp und Policy eindeutig ableitbar ist. Beispielsweise kann eine
Navigationsaenderung automatisch relevante Seitendokumentation,
Browser-Supportmatrix und Navigationsregeln in ein gemeinsames Kontextpaket
aufnehmen.

Das LLM bleibt fuer semantisches Routing zustaendig, wenn der Zusammenhang
nicht durch Metadaten oder Regeln bestimmt werden kann. Es darf eine gezielte
Nachsuche verlangen, aber nicht ohne Budget beliebig Dokumente akkumulieren.

Der Context Builder soll:

- verbindliche vor unverbindlichen Quellen priorisieren;
- aktuelle vor veralteten Quellen kennzeichnen;
- verworfene Alternativen nicht als aktive Regeln darstellen;
- grosse Toolausgaben zusammenfassen und auf Evidenz verweisen;
- Tokenbudget und Datenschutz beachten;
- Quellenrevisionen und Hashes protokollieren.

## 16. OpenCode als agentische Ausfuehrungskomponente

OpenCode kann weiterhin genutzt werden fuer:

- Repositoryerkundung;
- Code- und Dokumentaenderungen;
- Test- und Buildausfuehrung;
- Diff-Review;
- technische Diagnose;
- klar begrenzte mehrstufige Agentenarbeit.

Der Orchestrator kann OpenCode entweder ueber `@opencode/client` als getrennten
Dienst ansprechen oder ueber `@opencode/sdk` direkt in eine Node.js-Anwendung
einbetten. Die Auswahl betrifft Betrieb und Isolation, nicht die grundlegende
Verantwortungsgrenze.

OpenCode erhaelt pro Auftrag:

- Arbeitsverzeichnis oder Worktree;
- eindeutiges Ziel;
- erlaubten Scope;
- relevante Kontextauszuege;
- Tool- und Berechtigungsgrenzen;
- erwartetes Ergebnisformat;
- Zeit- und Rundenbudget;
- Hinweis auf notwendige Rueckfragen.

Der Orchestrator behaelt Commit-, Push-, Deployment- und sonstige
Freigabeentscheidungen. Eine OpenCode-interne `AGENTS.md` bleibt eine wichtige
Verhaltensanweisung, aber nicht die einzige technische Schutzschicht.

## 17. Strukturierte Vertraege

Zwischen Orchestrator, Lead-LLM und Agenten werden versionierte Schemas
verwendet. Wesentliche Ausgaben sind:

- `TaskAssessment`;
- `ProposedPlan`;
- `ValidatedPlan`;
- `ActionRequest`;
- `ActionResult`;
- `EvidenceReference`;
- `ReplanRequest`;
- `FinalResponseDraft`.

Eine LLM-Ausgabe wird erst nach Schema- und Policypruefung wirksam. Freitext kann
Begruendungen enthalten, darf aber keine verborgene zweite Aktionsliste bilden.
Aktionen, die nicht im strukturierten Teil stehen, werden nicht ausgefuehrt.

Jede Aktion besitzt eine stabile ID und Idempotenzkennung. Wiederholte
Zustellung darf nicht zu doppelten irreversiblen Wirkungen fuehren.

## 18. Sicherheit und Datenschutz

Der Orchestrator setzt mindestens durch:

- Capability-Allowlist statt allgemeinem Shell- oder SQL-Zugriff;
- serverseitig gebundene Identitaet und Rolle;
- minimale kontrollierte Toolprojektionen;
- Trennung von Planen, Genehmigen und Ausfuehren;
- Geheimnisschutz vor Modellkontext und Logs;
- Pfad- und Mandantenisolation;
- explizite Human-Gates fuer irreversible Aktionen;
- Idempotenz und revisionsgebundene Writes;
- kontrollierte Behandlung unklarer Ausgaenge;
- keine automatische Vertrauensuebernahme aus untrusted Dokumenten oder
  Toolausgaben.

Das LLM darf nicht zugleich allein planen, die Einhaltung aller Regeln
beurteilen und die irreversible Aktion autorisieren.

## 19. Observability und Audit

Fuer jeden Gesamtauftrag werden kontrolliert erfasst:

- Task- und Session-ID;
- Benutzer, Rolle und Projektkontext;
- verwendete Policyversion und Regel-IDs;
- Modell, Provider und Prompt-/Kontextversion;
- Planrevisionen und Entscheidungen;
- Tool- und Agentenaufrufe mit Dauer und Status;
- Token-, Kosten- und Schleifenbudgets;
- Freigaben und Ablehnungen;
- Evidenzreferenzen;
- Abschlussstatus und Fehlerklasse.

Freie Prompts, vollstaendige Toolpayloads, Secrets und unnoetige Personendaten
werden nicht unkontrolliert als Diagnosefelder gespeichert. Fuer qualitative
Nachvollziehbarkeit werden kontrollierte Zusammenfassungen und Hash-/Versions-
Referenzen verwendet.

Messbare Betriebskennzahlen sind mindestens:

- Zeit bis zur ersten sichtbaren Rueckmeldung;
- Zeit bis zum ersten verwertbaren Ergebnis;
- Gesamtlatenz;
- Zahl der LLM-Aufrufe je Taskklasse;
- Zahl der Tool- und Agentenrunden;
- Replan- und Validierungsfehlerrate;
- Anteil deterministischer Fast-Path-Anfragen;
- Anteil menschlicher Eskalationen;
- Kosten je erfolgreichem Auftrag;
- Abbruch- und Timeoutquote.

## 20. Empfohlene Implementierungsstufen

### Stufe 1: Beobachtbare Fassade

- zentraler Task- und Sessionzustand;
- technische Vorpruefung;
- ein Lead-LLM-Aufruf;
- wenige read-only Faehigkeiten;
- strukturiertes Ergebnis;
- keine autonomen Writes.

### Stufe 2: Deterministisches Policy- und Routing-System

- strukturierter Regelkatalog;
- Policy Engine;
- Context Builder;
- Fast Paths;
- Evidenzspeicher;
- feste Budgets und Timeouts.

### Stufe 3: Begrenzte agentische Ausfuehrung

- OpenCode-Integration;
- isolierte Worktrees oder Arbeitsbereiche;
- typisierte Agentenauftraege;
- Ergebnisnormalisierung;
- maximal ein begruendeter Replan.

### Stufe 4: Kontrollierte Writes

- ausdrueckliche Benutzerfreigaben;
- Idempotenz;
- Preflight und Postconditions;
- Auditvertraege;
- Abbruch- und Recoverypfade.

### Stufe 5: Optimierung

- gemessene Kontextpakete;
- Caching;
- Parallelisierung unabhaengiger Aufgaben;
- Modellwahl nach Taskklasse;
- Reduktion ueberfluessiger LLM-Runden;
- laufende Evaluation gegen feste Szenarien.

## 21. Offene Designentscheidungen vor Umsetzung

Vor einer verbindlichen Architektur sind mindestens zu entscheiden:

1. Ein gemeinsames Lead-LLM fuer Planung und Abschluss oder getrennte Rollen.
2. Netzwerkdienst ueber `@opencode/client` oder eingebettete Nutzung ueber
   `@opencode/sdk` fuer technische Agenten.
3. Format und Speicherort des autoritativen Regelkatalogs.
4. Konkrete Faehigkeits-Allowlist und Schemas.
5. Persistenzmodell fuer Tasks, Planrevisionen, Evidenz und Freigaben.
6. Aufgabenspezifische LLM-, Tool- und Replanbudgets.
7. Grenzen zwischen deterministischem Routing, Retrieval und LLM-Klassifikation.
8. Datenschutz- und Aufbewahrungsvertrag fuer Chat-, Prompt- und
   Agentendiagnosen.
9. Evaluationskatalog fuer Qualitaet, Latenz, Kosten und Policytreue.
10. Benutzererlebnis bei langen Tasks, Rueckfragen, Teilfehlern und Eskalation.

## 22. Verdichtete Leitprinzipien

1. Das Modellwissen liefert allgemeine Kompetenz; der Kontext liefert die
   konkrete Projektwahrheit.
2. Kontext soll nicht maximal, sondern minimal vollstaendig sein.
3. Kompaktierung spart Kontext, ist aber zwangslaeufig verlustbehaftet.
4. Verbindliche Entscheidungen gehoeren in dauerhafte Artefakte und
   strukturierten Zustand.
5. `AGENTS.md` bleibt wichtig, ersetzt aber keine deterministische Policy
   Engine.
6. Software erzwingt Exaktes; LLMs bearbeiten Mehrdeutiges und Qualitatives.
7. Menschen bestaetigen riskante oder irreversible Uebergaenge.
8. Das Lead-LLM schlaegt typisierte Plaene vor; der Orchestrator autorisiert
   und steuert ihre Ausfuehrung.
9. Der Orchestrator, nicht das LLM, besitzt Workflowzustand, Budgets und
   Evidenz.
10. LLM-Aufrufe werden nach semantischen Arbeitseinheiten gebuendelt.
11. Ein weiterer LLM-Aufruf benoetigt neue Information oder echte Unsicherheit.
12. Deterministische Antworten werden ohne zusaetzlichen Modellaufruf geliefert.
13. Agentische Schleifen sind begrenzt, monoton und auditierbar.
14. OpenCode bleibt ein starker technischer Agent, aber nicht der alleinige
    Orchestrator oder Freigabeinhaber.
15. Eine einzige autoritative Policyquelle verhindert widerspruechliche
    Wahrheiten zwischen Code, Dokumentation und Agentenanweisung.
