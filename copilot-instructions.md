# GitHub Copilot Instructions für ePiber

## Commit-Struktur nach Semantic Versioning

Bei der Erstellung von Commits sollte die folgende Struktur verwendet werden, basierend auf dem Umfang der Änderungen:

### MAJOR - Breaking Changes
- Signifikante Änderungen, die die Kompatibilität brechen
- Datenbankschema-Refactorings
- Änderungen an APIs oder Funktionssignaturen
- Beispiele:
  - `breaking(database): refactor tournament schema`
  - `breaking(firestore): change collection structure`

### MINOR - Features
- Neue Features oder Funktionalität
- Neue Funktionen hinzufügen
- Erwerbungen von bestehenden Features
- Beispiele:
  - `feat(matches): add new tournament feature`
  - `feat(navigator): implement ranking calculation`
  - `feat(entryList): add player filtering options`

### PATCH - Fixes & Small Improvements
- Bugfixes
- Performance-Verbesserungen
- Code-Cleanup und Refactoring (nicht breaking)
- Dokumentation
- Beispiele:
  - `fix(navigator): resolve state management bug`
  - `fix(matches): correct score calculation`
  - `fix(preMatches): handle null values properly`
  - `docs(README): update deployment instructions`

## Commit-Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types
- `feat` - Neue Feature (MINOR)
- `fix` - Bugfix (PATCH)
- `docs` - Dokumentation (PATCH)
- `style` - Code-Style, Formatierung (PATCH)
- `refactor` - Code-Refactoring ohne neue Features (PATCH)
- `perf` - Performance-Verbesserungen (PATCH)
- `test` - Tests hinzufügen/anpassen (PATCH)
- `breaking` - Breaking Changes (MAJOR)

### Scopes für ePiber
- `matches` - Match-Management
- `navigator` - Navigator/Scoreboard
- `preMatches` - Pre-Match-Verwaltung
- `entryList` - Anmeldungsliste
- `ranking` - Ranglisten-Funktionalität
- `functions` - Backend/Firebase Functions
- `firestore` - Datenbank/Firestore
- `ui` - Frontend/UI Änderungen
- `config` - Konfiguration
- `database` - Datenbankschema

## Verwendung mit Gitlens

Verwende **Gitlens Commit Composer** um deine Commits zu organisieren:
- Strukturiere größere Änderungen in mehrere, semantisch sinnvolle Commits
- Nutze die Commit-Vorschläge basierend auf deinen Änderungen

## Versionierung

Die Versionsnummern folgen diesem Schema: `MAJOR.MINOR.PATCH`

Beispiel-Progression:
- `1.0.0` - Initial Release
- `1.1.0` - Neue Features hinzufügt (MINOR)
- `1.1.1` - Bugfix (PATCH)
- `2.0.0` - Breaking Changes (MAJOR)

---

**Hinweis**: Diese Richtlinien helfen dabei, die Projekt-Historie übersichtlich zu halten und Release-Management zu vereinfachen.
**Hinweis**: wir sind gerade bei 1.20.0 da der letzte Release 1.19.3 der von palf80 563351 erstellt wurde. Danach haben wir wie gesagt 1.20.0 gemacht, da wir ja auch neue Features hinzugefügt haben.