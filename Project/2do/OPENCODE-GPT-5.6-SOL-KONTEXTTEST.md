# OpenCode-Kontexttest fuer `openai/gpt-5.6-sol`

Stand: 2026-09-25

## 1. Zweck und Ergebnis in Kurzform

Diese Datei dokumentiert den vollstaendigen Kontextlaengenversuch mit
OpenCode V2 und `openai/gpt-5.6-sol`. Sie soll ermoeglichen, die Erkenntnisse in
einer spaeteren Session ohne Zugriff auf den urspruenglichen Chat
nachzuvollziehen, die Messung zu reproduzieren und die Modellgrenzen korrekt zu
konfigurieren.

Ausgangspunkt war die Frage, ob das Modell mehr als die zuvor von OpenCode
angezeigten 400.000 Kontexttokens akzeptiert. Das Ergebnis ist eindeutig:

- Mehr als 400.000 Tokens funktionieren.
- Im automatisierten Test wurden **900.308 Inputtokens erfolgreich** verarbeitet.
- Ein auf 1.000.000 Inputtokens zielender Request wurde vom Provider mit
  `context_length_exceeded` abgelehnt.
- Der Fehlerdatensatz meldete `input: 926572`. Dieser Wert liegt nahe an der
  bekannten Inputgrenze von 922.000 Tokens, ist wegen auffaelliger weiterer
  Fehlerzaehler aber nicht als exakt akzeptierte Obergrenze zu interpretieren.
- Die getesteten Resultate stuetzen die Modellmetadaten
  `context: 1050000`, `input: 922000`, `output: 128000`.
- Fuer den regulaeren Betrieb wurde anschliessend bewusst die konservativere
  Konfiguration `600000 / 472000 / 128000` gewaehlt.

Die hoechste **nachgewiesen erfolgreiche** automatisierte Eingabegroesse ist
damit 900.308 Tokens. Die exakte harte Grenze zwischen 900.308 und dem
abgelehnten Millionenversuch wurde nicht per Binaersuche bestimmt.

## 2. Umgebung

- Datum: 2026-09-25
- OpenCode: 2.0.6
- Provider: `openai`
- Modell: `gpt-5.6-sol`
- Manuelle Versuche: ueberwiegend Variante `medium`
- Automatisierter Versuch: Variante `low`
- OpenCode arbeitet als Client-/Server-System mit gemeinsamem Background-Service.
- Projektcheckout waehrend der Untersuchung:
  `/srv/http/ePiber/paj`
- Testartefakte ausserhalb des Repositorys:
  `/home/paj/.local/share/opencode/context-tests/2026-09-25-gpt-5.6-sol-1m/`
- Automatisierte Testsitzung:
  `ses_f282c1f0fffeHdaEmCyn3WMgjk`

## 3. Relevantes OpenCode-Verhalten

### 3.1 Modelllimits

OpenCode V2 kann Modelllimits in der Provider-/Modellkonfiguration
ueberschreiben:

```jsonc
{
  "providers": {
    "openai": {
      "models": {
        "gpt-5.6-sol": {
          "limit": {
            "context": 600000,
            "input": 472000,
            "output": 128000
          }
        }
      }
    }
  }
}
```

Die drei Werte bedeuten fuer den hier untersuchten Betrieb:

- `context`: gesamtes konfiguriertes Kontextfenster,
- `input`: fuer Eingabe verfuegbares Budget,
- `output`: maximales Ausgabebudget.

Die aktuell gewaehlten Werte folgen der Rechnung:

```text
600000 context - 128000 output = 472000 input
```

### 3.2 V2-Konfigurationssyntax

Die urspruengliche globale Konfiguration verwendete noch die Legacy-Schluessel
`provider`, `npm` und `options`. Der Modelllimit-Override wurde erst mit der
nativen V2-Form wirksam:

- `provider` -> `providers`
- `npm` -> `package`
- `options` -> `settings`

Die Poe-Konfiguration blieb bei dieser Migration inhaltlich erhalten. Das
globale Standardmodell blieb `poe/GPT-5.6-Sol`; der hier dokumentierte
Limit-Override gilt fuer das explizit ausgewaehlte Modell
`openai/gpt-5.6-sol`.

### 3.3 Automatische Kompaktierung

OpenCode V2 kompaktierte standardmaessig automatisch. Relevante Standardwerte:

```jsonc
{
  "compaction": {
    "auto": true,
    "keep": { "tokens": 15000 },
    "buffer": 20000
  }
}
```

