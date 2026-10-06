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
  const ui = { year: String(new Date().getFullYear()), month: null, filter: 'open', msg: '', busy: false, assetsOpen: false };

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
    else if (a === 'assets-toggle') ui.assetsOpen = !b.closest('details').open;
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

  window.TB_FINANZEN = { view, CATS, _test: { parseCSV, toCents, toISO, categorize, rowsToFinance, balanceIndex, balancesAt, worthAt, parseEuro } };
})();
