// Finanzen: Einnahmen und Ausgaben über alle Konten, Kategorien wie in der Jahresübersicht der Numbers-Dateien.
// Quellen: Finanzguru-Export (Excel) bzw. Bank-CSV über „Datei einlesen“ und die Monatswerte der Numbers-Jahresübersichten
// (Import als Sicherung). Für Monate, die in Numbers gepflegt sind, gelten diese Werte; die Buchungen füllen die übrigen
// Monate und zeigen die Einzelheiten. Korrekturen lernen mit: „Immer so“ legt eine Regel an.
// Daten: Buchungen in data/f<Jahr>.json, Regeln in data/fmeta.json (privates Daten-Repo, nie im App-Repo).
(function () {
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
  // g: in = Einnahme, out = private Ausgabe, biz = geschäftliche Ausgabe, save = Sparen & Anlegen, skip = zählt nicht
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
    ['save', 'Sparen & Anlegen'],
    ['skip', 'Umbuchung (zählt nicht)'],
  ].map(([g, name]) => ({ g, name }));
  const GROUPS = [['in', 'Einnahmen'], ['out', 'Ausgaben privat'], ['biz', 'Ausgaben geschäftlich'], ['save', 'Sparen & Anlegen'], ['skip', 'Zählt nicht']];
  const catGroup = name => (CATS.find(c => c.name === name) || {}).g;

  // Grundregeln für Bank-CSV ohne Kategorie; eigene Regeln (aus „Immer so“) haben Vorrang.
  const BASE_RULES = [
    [/\b(aral|shell|esso|jet tank|totalenergies|agip|omv|tankstelle|avia)\b/, 'Auto (Benzinkosten, Vers. Etc.)'],
    [/\b(rewe|edeka|lidl|aldi|netto|kaufland|penny|norma|alnatura|tegut|globus)\b/, 'Lebensmittel (Supermarkteinkäufe)'],
    [/\b(lieferando|wolt|uber eats|mcdonald|burger king|restaurant|pizzeria|bäckerei|starbucks)\b/, 'Außer Haus essen / bestellen'],
    [/\b(spotify|netflix|disney|audible|dazn)\b/, 'Spotify, Netflix und Co.'],
    [/\b(vodafone|telekom|congstar)\b/, 'Handyvertrag/Prepaid'],
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
    const fg = norm(t.fgCat);
    if (fg) {
      let cat = FG_SUB[fg] || FG_MAIN[fg.split(' / ')[0]];
      if (cat === 'Gehalt vom Hauptjob' && !BUSINESS_ACCOUNT.test(t.account || '')) cat = 'Umbuchung (zählt nicht)';
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

  // ---------- Auswertung ----------
  const ui = { year: String(new Date().getFullYear()), month: null, filter: 'open', msg: '', busy: false };

  function enriched() {
    return S.finance.map(t => {
      if (t.kind === 'summary') return { ...t, how: 'numbers', g: catGroup(t.cat) || t.g };
      const c = categorize(t);
      return { ...t, cat: c.cat, how: c.how, g: c.cat ? catGroup(c.cat) || t.g : null };
    });
  }

  function view(main) {
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
    const left = income - out - biz;
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
      <header class="page-head row"><div><h1>Finanzen</h1><p>Einnahmen und Ausgaben · ${esc(period)}</p></div>
        <label class="btn ghost fin-import">${ms('upload')} ${ui.busy ? 'Liest ein …' : 'Datei einlesen'}<input type="file" accept=".csv,.xlsx,.xls,text/csv" multiple hidden data-fin="import"></label></header>
      ${ui.msg ? `<p class="fin-msg">${esc(ui.msg)}</p>` : ''}
      ${!all.length ? `<section class="set"><h3>Noch keine Buchungen</h3><p class="hint">Lies den Finanzguru-Export (Excel) oder eine CSV aus dem Online-Banking über „Datei einlesen“ ein. Mehrfaches Einlesen erzeugt keine doppelten Buchungen.</p></section>` : `
      <div class="chips fin-years">${years.map(y => `<button class="chip" aria-pressed="${y === ui.year}" data-fin="year" data-y="${y}">${y}</button>`).join('')}</div>
      <div class="chips fin-months"><button class="chip" aria-pressed="${ui.month === null}" data-fin="month" data-m="">Ganzes Jahr</button>${MONTHS.map((m, i) => `<button class="chip" aria-pressed="${ui.month === i}" data-fin="month" data-m="${i}">${m}</button>`).join('')}</div>
      <section class="fin-kpis">
        <div><span>Einnahmen</span><b>${eur0(income)}</b></div>
        <div><span>Ausgaben privat</span><b>${eur0(out)}</b></div>
        <div><span>Ausgaben geschäftlich</span><b>${eur0(biz)}</b></div>
        <div><span>Übrig</span><b class="${left >= 0 ? 'ok' : 'bad'}">${eur0(left)}</b><small>${rate === null ? '' : `Sparquote ${rate} %`}</small></div>
      </section>
      ${saved ? `<p class="hint">Davon gespart und angelegt: ${eur0(saved)}.</p>` : ''}
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
  function rerender() { const main = $('#main'); if (main && $('.fin', main)) view(main); }
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-fin]');
    if (!b || !b.closest('.fin')) return;
    const a = b.dataset.fin;
    if (a === 'year') { ui.year = b.dataset.y; ui.month = null; ui.msg = ''; rerender(); }
    else if (a === 'month') { ui.month = b.dataset.m === '' ? null : +b.dataset.m; ui.msg = ''; rerender(); }
    else if (a === 'filter') { ui.filter = b.dataset.f; rerender(); }
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
  });
  document.addEventListener('change', async ev => {
    const el = ev.target;
    if (!el.closest || !el.closest('.fin') || !el.dataset.fin) return;
    if (el.dataset.fin === 'cat') {
      const t = S.finance.find(x => x.id === el.closest('.fin-row').dataset.id);
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

  window.TB_FINANZEN = { view, CATS, _test: { parseCSV, toCents, toISO, categorize, rowsToFinance } };
})();