Fuer den ersten 600k-Override mit 472.000 Inputtokens ergibt sich aus dem
20.000-Token-Puffer eine ungefaehre Kompaktierungsschwelle von 452.000
tatsaechlichen Inputtokens.

Der in der Oberflaeche sichtbare Kontextzaehler ist nicht identisch mit der
vollstaendigen Provideranfrage. Systemprompt, Agentanweisungen und Toolschemata
koennen zusaetzliche, in der damaligen Anzeige nicht vollstaendig sichtbare
Tokens belegen. Deshalb wurde bei etwa 401k sichtbaren Tokens kompaktisiert:

```text
ca. 401k sichtbar + ca. 51k fixe Anteile = ca. 452k
```

Die API bestaetigte fuer dieses Ereignis:

- Typ: `compaction`
- Status: `completed`
- Grund: `auto`
- kein vorausgehender Provider-Kontextfehler
- Kompaktierung von etwa 401k sichtbar auf etwa 41k sichtbar

Bei `compaction.auto: false` findet weder die normale automatische
Kompaktierung noch die einmalige Recovery-Kompaktierung nach einem
Provider-Kontextfehler statt. Das war fuer einen unverfaelschten Grenztest
notwendig.

### 3.4 Projektion und Kuerzung von Toolausgaben

Lange Toolausgaben werden von OpenCode beziehungsweise der aktiven
Kontextprojektion gekuerzt oder aus aelteren Nachrichten verdraengt. Deshalb
stieg der sichtbare Zaehler bei den spaeten manuellen Dateileseversuchen nicht
mehr proportional zur neu gelesenen Payload. Ein sichtbarer UI-Wert ist damit
ein guter Betriebsindikator, aber kein ausreichend praeziser Messwert fuer eine
Providergrenze.

Die automatisierte Messung verwendete deshalb als Nutzlast dauerhaft
gespeicherte User-Nachrichten und las die Tokenzaehler direkt aus den
Assistant-/Sessiondaten der OpenCode-API.

## 4. Manuelle Vorstudie

### 4.1 Testdatei und Aufbau

Zunaechst wurde ausserhalb des Repositorys eine wiederholt lesbare Textdatei
mit ungefaehr 50.000 Payloadtokens erzeugt:

```text
/home/paj/.cache/opencode-tmp/session.RXoSzMDGhf/context-probe-50k.txt
```

Die Datei bestand aus nummerierten `PROBE-xxxx`-Zeilen und vielen Wiederholungen
des Wortes `probe`. Aufgrund separater Harness-Ausgabelimits musste ein
vollstaendiger Block ueber mehrere begrenzte `read`-Aufrufe geladen werden.

Fuer die erste Testphase wurden folgende Limits gesetzt:

```json
{
  "context": 600000,
  "input": 472000,
  "output": 128000
}
```

### 4.2 Messreihe mit aktiver Auto-Compaction

Die ungefaehren sichtbaren Staende waren:

| Schritt | Sichtbarer Kontext |
|---:|---:|
| Block 1 | 133.415 |
| Block 2 | ca. 185k |
| Block 3 | ca. 244k |
| Block 4 | ca. 299k |
| Block 5 | ca. 354k |
| Block 6 | ca. 401k, danach Kompaktierung auf ca. 41k |

Wichtig: Block 4 widerlegte bereits die zuvor vermutete alte 272k-Inputgrenze.
Die Kompaktierung nach Block 6 war kein Providerfehler, sondern die normale
OpenCode-Automatik nahe dem konfigurierten Inputbudget abzueglich Puffer.

### 4.3 Messreihe mit deaktivierter Auto-Compaction

Danach wurde temporaer gesetzt:

```jsonc
{
  "compaction": {
    "auto": false,
    "keep": { "tokens": 15000 },
    "buffer": 20000
  }
}
```

Ausgehend von etwa 41k nach der Kompaktierung wurde der Kontext neu aufgebaut:

| Neuaufbau | Sichtbarer Kontext |
|---:|---:|
| 1 | 88k |
| 2 | ca. 135-145k |
| 3 | ca. 185-195k |
| 4 | 245k |
| 5 | ca. 295-305k |
| 6 | 355k |
| 7 | 410k |
| weiterer Feinschritt | 465k |
| Mikroschritt | 493k |
| weiterer Block | 497k |
| weitere Doppelblockphase | 526k |

