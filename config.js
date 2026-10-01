// Grundeinstellungen des Tagebuchs.
window.TB_CONFIG = {
  owner: 'patrickhintersberger',
  dataRepo: 'tagebuch-daten',
  dataDir: 'data',          // Ordner im Daten-Repo: eine Datei pro Jahr + templates.json
  branch: 'main',
  photoMax: 1600,   // längste Kante der gespeicherten Bilder in Pixeln
  thumbMax: 320,    // längste Kante der Vorschaubilder
  videoUploadMax: 50 * 1024 * 1024, // größere Videos werden nicht ins Repo geladen (GitHub-Grenze)
};

// Vorlagen, die beim ersten Start angelegt werden. Danach in der App unter Einstellungen → Vorlagen änderbar.
window.TB_DEFAULT_TEMPLATES = [
  {
    id: 'tpl-morgen', name: 'Morgenroutine', tags: ['Morgenroutine'],
    body: [
      '## Dankbarkeit',
      'Ich bin dankbar für …',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Fokus',
      'Was würde den heutigen Tag großartig machen?',
      '',
      '',
      '## Wichtigste Aufgabe',
      'Die eine Sache, die heute erledigt wird:',
      '',
      '',
      '## Affirmation',
      'Ich bin …',
      '',
    ].join('\n'),
  },
  {
    id: 'tpl-abend', name: 'Abendroutine', tags: ['Abendroutine'],
    body: [
      '## Highlights',
      'Drei gute Dinge, die heute passiert sind:',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Gelernt',
      'Was habe ich heute gelernt?',
      '',
      '',
      '## Besser machen',
      'Was hätte ich heute besser machen können?',
      '',
      '',
      '## Morgen',
      'Das Wichtigste für morgen:',
      '',
    ].join('\n'),
  },
  {
    id: 'tpl-woche', name: 'Wochen-Review', tags: ['Wochen-Review'],
    body: [
      '## Rückblick',
      'Was lief diese Woche gut?',
      '',
      '',
      'Was lief nicht gut?',
      '',
      '',
      '## Zahlen',
      'Umsatz / Leads / Termine:',
      '',
      '',
      '## Erkenntnisse',
      'Was nehme ich aus dieser Woche mit?',
      '',
      '',
      '## Nächste Woche',
      'Die drei wichtigsten Ziele:',
      '1. ',
      '2. ',
      '3. ',
      '',
    ].join('\n'),
  },
];
