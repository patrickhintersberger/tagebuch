# Daily

Persönliche App: Tagebuch, Gewohnheiten, Länderzähler und Reisekarte (die Reisekarte ist als eigene App unter `/reisekarte/` eingebunden).

Eigenes Tagebuch im Stil von Diarium: Einträge mit Bildern, Ort, Bewertung (1–10), Tags und Vorlagen (Morgenroutine, Abendroutine, Wochen-Review). Dazu Kalender, Karte der Bilder und Orte sowie der Rückblick „An diesem Tag“.

## Lokal starten
```bash
cd ~/Claude/Tagebuch && python3 -m http.server 8770
```
Dann http://localhost:8770 öffnen. Der Standort funktioniert nur auf `localhost` oder über https.

## Daten
- Auf dem Gerät: Browser-Speicher (IndexedDB), Einträge und Bilder.
- Synchronisation: privates Repo `tagebuch-daten` über die GitHub-API (Token in den Einstellungen der App).
  - `data/<Jahr>.json` – Einträge eines Jahres, `data/templates.json` – Vorlagen
  - `photos/<id>.jpg` (max. 1600 px) und `thumbs/<id>.jpg` (320 px)
- Zusammenführung pro Eintrag nach `updatedAt`; Löschungen bleiben als Markierung erhalten.

## Diarium-Import
Einstellungen → „Sicherung oder Diarium-Export einlesen“ → JSON-Export aus Diarium wählen. Übernommen werden Datum, Uhrzeit, Titel, Text, Tags, Koordinaten und Wetter. Die IDs sind fest (`dia-<Zeitstempel>`), mehrfaches Einlesen erzeugt keine Doppelten. Bilder stehen nicht in der JSON-Datei und sind noch nicht angebunden.

## Anpassen
- Standard-Vorlagen und Bildgrößen: `config.js`
- Neue Icons (Material Symbols) zusätzlich in `index.html` in `icon_names=` eintragen (alphabetisch sortiert).