Der Provider erzeugte bis zu diesen Staenden normale Antworten ohne
`context_length_exceeded`. Damit war die 400k-Grenze eindeutig widerlegt.

Spaeter zeigte die UI etwa 620k und kompaktierte nach Wiederherstellung der
Standardautomatik auf etwa 54k. Dieser UI-Wert beweist, dass OpenCode einen
entsprechend grossen Sitzungsstand verwaltete. Er beweist alleine jedoch nicht,
dass der Provider vor der Kompaktierung eine normale Generation mit exakt allen
620k Tokens erhalten hatte. Aus diesem Grund wurde anschliessend der
automatisierte API-Test gebaut.

## 5. Automatisierter Kontexttest

### 5.1 Ziel

Der automatisierte Test sollte:

1. ohne manuelles Ablesen arbeiten,
2. eine eigene OpenCode-Sitzung verwenden,
3. Auto-Compaction deaktivieren,
4. Payload persistent in den Sessionkontext aufnehmen,
5. in ungefaehr 100k-Abstaenden echte Providerantworten anfordern,
6. Tokenwerte, Laufzeit, Ergebnis und Fehler sofort persistent speichern,
7. bis zu einem Ziel von einer Million Inputtokens laufen.

### 5.2 Testkonfiguration

Die isolierte Testlocation verwendete:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "openai": {
      "models": {
        "gpt-5.6-sol": {
          "limit": {
            "context": 1050000,
            "input": 1030000,
            "output": 20000
          }
        }
      }
    }
  },
  "compaction": {
    "auto": false,
    "keep": { "tokens": 15000 },
    "buffer": 20000
  },
  "model": "openai/gpt-5.6-sol"
}
```

Das reduzierte Ausgabebudget von 20.000 Tokens war ausschliesslich ein
Testinstrument, um innerhalb eines 1,05M-Gesamtfensters Platz fuer eine
Million Inputtokens zu lassen. Es entspricht nicht der anschliessend gewaehlten
Betriebskonfiguration.

### 5.3 Runner

Der Node.js-Runner liegt unter:

```text
/home/paj/.local/share/opencode/context-tests/2026-09-25-gpt-5.6-sol-1m/run-context-probe.mjs
```

Sein Ablauf:

1. Wirksame lokale Konfiguration ueber die OpenCode-API pruefen.
2. Eigene Session mit `openai/gpt-5.6-sol#low` anlegen.
3. Payloadnachrichten mit `resume: false` dauerhaft aufnehmen, ohne fuer jeden
   kleinen Block einen Provideraufruf zu erzeugen.
4. Am naechsten 100k-Ziel eine kurze Checkpointnachricht senden.
5. Mit `/api/experimental/session/<id>/wait` bis zum Sessionstillstand warten.
6. Neuesten Assistantdatensatz und Sessionstatus lesen.
7. Bei erfolgreichen Antworten `tokens.input + tokens.cache.read` als
   tatsaechlichen Kontextindikator speichern.
8. Alle Ereignisse append-only und mit `fsync` in `results.jsonl` schreiben.
9. `state.json` und `summary.json` ueber temporaere Datei plus atomarem Rename
   aktualisieren.
10. Bei Fehler den vollstaendigen strukturierten Befund speichern und mit
    Exitcode 1 enden.

Startkommando des Millionenlaufs:

```sh
PROBE_MAX_TOKENS=1000000 node run-context-probe.mjs
```

### 5.4 Persistente Dateien

Alle Artefakte liegen unter:

```text
/home/paj/.local/share/opencode/context-tests/2026-09-25-gpt-5.6-sol-1m/
```

| Datei | Bedeutung |
|---|---|
| `opencode.jsonc` | Isolierte Testkonfiguration |
| `run-context-probe.mjs` | Automatischer Runner |
| `results.jsonl` | Vollstaendiges append-only Ereignisprotokoll |
| `state.json` | Persistenter Runnerzustand |
| `summary.json` | Kompakte maschinenlesbare Zusammenfassung |
| `CONCLUSION.md` | Kurzauswertung des automatisierten Tests |

Die Testsitzung bleibt ebenfalls im gemeinsamen OpenCode-Datenspeicher
erhalten:

```text
ses_f282c1f0fffeHdaEmCyn3WMgjk
```

Sie kann lesend geoeffnet werden mit:

```sh
opencode --session ses_f282c1f0fffeHdaEmCyn3WMgjk \
  /home/paj/.local/share/opencode/context-tests/2026-09-25-gpt-5.6-sol-1m
```

