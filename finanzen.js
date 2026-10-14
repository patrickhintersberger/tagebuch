// Finanzen: Einnahmen und Ausgaben über alle Konten, Kategorien wie in der Jahresübersicht der Numbers-Dateien.
// Quellen: Finanzguru-Export (Excel) bzw. Bank-CSV über „Datei einlesen“ und die Monatswerte der Numbers-Jahresübersichten
// (Import als Sicherung). Für Monate, die in Numbers gepflegt sind, gelten diese Werte; die Buchungen füllen die übrigen
// Monate und zeigen die Einzelheiten. Korrekturen lernen mit: „Immer so“ legt eine Regel an.
// Daten: Buchungen in data/f<Jahr>.json, Regeln in data/fmeta.json (privates Daten-Repo, nie im App-Repo).
(function () {
  if (window.TB_GESPERRT) return; // ohne Anmeldung startet nichts (sperre.js)
  'use strict';
  const S = window.TB_STORE;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = name => `<span class="ms">${name}</span>`;
  const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const eur = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const eur0 = c => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  // ---------- Kategorien (Zeilen der Jahresübersicht) ----------
  // g: in = Einnahme, out = private Ausgabe, biz = geschäftliche Ausgabe, prop = Immobilie (Kauf & Umbau über Kredit),
  //    save = Sparen & Anlegen, skip = zählt nicht
  const CATS = [
    ['in', 'Gehalt vom Hauptjob'], ['in', 'Empfehlungsmarketing'], ['in', 'Stuff-Verkäufe / Ebay'], ['in', 'Rückzahlungen'], ['in', 'Vermietung'],
    ['in', 'Geldgeschenke, sonstiges, Urlaubsgeld, Bonus'],
    ['out', 'Warmmiete'], ['out', 'Kredit + Hausgeld'], ['out', 'Monatliche Zahlungen Haus'], ['out', 'Haus (Sonderzahlungen etc)'], ['out', 'Allgemein'],
    ['out', 'Versicherungen'], ['out', 'Internet'], ['out', 'Handyvertrag/Prepaid'], ['out', 'Lebensmittel (Supermarkteinkäufe)'], ['out', 'Außer Haus essen / bestellen'],
    ['out', 'Partys, Kneipe, Ausgehen'], ['out', 'Auto (Benzinkosten, Vers. Etc.)'], ['out', 'Gesundheit und Medikamente'], ['out', 'Kleidung'],
    ['out', 'Werkzeuge und Haushaltsgeräte'], ['out', 'Sport'], ['out', 'Spotify, Netflix und Co.'], ['out', 'Geburtstags- und Weihnachtsgeschenke'], ['out', 'Friseur'],
    ['out', 'Urlaub / Reisen (Bus- Zug-, Flugtickets)'], ['out', 'Nahrungsergänzungsmittel'], ['out', 'Andere Ausgaben'], ['out', 'Spaß'], ['out', 'Futter und Tierbedarf'],
    ['out', 'Spenden'], ['out', 'Bauen und Renovieren'],
    ['biz', 'Equipment'], ['biz', 'Leasing'], ['biz', 'Putzkraft'], ['biz', 'Software (Adobe / frame.io / etc.)'], ['biz', 'Autokosten Geschäftlich'],
    ['biz', 'Fahrtkosten (Bahn / Auto / Benzin)'], ['biz', 'Unterkunft / Hotel'], ['biz', 'Rechtliches'], ['biz', 'Sonstiges'], ['biz', 'Bücher'], ['biz', 'Marketing'],
    ['biz', 'Weiterbildung / Seminare'], ['biz', 'Mitarbeiter / Gehälter'], ['biz', 'Bankgebühren'], ['biz', 'Steuerberater'], ['biz', 'Steuer'],
    ['prop', 'Immobilie (Kauf & Umbau)'],
    ['save', 'Sparen & Anlegen'],
    ['skip', 'Umbuchung (zählt nicht)'],
  ].map(([g, name]) => ({ g, name }));
  const GROUPS = [['in', 'Einnahmen'], ['out', 'Ausgaben privat'], ['biz', 'Ausgaben geschäftlich'], ['prop', 'Immobilie (über Kredit)'], ['save', 'Sparen & Anlegen'], ['skip', 'Zählt nicht']];
  const catGroup = name => (CATS.find(c => c.name === name) || {}).g;

  // Grundregeln für Bank-CSV ohne Kategorie; eigene Regeln (aus „Immer so“) haben Vorrang.
  const BASE_RULES = [
    [/\b(aral|shell|esso|jet tank|totalenergies|agip|omv|tankstelle|avia)\b/, 'Auto (Benzinkosten, Vers. Etc.)'],
    [/\b(rewe|edeka|lidl|aldi|netto|kaufland|penny|norma|alnatura|tegut|globus|picnic|flink|getir)\b/, 'Lebensmittel (Supermarkteinkäufe)'],
    [/\b(lieferando|wolt|uber eats|mcdonald|burger king|restaurant|pizzeria|bäckerei|starbucks)\b/, 'Außer Haus essen / bestellen'],
    [/\b(spotify|netflix|disney|audible|dazn)\b/, 'Spotify, Netflix und Co.'],
    [/\b(vodafone)\b/, 'Internet'], // wie in Finanzguru: Wohnen / Internet & Telefon
    [/\b(congstar|telekom)\b/, 'Handyvertrag/Prepaid'],
    [/\b(versicherung)\b/, 'Versicherungen'],
    [/\b(rossmann|apotheke|docmorris)\b/, 'Gesundheit und Medikamente'],
    [/\b(obi|bauhaus|hornbach|toom)\b/, 'Bauen und Renovieren'],
    [/\b(friseur|barber)\b/, 'Friseur'],
  ];

  // Finanzguru: „Hauptkategorie / Unterkategorie“ -> eigene Kategorie. Erst die genaue Unterkategorie, sonst die Hauptkategorie.
  const FG_SUB = {
    'einnahmen / lohn / gehalt': 'Gehalt vom Hauptjob', 'einnahmen / mieteinnahmen': 'Vermietung',
    'essen & trinken / lebensmittel': 'Lebensmittel (Supermarkteinkäufe)', 'essen & trinken / eiweisspulver': 'Nahrungsergänzungsmittel',
    'finanzen / bankgebuehren': 'Bankgebühren', 'finanzen / kredit': 'Kredit + Hausgeld', 'finanzen / spende': 'Spenden', 'finanzen / steuern': 'Steuer',
    'freizeit / urlaub': 'Urlaub / Reisen (Bus- Zug-, Flugtickets)', 'freizeit / sport': 'Sport', 'freizeit / musik & podcasts': 'Spotify, Netflix und Co.',
    'freizeit / serien & filme': 'Spotify, Netflix und Co.', 'freizeit / veranstaltungen': 'Partys, Kneipe, Ausgehen', 'freizeit / kino': 'Partys, Kneipe, Ausgehen',
    'geschaeftlich / equipment': 'Equipment', 'geschaeftlich / fahrtkosten': 'Fahrtkosten (Bahn / Auto / Benzin)', 'geschaeftlich / leasing': 'Leasing',
    'geschaeftlich / marketing': 'Marketing', 'geschaeftlich / mitarbeiter / gehaelter': 'Mitarbeiter / Gehälter', 'geschaeftlich / putzen': 'Putzkraft',
    'geschaeftlich / seminare': 'Weiterbildung / Seminare', 'geschaeftlich / weiterbildung': 'Weiterbildung / Seminare', 'geschaeftlich / software': 'Software (Adobe / frame.io / etc.)',
    'geschaeftlich / steuerberater': 'Steuerberater', 'geschaeftlich / unterkunft / hotel': 'Unterkunft / Hotel',
    'gesundheit / nahrungsergaenzungsmittel': 'Nahrungsergänzungsmittel',
    'lifestyle / bekleidung': 'Kleidung', 'lifestyle / friseur': 'Friseur', 'lifestyle / geschenke': 'Geburtstags- und Weihnachtsgeschenke',
    'lifestyle / mobilfunk': 'Handyvertrag/Prepaid', 'lifestyle / prime-mitgliedschaft': 'Spotify, Netflix und Co.', 'lifestyle / bildung': 'Weiterbildung / Seminare',
    'lifestyle / elektrohandel': 'Werkzeuge und Haushaltsgeräte',
    'mobilitaet / bus & bahn': 'Urlaub / Reisen (Bus- Zug-, Flugtickets)', 'mobilitaet / taxi': 'Urlaub / Reisen (Bus- Zug-, Flugtickets)',
    'sonstiges / bargeld': 'Umbuchung (zählt nicht)', 'sonstiges / kreditkartenabrechnung': 'Umbuchung (zählt nicht)', 'sonstiges / rueckzahlungskonto': 'Umbuchung (zählt nicht)',
    'sonstiges / allgemein': 'Allgemein',
    'versicherungen / kfz-versicherung': 'Auto (Benzinkosten, Vers. Etc.)',
    'wohnen / bauen / renovieren': 'Bauen und Renovieren', 'wohnen / baufinanzierung': 'Kredit + Hausgeld', 'wohnen / miete': 'Warmmiete', 'wohnen / gas': 'Warmmiete',
    'wohnen / strom': 'Warmmiete', 'wohnen / internet & telefon': 'Internet', 'wohnen / haushaltsgeraete': 'Werkzeuge und Haushaltsgeräte', 'wohnen / einrichtung': 'Werkzeuge und Haushaltsgeräte',
    'wohnen / sonstiges wohnen': 'Haus (Sonderzahlungen etc)', 'wohnen / rundfunkgebuehren': 'Allgemein',
  };
  const FG_MAIN = {
    'einnahmen': 'Geldgeschenke, sonstiges, Urlaubsgeld, Bonus', 'essen & trinken': 'Außer Haus essen / bestellen', 'finanzen': 'Andere Ausgaben',
    'freizeit': 'Spaß', 'geschaeftlich': 'Sonstiges', 'gesundheit': 'Gesundheit und Medikamente', 'drogerie': 'Gesundheit und Medikamente',
    'haustiere': 'Futter und Tierbedarf', 'kinder': 'Andere Ausgaben', 'lifestyle': 'Andere Ausgaben', 'mobilitaet': 'Auto (Benzinkosten, Vers. Etc.)',
    'sonstiges': 'Andere Ausgaben', 'sparen': 'Sparen & Anlegen', 'versicherungen': 'Versicherungen', 'wohnen': 'Haus (Sonderzahlungen etc)',
  };

  // „Gehalt vom Hauptjob“ sind wie in der Jahresübersicht die Zahlungseingänge auf dem Geschäftskonto.
  // Dasselbe Etikett auf Privatkonten ist das Geld, das vom Geschäftskonto herüberkommt: zählt nicht doppelt.
  const BUSINESS_ACCOUNT = /geschaeftskonto|geschäftskonto/i;
  // Hauskauf und Umbau laufen über den Kredit und gehören nicht zu den laufenden Ausgaben:
  // Auszahlungen vom Kreditkonto (außer Umbuchungen) und einzelne Bau-/Renovierungsrechnungen ab 5.000 €.
  const LOAN_ACCOUNT = /kreditkonto/i;
  const BIG_BUILD = -500000;

  // Feste Zuordnungen, die vor der Finanzguru-Kategorie gelten (Finanzguru liegt hier falsch); eigene Regeln haben Vorrang.
  const FIXED_RULES = [
    [/\bopenbank\b/, 'Leasing'], // Leasing-Finanzierung des Geschäftswagens, Finanzguru: „Mobilität / Auto“
  ];
  // Umsatzsteuer: Einnahmen auf dem Geschäftskonto sind brutto. Mit Dauerfristverlängerung wird die Umsatzsteuer eines
  // Monats erst am 10. des übernächsten Monats fällig, am Monatsende sind also der laufende und der Vormonat noch offen.
  const UST_RATE = 0.19;
  const UST_OPEN_MONTHS = 2;

  const userRules = () => S.fmeta.filter(m => m.type === 'rule' && m.match && m.cat);
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const haystack = t => norm(`${t.payee || ''} ${t.text || ''}`);

  /** Kategorie einer Buchung: von Hand gesetzt > eigene Regel > Umbuchung > Finanzguru-Kategorie > Grundregel */
  function categorize(t) {
    if (t.cat) return { cat: t.cat, how: 'hand' };
    const h = haystack(t);
    const r = userRules().find(r => h.includes(norm(r.match)));
    if (r) return { cat: r.cat, how: 'regel' };
    if (t.transfer) return { cat: 'Umbuchung (zählt nicht)', how: 'finanzguru' };
    const fixed = FIXED_RULES.find(([re]) => re.test(h));
    if (fixed) return { cat: fixed[1], how: 'auto' };
    const fg = norm(t.fgCat);
    if (fg) {
      let cat = FG_SUB[fg] || FG_MAIN[fg.split(' / ')[0]];
      if (cat === 'Gehalt vom Hauptjob' && !BUSINESS_ACCOUNT.test(t.account || '')) cat = 'Umbuchung (zählt nicht)';
      // Abbuchung vom Geschäftskonto, die Finanzguru als Lohn/Gehalt führt (z. B. SAMI Systems), ist eine Geschäftsausgabe
      if (cat === 'Gehalt vom Hauptjob' && t.amount < 0) cat = 'Sonstiges';
      if (t.amount < 0 && cat !== 'Umbuchung (zählt nicht)' && (LOAN_ACCOUNT.test(t.account || '') || (cat === 'Bauen und Renovieren' && t.amount <= BIG_BUILD))) cat = 'Immobilie (Kauf & Umbau)';
      // Gutschriften in einer Ausgaben-Kategorie (Erstattung, Rückgabe) zählen wie in der Jahresübersicht als Rückzahlung
      if (cat && t.amount > 0 && ['out', 'biz'].includes(catGroup(cat))) cat = 'Rückzahlungen';
      if (cat) return { cat, how: 'finanzguru' };
    }
    const b = BASE_RULES.find(([re]) => re.test(h));
    if (b) return { cat: b[1], how: 'auto' };
    return { cat: null, how: '' };
  }

  // ---------- Import ----------
  const toCents = v => {
    if (typeof v === 'number') return Math.round(v * 100);
    let t = String(v || '').replace(/[€\s]|EUR/gi, '');
    if (!t) return null;
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const toISO = v => {
    if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel-Datumszahl
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
      return d.toISOString().slice(0, 10);
    }
    if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    const t = String(v || '').trim();
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(t);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };
  function hash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    const delim = [';', ',', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(x => x.trim())) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some(x => String(x).trim())) rows.push(row);
    return rows;
  }

  let xlsxLib = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLib) xlsxLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_URL; s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { xlsxLib = null; reject(new Error('Excel-Dateien lassen sich nur mit Internet einlesen.')); };
      document.head.appendChild(s);
    });
    return xlsxLib;
  }

  // Spalten anhand der Überschriften erkennen (Finanzguru, Banken, PayPal …)
  const COLS = {
    date: /^(buchungstag|buchungs?datum|datum|date|valuta|wertstellung)$/i,
    amount: /^(betrag|betrag \(eur\)|betrag in eur|amount|umsatz|brutto)$/i,
    bal: /^(kontostand|saldo|balance)$/i,
    payee: /^(beguenstigter\/auftraggeber|begünstigter\/auftraggeber|empfänger|empfaenger|zahlungsempfänger|gegenpartei|name|beguenstigter\/zahlungspflichtiger|begünstigter\/zahlungspflichtiger|auftraggeber|händler)$/i,
    text: /^(verwendungszweck|beschreibung|buchungstext|description|zweck)$/i,
    account: /^(name referenzkonto|kontoname|konto|account|bankname)$/i,
    fgMain: /^(analyse-hauptkategorie|hauptkategorie|kategorie|category)$/i,
    fgSub: /^(analyse-unterkategorie|unterkategorie|subcategory)$/i,
    transfer: /^analyse-umbuchung$/i,
    split: /^split-typ$/i,
    id: /^buchungs-id$/i,
    note: /^notiz$/i,
    tags: /^tags$/i,
  };
  function rowsToFinance(rows, source) {
    const hi = rows.findIndex(r => r.some(c => COLS.date.test(String(c).trim())) && r.some(c => COLS.amount.test(String(c).trim())));
    if (hi < 0) throw new Error('In der Datei wurden keine Spalten für Datum und Betrag gefunden.');
    const head = rows[hi].map(c => String(c).trim());
    const col = {};
    for (const [k, re] of Object.entries(COLS)) { const i = head.findIndex(h => re.test(h)); if (i >= 0) col[k] = i; }
    const val = (r, k) => (col[k] === undefined ? '' : r[col[k]]);
    const seen = {};
    const list = [];
    let skipped = 0;
    for (const r of rows.slice(hi + 1)) {
      // Aufgeteilte Buchungen: das Original fällt weg, es zählen Teilbuchung und Restbetrag
      if (/^original$/i.test(String(val(r, 'split')).trim())) { skipped++; continue; }
      const date = toISO(val(r, 'date'));
      const amount = toCents(val(r, 'amount'));
      if (!date || amount === null) continue;
      const t = {
        date, amount,
        payee: String(val(r, 'payee') || '').trim(),
        text: String(val(r, 'text') || '').trim().slice(0, 300),
        account: String(val(r, 'account') || '').trim(),
        fgCat: [val(r, 'fgMain'), val(r, 'fgSub')].map(s => String(s || '').trim()).filter(Boolean).join(' / '),
        src: source,
      };
      if (/^ja$/i.test(String(val(r, 'transfer')).trim())) t.transfer = true;
      const bal = String(val(r, 'bal')).trim() === '' ? null : toCents(val(r, 'bal'));
      if (bal !== null) t.bal = bal;
      const note = String(val(r, 'note') || '').trim(), tags = String(val(r, 'tags') || '').trim();
      if (note) t.note = note;
      if (tags) t.tags = tags;
      const fid = String(val(r, 'id') || '').trim();
      if (fid) t.id = 'fg-' + fid;
      else {
        // Feste ID aus den Inhalten, damit erneutes Einlesen keine Doppelten erzeugt; gleiche Buchungen am selben Tag durchzählen
        const base = `${t.date}|${t.amount}|${norm(t.payee)}|${norm(t.text)}|${norm(t.account)}`;
        seen[base] = (seen[base] || 0) + 1;
        t.id = 'fi-' + hash(base) + (seen[base] > 1 ? '-' + seen[base] : '');
      }
      list.push(t);
    }
    if (!list.length) throw new Error('Die Datei enthält keine lesbaren Buchungen.');
    const dates = list.map(t => t.date).sort();
    // Schon vorhandene Buchungen bekommen beim erneuten Einlesen den Kontostand nachgetragen, sonst bleiben sie unverändert
    const have = new Map(S.finance.map(f => [f.id, f]));
    const withBal = list.filter(t => t.bal != null && have.has(t.id) && have.get(t.id).bal == null).map(t => ({ ...have.get(t.id), bal: t.bal }));
    if (withBal.length) S.saveFinance(withBal, true);
    return { added: S.saveFinance(list, false), total: list.length, skipped, from: dates[0], to: dates[dates.length - 1] };
  }
  async function importFile(file) {
    if (/\.xlsx?$/i.test(file.name)) {
      const X = await loadXLSX();
      const wb = X.read(await file.arrayBuffer(), { type: 'array' });
      const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      return rowsToFinance(rows, file.name);
    }
    return rowsToFinance(parseCSV(await file.text()), file.name);
  }

  // ---------- Diagramm: je Monat drei Balken (Einnahmen, Ausgaben privat, Ausgaben geschäftlich) ----------
  const SERIES = [['in', 'Einnahmen', 'fin-c-in'], ['out', 'Ausgaben privat', 'fin-c-out'], ['biz', 'Ausgaben geschäftlich', 'fin-c-biz']];
  function chart(rows) {
    const v = MONTHS.map(() => ({ in: 0, out: 0, biz: 0 }));
    for (const t of rows) if (t.g in v[0]) v[+t.date.slice(5, 7) - 1][t.g] += t.g === 'in' ? t.amount : -t.amount;
    const max = Math.max(1, ...v.flatMap(m => [m.in, m.out, m.biz]));
    // runde Skala: 1, 2 oder 5 × Zehnerpotenz
    const step = (() => { const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map(f => f * p).find(s => s >= raw); })();
    const top = Math.ceil(max / step) * step;
    const W = 760, H = 250, L = 48, B = 26, T = 10, plotH = H - B - T, gw = (W - L) / 12, bw = Math.min(16, (gw - 10) / 3);
    const y = c => T + plotH - (c / top) * plotH;
    const k = c => { const e = c / 100; return e >= 1000 ? `${(e / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : Math.round(e).toLocaleString('de-DE'); };
    let svg = '';
    for (let s = 0; s <= top; s += step) svg += `<line x1="${L}" x2="${W}" y1="${y(s)}" y2="${y(s)}" class="fin-grid"/><text x="${L - 6}" y="${y(s) + 4}" text-anchor="end" class="fin-ax">${k(s)}</text>`;
    v.forEach((m, i) => {
      const x0 = L + i * gw + (gw - bw * 3 - 4) / 2;
      const sel = ui.month === null || ui.month === i;
      svg += `<g class="fin-mon${sel ? '' : ' dim'}" data-fin="month" data-m="${i}"><rect x="${L + i * gw}" y="${T}" width="${gw}" height="${plotH}" class="fin-hit"/>`;
      SERIES.forEach(([g, label, cls], j) => {
        const val = Math.max(0, m[g]);
        svg += `<rect x="${x0 + j * (bw + 2)}" y="${y(val)}" width="${bw}" height="${Math.max(0, T + plotH - y(val))}" rx="3" class="${cls}"><title>${MONTHS_LONG[i]}: ${label} ${eur0(m[g])}</title></rect>`;
      });
      svg += `<text x="${L + i * gw + gw / 2}" y="${H - 8}" text-anchor="middle" class="fin-ax">${MONTHS[i]}</text></g>`;
    });
    return `<div class="fin-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Einnahmen und Ausgaben je Monat">${svg}</svg>
      <div class="fin-legend">${SERIES.map(([, label, cls]) => `<span><i class="${cls}"></i>${label}</span>`).join('')}</div></div>`;
  }

  // ---------- Vermögen ----------
  // Konten: letzter Kontostand je Konto aus den Buchungen (Finanzguru-Spalte „Kontostand“). Je Konto lassen sich ein
  // eigener Name und „nicht mitzählen“ festlegen: fmeta {type: 'acct', account, label, hidden}.
  // Sachwerte und Schulden ohne eigenes Konto (Haus, Wohnung, Autos, Depot, Kredite): von Hand gepflegt in fmeta
  // als {type: 'asset', name, date, amount}; es gilt je Name der letzte Wert bis zum Stichtag, negativ = Schuld.
  // Reihenfolge der Zeilen: fmeta 'wealth-order' mit Schlüsseln 'k:<Konto>' und 'a:<Name>'.
  const LOAN_ACC = /kreditkonto|darlehen/i;
  const TAX_ACC = /tagesgeld|steuer/i;
  const assetEntries = () => S.fmeta.filter(m => m.type === 'asset' && m.name && m.date);
  const acctMeta = () => { const m = {}; S.fmeta.filter(x => x.type === 'acct' && x.account).forEach(x => { m[x.account] = x; }); return m; };
  const acctLabel = (acc, meta) => (meta[acc] && meta[acc].label) || acc;
  const orderMeta = () => S.fmeta.find(x => x.id === 'wealth-order');
  const sortByOrder = keys => { const o = (orderMeta() || {}).order || []; const at = k => { const i = o.indexOf(k); return i < 0 ? 1e9 : i; }; return [...keys].sort((a, b) => at(a) - at(b)); };
  const monthEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Auf- und zugeklappte Gruppen der Vermögenstabelle merkt sich nur dieses Gerät
  const loadFold = () => { try { return JSON.parse(localStorage.getItem('fin-wealth-open')) || {}; } catch { return {}; } };
  const saveFold = v => { try { localStorage.setItem('fin-wealth-open', JSON.stringify(v)); } catch { /* egal */ } };
  let groupKeys = { k: [], w: [] }; // zuletzt angezeigte Reihenfolge, fürs Verschieben

  function balanceIndex(tx) {
    const byAcc = {};
    for (const t of tx) if (t.bal != null && t.account) (byAcc[t.account] = byAcc[t.account] || []).push(t);
    for (const list of Object.values(byAcc)) list.sort((a, b) => a.date.localeCompare(b.date));
    return byAcc;
  }
  /** Kontostände je Konto zum Stichtag. Bei mehreren Buchungen am letzten Tag zählt die, auf die keine andere aufbaut. */
  function balancesAt(index, iso) {
    const out = {};
    for (const [acc, list] of Object.entries(index)) {
      let hi = -1;
      for (let i = 0; i < list.length && list[i].date <= iso; i++) hi = i;
      if (hi < 0) continue;
      const day = list.filter(t => t.date === list[hi].date);
      const before = new Set(day.map(t => t.bal - t.amount));
      const end = day.find(t => !before.has(t.bal)) || day[day.length - 1];
      out[acc] = { bal: end.bal, date: end.date };
    }
    return out;
  }
  function assetsAt(iso) {
    const latest = {};
    for (const a of assetEntries()) {
      if (a.date > iso) continue;
      const o = latest[a.name];
      if (!o || a.date > o.date || (a.date === o.date && (a.updatedAt || 0) > (o.updatedAt || 0))) latest[a.name] = a;
    }
    return latest;
  }
  function worthAt(index, iso, meta) {
    const acc = balancesAt(index, iso);
    for (const name of Object.keys(acc)) if (meta[name] && meta[name].hidden) delete acc[name];
    const assets = assetsAt(iso);
    let liquid = 0, tax = 0, loans = 0, goods = 0, debts = 0;
    for (const [name, a] of Object.entries(acc)) {
      if (LOAN_ACC.test(name)) loans += a.bal;
      else { liquid += a.bal; if (TAX_ACC.test(name)) tax += a.bal; }
    }
    for (const a of Object.values(assets)) { if (a.amount >= 0) goods += a.amount; else debts += a.amount; }
    return { acc, assets, liquid, tax, goods, debts: debts + loans, total: liquid + goods + debts + loans };
  }
  // Beträge wie „650.000“, „-96.000,50“ oder „38000“
  const parseEuro = v => {
    let t = String(v || '').replace(/[€\s]|EUR/gi, '');
    if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };

  function wealthView(tx) {
    const index = balanceIndex(tx);
    const meta = acctMeta();
    if (!Object.keys(index).length && !assetEntries().length) {
      return `<h2 class="ct-h">Vermögen</h2><section class="set"><p class="hint">Für das Vermögen braucht es Kontostände: den Finanzguru-Export noch einmal über „Datei einlesen“ laden (die Spalte „Kontostand“ wird jetzt mit übernommen). Haus, Wohnung, Autos, Depot und Kredite ohne eigenes Konto trägst du unten von Hand ein.</p></section>${assetForm(index, meta)}`;
    }
    const y = +ui.year;
    const today = todayISO();
    const stich = ui.month !== null ? monthEnd(y, ui.month) : (String(y) === today.slice(0, 4) ? today : monthEnd(y, 11));
    const stichShown = stich > today ? today : stich;
    const w = worthAt(index, stichShown, meta);
    // Monatsenden des Jahres bis heute, wie die Numbers-Übersicht
    const months = MONTHS.map((_, i) => monthEnd(y, i)).map(d => (d > today ? (d.slice(0, 7) === today.slice(0, 7) ? today : null) : d));
    const cols = months.map(d => (d ? worthAt(index, d, meta) : null));
    const prev = worthAt(index, monthEnd(y - 1, 11), meta);
    const accNames = [...new Set(cols.filter(Boolean).flatMap(c => Object.keys(c.acc)))].filter(n => cols.some(c => c && c.acc[n] && c.acc[n].bal));
    const assetNames = [...new Set(cols.filter(Boolean).flatMap(c => Object.keys(c.assets)))].filter(n => cols.some(c => c && c.assets[n] && c.assets[n].amount));
    const kKeys = sortByOrder(accNames.filter(n => !LOAN_ACC.test(n)).sort((a, b) => acctLabel(a, meta).localeCompare(acctLabel(b, meta))).map(n => 'k:' + n));
    const wKeys = sortByOrder([...assetNames.map(n => 'a:' + n), ...accNames.filter(n => LOAN_ACC.test(n)).map(n => 'k:' + n)]);
    const fold = loadFold();
    const cell = (v, i) => `<td class="${ui.month === i ? 'sel' : ''}">${v ? eur0(v) : ''}</td>`;
    const row = (label, vals, cls, title) => `<tr class="${cls || ''}"><th${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</th>${vals.map(cell).join('')}</tr>`;
    const stale = name => { const a = w.acc[name]; return a && a.date < stichShown.slice(0, 8) + '01' ? `Letzter Kontostand ${new Date(a.date).toLocaleDateString('de-DE')}` : ''; };
    const valOf = (c, key) => { if (!c) return 0; const n = key.slice(2); return key[0] === 'k' ? (c.acc[n] ? c.acc[n].bal : 0) : (c.assets[n] ? c.assets[n].amount : 0); };
    const keyRow = key => row(key[0] === 'k' ? acctLabel(key.slice(2), meta) : key.slice(2), cols.map(c => valOf(c, key)), '', key[0] === 'k' ? [key.slice(2) !== acctLabel(key.slice(2), meta) ? key.slice(2) : '', stale(key.slice(2))].filter(Boolean).join(' · ') : '');
    const head = (g, label, n) => `<tr class="grp fin-fold${fold[g] ? ' open' : ''}" data-fin="fold" data-g="${g}"><th colspan="13">${ms('expand_more')}${label} <small>${n} ${fold[g] ? '' : '· zum Aufklappen tippen'}</small></th></tr>`;
    const totals = cols.map(c => (c ? c.total : 0));
    const diffs = cols.map((c, i) => (c ? c.total - (i === 0 ? prev.total : (cols[i - 1] || prev).total) : 0));
    const table = [
      head('k', 'Konten', kKeys.length),
      ...(fold.k ? kKeys.map(keyRow) : []),
      row('Konten gesamt', cols.map(c => (c ? c.liquid : 0)), 'tot'),
      wKeys.length ? head('w', 'Sachwerte und Schulden', wKeys.length) : '',
      ...(fold.w ? wKeys.map(keyRow) : []),
      wKeys.length ? row('Sachwerte und Schulden gesamt', cols.map(c => (c ? c.total - c.liquid : 0)), 'tot') : '',
      row('Netto-Vermögen', totals, 'tot'),
      `<tr class="tot"><th>Veränderung zum Vormonat</th>${diffs.map((v, i) => `<td class="${ui.month === i ? 'sel' : ''} ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${cols[i] && v ? (v > 0 ? '+' : '') + eur0(v) : ''}</td>`).join('')}</tr>`,
    ].join('');
    return `<h2 class="ct-h">Vermögen · Stand ${new Date(stichShown).toLocaleDateString('de-DE')}</h2>
      <section class="fin-kpis">
        <div><span>Konten</span><b>${eur0(w.liquid)}</b><small>davon Steuerkonto ${eur0(w.tax)}</small></div>
        <div><span>Frei verfügbar</span><b>${eur0(w.liquid - w.tax)}</b><small>Konten ohne Steuerkonto</small></div>
        <div><span>Sachwerte</span><b>${eur0(w.goods)}</b><small>Immobilien, Autos, Depot</small></div>
        <div><span>Schulden</span><b class="bad">${eur0(w.debts)}</b><small>Kredite und Finanzierungen</small></div>
        <div><span>Netto-Vermögen</span><b class="${w.total >= 0 ? 'ok' : 'bad'}">${eur0(w.total)}</b><small>${prev.total ? `seit Jahresbeginn ${w.total - prev.total >= 0 ? '+' : ''}${eur0(w.total - prev.total)}` : ''}</small></div>
      </section>
      <div class="ct-table fin-table"><table><thead><tr><th></th>${MONTHS.map((m, i) => `<th class="${ui.month === i ? 'sel' : ''}">${m}</th>`).join('')}</tr></thead><tbody>${table}</tbody></table></div>
      ${assetForm(index, meta)}`;
  }

  // ---------- Vorschau ----------
  // Kontostand in den nächsten Monaten: Konten heute (wie „Konten gesamt“ im Vermögen) + Ø je Monat aus den letzten
  // vollen Monaten mit Daten (Einnahmen, Ausgaben privat und geschäftlich, wahlweise Sparen) + eigene geplante Posten.
  // Immobilie (über Kredit) und Umbuchungen zählen nicht. Geplante Posten: fmeta {type: 'plan', name, amount, date, every}.
  const EVERY = { once: ['einmalig', 0], month: ['monatlich', 1], quarter: ['vierteljährlich', 3], year: ['jährlich', 12] };
  const planEntries = () => S.fmeta.filter(m => m.type === 'plan' && m.name && m.date);
  const FC_DEFAULT = { h: 6, b: 6, save: true, mode: 'list', tax: 30 };
  const loadFc = () => { try { return { ...FC_DEFAULT, ...JSON.parse(localStorage.getItem('fin-forecast')) }; } catch { return { ...FC_DEFAULT }; } };
  const saveFc = v => { try { localStorage.setItem('fin-forecast', JSON.stringify(v)); } catch { /* egal */ } };
  const addMonthsKey = (key, n) => { const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const monthLabel = key => `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(2, 4)}`;

  /** Termine eines geplanten Postens im Monat `key` (nur ab heute) */
  function planHits(p, key, today) {
    const every = EVERY[p.every] ? EVERY[p.every][1] : 0;
    const start = p.date.slice(0, 7);
    if (key < start) return 0;
    const diff = (+key.slice(0, 4) - +start.slice(0, 4)) * 12 + (+key.slice(5, 7) - +start.slice(5, 7));
    if (every === 0 ? diff !== 0 : diff % every !== 0) return 0;
    const day = `${key}-${p.date.slice(8, 10)}`;
    return day >= today ? 1 : 0;
  }

  // Standard-Ausgaben: fmeta {type: 'budget', name, amount (Cent, positiv), g: out|biz|save, every: month|quarter|year, date}.
  // Vierteljährliche und jährliche Posten fallen im Monat ihres Datums an (und dann alle 3 bzw. 12 Monate).
  // g 'in' = feste Einnahme ohne Rechnung (z. B. Mieteinnahmen), mindert, was du verdienen musst
  const BUDGET_G = [['out', 'privat'], ['biz', 'geschäftlich'], ['save', 'Sparen & Anlegen'], ['in', 'feste Einnahmen (z. B. Miete)']];
  const REVENUE_CAT = 'Gehalt vom Hauptjob'; // Umsatz aus dem eigenen Geschäft
  const budgetEntries = () => S.fmeta.filter(m => m.type === 'budget' && m.name);
  const perMonth = b => b.amount / ((EVERY[b.every] || EVERY.month)[1] || 1);

  // ---------- Steuern ----------
  // Einkommensteuer nach Tarif 2026 (§ 32a EStG), Soli, Kirchensteuer (Bayern 8 %) und Gewerbesteuer mit Anrechnung (§ 35 EStG).
  // Einzelunternehmer: zu versteuerndes Einkommen = Gewinn + Mieteinkünfte − Abzüge (Vorsorge usw.), Gewerbeertrag = Gewinn.
  // Mieteinkünfte: eigener Wert, sonst die festen Einnahmen der Liste × 12 (bzw. „Vermietung“ der letzten 12 Monate).
  // Einstellungen synchronisiert in fmeta {id: 'tax-settings'}; Beträge in Cent pro Jahr.
  // Standard: ledig, ohne Kirchensteuer, Hebesatz Mering 360 % (wie im CRM), private Krankenversicherung 299,16 € im Monat.
  const TAX_DEFAULT = { auto: true, splitting: false, hebesatz: 360, kirche: false, mietgewinn: null, abzuege: 29916 * 12 };
  const taxSettings = () => ({ ...TAX_DEFAULT, ...(S.fmeta.find(m => m.id === 'tax-settings') || {}) });
  function estTarif(x) { // Euro, ganzzahlig abgerundet
    x = Math.floor(Math.max(0, x));
    if (x <= 12348) return 0;
    if (x <= 17799) { const y = (x - 12348) / 10000; return Math.floor((914.51 * y + 1400) * y); }
    if (x <= 69878) { const z = (x - 17799) / 10000; return Math.floor((173.10 * z + 2397) * z + 1034.87); }
    if (x <= 277825) return Math.floor(0.42 * x - 11135.63);
    return Math.floor(0.45 * x - 19470.38);
  }
  /** Steuern für einen Jahresgewinn (Cent) */
  function taxesFor(profitYear, ts) {
    const profit = Math.max(0, profitYear / 100);
    const zve = Math.max(0, profit + (ts.mietgewinn || 0) / 100 - (ts.abzuege || 0) / 100);
    const est0 = ts.splitting ? 2 * estTarif(zve / 2) : estTarif(zve);
    const ertrag = Math.max(0, Math.floor(profit / 100) * 100 - 24500);
    const mess = ertrag * 0.035;
    const gewst = mess * (ts.hebesatz || 0) / 100;
    const anr = Math.min(4 * mess, gewst, est0);
    const est = est0 - anr;
    const frei = ts.splitting ? 40700 : 20350; // Soli-Freigrenze 2026
    const soli = est <= frei ? 0 : Math.min(est * 0.055, (est - frei) * 0.119);
    const kist = ts.kirche ? est0 * 0.08 : 0;
    const total = est + soli + kist + gewst;
    return { profit: profit * 100, zve: zve * 100, est: est * 100, soli: soli * 100, kist: kist * 100, gewst: gewst * 100, anr: anr * 100, total: total * 100, rate: zve > 0 ? total / zve : 0 };
  }
  /** Gewinn der letzten 12 vollen Monate: Umsatz ohne USt − geschäftliche Ausgaben (ohne Steuerzahlungen) */
  function profitLast12(counted) {
    const cur = todayISO().slice(0, 7);
    const months = [...new Set(counted.map(t => t.date.slice(0, 7)))].filter(k => k < cur).sort().reverse().slice(0, 12);
    const inM = t => months.includes(t.date.slice(0, 7));
    const revenue = counted.filter(t => inM(t) && t.cat === REVENUE_CAT).reduce((s, t) => s + t.amount, 0) / (1 + UST_RATE);
    const costs = -counted.filter(t => inM(t) && t.g === 'biz' && t.cat !== 'Steuer').reduce((s, t) => s + t.amount, 0);
    const scale = months.length ? 12 / months.length : 0; // weniger als 12 Monate: hochgerechnet
    const rent = counted.filter(t => inM(t) && t.cat === 'Vermietung').reduce((s, t) => s + t.amount, 0) * scale;
    return { months, revenue: revenue * scale, costs: costs * scale, profit: (revenue - costs) * scale, rent };
  }

  /** Was im Monat nötig ist, damit die Standard-Ausgaben gedeckt sind (Steuern nur auf den Gewinn) */
  function needed(budgets, taxRate, withSave, ts) {
    const sum = g => budgets.filter(b => b.g === g).reduce((s, b) => s + perMonth(b), 0);
    const inc = sum('in');
    const priv = Math.max(0, sum('out') + (withSave ? sum('save') : 0) - inc), biz = sum('biz');
    let profit, taxes = null;
    if (ts && ts.auto) {
      // Gewinn P je Monat, bei dem nach allen Steuern genug übrig bleibt: P − Steuern(12 P) / 12 = privat
      let lo = 0, hi = priv * 4 + 1e7;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (mid - taxesFor(mid * 12, ts).total / 12 < priv) lo = mid; else hi = mid; }
      profit = hi;
      taxes = taxesFor(profit * 12, ts);
    } else profit = priv / (1 - taxRate); // fester Satz
    const netto = profit + biz;
    return { priv, biz, inc, out: sum('out'), save: withSave ? sum('save') : 0, total: sum('out') + biz + (withSave ? sum('save') : 0), profit, tax: profit - priv, taxes, netto, brutto: netto * (1 + UST_RATE) };
  }

  /** „Warmmiete 1.250“, „Adobe 65 geschäftlich“, „KFZ-Versicherung 480 jährlich“, „Depot 500 sparen“ */
  function parseBudgetLines(text) {
    const out = [];
    for (const raw of String(text || '').split(/\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const nums = line.match(/-?\d[\d.]*(,\d+)?/g);
      if (!nums) continue;
      const amount = parseEuro(nums[nums.length - 1]);
      if (!amount) continue;
      const low = line.toLowerCase();
      // Minus = Einnahme (z. B. „Miete Mering -1.830“)
      const g = amount < 0 || /einnahme/.test(low) ? 'in' : /geschäft|geschaeft|business|firma/.test(low) ? 'biz' : /spar|depot|anlegen|etf|rücklage|ruecklage/.test(low) ? 'save' : 'out';
      const every = /viertel|quartal/.test(low) ? 'quarter' : /jähr|jaehr|jahr/.test(low) ? 'year' : 'month';
      const name = line.replace(nums[nums.length - 1], ' ')
        .replace(/\b(geschäftlich|geschaeftlich|business|firma|privat|sparen|einnahme|monatlich|vierteljährlich|quartalsweise|jährlich|jaehrlich|pro monat|im monat|im jahr|pro jahr)\b/gi, ' ')
        .replace(/€|(^|\s)eur\b/gi, ' ').replace(/[;:|\t]+/g, ' ').replace(/\s+[-–]\s*$/, '').replace(/\s+/g, ' ').trim();
      if (name) out.push({ name, amount: Math.abs(amount), g, every });
    }
    return out;
  }

  function forecast(counted, index, meta, fc) {
    const today = todayISO();
    const cur = today.slice(0, 7);
    const w = worthAt(index, today, meta);
    const stand = Object.values(w.acc).map(a => a.date).sort()[0] || null;
    // Grundlage: die letzten fc.b vollen Monate mit Daten vor dem laufenden Monat
    const basis = [...new Set(counted.map(t => t.date.slice(0, 7)))].filter(k => k < cur).sort().reverse().slice(0, fc.b).sort();
    const n = Math.max(1, basis.length);
    const avg = { in: 0, out: 0, biz: 0, save: 0 };
    const byCat = {};
    for (const t of counted) {
      if (!basis.includes(t.date.slice(0, 7)) || !(t.g in avg)) continue;
      avg[t.g] += t.amount / n;
      byCat[t.cat] = (byCat[t.cat] || 0) + t.amount / n;
    }
    if (!fc.save) avg.save = 0;
    const budgets = budgetEntries();
    const useList = fc.mode !== 'avg' && budgets.length > 0;
    const ust = Math.max(0, (byCat['Gehalt vom Hauptjob'] || 0) * UST_RATE / (1 + UST_RATE));
    // laufender Monat nur noch anteilig (Rest des Monats)
    const dim = new Date(+cur.slice(0, 4), +cur.slice(5, 7), 0).getDate();
    const rest = (dim - +today.slice(8, 10)) / dim;
    const plans = planEntries();
    let bal = w.liquid;
    const rows = [];
    for (let i = 0; i <= fc.h; i++) {
      const key = addMonthsKey(cur, i);
      const f = i === 0 ? rest : 1;
      const items = plans.filter(p => planHits(p, key, today)).map(p => ({ name: p.name, amount: p.amount }));
      const planned = items.reduce((s, p) => s + p.amount, 0);
      let out = (avg.out + avg.biz) * f, save = avg.save * f;
      if (useList) {
        // monatliche Posten anteilig, seltenere im Monat ihres Datums
        const hit = b => (b.every === 'month' || !b.date ? f : planHits(b, key, today));
        // Umsatzsteuer in den Geschäftseinnahmen geht weiter ans Finanzamt, auch wenn sie nicht in der Liste steht
        out = -budgets.filter(b => b.g === 'out' || b.g === 'biz').reduce((s, b) => s + b.amount * hit(b), 0) - ust * f;
        save = fc.save ? -budgets.filter(b => b.g === 'save').reduce((s, b) => s + b.amount * hit(b), 0) : 0;
      }
      // mit Liste: Umsatz aus dem Ø, feste Einnahmen (Miete) aus der Liste statt aus dem Ø
      const inc = useList ? (byCat[REVENUE_CAT] || 0) * f + budgets.filter(b => b.g === 'in').reduce((s, b) => s + b.amount * (b.every === 'month' || !b.date ? f : planHits(b, key, today)), 0) : avg.in * f;
      const r = { key, in: inc, out, save, planned, items };
      bal += r.in + r.out + r.save + planned;
      rows.push({ ...r, end: Math.round(bal) });
    }
    const full = rows.slice(1);
    const net = full.length ? full.reduce((s, r) => s + r.in + r.out + r.save, 0) / full.length : 0;
    return { start: w.liquid, tax: w.tax, stand, basis, avg, net, byCat, rows, useList, budgets, ust, revenue: byCat[REVENUE_CAT] || 0 };
  }

  function forecastChart(f) {
    const vals = [f.start, ...f.rows.map(r => r.end)];
    const labels = ['heute', ...f.rows.map(r => monthLabel(r.key))];
    const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
    const step = (() => { const raw = (hi - lo) / 4 || 1; const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map(x => x * p).find(s => s >= raw); })();
    const top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
    const W = 760, H = 230, L = 52, B = 26, T = 12, R = 16, plotH = H - B - T;
    const x = i => L + (i * (W - L - R)) / Math.max(1, vals.length - 1);
    const y = c => T + plotH - ((c - bot) / (top - bot)) * plotH;
    const k = c => { const e = c / 100; return Math.abs(e) >= 1000 ? `${(e / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : Math.round(e).toLocaleString('de-DE'); };
    let svg = '';
    for (let s = bot; s <= top; s += step) svg += `<line x1="${L}" x2="${W - R}" y1="${y(s)}" y2="${y(s)}" class="fin-grid${s === 0 ? ' fin-zero' : ''}"/><text x="${L - 6}" y="${y(s) + 4}" text-anchor="end" class="fin-ax">${k(s)}</text>`;
    svg += `<polyline points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" class="fin-fc-line"/>`;
    vals.forEach((v, i) => {
      svg += `<circle cx="${x(i)}" cy="${y(v)}" r="4" class="fin-fc-dot${v < 0 ? ' neg' : ''}"><title>${labels[i]}: ${eur0(v)}</title></circle>`;
      svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="fin-ax">${labels[i]}</text>`;
    });
    return `<div class="fin-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Erwarteter Kontostand je Monatsende">${svg}</svg></div>`;
  }

  const useOptions = cur => `<option value=""${cur === '' ? ' selected' : ''}>Abgleich automatisch</option><option value="fix"${cur === 'fix' ? ' selected' : ''}>eine Abbuchung</option><option value="var"${cur === 'var' ? ' selected' : ''}>Verbrauch (Beträge eintragen)</option>
    <optgroup label="Verbrauch aus Kategorie">${CATS.filter(c => c.g === 'out' || c.g === 'biz').map(c => `<option value="${esc(c.name)}"${cur === c.name ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;

  function forecastView(counted, index, meta) {
    const fc = loadFc();
    if (!Object.keys(index).length) return `<h2 class="ct-h">Vorschau</h2><section class="set"><p class="hint">Für die Vorschau braucht es Kontostände: den Finanzguru-Export über „Datei einlesen“ laden.</p></section>`;
    const f = forecast(counted, index, meta, fc);
    const last = f.rows[f.rows.length - 1];
    const low = f.rows.reduce((m, r) => (r.end < m.end ? r : m), f.rows[0]);
    const old = f.stand && (Date.now() - new Date(f.stand).getTime()) / 86400000 > 7;
    const chips = (k, opts, label) => `<div class="chips"><span class="fin-chip-label">${label}</span>${opts.map(v => `<button class="chip" aria-pressed="${fc[k] === v}" data-fin="fc" data-k="${k}" data-v="${v}">${v} Monate</button>`).join('')}</div>`;
    const sign = v => `${v > 0 ? '+' : ''}${eur0(v)}`;
    const td = v => `<td class="${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${Math.round(v) ? sign(v) : ''}</td>`;
    const table = `<div class="ct-table fin-table"><table><thead><tr><th></th>${f.rows.map(r => `<th>${monthLabel(r.key)}${r.key === f.rows[0].key ? '<small>Rest</small>' : ''}</th>`).join('')}</tr></thead><tbody>
      <tr><th>Einnahmen</th>${f.rows.map(r => td(r.in)).join('')}</tr>
      <tr><th>Ausgaben (privat + geschäftlich)</th>${f.rows.map(r => td(r.out)).join('')}</tr>
      ${fc.save ? `<tr><th>Sparen & Anlegen</th>${f.rows.map(r => td(r.save)).join('')}</tr>` : ''}
      <tr><th>Geplante Posten</th>${f.rows.map(r => `<td class="${r.planned < 0 ? 'neg' : r.planned > 0 ? 'pos' : ''}"${r.items.length ? ` title="${esc(r.items.map(p => `${p.name}: ${eur0(p.amount)}`).join('\n'))}"` : ''}>${r.planned ? sign(r.planned) : ''}</td>`).join('')}</tr>
      <tr class="tot"><th>Konten am Monatsende</th>${f.rows.map(r => `<td class="${r.end < 0 ? 'neg' : ''}">${eur0(r.end)}</td>`).join('')}</tr>
    </tbody></table></div>`;
    const top = Object.entries(f.byCat).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, 5);
    const plans = planEntries().sort((a, b) => a.date.localeCompare(b.date));
    const p12 = profitLast12(counted);
    const ts0 = taxSettings();
    const listRent = f.budgets.filter(b => b.g === 'in').reduce((s, b) => s + perMonth(b), 0) * 12;
    const rentAuto = listRent || p12.rent;
    const ts = { ...ts0, mietgewinn: ts0.mietgewinn == null ? rentAuto : ts0.mietgewinn };
    const need = needed(f.budgets, fc.tax / 100, fc.save, ts);
    const t12 = taxesFor(p12.profit, ts);
    const pct = v => `${(v * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
    const taxDetail = t => [`ESt ${eur0(t.est / 12)}`, t.gewst ? `GewSt ${eur0(t.gewst / 12)}` : '', t.soli ? `Soli ${eur0(t.soli / 12)}` : '', t.kist ? `KiSt ${eur0(t.kist / 12)}` : ''].filter(Boolean).join(' · ');
    const gap = f.revenue - need.brutto;
    const modeChips = `<div class="chips"><span class="fin-chip-label">Ausgaben aus</span><button class="chip" aria-pressed="${f.useList}" data-fin="fc-mode" data-v="list">meiner Liste${f.budgets.length ? '' : ' (leer)'}</button><button class="chip" aria-pressed="${!f.useList}" data-fin="fc-mode" data-v="avg">Durchschnitt</button></div>`;
    const earn = f.budgets.length ? `<h2 class="ct-h">Was du im Monat verdienen musst</h2>
      <section class="fin-kpis">
        <div><span>Ausgaben laut Liste</span><b>${eur0(need.total)}</b><small>privat ${eur0(need.out)}${need.save ? ` · Sparen ${eur0(need.save)}` : ''} · geschäftlich ${eur0(need.biz)}${need.inc ? ` · feste Einnahmen −${eur0(need.inc)}` : ''}</small></div>
        <div><span>Steuern</span><b>${eur0(need.tax)}</b><small>${need.taxes ? `${taxDetail(need.taxes)} · Ø ${pct(need.taxes.rate)}` : `<label>Satz <input type="number" min="0" max="60" step="1" value="${fc.tax}" data-fin="fc-tax" class="fin-tax" aria-label="Steuersatz in Prozent"> % auf den Gewinn</label>`}</small></div>
        <div><span>Nötiger Umsatz netto</span><b>${eur0(need.netto)}</b><small>Gewinn ${eur0(need.profit)} + geschäftliche Ausgaben</small></div>
        <div><span>Als Rechnungsbetrag</span><b>${eur0(need.brutto)}</b><small>inkl. ${Math.round(UST_RATE * 100)} % Umsatzsteuer</small></div>
        <div><span>Ø Umsatz zuletzt</span><b class="${gap >= 0 ? 'ok' : 'bad'}">${eur0(f.revenue)}</b><small>${gap >= 0 ? `${eur0(gap)} über dem Nötigen` : `${eur0(-gap)} fehlen im Monat`}</small></div>
      </section>
      <p class="hint">Vierteljährliche und jährliche Posten sind auf den Monat umgerechnet. Feste Einnahmen wie Miete decken einen Teil der privaten Ausgaben, der Rest muss als Gewinn aus dem Geschäft kommen. ${need.taxes ? `Steuern nach Tarif 2026 auf diesen Gewinn${ts.mietgewinn ? ' plus Mieteinkünfte' : ''}${ts.abzuege ? ' minus Abzüge' : ''}, Gewerbesteuer mit Hebesatz ${ts.hebesatz} % und Anrechnung auf die Einkommensteuer.` : 'Die Steuer rechnet mit dem festen Satz auf den Gewinn (Umsatz minus geschäftliche Ausgaben).'} Sparen zählt ${fc.save ? 'mit' : 'nicht mit'}.</p>
      <h2 class="ct-h">Steuern aus deinen Zahlen</h2>
      <section class="fin-kpis">
        <div><span>Gewinn letzte 12 Monate</span><b>${eur0(p12.profit)}</b><small>Umsatz ohne USt ${eur0(p12.revenue)} − Ausgaben ${eur0(p12.costs)}${p12.months.length && p12.months.length < 12 ? ` · aus ${p12.months.length} Monaten hochgerechnet` : ''}</small></div>
        <div><span>Zu versteuern</span><b>${eur0(t12.zve)}</b><small>Gewinn + Mieteinkünfte ${eur0(ts.mietgewinn)} − Abzüge ${eur0(ts.abzuege)}</small></div>
        <div><span>Einkommensteuer</span><b>${eur0(t12.est + t12.soli + t12.kist)}</b><small>im Jahr${t12.soli ? ` · inkl. Soli ${eur0(t12.soli)}` : ''}${t12.kist ? ` · KiSt ${eur0(t12.kist)}` : ''}${t12.anr ? ` · nach Anrechnung GewSt ${eur0(t12.anr)}` : ''}</small></div>
        <div><span>Gewerbesteuer</span><b>${eur0(t12.gewst)}</b><small>im Jahr · Hebesatz ${ts.hebesatz} %, Freibetrag 24.500 €</small></div>
        <div><span>Steuern gesamt</span><b>${eur0(t12.total)}</b><small>Ø ${pct(t12.rate)} vom zu versteuernden Einkommen</small></div>
        <div><span>Rücklage pro Monat</span><b>${eur0(t12.total / 12)}</b><small>dazu Umsatzsteuer, die du ohnehin abführst</small></div>
      </section>
      <details class="set fin-assets"${ui.taxOpen ? ' open' : ''}><summary data-fin="tax-toggle">Steuer-Einstellungen</summary>
        <p class="hint">Grobe Schätzung, ersetzt nicht den Steuerberater: Der Gewinn kommt aus deinen Buchungen (Umsatz aus „${REVENUE_CAT}“ ohne Umsatzsteuer, minus geschäftliche Ausgaben ohne Steuerzahlungen). Als Einzelunternehmer zählen alle Einkünfte zusammen: Ohne eigenen Wert rechnet Daily die Mieten voll (${eur0(rentAuto)} im Jahr); Zinsen und Abschreibung senken sie, den genauen Wert hat die Anlage V der letzten Steuererklärung. Abzüge wie die private Krankenversicherung senken das zu versteuernde Einkommen.</p>
        <div class="fin-taxset">
          <label class="fin-count"><input type="checkbox" data-t="auto" ${ts.auto ? 'checked' : ''}> automatisch nach Tarif rechnen (sonst fester Satz ${fc.tax} %)</label>
          <label class="fin-count"><input type="checkbox" data-t="splitting" ${ts.splitting ? 'checked' : ''}> verheiratet, Zusammenveranlagung (Splitting)</label>
          <label class="fin-count"><input type="checkbox" data-t="kirche" ${ts.kirche ? 'checked' : ''}> Kirchensteuer (8 %)</label>
          <label>Hebesatz Gewerbesteuer <input type="number" min="0" max="900" step="5" value="${ts.hebesatz}" data-t="hebesatz" class="fin-tax"> %</label>
          <label>Mieteinkünfte pro Jahr <input type="text" inputmode="decimal" value="${ts0.mietgewinn == null ? '' : (ts0.mietgewinn / 100).toLocaleString('de-DE')}" placeholder="${(rentAuto / 100).toLocaleString('de-DE', { maximumFractionDigits: 0 })} (Mieten voll)" data-t="mietgewinn" class="fin-tax wide"> €</label>
          <label>Abzüge pro Jahr <input type="text" inputmode="decimal" value="${ts.abzuege ? (ts.abzuege / 100).toLocaleString('de-DE') : ''}" placeholder="0" data-t="abzuege" class="fin-tax wide"> €</label>
          <button class="btn small" data-fin="tax-save">Speichern</button>
        </div>
      </details>` : '';
    const bRow = b => `<div class="fin-asset" data-id="${esc(b.id)}">
        <input type="text" data-k="name" value="${esc(b.name)}" aria-label="Name">
        <input type="text" inputmode="decimal" data-k="amount" value="${(b.amount / 100).toLocaleString('de-DE')}" aria-label="Betrag für ${esc(b.name)}">
        <select data-k="g" aria-label="Art">${BUDGET_G.map(([g, l]) => `<option value="${g}"${b.g === g ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <select data-k="every" aria-label="Rhythmus">${['month', 'quarter', 'year'].map(k => `<option value="${k}"${(b.every || 'month') === k ? ' selected' : ''}>${EVERY[k][0]}</option>`).join('')}</select>
        <input type="date" data-k="date" value="${esc(b.date || '')}" aria-label="Nächste Fälligkeit" title="Bei vierteljährlich und jährlich: wann fällig">
        <select data-k="use" aria-label="Abbuchung" title="Wie der Posten im aktuellen Monat abgeglichen wird">${useOptions(b.use || '')}</select>
        <input type="text" data-k="match" value="${esc(b.match || '')}" placeholder="Suchwort für Abgleich" aria-label="Suchwort für den Abgleich mit den Buchungen" title="Teil des Empfängers in den Buchungen, z. B. „Santander“">
        <span class="fin-acts"><button class="btn small" data-fin="budget-save">Speichern</button>
        <button class="icon-btn" data-fin="budget-split" data-id="${esc(b.id)}" aria-label="${esc(b.name)} aufteilen" title="In zwei Posten aufteilen, z. B. Finanzierung und Versicherung">${ms('call_split')}</button>
        <button class="icon-btn" data-fin="budget-del" data-id="${esc(b.id)}" aria-label="${esc(b.name)} löschen">${ms('delete')}</button></span></div>`;
    const budgetForm = `<details class="set fin-assets"${ui.budgetOpen ? ' open' : ''}><summary data-fin="budget-toggle">Standard-Ausgaben pro Monat (${f.budgets.length}${f.budgets.length ? ` · ${eur0(f.budgets.reduce((t, b) => t + (b.g === 'in' ? -1 : 1) * perMonth(b), 0))} im Monat nach festen Einnahmen` : ''})</summary>
        <p class="hint">Deine feste Monatsliste: Miete, Versicherungen, Lebensmittel, Software usw. Beträge ohne Minus; feste Einnahmen wie Mieteinnahmen mit der Art „feste Einnahmen“. Bei vierteljährlich und jährlich das Datum der nächsten Zahlung eintragen. Einkommensteuer-Vorauszahlungen als vierteljährlichen Posten „geschäftlich“ eintragen; die Umsatzsteuer rechnet die Vorschau selbst.</p>
        ${BUDGET_G.map(([g, l]) => { const list = f.budgets.filter(b => b.g === g).sort((a, b) => b.amount - a.amount); return list.length ? `<h3 class="fin-sub">${l} · ${eur0(list.reduce((s, b) => s + perMonth(b), 0))} im Monat</h3><div class="list">${list.map(bRow).join('')}</div>` : ''; }).join('')}
        <h3 class="fin-sub">Neuer Posten</h3>
        <div class="list"><div class="fin-asset fin-asset-new">
          <input type="text" placeholder="z. B. Warmmiete" aria-label="Name" data-k="name">
          <input type="text" inputmode="decimal" placeholder="Betrag" aria-label="Betrag" data-k="amount">
          <select data-k="g" aria-label="Art">${BUDGET_G.map(([g, l]) => `<option value="${g}">${l}</option>`).join('')}</select>
          <select data-k="every" aria-label="Rhythmus">${['month', 'quarter', 'year'].map(k => `<option value="${k}">${EVERY[k][0]}</option>`).join('')}</select>
          <input type="date" data-k="date" aria-label="Nächste Fälligkeit">
          <button class="btn small" data-fin="budget-add">Hinzufügen</button>
        </div></div>
        <h3 class="fin-sub">Liste einfügen</h3>
        <p class="hint">Eine Zeile pro Posten, z. B. „Warmmiete 1.250“, „Adobe 65 geschäftlich“, „KFZ-Versicherung 480 jährlich“ oder „Depot 500 sparen“ oder „Miete Mering -1.830“ (Minus = Einnahme). Gleiche Namen werden überschrieben.</p>
        <textarea class="fin-paste" rows="5" data-k="paste" aria-label="Liste einfügen" placeholder="Warmmiete 1.250&#10;Lebensmittel 600&#10;Adobe 65 geschäftlich&#10;KFZ-Versicherung 480 jährlich"></textarea>
        <div class="row-btns"><button class="btn small" data-fin="budget-paste">Übernehmen</button>
        ${f.budgets.length ? '' : `<button class="btn small ghost" data-fin="budget-suggest">Aus den letzten Monaten vorschlagen</button>`}</div>
      </details>`;
    return `<h2 class="ct-h">Vorschau · nächste ${fc.h} Monate</h2>
      ${low.end < 0 ? `<p class="fin-msg">${ms('warning')} Im ${MONTHS_LONG[+low.key.slice(5, 7) - 1]} ${low.key.slice(0, 4)} wären die Konten bei ${eur0(low.end)}.</p>` : ''}
      <section class="fin-kpis">
        <div><span>Konten heute</span><b>${eur0(f.start)}</b><small>${f.stand ? `Kontostand vom ${new Date(f.stand).toLocaleDateString('de-DE')}${old ? ' · neu einlesen' : ''}` : ''}</small></div>
        <div><span>Ø pro Monat</span><b class="${f.net >= 0 ? 'ok' : 'bad'}">${sign(f.net)}</b><small>${f.useList ? 'Umsatz Ø, der Rest laut Liste' : `aus ${f.basis.length ? `${monthLabel(f.basis[0])} – ${monthLabel(f.basis[f.basis.length - 1])}` : 'keinen Monaten'}`}</small></div>
        <div><span>Geplante Posten</span><b>${sign(f.rows.reduce((s, r) => s + r.planned, 0))}</b><small>${plans.length} eingetragen</small></div>
        <div><span>Tiefster Stand</span><b class="${low.end >= 0 ? 'ok' : 'bad'}">${eur0(low.end)}</b><small>Ende ${MONTHS_LONG[+low.key.slice(5, 7) - 1]}</small></div>
        <div><span>In ${fc.h} Monaten</span><b class="${last.end >= 0 ? 'ok' : 'bad'}">${eur0(last.end)}</b><small>${sign(last.end - f.start)} gegenüber heute${f.tax ? ` · Steuerkonto heute ${eur0(f.tax)}` : ''}</small></div>
      </section>
      ${modeChips}
      ${chips('h', [3, 6, 12], 'Zeitraum')}
      ${chips('b', [3, 6, 12], 'Ø aus den letzten')}
      <label class="fin-count fin-fc-save"><input type="checkbox" data-fin="fc-save" ${fc.save ? 'checked' : ''}> Sparen & Anlegen als Abfluss rechnen</label>
      ${forecastChart(f)}
      ${table}
      <p class="hint">${f.useList
        ? `Umsatz aus dem Durchschnitt (${eur0(f.revenue)} im Monat), feste Einnahmen und Ausgaben aus deiner Liste${f.ust ? ` plus Umsatzsteuer ans Finanzamt (Ø ${eur0(f.ust)})` : ''}.`
        : `Rechnet mit dem Durchschnitt je Monat: Einnahmen ${eur0(f.avg.in)}, Ausgaben privat ${eur0(-f.avg.out)}, geschäftlich ${eur0(-f.avg.biz)}${fc.save ? `, Sparen ${eur0(-f.avg.save)}` : ''}.${top.length ? ` Größte Posten: ${top.map(([c, v]) => `${esc(c)} ${eur0(-v)}`).join(', ')}.` : ''}`} Einmalige Sachen wie Urlaub, Steuernachzahlung oder eine Anschaffung trägst du unten ein.</p>
      ${budgetForm}
      <details class="set fin-assets"${ui.plansOpen ? ' open' : ''}><summary data-fin="plans-toggle">Geplante Posten (${plans.length})</summary>
        <p class="hint">Ausgaben mit Minus, Einnahmen ohne. Wiederkehrende Posten laufen ab dem Datum weiter.</p>
        <div class="list">${plans.map(p => `<div class="fin-asset"><div class="fin-name"><b>${esc(p.name)}</b><small>${new Date(p.date).toLocaleDateString('de-DE')} · ${(EVERY[p.every] || EVERY.once)[0]}</small></div>
          <b class="fin-amt ${p.amount < 0 ? 'neg' : 'pos'}">${eur(p.amount)}</b>
          <button class="icon-btn" data-fin="plan-del" data-id="${esc(p.id)}" aria-label="${esc(p.name)} löschen">${ms('delete')}</button></div>`).join('')}
          <div class="fin-asset fin-asset-new">
            <input type="text" placeholder="z. B. Urlaub Mallorca" aria-label="Name" data-k="name">
            <input type="text" inputmode="decimal" placeholder="Betrag, Ausgabe mit Minus" aria-label="Betrag" data-k="amount">
            <input type="date" value="${todayISO()}" aria-label="Datum" data-k="date">
            <select data-k="every" aria-label="Rhythmus">${Object.entries(EVERY).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
            <button class="btn small" data-fin="plan-add">Hinzufügen</button>
          </div></div>
      </details>
      ${earn}`;
  }

  function assetForm(index, meta) {
    const latest = assetsAt('9999-12-31');
    const now = balancesAt(index, '9999-12-31');
    const allAcc = Object.keys(index);
    // Pflege-Liste in derselben Reihenfolge wie die Tabelle; abgewählte Konten bleiben hier sichtbar
    const kKeys = sortByOrder(allAcc.filter(n => !LOAN_ACC.test(n)).sort((a, b) => acctLabel(a, meta).localeCompare(acctLabel(b, meta))).map(n => 'k:' + n));
    const wKeys = sortByOrder([...Object.keys(latest).map(n => 'a:' + n), ...allAcc.filter(n => LOAN_ACC.test(n)).map(n => 'k:' + n)]);
    groupKeys = { k: kKeys, w: wKeys };
    const moves = (g, key) => `<button class="icon-btn" data-fin="move" data-g="${g}" data-key="${esc(key)}" data-d="-1" aria-label="Nach oben">${ms('arrow_upward')}</button><button class="icon-btn" data-fin="move" data-g="${g}" data-key="${esc(key)}" data-d="1" aria-label="Nach unten">${ms('arrow_downward')}</button>`;
    const accRow = (g, acc) => {
      const m = meta[acc] || {}, b = now[acc];
      return `<div class="fin-asset" data-acc="${esc(acc)}">
        <div class="fin-name"><input type="text" data-k="label" value="${esc(acctLabel(acc, meta))}" aria-label="Name für ${esc(acc)}"><small>Aus Finanzguru${acc !== acctLabel(acc, meta) ? ` (${esc(acc)})` : ''} · ${b ? `${eur0(b.bal)} am ${new Date(b.date).toLocaleDateString('de-DE')}` : 'kein Kontostand'}, aktualisiert sich selbst</small></div>
        <label class="fin-count"><input type="checkbox" data-k="count" ${m.hidden ? '' : 'checked'}> mitzählen</label>
        <span class="fin-acts"><button class="btn small" data-fin="acct-save">Speichern</button>${moves(g, 'k:' + acc)}</span></div>`;
    };
    const assetRow = name => {
      const a = latest[name];
      return `<div class="fin-asset" data-name="${esc(name)}">
        <div class="fin-name"><input type="text" data-k="name" value="${esc(name)}" aria-label="Name"><small>${eur0(a.amount)} seit ${new Date(a.date).toLocaleDateString('de-DE')}</small></div>
        <input type="text" inputmode="decimal" data-k="amount" placeholder="Neuer Wert" aria-label="Neuer Wert für ${esc(name)}">
        <input type="date" data-k="date" value="${todayISO()}" aria-label="Gültig ab">
        <span class="fin-acts"><button class="btn small" data-fin="asset-save">Speichern</button>${moves('w', 'a:' + name)}
        <button class="icon-btn" data-fin="asset-del" data-id="${esc(a.id)}" aria-label="Letzten Wert von ${esc(name)} löschen" title="Letzten Wert löschen">${ms('delete')}</button></span>
      </div>`;
    };
    return `<details class="set fin-assets"${ui.assetsOpen ? ' open' : ''}><summary data-fin="assets-toggle">Vermögen pflegen: Namen, Werte, Reihenfolge</summary>
      <h3 class="fin-sub">Sachwerte und Schulden</h3>
      <p class="hint">Haus, Wohnung, Autos, Depot und Finanzierungen ohne eigenes Konto trägst du hier ein, Schulden mit Minus. Ein neuer Wert gilt ab dem gewählten Datum, frühere Monate behalten den alten Wert. Wert 0 heißt verkauft oder abbezahlt. Kredite mit eigenem Konto in Finanzguru (z. B. Kreditkonto) stehen automatisch dabei und aktualisieren sich selbst; trag sie nicht noch einmal von Hand ein.</p>
      <div class="list">${wKeys.map(k => (k[0] === 'a' ? assetRow(k.slice(2)) : accRow('w', k.slice(2)))).join('')}
        <div class="fin-asset fin-asset-new">
          <input type="text" placeholder="Name, z. B. Haus" aria-label="Name" data-k="name">
          <input type="text" inputmode="decimal" placeholder="Wert, Schuld mit Minus" aria-label="Wert" data-k="amount">
          <input type="date" value="${todayISO()}" aria-label="Gültig ab" data-k="date">
          <button class="btn small" data-fin="asset-add">Hinzufügen</button>
        </div></div>
      <h3 class="fin-sub">Konten aus Finanzguru</h3>
      <p class="hint">Eigener Name statt Kontonummer, Reihenfolge und ob das Konto ins Vermögen zählt.</p>
      <div class="list">${kKeys.map(k => accRow('k', k.slice(2))).join('')}</div>
    </details>`;
  }

  // ---------- Auswertung ----------
  const ui = { part: 'uebersicht', year: String(new Date().getFullYear()), month: null, filter: 'open', msg: '', busy: false, assetsOpen: false, plansOpen: false, budgetOpen: false, taxOpen: false };

  // ---------- Bankabruf über das CRM (Enable Banking) ----------
  // Commerzbank, HypoVereinsbank, Amex: das CRM holt die Umsätze alle 6 Stunden, Daily zieht sie beim Öffnen der Finanzen
  // (höchstens alle 15 Minuten). Adresse und Schlüssel liegen im privaten Daten-Repo (fmeta '_bankabruf'), damit sie auf
  // allen Geräten gelten. Jedes Bankkonto wird einem Konto in Daily zugeordnet (wie es im Finanzguru-Export heißt).
  // Buchungen haben die ID eb-…; überschneiden sie sich mit einem Finanzguru-Export, gilt der Export.
  const bankCfg = () => S.fmeta.find(m => m.id === '_bankabruf') || null;
  const normAcc = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  function guessAccount(a, names) {
    const n = normAcc(a.account);
    const digits = String(a.iban || '').replace(/\D/g, '');
    // Nur eindeutige Treffer: gleicher Name oder Kontonummer in der IBAN. Banken melden als Namen oft nur den
    // Kontoinhaber (z. B. „Patrick Hintersberger“) – ein Teilwort-Vergleich landete so beim PayPal-Konto.
    return names.find(x => normAcc(x) === n && !x.includes('@'))
      || names.find(x => /^\d{6,}$/.test(x) && digits.endsWith(x.replace(/^0+/, '')))
      || '';
  }
  const mapAccount = (cfg, acc) => ((cfg && cfg.map) || {})[acc] || acc;
  let pulling = false;
  async function pullBank(force) {
    const cfg = bankCfg();
    if (!cfg || !cfg.url || !cfg.key || pulling) return null;
    const last = +(localStorage.getItem('tb-bank-at') || 0);
    if (!force && Date.now() - last < 15 * 60e3) return null;
    pulling = true;
    localStorage.setItem('tb-bank-at', String(Date.now()));
    try {
      const mine = S.finance.filter(t => t.id && t.id.startsWith('eb-'));
      const newest = mine.reduce((m, t) => (t.date > m ? t.date : m), '');
      const since = newest ? new Date(Date.parse(newest) - 10 * 864e5).toISOString().slice(0, 10) : new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
      const res = await fetch(cfg.url.replace(/\/$/, '') + '?since=' + since, { headers: { Authorization: 'Bearer ' + cfg.key }, cache: 'no-store' });
      if (res.status === 401) throw new Error('Der Schlüssel stimmt nicht. Im CRM unter Bank → „Bankabruf für Daily“ einen neuen erzeugen.');
      if (!res.ok) throw new Error('Das CRM antwortet mit Fehler ' + res.status + '.');
      const data = await res.json();
      // Neue Bankkonten einmalig dem passenden bisherigen Konto zuordnen (lässt sich im Kasten ändern)
      const names = [...new Set(S.finance.filter(t => t.account && !(t.id || '').startsWith('eb-')).map(t => t.account))];
      const map = { ...(cfg.map || {}) };
      let changed = false;
      (data.accounts || []).forEach(a => { if (!(a.account in map)) { map[a.account] = guessAccount(a, names); changed = true; } });
      if (changed) { S.saveFmeta({ ...cfg, map }); cfg.map = map; }
      // Kontostände: vom aktuellen Saldo rückwärts durch die abgerufenen Buchungen
      const bal = {};
      (data.accounts || []).forEach(a => { if (a.balance != null) bal[a.account] = a.balance; });
      const byAcc = {};
      for (const t of data.tx || []) (byAcc[t.account] = byAcc[t.account] || []).push(t);
      const list = [];
      for (const [acc, txs] of Object.entries(byAcc)) {
        txs.sort((a, b) => a.date.localeCompare(b.date));
        let run = bal[acc];
        for (let i = txs.length - 1; i >= 0; i--) {
          const t = txs[i];
          const item = { id: 'eb-' + t.id, date: t.date, amount: t.amount, payee: t.payee || '', text: t.text || '', account: mapAccount(cfg, acc), src: 'Bankabruf' };
          if (run != null) { item.bal = run; run -= t.amount; }
          list.push(item);
        }
      }
      const have = new Map(S.finance.map(f => [f.id, f]));
      const upd = list.filter(t => have.has(t.id) && (have.get(t.id).bal !== t.bal || have.get(t.id).account !== t.account)).map(t => ({ ...have.get(t.id), bal: t.bal, account: t.account }));
      if (upd.length) S.saveFinance(upd, true);
      const added = S.saveFinance(list.filter(t => !have.has(t.id)), false);
      localStorage.setItem('tb-bank-status', JSON.stringify({ at: Date.now(), added, accounts: data.accounts || [] }));
      return added;
    } catch (e) {
      localStorage.setItem('tb-bank-status', JSON.stringify({ ...(JSON.parse(localStorage.getItem('tb-bank-status') || '{}')), error: e.message === 'Failed to fetch' ? 'Das CRM ist nicht erreichbar (Adresse prüfen).' : e.message, errAt: Date.now() }));
      return null;
    } finally { pulling = false; }
  }
  // Bank-Buchungen, die schon aus einem Finanzguru-Export da sind (gleicher Betrag, gleiches Konto, bis 3 Tage Abstand)
  function hiddenBank(list) {
    const hide = new Set();
    const eb = list.filter(t => t.id && t.id.startsWith('eb-'));
    if (!eb.length) return hide;
    const byAmt = new Map();
    list.forEach(t => { if (t.kind !== 'summary' && t.id && !t.id.startsWith('eb-')) { if (!byAmt.has(t.amount)) byAmt.set(t.amount, []); byAmt.get(t.amount).push(t); } });
    const used = new Set();
    eb.forEach(t => {
      const m = (byAmt.get(t.amount) || []).find(f => !used.has(f.id) && Math.abs(Date.parse(f.date) - Date.parse(t.date)) <= 3 * 864e5 && (!f.account || !t.account || f.account === t.account));
      if (m) { used.add(m.id); hide.add(t.id); }
    });
    return hide;
  }
  function bankBox() {
    const cfg = bankCfg() || {};
    const st = JSON.parse(localStorage.getItem('tb-bank-status') || '{}');
    const names = [...new Set(S.finance.filter(t => t.account && !(t.id || '').startsWith('eb-')).map(t => t.account))].sort();
    const fmtDT = ms => new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
    const accs = st.accounts || [];
    return `<details class="set fin-assets fin-bank"${!cfg.key || st.error ? ' open' : ''}><summary>${ms('sync')} Automatischer Bankabruf${cfg.key ? (st.error ? ' · Fehler' : st.at ? ' · ' + fmtDT(st.at) : '') : ' · nicht eingerichtet'}</summary>
      <p class="hint">Commerzbank, HypoVereinsbank und Amex kommen über dein CRM (Bank → „Bankabruf für Daily“). Dort verbindest du die Banken und erzeugst den Schlüssel. Daily holt die Buchungen beim Öffnen der Finanzen selbst ab.</p>
      ${st.error ? `<p class="fin-msg bad">${esc(st.error)}</p>` : ''}
      <form class="fin-bank-form" data-fin-form="bank"><input name="url" type="url" placeholder="Adresse aus dem CRM (…/api/daily/finance)" value="${esc(cfg.url || '')}" autocomplete="off"><input name="key" type="password" placeholder="${cfg.key ? 'Schlüssel gespeichert – zum Ändern neu einfügen' : 'Schlüssel aus dem CRM (dly_…)'}" autocomplete="off"><button class="btn small">Speichern</button></form>
      ${cfg.key ? `<div class="row-btns"><button class="btn ghost small" data-fin="bank-pull">${ms('sync')} Jetzt abrufen</button></div>` : ''}
      ${accs.length ? `<h4>Konten</h4><p class="hint">Ordne jedes Bankkonto dem Konto zu, wie es bisher in Daily heißt. Sonst zählt es als eigenes Konto (Kontostand doppelt).</p><div class="fin-bank-accs">${accs.map(a => {
        const guess = ((cfg.map || {})[a.account]) || '';
        const days = a.validUntil ? Math.ceil((Date.parse(a.validUntil) - Date.now()) / 864e5) : null;
        return `<div class="fin-bank-acc"><div><b>${esc(a.bank)} · ${esc(a.account)}</b><small>${a.balance != null ? eur(a.balance) + ' · ' : ''}${days != null ? (days > 0 ? `Freigabe noch ${days} Tage` : 'Freigabe abgelaufen – im CRM neu verbinden') : ''}${a.lastError ? ' · Fehler: ' + esc(a.lastError) : ''}</small></div>
          <select data-fin="bank-map" data-acc="${esc(a.account)}"><option value="">Eigenes Konto „${esc(a.account)}“</option>${names.map(n => `<option${n === guess ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
      }).join('')}</div>` : ''}
    </details>`;
  }

  function enriched() {
    const hide = hiddenBank(S.finance);
    return S.finance.filter(t => !hide.has(t.id)).map(t => {
      if (t.kind === 'summary') return { ...t, how: 'numbers', g: catGroup(t.cat) || t.g };
      const c = categorize(t);
      return { ...t, cat: c.cat, how: c.how, g: c.cat ? catGroup(c.cat) || t.g : null };
    });
  }

  // ---------- Aktueller Monat ----------
  // Standard-Posten (Liste) und geplante Posten dieses Monats zum Abhaken. Abgleich mit den eingelesenen Buchungen:
  // Suchwort (oder Namensteil) in Empfänger/Text und Betrag ±30 %, oder genau derselbe Betrag (±1 €). Variable Posten
  // wie Lebensmittel zeigen, was in der passenden Kategorie schon verbraucht ist. Haken von Hand je Monat in fmeta
  // {id: 'mc-<Monat>-<Posten>', type: 'mcheck', month, ref, done}; am 1. beginnt jeder Monat wieder offen.
  // Posten, die ohne eigene Einstellung als Verbrauch zählen (Name → Kategorie)
  const SPEND_HINTS = [[/sprit|tanken|benzin|diesel/, 'Auto (Benzinkosten, Vers. Etc.)'], [/werbeanzeige|werbung|meta ads|facebook|instagram ads/, 'Marketing']];
  const STOP = new Set(['und', 'inkl', 'konto', 'kredit', 'miete', 'auto', 'versicherung', 'versicherungen', 'automatisch', 'sprit', 'hausgeld', 'mama']);
  const tokens = str => norm(str).replace(/[^a-z0-9äöüß ]/g, ' ').split(' ').filter(w => w.length >= 4 && !STOP.has(w));
  function dueInMonth(b, key) {
    if (b.every === 'month' || !b.date) return true;
    const every = (EVERY[b.every] || EVERY.month)[1] || 1;
    const start = b.date.slice(0, 7);
    const diff = (+key.slice(0, 4) - +start.slice(0, 4)) * 12 + (+key.slice(5, 7) - +start.slice(5, 7));
    return ((diff % every) + every) % every === 0;
  }
  function monthStatus(key, tx) {
    const inMonth = tx.filter(t => t.date.slice(0, 7) === key);
    const used = new Set();
    const checks = {};
    S.fmeta.filter(m => m.type === 'mcheck' && m.month === key).forEach(m => { checks[m.ref] = m; if (m.tx) used.add(m.tx); });
    // variable Posten: zugeordnete Buchungen (fmeta 'mlink') und von Hand eingetragene Beträge (fmeta 'mspend')
    const links = S.fmeta.filter(m => m.type === 'mlink' && m.month === key);
    const spends = S.fmeta.filter(m => m.type === 'mspend' && m.month === key);
    links.forEach(m => used.add(m.tx));
    const posts = [
      ...budgetEntries().filter(b => dueInMonth(b, key)).map(b => ({ id: b.id, name: b.name, g: b.g, amount: b.amount, match: b.match, every: b.every, use: b.use, plan: false })),
      ...planEntries().filter(p => p.date.slice(0, 7) <= key && planHits(p, key, key + '-01')).map(p => ({ id: p.id, name: p.name, g: p.amount < 0 ? 'out' : 'in', amount: Math.abs(p.amount), match: p.match, plan: true })),
    ];
    const items = posts.map(it => {
      const sign = it.g === 'in' ? 1 : -1;
      const words = it.match ? [norm(it.match)] : tokens(it.name);
      const text = t => norm([t.payee, t.text, t.note].filter(Boolean).join(' '));
      const near = (t, tol) => Math.abs(Math.abs(t.amount) - it.amount) <= Math.max(100, it.amount * tol);
      const cands = inMonth.filter(t => !used.has(t.id) && Math.sign(t.amount) === sign);
      // von Hand zugeordnete Buchung (aus „ohne Standard-Posten“) geht vor
      const linked = checks[it.id] && checks[it.id].tx ? inMonth.find(t => t.id === checks[it.id].tx) : null;
      let hit = linked || (words.length ? cands.find(t => words.some(w => text(t).includes(w)) && near(t, 0.3)) : null);
      if (!hit) hit = cands.find(t => near(t, 0) && Math.abs(Math.abs(t.amount) - it.amount) <= 100);
      if (hit) used.add(hit.id);
      // variable Posten: passende Kategorie (z. B. „Lebensmittel“ → „Lebensmittel (Supermarkteinkäufe)“),
      // dazu zugeordnete Buchungen und Beträge von Hand
      const myLinks = links.filter(m => m.ref === it.id).map(m => inMonth.find(t => t.id === m.tx)).filter(Boolean);
      const mySpends = spends.filter(m => m.ref === it.id);
      // Abbuchungsart am Posten: '' = automatisch, 'fix' = eine Abbuchung, 'var' = Verbrauch, sonst Kategoriename
      const use = it.use || '';
      const hint = SPEND_HINTS.find(([re]) => re.test(norm(it.name)));
      const auto = !hit && use === '' ? CATS.find(c => it.name.length >= 5 && norm(c.name).startsWith(norm(it.name))) || (hint && CATS.find(c => c.name === hint[1])) : null;
      const cat = use && use !== 'fix' && use !== 'var' ? CATS.find(c => c.name === use) || null : auto || null;
      const variable = use === 'var' || !!cat || myLinks.length > 0 || mySpends.length > 0;
      if (use === 'var' || cat) { if (hit && !linked) { used.delete(hit.id); hit = null; } }
      if (variable && hit && !linked) { used.delete(hit.id); hit = null; } // zugeordnete Buchungen/Beträge: Verbrauch statt Einzelbuchung
      const spent = variable ? -inMonth.filter(t => cat && t.cat === cat.name && !links.some(l => l.tx === t.id && l.ref !== it.id)).reduce((s, t) => s + t.amount, 0)
        - myLinks.filter(t => !cat || t.cat !== cat.name).reduce((s, t) => s + t.amount, 0) + mySpends.reduce((s, m) => s + m.amount, 0) : null;
      const manual = checks[it.id];
      const done = manual ? !!manual.done : !!hit;
      const catTx = variable && cat ? inMonth.filter(t => t.cat === cat.name && !links.some(l => l.tx === t.id && l.ref !== it.id)) : [];
      return { ...it, hit, cat, variable, spent, links: myLinks, spends: mySpends, catTx, manual, done };
    });
    return { items, inMonth };
  }

  function monthView(tx, index, meta) {
    const today = todayISO();
    const key = today.slice(0, 7);
    const { items, inMonth } = monthStatus(key, tx);
    const w = worthAt(index, today, meta);
    const last = inMonth.reduce((m, t) => (t.date > m ? t.date : m), '');
    const lastAny = tx.reduce((m, t) => (t.date > m ? t.date : m), '');
    // offen: nicht abgehakte Posten; bei variablen nur der noch nicht verbrauchte Rest
    const openOf = it => (it.done ? 0 : it.spent != null ? Math.max(0, it.amount - it.spent) : it.amount);
    const sumG = (gs, f) => items.filter(it => gs.includes(it.g)).reduce((s, it) => s + f(it), 0);
    const openOut = sumG(['out', 'biz', 'save'], openOf);
    const openIn = sumG(['in'], openOf);
    const planOut = sumG(['out', 'biz', 'save'], it => it.amount);
    const doneOut = planOut - openOut;
    const free = w.liquid - w.tax;
    const left = free + openIn - openOut;
    const fmtD = d => new Date(d).toLocaleDateString('de-DE');
    // Woraus sich ein Verbrauch zusammensetzt: Buchungen der Kategorie (mit Kategorie zum Ändern) und zugeordnete Buchungen
    const catOptions = cur => `<option value="">Ohne Kategorie</option>${GROUPS.map(([g, label]) => `<optgroup label="${label}">${CATS.filter(c => c.g === g).map(c => `<option${c.name === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}`;
    const txList = it => {
      const list = [...it.catTx, ...it.links.filter(t => !it.catTx.includes(t))].sort((a, b) => a.date.localeCompare(b.date));
      if (!list.length) return '';
      return `<details class="fin-mtxs"><summary>${list.length} ${list.length === 1 ? 'Buchung' : 'Buchungen'}${it.cat ? ` aus „${esc(it.cat.name)}“` : ''}</summary>
        ${list.map(t => `<div class="fin-mtx" data-id="${esc(t.id)}"><span>${fmtD(t.date)}</span><span class="fin-mtx-who">${esc(t.payee || t.text || 'Buchung')}${t.account ? `<small>${esc(t.account)}</small>` : ''}</span><b>${eur(-t.amount)}</b>
          ${it.catTx.includes(t) ? `<select data-fin="cat" aria-label="Kategorie von ${esc(t.payee || 'Buchung')}">${catOptions(t.cat)}</select>` : '<small>zugeordnet</small>'}</div>`).join('')}
        ${it.cat ? '<p class="hint">Gehört eine Buchung nicht dazu, gib ihr eine andere Kategorie. Für dieselbe Firma künftig immer: in der Übersicht „Immer so“.</p>' : ''}</details>`;
    };
    const row = it => {
      const status = it.manual
        ? (it.done ? 'von Hand abgehakt' : 'von Hand offen')
        : it.hit ? `${it.g === 'in' ? 'eingegangen' : 'abgebucht'} ${fmtD(it.hit.date)} · ${eur(Math.abs(it.hit.amount))} · ${esc(it.hit.payee || it.hit.text || '')}`
          : it.spent != null ? `verbraucht ${eur0(it.spent)} von ${eur0(it.amount)} · noch ${eur0(Math.max(0, it.amount - it.spent))}`
            : 'offen';
      const pct = it.spent != null && !it.done ? Math.min(100, Math.round((it.spent / Math.max(1, it.amount)) * 100)) : null;
      const extra = it.variable && !it.done ? `<span class="fin-spend">
          ${[...it.links.map(t => `<span class="fin-tag">${esc(t.payee || t.text || 'Buchung')} ${eur0(-t.amount)}</span>`), ...it.spends.map(m => `<span class="fin-tag">${esc(m.note || 'von Hand')} ${eur0(m.amount)} <button class="fin-x" data-fin="mspend-del" data-id="${esc(m.id)}" aria-label="Betrag löschen">×</button></span>`)].join('')}
          <input type="text" inputmode="decimal" placeholder="Betrag" data-k="spend" aria-label="Betrag von Hand für ${esc(it.name)}"><input type="text" placeholder="wofür (optional)" data-k="note" aria-label="Notiz">
          <button class="btn small" data-fin="mspend-add" data-ref="${esc(it.id)}" data-month="${key}">＋ eintragen</button></span>` : '';
      return `<div class="fin-mrow${it.done ? ' done' : ''}">
        <input type="checkbox" data-fin="mcheck" data-ref="${esc(it.id)}" data-month="${key}" ${it.done ? 'checked' : ''} aria-label="${esc(it.name)} erledigt">
        <span class="fin-main"><b>${esc(it.name)}${it.plan ? ' <small class="fin-tag">geplant</small>' : ''}${it.every && it.every !== 'month' ? ` <small class="fin-tag">${EVERY[it.every][0]}</small>` : ''}</b><small>${status}</small>
        ${pct !== null ? `<i class="fin-bar"><i style="width:${pct}%" class="${it.spent > it.amount ? 'over' : ''}"></i></i>` : ''}${extra}${txList(it)}</span>
        <b class="fin-amt ${it.g === 'in' ? 'pos' : ''}">${eur(it.amount)}</b></div>`;
    };
    const groups = [['in', 'Einnahmen'], ['out', 'Ausgaben privat'], ['biz', 'Ausgaben geschäftlich'], ['save', 'Sparen & Anlegen']].map(([g, label]) => {
      const list = items.filter(it => it.g === g).sort((a, b) => a.done - b.done || b.amount - a.amount);
      if (!list.length) return '';
      const n = list.filter(it => it.done).length;
      return `<h3 class="fin-sub">${label} · ${n} von ${list.length} erledigt · offen ${eur0(list.reduce((s, it) => s + openOf(it), 0))}</h3><div class="list fin-mlist">${list.map(row).join('')}</div>`;
    }).join('');
    const ignored = new Set(S.fmeta.filter(m => m.type === 'mignore' && m.month === key).map(m => m.tx));
    const unmatched = inMonth.filter(t => t.amount < 0 && !ignored.has(t.id) && !items.some(it => (it.hit && it.hit.id === t.id) || (it.cat && it.cat.name === t.cat) || it.links.some(l => l.id === t.id)) && t.g !== 'skip' && t.g !== 'prop').sort((a, b) => a.amount - b.amount).slice(0, 20);
    return `<h2 class="ct-h">${MONTHS_LONG[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}</h2>
      <section class="fin-kpis">
        <div><span>Frei verfügbar heute</span><b>${eur0(free)}</b><small>Konten ohne Steuerkonto${w.tax ? ` (${eur0(w.tax)})` : ''}</small></div>
        <div><span>Schon abgebucht</span><b>${eur0(doneOut)}</b><small>von ${eur0(planOut)} geplant</small></div>
        <div><span>Noch offen</span><b class="${openOut ? 'bad' : 'ok'}">${eur0(openOut)}</b><small>Ausgaben bis Monatsende</small></div>
        <div><span>Noch erwartet</span><b>${eur0(openIn)}</b><small>feste Einnahmen</small></div>
        <div><span>Übrig zum Monatsende</span><b class="${left >= 0 ? 'ok' : 'bad'}">${eur0(left)}</b><small>frei + erwartet − offen</small></div>
      </section>
      <p class="hint">${last ? `Abgleich mit den Buchungen bis ${fmtD(last)}.` : `Für ${MONTHS_LONG[+key.slice(5, 7) - 1]} sind noch keine Buchungen eingelesen${lastAny ? ` (letzte vom ${fmtD(lastAny)})` : ''}.`} ${bankCfg() && bankCfg().key ? 'Die Buchungen kommen automatisch per Bankabruf aus dem CRM.' : 'Für einen frischen Stand den Finanzguru-Export unter Übersicht → „Datei einlesen“ laden oder unter Übersicht den automatischen Bankabruf einrichten.'} Erkannt wird über ein Suchwort (in den Standard-Ausgaben unter Vorschau) oder den Namen und den Betrag; was nicht erkannt wird, hakst du von Hand ab. Am 1. beginnt jeder Monat wieder offen.</p>
      ${items.length ? groups : `<section class="set"><p class="hint">Noch keine Standard-Posten. Unter Finanzen → Vorschau → „Standard-Ausgaben pro Monat“ anlegen.</p></section>`}
      ${unmatched.length ? `<details class="set fin-assets" open><summary>Ausgaben diesen Monat ohne Standard-Posten (${unmatched.length})</summary>
        <p class="hint">Einem Posten oben zuordnen (er gilt dann als abgebucht und wird nächsten Monat von selbst erkannt), direkt als neuen Standard-Posten übernehmen oder als einmalige Ausgabe ausblenden. Versehentlich angelegte Standard-Posten löschst du unter Vorschau → Standard-Ausgaben mit dem Papierkorb.</p>
        <div class="list">${unmatched.map(t => `<div class="fin-row fin-unm"><div class="fin-main"><b>${esc(t.payee || t.text || 'Ohne Namen')}</b><small>${fmtD(t.date)}${t.cat ? ' · ' + esc(t.cat) : ''}</small></div><b class="fin-amt neg">${eur(t.amount)}</b>
          <select data-fin="assign" data-tx="${esc(t.id)}" data-month="${key}" aria-label="Buchung zuordnen"><option value="">Zuordnen …</option><option value="ignore">Einmalig – ausblenden</option>
            <optgroup label="Als neuer Standard-Posten"><option value="new:out">＋ privat</option><option value="new:biz">＋ geschäftlich</option><option value="new:save">＋ Sparen & Anlegen</option></optgroup>
            ${items.filter(it => it.g !== 'in' && !it.hit).length ? `<optgroup label="Zu offenem Posten">${items.filter(it => it.g !== 'in' && !it.hit).map(it => `<option value="${esc(it.id)}">${esc(it.name)} (${eur0(it.amount)})</option>`).join('')}</optgroup>` : ''}
          </select></div>`).join('')}</div></details>` : ''}`;
  }

  function partView(main, part) {
    const all = enriched();
    const tx = all.filter(t => t.kind !== 'summary');
    const sums = all.filter(t => t.kind === 'summary');
    const nm = new Set(sums.map(t => t.date.slice(0, 7)));
    const counted = [...sums, ...tx.filter(t => !nm.has(t.date.slice(0, 7)))];
    const index = balanceIndex(tx), meta = acctMeta();
    const title = part === 'monat' ? 'Aktueller Monat' : 'Vorschau';
    const sub = part === 'monat' ? 'Standard-Posten abhaken und abgleichen' : 'Kontostand der nächsten Monate, Standard-Ausgaben und was du verdienen musst';
    main.innerHTML = `<div class="page fin">
      <header class="page-head"><div><h1>Finanzen · ${title}</h1><p>${sub}</p></div></header>
      ${ui.msg ? `<p class="fin-msg">${esc(ui.msg)}</p>` : ''}
      ${part === 'monat' ? monthView(tx, index, meta) : forecastView(counted, index, meta)}
    </div>`;
  }

  function view(main, part) {
    ui.part = part || ui.part || 'uebersicht';
    pullBank(false).then(n => { if (n != null) rerender(); });
    if (ui.part !== 'uebersicht') return partView(main, ui.part);
    const all = enriched();
    const tx = all.filter(t => t.kind !== 'summary');
    const sums = all.filter(t => t.kind === 'summary');
    // Monate mit Werten aus der Numbers-Jahresübersicht: dort gelten diese, sonst die Buchungen
    const numbersMonths = new Set(sums.map(t => t.date.slice(0, 7)));
    const counted = [...sums, ...tx.filter(t => !numbersMonths.has(t.date.slice(0, 7)))];
    const years = [...new Set([ui.year, ...all.map(t => t.date.slice(0, 4))])].sort().reverse();
    const yearRows = counted.filter(t => t.date.startsWith(ui.year));
    const inMonth = t => ui.month === null || +t.date.slice(5, 7) - 1 === ui.month;
    const sel = yearRows.filter(inMonth);
    const sum = (list, g) => list.filter(t => t.g === g).reduce((s, t) => s + t.amount, 0);
    const income = sum(sel, 'in');
    const out = -sum(sel, 'out');
    const biz = -sum(sel, 'biz');
    const saved = -sum(sel, 'save');
    const prop = -sum(sel, 'prop');
    // Steuerrücklage: Umsatzsteuer in den Geschäftseinnahmen, die am Ende des Zeitraums noch nicht ans Finanzamt ging
    const endKey = ui.month !== null ? `${ui.year}-${String(ui.month + 1).padStart(2, '0')}`
      : yearRows.reduce((m, t) => (t.date.slice(0, 7) > m ? t.date.slice(0, 7) : m), `${ui.year}-01`);
    const openKeys = Array.from({ length: UST_OPEN_MONTHS }, (_, i) => {
      const d = new Date(Date.UTC(+endKey.slice(0, 4), +endKey.slice(5, 7) - 1 - i, 1));
      return d.toISOString().slice(0, 7);
    }).reverse();
    const grossOpen = counted.filter(t => t.cat === 'Gehalt vom Hauptjob' && openKeys.includes(t.date.slice(0, 7))).reduce((s, t) => s + t.amount, 0);
    const reserve = Math.max(0, Math.round(grossOpen * UST_RATE / (1 + UST_RATE)));
    const beforeReserve = income - out - biz;
    const left = beforeReserve - reserve;
    const rate = income > 0 ? Math.round((left / income) * 100) : null;
    const period = ui.month === null ? ui.year : `${MONTHS_LONG[ui.month]} ${ui.year}`;
    const open = tx.filter(t => !t.cat);

    // Kategorien × Monate (wie die Jahresübersicht)
    const grid = {};
    const extra = {};
    for (const t of yearRows) {
      if (!t.cat || t.g === 'skip') continue;
      const m = +t.date.slice(5, 7) - 1;
      (grid[t.cat] = grid[t.cat] || Array(12).fill(0))[m] += t.amount;
      if (!catGroup(t.cat)) extra[t.cat] = t.g;
    }
    const monthsWithData = new Set(yearRows.map(t => +t.date.slice(5, 7) - 1));
    const nMonths = Math.max(1, monthsWithData.size);
    const src = MONTHS.map((_, i) => numbersMonths.has(`${ui.year}-${String(i + 1).padStart(2, '0')}`) ? 'N' : tx.some(t => t.date.startsWith(`${ui.year}-${String(i + 1).padStart(2, '0')}`)) ? 'F' : '');
    const table = GROUPS.filter(([g]) => g !== 'skip').map(([g, label]) => {
      const names = [...CATS.filter(c => c.g === g).map(c => c.name), ...Object.keys(extra).filter(n => extra[n] === g)].filter(n => grid[n]);
      if (!names.length) return '';
      const sign = g === 'in' ? 1 : -1;
      const totals = Array(12).fill(0);
      names.forEach(n => grid[n].forEach((v, i) => { totals[i] += v; }));
      const row = (name, vals, cls) => {
        const total = vals.reduce((s, v) => s + v, 0);
        return `<tr class="${cls || ''}"><th>${esc(name)}</th>${vals.map((v, i) => `<td class="${ui.month === i ? 'sel' : ''}">${v ? eur0(sign * v) : ''}</td>`).join('')}<td class="sum">${eur0(sign * total)}</td><td class="avg">${eur0(sign * total / nMonths)}</td></tr>`;
      };
      return `<tr class="grp"><th colspan="15">${label}</th></tr>${names.map(n => row(n, grid[n])).join('')}${row(label + ' gesamt', totals, 'tot')}`;
    }).join('');

    // Buchungsliste
    const listSrc = (ui.filter === 'open' ? open : tx.filter(t => t.date.startsWith(ui.year) && inMonth(t))).sort((a, b) => b.date.localeCompare(a.date));
    const shown = listSrc.slice(0, 200);
    const options = cur => `<option value="">Ohne Kategorie</option>${GROUPS.map(([g, label]) => `<optgroup label="${label}">${CATS.filter(c => c.g === g).map(c => `<option${c.name === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}`;
    const how = { hand: 'von Hand', regel: 'Regel', finanzguru: 'Finanzguru', auto: 'automatisch' };

    main.innerHTML = `<div class="page fin">
      <header class="page-head row"><div><h1>Finanzen · Übersicht</h1><p>Einnahmen und Ausgaben · ${esc(period)}</p></div>
        <label class="btn ghost fin-import">${ms('upload')} ${ui.busy ? 'Liest ein …' : 'Datei einlesen'}<input type="file" accept=".csv,.xlsx,.xls,text/csv" multiple hidden data-fin="import"></label></header>
      ${ui.msg ? `<p class="fin-msg">${esc(ui.msg)}</p>` : ''}
      ${bankBox()}
      ${!all.length ? `<section class="set"><h3>Noch keine Buchungen</h3><p class="hint">Lies den Finanzguru-Export (Excel) oder eine CSV aus dem Online-Banking über „Datei einlesen“ ein. Mehrfaches Einlesen erzeugt keine doppelten Buchungen.</p></section>` : `
      <div class="chips fin-years">${years.map(y => `<button class="chip" aria-pressed="${y === ui.year}" data-fin="year" data-y="${y}">${y}</button>`).join('')}</div>
      <div class="chips fin-months"><button class="chip" aria-pressed="${ui.month === null}" data-fin="month" data-m="">Ganzes Jahr</button>${MONTHS.map((m, i) => `<button class="chip" aria-pressed="${ui.month === i}" data-fin="month" data-m="${i}">${m}</button>`).join('')}</div>
      <section class="fin-kpis">
        <div><span>Einnahmen</span><b>${eur0(income)}</b></div>
        <div><span>Ausgaben privat</span><b>${eur0(out)}</b></div>
        <div><span>Ausgaben geschäftlich</span><b>${eur0(biz)}</b></div>
        <div title="Umsatzsteuer aus den Geschäftseinnahmen dieser Monate, die noch ans Finanzamt geht (Dauerfristverlängerung). Einkommensteuer-Nachzahlungen sind nicht enthalten."><span>Steuerrücklage</span><b>${eur0(reserve)}</b><small>offene USt ${openKeys.map(k => MONTHS[+k.slice(5, 7) - 1]).join(' + ')}</small></div>
        <div><span>Übrig nach Rücklage</span><b class="${left >= 0 ? 'ok' : 'bad'}">${eur0(left)}</b><small>vor Rücklage ${eur0(beforeReserve)}${rate === null ? '' : ` · Sparquote ${rate} %`}</small></div>
      </section>
      ${saved || prop ? `<p class="hint">${[saved ? `Gespart und angelegt: ${eur0(saved)}` : '', prop ? `Immobilie (Kauf & Umbau über Kredit, nicht in den Ausgaben): ${eur0(prop)}` : ''].filter(Boolean).join(' · ')}.</p>` : ''}
      ${wealthView(tx)}
      <h2 class="ct-h">Monate ${esc(ui.year)}</h2>
      ${chart(yearRows)}
      <h2 class="ct-h">Jahresübersicht ${esc(ui.year)}</h2>
      <div class="ct-table fin-table"><table><thead><tr><th></th>${MONTHS.map((m, i) => `<th class="${ui.month === i ? 'sel' : ''}">${m}${src[i] ? `<small title="${src[i] === 'N' ? 'Werte aus der Numbers-Jahresübersicht' : 'Werte aus den Buchungen'}">${src[i] === 'N' ? 'Numbers' : 'Buchungen'}</small>` : ''}</th>`).join('')}<th>Gesamt</th><th>Ø Monat</th></tr></thead><tbody>${table || '<tr><td colspan="15" class="hint">Noch nichts zugeordnet.</td></tr>'}</tbody></table></div>
      <h2 class="ct-h">Buchungen</h2>
      <div class="chips"><button class="chip" aria-pressed="${ui.filter === 'open'}" data-fin="filter" data-f="open">Ohne Kategorie (${open.length})</button><button class="chip" aria-pressed="${ui.filter === 'all'}" data-fin="filter" data-f="all">Alle · ${esc(period)}</button></div>
      ${shown.length ? `<div class="list fin-list">${shown.map(t => `<div class="fin-row" data-id="${esc(t.id)}">
          <div class="fin-main"><b>${esc(t.payee || t.text || 'Ohne Namen')}</b><small>${new Date(t.date).toLocaleDateString('de-DE')}${t.account ? ' · ' + esc(t.account) : ''}${t.fgCat ? ' · ' + esc(t.fgCat) : ''}${t.note ? ' · ' + esc(t.note) : ''}</small></div>
          <b class="fin-amt ${t.amount < 0 ? 'neg' : 'pos'}">${eur(t.amount)}</b>
          <div class="fin-cat"><select data-fin="cat" aria-label="Kategorie">${options(t.cat)}</select>${t.how && t.how !== 'hand' ? `<small>${how[t.how] || ''}</small>` : ''}
          ${t.payee ? `<button class="chip" data-fin="rule" title="Alle Buchungen von „${esc(t.payee)}“ künftig so zuordnen">Immer so</button>` : ''}</div>
        </div>`).join('')}</div>${listSrc.length > shown.length ? `<p class="hint">Es werden die neuesten 200 von ${listSrc.length} angezeigt.</p>` : ''}` : `<p class="hint">${ui.filter === 'open' ? 'Alle Buchungen haben eine Kategorie.' : 'Keine Buchungen im gewählten Zeitraum.'}</p>`}
      ${userRules().length ? `<details class="set fin-rules"><summary>Eigene Regeln (${userRules().length})</summary><div class="list">${userRules().map(r => `<div class="listrow"><span>„${esc(r.match)}“ → ${esc(r.cat)}</span><button class="icon-btn" data-fin="rule-del" data-id="${esc(r.id)}" aria-label="Regel löschen">${ms('delete')}</button></div>`).join('')}</div></details>` : ''}
      <p class="hint">Monate mit Werten in deiner Numbers-Jahresübersicht zeigen diese Werte, die übrigen Monate rechnen aus den Buchungen.</p>`}
    </div>`;
  }

  // ---------- Bedienung ----------
  function rerender() { const main = $('#main'); if (main && $('.fin', main)) view(main, ui.part); }
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-fin]');
    if (!b || !b.closest('.fin')) return;
    const a = b.dataset.fin;
    if (a === 'year') { ui.year = b.dataset.y; ui.month = null; ui.msg = ''; rerender(); }
    else if (a === 'month') { ui.month = b.dataset.m === '' ? null : +b.dataset.m; ui.msg = ''; rerender(); }
    else if (a === 'filter') { ui.filter = b.dataset.f; rerender(); }
    else if (a === 'bank-pull') { ui.msg = 'Rufe die Bankbuchungen ab …'; rerender(); pullBank(true).then(n => { ui.msg = n == null ? '' : `${n} neue Buchungen vom Bankabruf.`; rerender(); }); }
    else if (a === 'rule') {
      const row = b.closest('.fin-row');
      const t = S.finance.find(x => x.id === row.dataset.id);
      const cat = row.querySelector('select').value;
      if (!t || !cat) { ui.msg = 'Erst eine Kategorie wählen, dann „Immer so“.'; rerender(); return; }
      const match = norm(t.payee);
      const old = userRules().find(r => norm(r.match) === match);
      ui.msg = `Regel gespeichert: alles von „${t.payee}“ → ${cat}.`;
      S.saveFmeta({ ...(old || {}), type: 'rule', match, cat });
    } else if (a === 'rule-del') S.deleteFmeta(b.dataset.id);
    else if (a === 'assets-toggle') ui.assetsOpen = !b.closest('details').open;
    else if (a === 'plans-toggle') ui.plansOpen = !b.closest('details').open;
    else if (a === 'budget-toggle') ui.budgetOpen = !b.closest('details').open;
    else if (a === 'tax-toggle') ui.taxOpen = !b.closest('details').open;
    else if (a === 'tax-save') {
      const box = b.closest('.fin-taxset');
      const v = k => box.querySelector(`[data-t="${k}"]`);
      ui.taxOpen = true;
      ui.msg = 'Steuer-Einstellungen gespeichert.';
      S.saveFmeta({ ...(S.fmeta.find(m => m.id === 'tax-settings') || {}), id: 'tax-settings', type: 'setting', auto: v('auto').checked, splitting: v('splitting').checked, kirche: v('kirche').checked,
        hebesatz: Math.max(0, +v('hebesatz').value || 0), mietgewinn: v('mietgewinn').value.trim() ? parseEuro(v('mietgewinn').value) || 0 : null, abzuege: Math.abs(parseEuro(v('abzuege').value) || 0) });
    }
    else if (a === 'fc-mode') { const fc = loadFc(); fc.mode = b.dataset.v; saveFc(fc); rerender(); }
    else if (a === 'budget-add' || a === 'budget-save') {
      const row = b.closest('.fin-asset');
      const field = k => row.querySelector(`[data-k="${k}"]`);
      const name = field('name').value.trim();
      const amount = parseEuro(field('amount').value);
      const every = field('every').value;
      const date = field('date').value;
      ui.budgetOpen = true;
      if (!name || !amount) { ui.msg = 'Bitte Name und Betrag eintragen.'; rerender(); return; }
      if (every !== 'month' && !date) { ui.msg = 'Bei vierteljährlich und jährlich bitte das Datum der nächsten Zahlung eintragen.'; rerender(); return; }
      const old = a === 'budget-save' ? budgetEntries().find(x => x.id === row.dataset.id) : null;
      ui.msg = `${name}: ${eur0(Math.abs(amount))} ${EVERY[every][0]} gespeichert.`;
      S.saveFmeta({ ...(old || {}), type: 'budget', name, amount: Math.abs(amount), g: field('g').value, every, date: every === 'month' ? '' : date, ...(field('match') ? { match: field('match').value.trim() } : {}), ...(field('use') ? { use: field('use').value } : {}) });
    } else if (a === 'budget-del') { ui.budgetOpen = true; S.deleteFmeta(b.dataset.id); }
    else if (a === 'mspend-add') {
      const box = b.closest('.fin-spend');
      const amount = parseEuro(box.querySelector('[data-k="spend"]').value);
      if (!amount) { ui.msg = 'Bitte einen Betrag eintragen.'; rerender(); return; }
      const note = box.querySelector('[data-k="note"]').value.trim();
      ui.msg = `${eur(Math.abs(amount))}${note ? ` (${note})` : ''} eingetragen. Kommt die Buchung später mit dem Export, den Betrag hier wieder löschen.`;
      S.saveFmeta({ type: 'mspend', month: b.dataset.month, ref: b.dataset.ref, amount: Math.abs(amount), note });
    } else if (a === 'mspend-del') S.deleteFmeta(b.dataset.id);
    else if (a === 'budget-split') {
      // halbieren und als zweiten Posten anlegen – danach Namen und Beträge anpassen
      const o = budgetEntries().find(x => x.id === b.dataset.id);
      if (!o) return;
      const half = Math.round(o.amount / 2);
      const { id, updatedAt, ...rest } = o; // eslint-disable-line no-unused-vars
      ui.budgetOpen = true;
      ui.msg = `„${o.name}“ aufgeteilt – jetzt beide Namen und Beträge anpassen (z. B. Finanzierung und Versicherung).`;
      S.saveFmeta({ ...o, amount: o.amount - half });
      S.saveFmeta({ ...rest, name: `${o.name} (2)`, amount: half, match: '' });
    }
    else if (a === 'budget-paste') {
      const items = parseBudgetLines(b.closest('details').querySelector('[data-k="paste"]').value);
      ui.budgetOpen = true;
      if (!items.length) { ui.msg = 'Keine Zeile erkannt. Format: Name und Betrag, z. B. „Warmmiete 1.250“.'; rerender(); return; }
      const byName = new Map(budgetEntries().map(x => [norm(x.name), x]));
      // jährliche/vierteljährliche ohne Datum: ab nächstem Monat
      const next = addMonthsKey(todayISO().slice(0, 7), 1) + '-01';
      items.forEach(it => { const old = byName.get(norm(it.name)); S.saveFmeta({ ...(old || {}), type: 'budget', ...it, date: it.every === 'month' ? '' : (old && old.date) || next }); });
      const undated = items.filter(it => it.every !== 'month').length;
      ui.msg = `${items.length} Posten übernommen${undated ? ` – bei ${undated} seltenen Posten bitte das Datum der nächsten Zahlung prüfen` : ''}.`;
    } else if (a === 'budget-suggest') {
      // Vorschlag aus dem Ø der letzten Monate je Kategorie, gerundet auf 10 €
      const all = enriched();
      const tx = all.filter(t => t.kind !== 'summary'), sums = all.filter(t => t.kind === 'summary');
      const nm = new Set(sums.map(t => t.date.slice(0, 7)));
      const f = forecast([...sums, ...tx.filter(t => !nm.has(t.date.slice(0, 7)))], balanceIndex(tx), acctMeta(), { ...loadFc(), mode: 'avg' });
      const items = Object.entries(f.byCat).filter(([c, v]) => v < -500 && ['out', 'biz', 'save'].includes(catGroup(c)))
        .map(([c, v]) => ({ name: c, amount: Math.round(-v / 1000) * 1000, g: catGroup(c), every: 'month', date: '' })).filter(it => it.amount > 0);
      ui.budgetOpen = true;
      ui.msg = items.length ? `${items.length} Posten aus dem Durchschnitt angelegt – jetzt an deine echte Monatsliste anpassen.` : 'Keine Ausgaben in den letzten Monaten gefunden.';
      items.forEach(it => S.saveFmeta({ type: 'budget', ...it }));
      if (!items.length) rerender();
    }
    else if (a === 'fc') { const fc = loadFc(); fc[b.dataset.k] = +b.dataset.v; saveFc(fc); rerender(); }
    else if (a === 'plan-add') {
      const row = b.closest('.fin-asset');
      const field = k => row.querySelector(`[data-k="${k}"]`);
      const name = field('name').value.trim();
      const amount = parseEuro(field('amount').value);
      ui.plansOpen = true;
      if (!name || !amount) { ui.msg = 'Bitte Name und Betrag eintragen, Ausgaben mit Minus.'; rerender(); return; }
      ui.msg = `Geplant: ${name} ${eur0(amount)} ab ${new Date(field('date').value || todayISO()).toLocaleDateString('de-DE')}.`;
      S.saveFmeta({ type: 'plan', name, amount, date: field('date').value || todayISO(), every: field('every').value });
    } else if (a === 'plan-del') { ui.plansOpen = true; S.deleteFmeta(b.dataset.id); }
    else if (a === 'fold') { const f = loadFold(); f[b.dataset.g] = !f[b.dataset.g]; saveFold(f); rerender(); }
    else if (a === 'asset-save' || a === 'asset-add') {
      const row = b.closest('.fin-asset');
      const field = k => row.querySelector(`[data-k="${k}"]`);
      const old = row.dataset.name || '';
      const name = field('name').value.trim();
      const amount = parseEuro(field('amount').value);
      const date = field('date').value || todayISO();
      ui.assetsOpen = true;
      if (!name || (a === 'asset-add' && amount === null)) { ui.msg = 'Bitte Name und Wert eintragen, Schulden mit Minus.'; rerender(); return; }
      if (a === 'asset-save' && name !== old) {
        // Umbenennen: alle Werte dieses Postens bekommen den neuen Namen, die Position in der Reihenfolge bleibt
        if (assetEntries().some(e => e.name === name)) { ui.msg = `„${name}“ gibt es schon.`; rerender(); return; }
        const om = orderMeta();
        if (om && om.order) S.saveFmeta({ ...om, order: om.order.map(k => (k === 'a:' + old ? 'a:' + name : k)) });
        assetEntries().filter(e => e.name === old).forEach(e => S.saveFmeta({ ...e, name }));
        ui.msg = `„${old}“ heißt jetzt „${name}“.`;
      }
      if (amount !== null) {
        ui.msg = `${ui.msg && name !== old ? ui.msg + ' ' : ''}${name}: ${eur0(amount)} ab ${new Date(date).toLocaleDateString('de-DE')} gespeichert.`;
        S.saveFmeta({ type: 'asset', name, date, amount });
      } else if (name === old) { ui.msg = 'Bitte einen neuen Wert oder Namen eintragen.'; rerender(); }
    } else if (a === 'acct-save') {
      const row = b.closest('.fin-asset');
      const acc = row.dataset.acc, m = acctMeta()[acc] || {};
      const label = row.querySelector('[data-k="label"]').value.trim();
      ui.assetsOpen = true;
      ui.msg = `Konto gespeichert: ${label || acc}.`;
      S.saveFmeta({ ...m, type: 'acct', account: acc, label: label && label !== acc ? label : '', hidden: !row.querySelector('[data-k="count"]').checked });
    } else if (a === 'move') {
      const list = [...groupKeys[b.dataset.g]];
      const i = list.indexOf(b.dataset.key), j = i + +b.dataset.d;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      const next = b.dataset.g === 'k' ? [...list, ...groupKeys.w] : [...groupKeys.k, ...list];
      const om = orderMeta() || { id: 'wealth-order', type: 'setting' };
      ui.assetsOpen = true;
      S.saveFmeta({ ...om, order: [...next, ...(om.order || []).filter(k => !next.includes(k))] });
    } else if (a === 'asset-del') { ui.assetsOpen = true; S.deleteFmeta(b.dataset.id); }
  });
  document.addEventListener('submit', ev => {
    const f = ev.target.closest && ev.target.closest('[data-fin-form="bank"]');
    if (!f) return;
    ev.preventDefault();
    const cfg = bankCfg() || { id: '_bankabruf', type: 'bank' };
    const url = f.url.value.trim(), key = f.key.value.trim();
    if (url && !/^https:\/\/.+\/api\/daily\/finance\/?$/.test(url) && !/^http:\/\/localhost/.test(url)) { ui.msg = 'Die Adresse muss auf /api/daily/finance enden (steht im CRM unter Bank).'; rerender(); return; }
    S.saveFmeta({ ...cfg, url, ...(key ? { key } : {}) });
    localStorage.removeItem('tb-bank-status');
    ui.msg = 'Bankabruf gespeichert.';
    pullBank(true).then(n => { ui.msg = n == null ? '' : `Bankabruf eingerichtet: ${n} Buchungen übernommen.`; rerender(); });
    rerender();
  });
  document.addEventListener('change', async ev => {
    const el = ev.target;
    if (!el.closest || !el.closest('.fin') || !el.dataset.fin) return;
    if (el.dataset.fin === 'bank-map') {
      const cfg = bankCfg(); if (!cfg) return;
      const acc = el.dataset.acc, before = mapAccount(cfg, acc), after = el.value || acc;
      const map = { ...(cfg.map || {}) };
      map[acc] = el.value; // leer = eigenes Konto
      S.saveFmeta({ ...cfg, map });
      // schon abgerufene Buchungen des Kontos umhängen
      const move = S.finance.filter(t => (t.id || '').startsWith('eb-') && t.account === before).map(t => ({ ...t, account: after }));
      if (move.length) S.saveFinance(move, true);
      rerender();
      return;
    }
    if (el.dataset.fin === 'assign' && el.value) {
      const t = S.finance.find(x => x.id === el.dataset.tx);
      if (!t) return;
      const payee = String(t.payee || t.text || 'Ausgabe').trim();
      const word = tokens(payee)[0] || '';
      if (el.value === 'ignore') {
        // einmalige Ausgabe (z. B. Urlaub): nur aus der Liste nehmen, kein Standard-Posten
        ui.msg = `„${payee}“ ausgeblendet.`;
        S.saveFmeta({ id: `mi-${t.id}`, type: 'mignore', month: el.dataset.month, tx: t.id });
        return;
      }
      if (el.value.startsWith('new:')) {
        const g = el.value.slice(4);
        ui.msg = `„${payee}“ mit ${eur0(Math.abs(t.amount))} im Monat als Standard-Posten übernommen – Name und Betrag kannst du unter Vorschau anpassen.`;
        S.saveFmeta({ type: 'budget', name: payee.slice(0, 60), amount: Math.abs(t.amount), g, every: 'month', date: '', match: word });
      } else {
        const ref = el.value, id = `mc-${el.dataset.month}-${ref}`;
        const bud = budgetEntries().find(x => x.id === ref);
        const target = monthStatus(el.dataset.month, enriched().filter(x => x.kind !== 'summary')).items.find(x => x.id === ref);
        if (target && target.variable) {
          // variabler Posten (z. B. Lebensmittel): Buchung zählt zum Verbrauch, der Posten bleibt offen
          ui.msg = `„${payee}“ zählt jetzt zu „${target.name}“.`;
          S.saveFmeta({ id: `ml-${t.id}`, type: 'mlink', month: el.dataset.month, ref, tx: t.id });
          return;
        }
        // Suchwort merken, damit die Buchung nächsten Monat von selbst erkannt wird
        if (bud && !bud.match && word) S.saveFmeta({ ...bud, match: word });
        ui.msg = `„${payee}“ zugeordnet${bud ? ` zu „${bud.name}“` : ''}.`;
        S.saveFmeta({ ...(S.fmeta.find(m => m.id === id) || {}), id, type: 'mcheck', month: el.dataset.month, ref, done: true, tx: t.id });
      }
      return;
    }
    if (el.dataset.fin === 'mcheck') {
      const id = `mc-${el.dataset.month}-${el.dataset.ref}`;
      S.saveFmeta({ ...(S.fmeta.find(m => m.id === id) || {}), id, type: 'mcheck', month: el.dataset.month, ref: el.dataset.ref, done: el.checked });
      return;
    }
    if (el.dataset.fin === 'fc-tax') { const fc = loadFc(); fc.tax = Math.min(60, Math.max(0, +el.value || 0)); saveFc(fc); rerender(); return; }
    if (el.dataset.fin === 'fc-save') { const fc = loadFc(); fc.save = el.checked; saveFc(fc); rerender(); return; }
    if (el.dataset.fin === 'cat') {
      const t = S.finance.find(x => x.id === el.closest('.fin-row, .fin-mtx').dataset.id);
      if (t) { const n = { ...t }; if (el.value) n.cat = el.value; else delete n.cat; S.saveFinance([n], true); }
    } else if (el.dataset.fin === 'import') {
      const files = [...el.files];
      el.value = '';
      ui.busy = true; rerender();
      const msgs = [];
      for (const f of files) {
        try {
          const r = await importFile(f);
          msgs.push(`${f.name}: ${r.added} neue von ${r.total} Buchungen (${new Date(r.from).toLocaleDateString('de-DE')} bis ${new Date(r.to).toLocaleDateString('de-DE')}).`);
          ui.year = r.to.slice(0, 4); ui.month = null;
        } catch (e) { msgs.push(`${f.name}: ${e.message}`); }
      }
      ui.busy = false; ui.msg = msgs.join(' ');
      rerender();
    }
  });

  window.TB_FINANZEN = { view, CATS, _test: { parseCSV, toCents, toISO, categorize, rowsToFinance, balanceIndex, balancesAt, worthAt, parseEuro, forecast, planHits, parseBudgetLines, needed, taxesFor, estTarif, profitLast12, monthStatus, dueInMonth } };
})();