### 5.5 Fehlversuche beim Aufbau der Automatisierung

Diese Punkte sind fuer eine spaetere Wiederholung wichtig:

1. **Direktes `fetch` auf den Shared Service lieferte HTTP 401.**
   `/api/info` ist ohne interne Authentifizierung lesbar, geschuetzte Endpunkte
   wie `/api/config` nicht. Der Runner wurde deshalb auf den authentifizierten
   Transport `opencode api` umgestellt.

2. **Ein 50k-Block als einzelnes CLI-Argument scheiterte lokal.**
   Der JSON-Body mit rund 300 KB ueberschritt unter Linux die Grenze fuer ein
   einzelnes Prozessargument (`MAX_ARG_STRLEN`, typischerweise etwa 128 KB).
   Es kam dabei zu keinem Provideraufruf. Die Einfuegebloecke wurden auf
   ungefaehr 15.000 Payloadtokens reduziert.

3. **Die Config-API liefert einzelne Quellen statt eines einzigen simplen
   Dokuments.**
   Der erste Pruefer waehlt irrtuemlich die globale Quelle mit Poe als
   Standardmodell. Korrekt ist fuer diese Location die letzte einschlaegige
   Dokumentquelle, also die lokale `opencode.jsonc` des Testverzeichnisses.

4. **Anfangs wurde nach jedem kleinen Payloadblock gemessen.**
   Das haette sehr viele kumulativ grosse und potenziell teure Providerrequests
   erzeugt. Der Runner wurde so optimiert, dass mehrere 15k-Bloecke ohne
   Providerlauf gesammelt und nur an den 100k-Messpunkten generiert werden.

5. **Ein fehlgeschlagener Grenzpunkt ist nicht normal fortsetzbar.**
   Die Payload des fehlgeschlagenen Millionenpunkts bleibt in der Session.
   Ein unveraendertes erneutes Starten des aktuellen Zustands wuerde weitere
   Payload anfuegen und ist keine saubere Wiederholung. Fuer neue Grenztests ist
   eine neue Session anzulegen oder gezielt vor die fehlgeschlagene
   Payloadphase zu forken.

## 6. Exakte automatisierte Messergebnisse

Auto-Compaction war fuer die gesamte Messreihe deaktiviert. Jeder erfolgreiche
Messpunkt endete mit `finish: stop`, `outcome: succeeded` und einer kurzen
Modellantwort.

| Ziel | Gemessener Input inkl. Cache | Ergebnis | Dauer des Checkpoints |
|---:|---:|---|---:|
| 100.000 | 100.069 | erfolgreich | 6,429 s |
| 200.000 | 200.308 | erfolgreich | 21,761 s |
| 300.000 | 300.308 | erfolgreich | 23,302 s |
| 400.000 | 400.308 | erfolgreich | 25,560 s |
| 500.000 | 500.308 | erfolgreich | 30,549 s |
| 600.000 | 600.308 | erfolgreich | 32,219 s |
| 700.000 | 700.308 | erfolgreich | 34,738 s |
| 800.000 | 800.308 | erfolgreich | 32,531 s |
| 900.000 | 900.308 | erfolgreich | 38,289 s |
| 1.000.000 | nicht erfolgreich messbar | Providerfehler | 5,833 s bis Fehler |

Der Millionenpunkt endete mit:

```text
type: provider.invalid-request
message: context_length_exceeded: Your input exceeds the context window of
         this model. Please adjust your input and try again.
finish: error
outcome: failed
```

Der Fehlerdatensatz enthielt:

```json
{
  "input": 926572,
  "output": 929,
  "reasoning": 0,
  "cache": {
    "read": 33824256,
    "write": 0
  }
}
```

`cache.read: 33824256` ist im Vergleich zur linearen erfolgreichen Messreihe
offensichtlich kein verwertbarer Kontextzaehler. Deshalb darf fuer den
Fehlerfall insbesondere **nicht** `input + cache.read = 34.750.828` als
Kontextgroesse ausgelegt werden. Der Wert `input: 926572` ist plausibel nahe der
bekannten 922k-Grenze, aber auch er ist nur ein Fehlerindikator und kein
erfolgreicher Messpunkt.

Im serverseitigen OpenCode-Log steht fuer diese Session ein direkter
`context_length_exceeded`-Fehler. Es existiert fuer den Grenzpunkt kein
`agent=compaction`-Eintrag. Damit ist ausgeschlossen, dass das Ergebnis durch
eine automatische OpenCode-Kompaktierung verdeckt wurde.

## 7. Interpretation und belastbare Aussagen

### 7.1 Bewiesene Aussagen

- Die fruehere 400k-Anzeige ist keine harte Providergrenze fuer
  `openai/gpt-5.6-sol`.
- 900.308 Inputtokens inklusive Cacheanteil wurden in einer normalen
  Providergeneration erfolgreich verarbeitet.
- Ein auf eine Million zielender Input ist fuer diesen Providerpfad zu gross.
- OpenCodes konfiguriertes `input`-Limit steuert vor allem die lokale
  Kompaktierungsplanung. Bei deaktivierter Automatik verhindert es nicht
  zwingend lokal das Absenden eines groesseren Requests.
- Fuer verlaessliche Grenzmessungen muss Auto-Compaction deaktiviert sein.
- UI-Kontextwerte und projizierte Toolausgaben sind fuer eine exakte
  Grenzbestimmung nicht ausreichend.

### 7.2 Sehr wahrscheinliche, aber nicht exakt ausgemessene Aussage

Die Kombination aus erfolgreichem 900.308-Punkt, Fehlerwert 926.572 und den
bekannten Modellmetadaten spricht stark fuer eine harte Inputgrenze um 922.000
Tokens. Der Test hat nicht bestimmt, ob beispielsweise 915k, 920k oder exakt
922k noch erfolgreich waeren.

Eine exakte Grenzbestimmung braeuchte neue isolierte Sessions oder kontrollierte
Forks und eine Binaersuche zwischen etwa 900k und 927k. Fuer die praktische
OpenCode-Konfiguration ist das nicht erforderlich, weil der Standardpuffer die
Kompaktierung rechtzeitig vor diesem Bereich ausloesen soll.

### 7.3 Nicht getestete Eigenschaften

- Inhaltliche Erinnerungsqualitaet oder Needle-in-a-Haystack-Leistung bei 900k
- Qualitaet komplexer Schlussfolgerungen ueber den gesamten Kontext
- Maximale Ausgabe von 128k Tokens
- Bild-, PDF- oder sonstige multimodale Lasten in sehr grossen Kontexten
- Kostenabrechnung; `cost: 0` in OpenCode beweist keine kostenlose
  Providerverarbeitung
- Exakte harte Inputgrenze per Binaersuche
- Verhalten anderer Varianten oder anderer Providerpfade

Die Payload bestand ueberwiegend aus repetitivem `probe`-Text. Damit wurde die
technische Annahme- und Kontextgrenze getestet, nicht die semantische
Langkontextqualitaet.

## 8. Abgeleitete Konfigurationsoptionen

### 8.1 Maximale, modellnahe Konfiguration

Die Ergebnisse stuetzen folgende Modellmetadaten:

```jsonc
"limit": {
  "context": 1050000,
  "input": 922000,
  "output": 128000
}
```

Bei aktivierter Auto-Compaction und dem Standardpuffer von 20.000 Tokens waere
eine Kompaktierung ungefaehr bei 902.000 Inputtokens zu erwarten. Das liegt sehr
nahe ueber dem erfolgreich getesteten Punkt von 900.308 und vor der beobachteten
Providerablehnung.

### 8.2 Gewaehlte konservative Betriebskonfiguration

Auf Userentscheidung wurde global fuer `openai/gpt-5.6-sol` gesetzt:

```jsonc
"limit": {
  "context": 600000,
  "input": 472000,
  "output": 128000
}
```

Die globale Datei ist:

```text
/home/paj/.config/opencode/opencode.jsonc
```

Auto-Compaction wurde nicht explizit ueberschrieben und verwendet daher wieder
den Standard. Mit 20.000 Tokens Puffer ist eine Kompaktierung ungefaehr bei
452.000 tatsaechlichen Inputtokens zu erwarten. Wegen fixer System- und
Toolanteile kann die sichtbare UI-Anzeige zu diesem Zeitpunkt deutlich kleiner
sein, im manuellen Versuch etwa 401k.

Diese 600k-Konfiguration bietet:

- deutlich mehr Kontext als die urspruengliche 400k-Anzeige,
- ein volles 128k-Ausgabebudget,
- fruehere Kompaktierung und mehr Sicherheitsabstand zur Providergrenze,
- geringere typische Latenz und Kontextkosten als die modellnahe
  1,05M-Konfiguration.

## 9. Reproduktion und Weiterarbeit

### 9.1 Bestehende Ergebnisse ansehen

```sh
cat /home/paj/.local/share/opencode/context-tests/2026-09-25-gpt-5.6-sol-1m/CONCLUSION.md
```

```sh
cat /home/paj/.local/share/opencode/context-tests/2026-09-25-gpt-5.6-sol-1m/summary.json
```

```sh
less /home/paj/.local/share/opencode/context-tests/2026-09-25-gpt-5.6-sol-1m/results.jsonl
```

### 9.2 Neuen Test starten

Nicht den fehlgeschlagenen Zustand blind wiederaufnehmen. Stattdessen:

1. Neues Testverzeichnis ausserhalb eines Projekt-Repositorys anlegen.
2. `opencode.jsonc` und `run-context-probe.mjs` kopieren.
3. Alte `state.json`, `summary.json` und `results.jsonl` nicht mitkopieren.
4. Gewuenschte Limits und Zielgroessen explizit pruefen.
5. Neuen Runner aus dem neuen Verzeichnis starten.
6. Session-ID und Ergebnisverzeichnis dauerhaft notieren.

Fuer eine Binaersuche sollte jede Kandidatengroesse in einer frischen Session
oder in einem sauber vor der zusaetzlichen Payload geforkten Zustand getestet
werden. Ein fehlgeschlagener Request laesst seine Payload in der Session zurueck.

### 9.3 Livebeobachtung eines laufenden Tests

```sh
watch -n 1 'cat <testverzeichnis>/summary.json'
```

```sh
tail -f <testverzeichnis>/results.jsonl
```

Die Session kann parallel lesend geoeffnet werden. Waehrend der Runner aktiv ist,
duerfen dort keine Nachrichten gesendet und keine manuellen Kompaktierungen
ausgeloest werden.

## 10. Sicherheits- und Betriebsbefunde

`opencode debug config` und breite Modell-/Providerdiagnosen koennen aufgeloeste
Providerwerte ausgeben. Im Verlauf der Untersuchung wurde dadurch der Wert von
`POE_API_KEY` in lokalen Tool- und Sitzungslogs sichtbar. Der konkrete
Schluesselwert wird in dieser Dokumentation bewusst nicht wiedergegeben.

Erforderliche Restarbeit:

- `POE_API_KEY` rotieren,
- alten Schluessel beim Provider widerrufen,
- neuen Wert nur ueber die Umgebung bereitstellen,
- lokale Diagnose- und Toollogs als geheimnishaltig behandeln,
- vor Weitergabe von Logs API-Keys, Authorization-Header, Prompts und Payloads
  redigieren.

Die globale Konfigurationsdatei referenziert den Key korrekt ueber
`{env:POE_API_KEY}`; das Problem entstand durch die aufgeloeste Diagnoseausgabe,
nicht durch einen im Repository gespeicherten Klartextschluessel.

## 11. Offene Folgefragen

- Soll die exakte Grenze zwischen 900k und etwa 927k per Binaersuche bestimmt
  werden, oder reicht die konservative 600k-Betriebskonfiguration dauerhaft aus?
- Soll der automatische Runner nach Bereinigung und Generalisierung als
  wiederverwendbares OpenCode-Diagnosewerkzeug ausserhalb dieses
  projektspezifischen Repositorys erhalten bleiben?
- Soll nach Rotation des Poe-Schluessels eine kontrollierte Bereinigung lokaler
  Diagnoseausgaben erfolgen?
- Soll ein separater semantischer Langkontexttest mit eindeutigen Fakten und
  spaeteren Recall-Fragen aufgebaut werden? Der bisherige Test misst nur die
  technische Kontextannahme.

## 12. Schlussfolgerung

Der Providerpfad von `openai/gpt-5.6-sol` kann nachweislich deutlich mehr als
400k und mindestens 900.308 Inputtokens verarbeiten. Eine Million Inputtokens
wurde abgelehnt. Die bekannten Limits 1,05M Gesamt, 922k Input und 128k Output
sind mit dem beobachteten Verhalten konsistent.

Fuer den aktuellen Alltagseinsatz wurde dennoch bewusst auf 600k Gesamt,
472k Input und 128k Output begrenzt. Diese Einstellung bewahrt das volle
Ausgabebudget, nutzt den nachgewiesenen groesseren Kontext und laesst OpenCode
mit Standardpuffer frueh genug automatisch kompaktieren.
