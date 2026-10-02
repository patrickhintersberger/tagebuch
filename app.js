// Tagebuch – Oberfläche: Einträge, Kalender, Karte, Rückblick, Editor und Einstellungen.
(function () {
  'use strict';
  const S = window.TB_STORE;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = (name, cls = '') => `<span class="ms ${cls}">${name}</span>`;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => iso(new Date());
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const fmtLong = s => parse(s).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtDayMonth = s => parse(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });
  const fmtMonth = d => d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const ratingColor = r => `hsl(${Math.round((Math.min(10, Math.max(1, r)) - 1) / 9 * 130)} 62% 42%)`;
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const autoLoc = () => lsGet('tb-autoloc') !== '0';

  const ui = {
    view: 'calendar',
    built: null,
    q: '',
    tag: null,
    limit: 150,
    calYear: new Date().getFullYear(),
    builtYear: null,
    attLimit: 300,
    ctYear: String(new Date().getFullYear()),
    hbDate: todayISO(),
    memDate: todayISO(),
    mapYear: '',
  };

  // ---------- Daten-Helfer ----------
  function sorted() {
    return S.entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || (b.createdAt || 0) - (a.createdAt || 0));
  }
  function byDate(date) { return sorted().filter(e => e.date === date).reverse(); }
  // Einträge vom gleichen Kalendertag in früheren Jahren, nach Jahr gruppiert (neuestes zuerst).
  function onThisDay(date) {
    const md = date.slice(5);
    const groups = new Map();
    sorted().forEach(e => {
      if (!e.date || e.date.slice(5) !== md || e.date >= date) return;
      const y = e.date.slice(0, 4);
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).unshift(e);
    });
    return [...groups.entries()];
  }
  function tagCounts() {
    const m = new Map();
    S.entries.forEach(e => (e.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  function headline(e) {
    if (e.title) return e.title;
    const line = (e.text || '').split('\n').map(l => l.replace(/^#+\s*/, '').replace(/\*\*|~~/g, '').trim()).find(Boolean);
    return line || 'Ohne Titel';
  }
  function snippet(e, max = 180) {
    let t = (e.text || '').replace(/^#+\s*/gm, '').replace(/\*\*|~~/g, '').replace(/\n{2,}/g, '\n').trim();
    return t.length > max ? t.slice(0, max).trimEnd() + ' …' : t;
  }
  // Text mit einfacher Formatierung: "## Überschrift" und **fett**.
  function richText(text) {
    return esc(text || '').split('\n').map(l => {
      const h = l.match(/^#{1,3}\s+(.*)$/);
      if (h) return `<b class="rt-h">${h[1]}</b>`;
      return l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/^- /, '• ');
    }).join('\n');
  }

  // ---------- Bausteine ----------
  function ratingBadge(r) { return r ? `<span class="rating" style="--rc:${ratingColor(r)}">${r}<small>/10</small></span>` : ''; }
  function metaRow(e) {
    const bits = [];
    if (e.rating) bits.push(ratingBadge(e.rating));
    if (e.time) bits.push(`<span class="m-time">${esc(e.time)}</span>`);
    if (e.loc) bits.push(`<span class="m-loc">${ms('location_on')}${esc(e.loc.name || 'Ort gespeichert')}</span>`);
    if (e.weather) bits.push(`<span class="m-loc">${esc(e.weather)}</span>`);
    (e.tags || []).forEach(t => bits.push(`<span class="tag">${esc(t)}</span>`));
    return bits.length ? `<div class="c-meta">${bits.join('')}</div>` : '';
  }
  // Zeile im Stil von Diarium: Wochentag und Tag links, Text in der Mitte, Vorschaubild rechts.
  function card(e) {
    const d = parse(e.date);
    const photos = e.photos || [];
    const text = snippet(e, 220);
    return `<article class="card" data-act="open" data-id="${esc(e.id)}" tabindex="0">
      <div class="c-date"><span>${WD[d.getDay()]}</span><b>${d.getDate()}</b></div>
      <div class="c-body">${e.title ? `<h3>${esc(e.title)}</h3>` : ''}${text ? `<p class="c-text">${esc(text)}</p>` : (e.title ? '' : '<p class="c-text">Ohne Text</p>')}${metaRow(e)}</div>
      ${photos.length ? `<div class="c-thumb"><img data-thumb="${esc(photos[0].id)}" alt="">${photos.length > 1 ? `<i>${photos.length}</i>` : ''}</div>` : ''}
    </article>`;
  }
  function memoryBlock(date, compact) {
    const groups = onThisDay(date);
    if (!groups.length) return '';
    const year = +date.slice(0, 4);
    return `<section class="memory ${compact ? 'compact' : ''}">
      <header>${ms('history')}<div><b>An diesem Tag</b><span>${esc(fmtDayMonth(date))} in früheren Jahren</span></div></header>
      ${groups.map(([y, list]) => `<h4>Vor ${year - y} ${year - y === 1 ? 'Jahr' : 'Jahren'} · ${y}</h4>${list.map(e => card(e, { full: !compact })).join('')}`).join('')}
    </section>`;
  }
  function empty(icon, title, text) {
    return `<div class="empty">${ms(icon)}<b>${esc(title)}</b><p>${esc(text)}</p></div>`;
  }

  // Vorschaubilder werden nachgeladen, sobald ein <img data-thumb> im Dokument auftaucht.
  function hydrate(root) {
    $$('img[data-thumb]:not([data-h]), img[data-photo]:not([data-h])', root).forEach(img => {
      img.dataset.h = '1';
      const full = img.dataset.photo;
      S.photoURL(full || img.dataset.thumb, !full).then(u => {
        if (u) img.src = u;
        else if (full) S.photoURL(full, true).then(t => { if (t) img.src = t; else img.classList.add('missing'); });
        else img.classList.add('missing');
      });
    });
  }
  new MutationObserver(() => hydrate(document)).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- Ansicht: Einträge ----------
  function viewTimeline(main) {
    if (ui.built !== 'timeline') {
      main.innerHTML = `<div class="page">
        <header class="page-head"><h1>Zeitleiste</h1><p id="tl-count"></p></header>
        <label class="search">${ms('search')}<input id="tl-q" type="search" placeholder="Einträge durchsuchen" value="${esc(ui.q)}" autocomplete="off"></label>
        <div class="chips" id="tl-tags"></div>
        <div id="tl-memory"></div>
        <div id="tl-list" class="list"></div>
      </div>`;
      $('#tl-q').addEventListener('input', e => { ui.q = e.target.value; ui.limit = 150; timelineList(); });
      ui.built = 'timeline';
    }
    timelineList();
  }
  function timelineList() {
    const all = sorted();
    const tags = tagCounts().slice(0, 14);
    $('#tl-tags').innerHTML = tags.map(([t, n]) => `<button class="chip" data-act="tag" data-tag="${esc(t)}" aria-pressed="${ui.tag === t}">${esc(t)} <span class="count">${n}</span></button>`).join('');
    const q = ui.q.trim().toLowerCase();
    const list = all.filter(e => (!ui.tag || (e.tags || []).includes(ui.tag)) &&
      (!q || [e.title, e.text, e.loc && e.loc.name, (e.tags || []).join(' ')].join(' ').toLowerCase().includes(q)));
    $('#tl-count').textContent = all.length ? `${all.length} ${all.length === 1 ? 'Eintrag' : 'Einträge'}` : '';
    $('#tl-memory').innerHTML = !q && !ui.tag ? memoryBlock(todayISO(), true) : '';
    const box = $('#tl-list');
    if (!all.length) { box.innerHTML = empty('auto_stories', 'Noch keine Einträge', 'Tippe auf das Plus, um deinen ersten Eintrag zu schreiben.'); return; }
    if (!list.length) { box.innerHTML = empty('search', 'Nichts gefunden', 'Kein Eintrag passt zu dieser Suche.'); return; }
    let html = '', month = '';
    list.slice(0, ui.limit).forEach(e => {
      const m = e.date.slice(0, 7);
      if (m !== month) { month = m; html += `<h2 class="month">${esc(fmtMonth(parse(e.date)))}</h2>`; }
      html += card(e);
    });
    if (list.length > ui.limit) html += `<button class="btn ghost wide" data-act="more">Ältere Einträge laden</button>`;
    box.innerHTML = html;
  }

  // ---------- Ansicht: Kalender ----------
  // Ganzes Jahr zum Durchscrollen. Tage mit Bild zeigen das Bild als Kachel, Tage mit Eintrag ohne Bild sind blau.
  function viewCalendar(main) {
    const y = ui.calYear;
    const keep = ui.built === 'calendar' && ui.builtYear === y ? main.scrollTop : null;
    const perDay = new Map();
    S.entries.forEach(e => {
      if (!e.date || !e.date.startsWith(y + '-')) return;
      if (!perDay.has(e.date)) perDay.set(e.date, []);
      perDay.get(e.date).push(e);
    });
    const today = todayISO();
    let months = '';
    for (let m = 0; m < 12; m++) {
      const first = new Date(y, m, 1);
      const days = new Date(y, m + 1, 0).getDate();
      let cells = '<span></span>'.repeat((first.getDay() + 6) % 7); // Montag zuerst
      for (let d = 1; d <= days; d++) {
        const date = `${y}-${pad(m + 1)}-${pad(d)}`;
        const list = perDay.get(date) || [];
        const cover = list.map(e => (e.photos || [])[0]).find(Boolean);
        const cls = [list.length ? 'has' : '', cover ? 'pic' : '', date === today ? 'today' : ''].join(' ');
        cells += `<button class="day ${cls}" data-act="cal-day" data-date="${date}" aria-label="${esc(fmtLong(date))}">${cover ? `<img data-thumb="${esc(cover.id)}" alt="">` : ''}<b>${d}</b>${list.length > 1 ? `<i>${list.length}</i>` : ''}</button>`;
      }
      months += `<section class="cal-month" id="cal-m${m}"><h2>${esc(fmtMonth(first))}</h2><div class="cal-grid">${cells}</div></section>`;
    }
    main.innerHTML = `<div class="page wide cal">
      <header class="cal-head">
        <div class="cal-year"><button class="icon-btn" data-act="cal-prev" aria-label="Vorheriges Jahr">${ms('chevron_left')}</button>
          <button class="cal-today" data-act="cal-today" title="Zu heute springen">${y}</button>
          <button class="icon-btn" data-act="cal-next" aria-label="Nächstes Jahr">${ms('chevron_right')}</button></div>
        <div class="cal-wd">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<span>${w}</span>`).join('')}</div>
      </header>${months}</div>`;
    if (keep != null) main.scrollTop = keep;
    else {
      const now = new Date();
      const el = y === now.getFullYear() ? $('#cal-m' + now.getMonth()) : null;
      main.scrollTop = el ? Math.max(0, el.offsetTop - 110) : 0;
    }
    ui.built = 'calendar'; ui.builtYear = y;
  }
  // Tag im Kalender angetippt: kein Eintrag -> neuer Eintrag, ein Eintrag -> öffnen, mehrere -> Auswahl.
  function openDay(date) {
    const list = byDate(date);
    if (!list.length) return openEditor(null, { date });
    if (list.length === 1) return openEditor(list[0].id);
    const o = $('#overlay');
    o.hidden = false;
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Einträge des Tages">
      <header class="sheet-head"><button class="icon-btn" data-act="set-close" aria-label="Zurück">${ms('arrow_back')}</button><b>${esc(fmtLong(date))}</b></header>
      <div class="sheet-body"><div class="list">${list.map(card).join('')}</div>
        <button class="btn wide" data-act="new" data-date="${date}">${ms('add')} Weiterer Eintrag für diesen Tag</button></div></div>`;
  }

  // ---------- Ansicht: An diesem Tag ----------
  function viewMemories(main) {
    const md = ui.memDate.slice(5);
    const groups = new Map();
    sorted().forEach(e => {
      if (!e.date || e.date.slice(5) !== md) return;
      const y = e.date.slice(0, 4);
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).unshift(e);
    });
    main.innerHTML = `<div class="page">
      <header class="page-head row"><div><h1>An diesem Tag</h1><p>${esc(fmtDayMonth(ui.memDate))}</p></div>
        <div class="row-btns"><button class="icon-btn" data-act="mem-prev" aria-label="Tag zurück">${ms('chevron_left')}</button>
        <button class="btn ghost" data-act="mem-today">Heute</button>
        <button class="icon-btn" data-act="mem-next" aria-label="Tag vor">${ms('chevron_right')}</button></div></header>
      ${groups.size ? [...groups.entries()].map(([y, list]) => `<h2 class="month">${esc(fmtMonth(parse(list[0].date)))}</h2><div class="list">${list.map(card).join('')}</div>`).join('')
        : empty('history', 'Noch nichts für diesen Tag', 'Sobald es Einträge an diesem Datum gibt, erscheinen sie hier.')}
    </div>`;
    ui.built = 'memories';
  }

  // ---------- Ansicht: Anhänge ----------
  function viewAttachments(main) {
    const items = [];
    sorted().forEach(e => (e.photos || []).forEach(p => items.push({ p, e })));
    main.innerHTML = `<div class="page wide">
      <header class="page-head"><h1>Anhänge</h1><p>${items.filter(x => x.p.kind !== 'video').length} Bilder, ${items.filter(x => x.p.kind === 'video').length} Videos</p></header>
      ${items.length ? `<div class="att-grid">${items.slice(0, ui.attLimit).map(({ p, e }) => `<button data-act="open" data-id="${esc(e.id)}" title="${esc(fmtLong(e.date))}"><img data-thumb="${esc(p.id)}" alt="">${p.kind === 'video' ? `<span class="play">${ms('play_arrow', 'fill')}</span>` : ''}</button>`).join('')}</div>
        ${items.length > ui.attLimit ? '<button class="btn ghost wide" data-act="att-more">Ältere Bilder laden</button>' : ''}`
        : empty('grid_view', 'Noch keine Anhänge', 'Bilder und Videos aus deinen Einträgen erscheinen hier.')}
    </div>`;
    ui.built = 'attachments';
  }

  // ---------- Ansicht: Länderzähler ----------
  // Bestimmt aus den Koordinaten der Einträge das Land und zählt die Tage pro Land und Jahr.
  let geo = null, geoLoading = null;
  function loadGeo() {
    if (geo) return Promise.resolve(geo);
    if (!geoLoading) geoLoading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'geo.js?v=1';
      sc.onload = () => {
        geo = (window.TB_COUNTRIES || []).map(([cc, name, rings]) => ({ cc, name, rings: rings.map(r => {
          let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
          for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
          return { r, x0, y0, x1, y1 };
        }) }));
        resolve(geo);
      };
      sc.onerror = () => { geoLoading = null; reject(new Error('Länderdaten konnten nicht geladen werden.')); };
      document.head.appendChild(sc);
    });
    return geoLoading;
  }
  const ccCache = new Map();
  function countryAt(lat, lng) {
    const key = lat.toFixed(2) + ',' + lng.toFixed(2);
    if (ccCache.has(key)) return ccCache.get(key);
    let hit = null;
    for (const c of geo) {
      let inside = false;
      for (const { r, x0, y0, x1, y1 } of c.rings) {
        if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
        for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
          const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
          if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
        }
      }
      if (inside) { hit = c; break; }
    }
    if (!hit) {
      // Punkt knapp vor der Küste oder an einer vereinfachten Grenze: nächstes Land im Umkreis von rund 60 km
      let best = 0.6;
      const k = Math.cos(lat * Math.PI / 180);
      for (const c of geo) for (const { r, x0, y0, x1, y1 } of c.rings) {
        if (lng < x0 - 1 || lng > x1 + 1 || lat < y0 - 1 || lat > y1 + 1) continue;
        for (let i = 0; i < r.length; i += 2) { const d = Math.hypot((r[i] - lng) * k, r[i + 1] - lat); if (d < best) { best = d; hit = c; } }
      }
    }
    ccCache.set(key, hit);
    return hit;
  }
  const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  const numDay = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const flag = cc => cc.length === 2 ? String.fromCodePoint(...[...cc].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65)) : '🏳️';
  const MAX_GAP = 30; // längere Lücken zwischen zwei Einträgen werden nicht mehr geschätzt

  // Liefert pro Jahr: Länder mit belegten und geschätzten Tagen, Tage ohne Angabe und die einzelnen Aufenthalte.
  function countryStats() {
    const days = new Map(); // Tagesnummer -> Map(cc -> 'doc' | 'est')
    const names = new Map();
    const put = (n, c, kind) => {
      if (!days.has(n)) days.set(n, new Map());
      const m = days.get(n);
      if (!m.has(c.cc) || kind === 'doc') m.set(c.cc, kind);
      names.set(c.cc, c.name);
    };
    S.entries.forEach(e => {
      if (!e.date || !e.loc || e.loc.lat == null) return;
      const c = countryAt(e.loc.lat, e.loc.lng);
      if (c) put(dayNum(e.date), c, 'doc');
    });
    const known = [...days.keys()].sort((a, b) => a - b);
    // Lücken: liegt davor und danach dasselbe Land, gelten die Tage dazwischen als geschätzt
    for (let i = 0; i + 1 < known.length; i++) {
      const a = known[i], b = known[i + 1];
      if (b - a < 2 || b - a - 1 > MAX_GAP) continue;
      const common = [...days.get(a).keys()].find(cc => days.get(b).has(cc));
      if (!common) continue;
      const c = { cc: common, name: names.get(common) };
      for (let n = a + 1; n < b; n++) put(n, c, 'est');
    }
    const years = new Map();
    const year = y => { if (!years.has(y)) years.set(y, { countries: new Map(), covered: 0, unknown: 0, total: 0 }); return years.get(y); };
    [...days.keys()].sort((a, b) => a - b).forEach(n => {
      const Y = year(numDay(n).slice(0, 4));
      Y.covered++;
      days.get(n).forEach((kind, cc) => {
        if (!Y.countries.has(cc)) Y.countries.set(cc, { cc, name: names.get(cc), doc: 0, est: 0, list: [] });
        const c = Y.countries.get(cc);
        c[kind]++; c.list.push(n);
      });
    });
    const today = dayNum(todayISO());
    const first = known.length ? known[0] : today;
    years.forEach((Y, y) => {
      const from = Math.max(dayNum(`${y}-01-01`), first), to = Math.min(dayNum(`${y}-12-31`), today);
      Y.total = Math.max(0, to - from + 1);
      Y.unknown = Math.max(0, Y.total - Y.covered);
      Y.countries.forEach(c => {
        // zusammenhängende Tage zu Aufenthalten bündeln
        c.stays = [];
        c.list.forEach(n => { const last = c.stays[c.stays.length - 1]; if (last && n === last[1] + 1) last[1] = n; else c.stays.push([n, n]); });
      });
    });
    return { years, names };
  }

  function viewCountries(main) {
    if (!geo) {
      main.innerHTML = `<div class="page"><header class="page-head"><h1>Länderzähler</h1></header><p class="hint">Lade Länderdaten …</p></div>`;
      ui.built = 'countries';
      loadGeo().then(() => { if (ui.view === 'countries') render(); }, err => { if (ui.view === 'countries') main.querySelector('.hint').textContent = err.message; });
      return;
    }
    const { years } = countryStats();
    const ys = [...years.keys()].sort().reverse();
    if (!ys.length) {
      main.innerHTML = `<div class="page"><header class="page-head"><h1>Länderzähler</h1></header>${empty('public', 'Noch keine Orte', 'Sobald Einträge einen Ort haben, zählt die App hier die Tage pro Land.')}</div>`;
      ui.built = 'countries'; return;
    }
    if (!years.has(ui.ctYear)) ui.ctYear = ys[0];
    const Y = years.get(ui.ctYear);
    const list = [...Y.countries.values()].sort((a, b) => (b.doc + b.est) - (a.doc + a.est) || a.name.localeCompare(b.name));
    const scale = Math.max(183, ...list.map(c => c.doc + c.est));
    const fmt = n => new Date(n * 864e5).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    const bars = list.map(c => {
      const sum = c.doc + c.est;
      return `<details class="ct-row"><summary>
          <span class="ct-name"><i>${flag(c.cc)}</i>${esc(c.name)}</span>
          <span class="ct-bar"><b style="width:${c.doc / scale * 100}%"></b><b class="est" style="width:${c.est / scale * 100}%"></b><u style="left:${183 / scale * 100}%"></u></span>
          <span class="ct-val ${sum >= 183 ? 'over' : ''}">${sum}<small> Tage</small></span></summary>
        <div class="ct-stays"><p>${c.doc} Tage mit Eintrag vor Ort${c.est ? `, ${c.est} Tage geschätzt (Lücke zwischen zwei Einträgen im selben Land)` : ''}.</p>
          ${c.stays.map(([a, b]) => `<span>${fmt(a)}${b > a ? '–' + fmt(b) : ''} <small>${b - a + 1} ${b === a ? 'Tag' : 'Tage'}</small></span>`).join('')}</div></details>`;
    }).join('');
    // Jahresvergleich: alle Länder über alle Jahre
    const all = new Map();
    years.forEach((yy, y) => yy.countries.forEach(c => { if (!all.has(c.cc)) all.set(c.cc, { cc: c.cc, name: c.name, per: {}, sum: 0 }); const a = all.get(c.cc); a.per[y] = c.doc + c.est; a.sum += c.doc + c.est; }));
    const cols = [...ys].reverse();
    const table = `<div class="ct-table"><table><thead><tr><th>Land</th>${cols.map(y => `<th>${y}</th>`).join('')}<th>Gesamt</th></tr></thead><tbody>
      ${[...all.values()].sort((a, b) => b.sum - a.sum).map(a => `<tr><td><i>${flag(a.cc)}</i> ${esc(a.name)}</td>${cols.map(y => `<td class="${(a.per[y] || 0) >= 183 ? 'over' : ''}">${a.per[y] || '–'}</td>`).join('')}<td><b>${a.sum}</b></td></tr>`).join('')}
      <tr class="muted"><td>Ohne Angabe</td>${cols.map(y => `<td>${years.get(y).unknown || '–'}</td>`).join('')}<td>${cols.reduce((n, y) => n + years.get(y).unknown, 0)}</td></tr>
      </tbody></table></div>`;
    main.innerHTML = `<div class="page">
      <header class="page-head"><h1>Länderzähler</h1><p>Tage pro Land, berechnet aus den Orten deiner Einträge</p></header>
      <div class="chips">${ys.map(y => `<button class="chip" data-act="ct-year" data-year="${y}" aria-pressed="${y === ui.ctYear}">${y}</button>`).join('')}</div>
      <div class="ct-tiles"><div><b>${list.length}</b><span>${list.length === 1 ? 'Land' : 'Länder'}</span></div>
        <div><b>${Y.covered}</b><span>Tage zugeordnet</span></div>
        <div><b>${Y.unknown}</b><span>Tage ohne Angabe</span></div></div>
      <section class="ct-chart"><h2>${ui.ctYear}</h2>${bars}
        <p class="ct-legend"><i></i> mit Eintrag vor Ort <i class="est"></i> geschätzt <u></u> 183 Tage</p></section>
      <h2 class="ct-h">Jahresvergleich</h2>${table}
      <p class="hint">So wird gezählt: Jeder Tag mit einem Eintrag samt Ort zählt für das Land dieses Ortes. Liegen zwischen zwei Einträgen im selben Land höchstens ${MAX_GAP} Tage ohne Ort, gelten sie als dort verbracht (geschätzt). Tage zwischen zwei verschiedenen Ländern und längere Lücken bleiben „ohne Angabe“. Ein Reisetag mit Einträgen in zwei Ländern zählt für beide. Tippe auf ein Land, um die einzelnen Aufenthalte zu sehen. Die Zahlen sind eine Orientierung und kein steuerlicher Nachweis.</p>
    </div>`;
    ui.built = 'countries';
  }

  // ---------- Ansicht: Gewohnheiten ----------
  // Tageswert v: bei „Erreichen“ der Fortschritt (z.B. 1500 von 2500 ml), bei „Vermeiden“ 1 = Ausrutscher.
  const HB_COLORS = ['#f6a5ad', '#8fe3cf', '#9ad4f5', '#43e0b5', '#b548e6', '#e884bd', '#f74c4c', '#9ebfd6', '#f5c451', '#7c8cf8'];
  const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  function habitIndex() {
    const m = new Map();
    S.logs.forEach(l => { if (!l.v) return; if (!m.has(l.h)) m.set(l.h, new Map()); m.get(l.h).set(l.date, l.v); });
    return m;
  }
  const hbStart = h => h.start || iso(new Date(h.createdAt || Date.now()));
  const hbDaily = h => h.kind === 'avoid' || !(h.perWeek >= 1 && h.perWeek <= 6);
  const hbDone = (h, v) => h.kind === 'avoid' ? !v : (v || 0) >= (h.target || 1);
  function hbStreak(h, days, today) {
    const start = hbStart(h);
    const ok = d => hbDone(h, days.get(d));
    if (hbDaily(h)) {
      let d = today, n = 0;
      if (h.kind !== 'avoid' && !ok(d)) d = addDays(d, -1); // heute noch offen bricht die Serie nicht
      while (d >= start && ok(d) && n < 5000) { n++; d = addDays(d, -1); }
      return { n, unit: n === 1 ? 'Tag' : 'Tage' };
    }
    const weekOk = mon => { let c = 0; for (let i = 0; i < 7; i++) if (ok(addDays(mon, i))) c++; return c >= h.perWeek; };
    let mon = mondayOf(today), n = 0;
    if (!weekOk(mon)) mon = addDays(mon, -7); // laufende Woche zählt erst, wenn sie erfüllt ist
    while (addDays(mon, 6) >= start && weekOk(mon) && n < 1000) { n++; mon = addDays(mon, -7); }
    return { n, unit: n === 1 ? 'Woche' : 'Wochen' };
  }
  // Anteil erfüllter Gewohnheiten an einem Tag (Wochen-Gewohnheiten zählen nur mit, wenn sie erledigt wurden)
  function hbDayShare(habits, idx, date) {
    let total = 0, done = 0;
    habits.forEach(h => {
      if (hbStart(h) > date) return;
      const ok = hbDone(h, (idx.get(h.id) || new Map()).get(date));
      if (hbDaily(h)) { total++; if (ok) done++; } else if (ok) { total++; done++; }
    });
    return total ? done / total : 0;
  }
  const hbProgress = (h, v) => h.kind === 'avoid' ? (h.unit ? `Limit: ${h.target || 0} ${h.unit}` : 'Vermeiden')
    : `${v || 0}/${h.target || 1}${h.unit ? ' ' + h.unit : ''}`;

  function viewHabits(main) {
    const habits = S.habits.filter(h => !h.archived);
    const idx = habitIndex();
    const today = todayISO();
    const sel = ui.hbDate > today ? today : ui.hbDate;
    const strip = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27)).map(d => {
      const share = hbDayShare(habits, idx, d);
      const dt = parse(d);
      return `<button class="hb-day ${d === sel ? 'sel' : ''}" data-act="hb-date" data-date="${d}"><small>${WD[dt.getDay()]}</small><span style="--p:${Math.round(share * 100)}">${dt.getDate()}</span></button>`;
    }).join('');
    const rows = habits.filter(h => hbStart(h) <= sel).map(h => {
      const days = idx.get(h.id) || new Map();
      const v = days.get(sel) || 0;
      const done = hbDone(h, v);
      const st = hbStreak(h, days, today);
      const extra = !hbDaily(h) && done ? '<i>Extra Tag</i>' : '';
      const slip = h.kind === 'avoid';
      return `<div class="hb ${slip ? (v ? 'slip' : 'done') : done ? 'done' : ''}" style="--hc:${esc(h.color || HB_COLORS[0])}" data-act="hb-open" data-id="${esc(h.id)}" tabindex="0">
        <span class="hb-ico">${esc(h.icon || '✅')}</span>
        <div class="hb-main"><b>${esc(h.name)}</b><span class="hb-sub"><i>${esc(hbProgress(h, v))}</i>${extra}${h.note ? `<em>${esc(h.note)}</em>` : ''}</span></div>
        <div class="hb-side">${st.n ? `<small>🔥 ${st.n} ${st.unit}</small>` : '<small>&nbsp;</small>'}
          <button class="hb-check" data-act="hb-toggle" data-id="${esc(h.id)}" aria-label="${slip ? 'Ausrutscher eintragen' : 'Erledigt'}" aria-pressed="${slip ? !!v : done}">${ms(slip ? 'close' : 'check')}</button></div>
      </div>`;
    }).join('');
    const keepStrip = ui.built === 'habits' ? ($('#hb-strip') || {}).scrollLeft : null;
    main.innerHTML = `<div class="page wide">
      <header class="page-head row"><div><h1>${sel === today ? 'Heute' : esc(fmtLong(sel))}</h1><p>Gewohnheiten</p></div>
        <div class="row-btns">${sel !== today ? '<button class="btn ghost" data-act="hb-today">Heute</button>' : ''}<button class="btn" data-act="hb-new">${ms('add')} Gewohnheit</button></div></header>
      <div class="hb-strip" id="hb-strip">${strip}</div>
      ${habits.length ? `<div class="hb-list">${rows || '<p class="hint">An diesem Tag gab es noch keine Gewohnheiten.</p>'}</div>`
        : empty('task_alt', 'Noch keine Gewohnheiten', 'Lege deine erste Gewohnheit an, zum Beispiel „Wasser trinken“ mit 2500 ml am Tag.')}
    </div>`;
    const el = $('#hb-strip');
    el.scrollLeft = keepStrip != null ? keepStrip : el.scrollWidth;
    ui.built = 'habits';
  }
  function toggleHabit(id) {
    const h = S.habit(id); if (!h) return;
    const date = ui.hbDate > todayISO() ? todayISO() : ui.hbDate;
    const v = S.logValue(id, date);
    const target = h.target || 1;
    if (h.kind === 'avoid') return S.setLog(id, date, v ? 0 : 1);
    if (v >= target) return S.setLog(id, date, 0);
    S.setLog(id, date, h.step && target > 1 ? Math.min(target, v + h.step) : target);
  }
  let hbEdit = null;
  function openHabit(id) {
    const h = id ? S.habit(id) : null;
    hbEdit = id || 'new';
    const date = ui.hbDate > todayISO() ? todayISO() : ui.hbDate;
    const d = h || { name: '', icon: '', color: HB_COLORS[S.habits.length % HB_COLORS.length], kind: 'do', target: 1, unit: '', step: '', perWeek: 7, start: todayISO(), remind: '', note: '' };
    const v = h ? S.logValue(h.id, date) : 0;
    const o = $('#overlay');
    o.hidden = false;
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Gewohnheit">
      <header class="sheet-head"><button class="icon-btn" data-act="set-close" aria-label="Zurück">${ms('arrow_back')}</button><b>${h ? esc(h.name) : 'Neue Gewohnheit'}</b></header>
      <div class="sheet-body">
        ${h && h.kind !== 'avoid' && (h.target || 1) > 1 ? `<section class="set"><h3>${esc(date === todayISO() ? 'Heute' : fmtLong(date))}</h3>
          <div class="hb-stepper"><button class="btn ghost" data-act="hb-step" data-d="-1">${ms('remove')}</button>
            <input id="hb-val" type="number" inputmode="decimal" min="0" value="${v}"><span>von ${h.target} ${esc(h.unit || '')}</span>
            <button class="btn ghost" data-act="hb-step" data-d="1">${ms('add')}</button><button class="btn" data-act="hb-full">Erledigt</button></div></section>` : ''}
        <section class="set"><h3>${h ? 'Bearbeiten' : 'Gewohnheit anlegen'}</h3>
          <form id="hb-form" class="tplform">
            <div class="hb-f2"><input name="icon" type="text" maxlength="4" placeholder="🙂" value="${esc(d.icon || '')}" aria-label="Symbol (Emoji)"><input name="name" type="text" placeholder="Name, z.B. Wasser trinken" value="${esc(d.name)}" required></div>
            <div class="hb-colors">${HB_COLORS.map(c => `<label style="--hc:${c}"><input type="radio" name="color" value="${c}" ${c === d.color ? 'checked' : ''}><span></span></label>`).join('')}</div>
            <label>Art<select name="kind"><option value="do" ${d.kind !== 'avoid' ? 'selected' : ''}>Erreichen (abhaken oder Menge zählen)</option><option value="avoid" ${d.kind === 'avoid' ? 'selected' : ''}>Vermeiden (jeder Tag zählt, außer bei Ausrutscher)</option></select></label>
            <div class="hb-f3"><label>Ziel<input name="target" type="number" inputmode="decimal" min="0" value="${esc(d.target == null ? 1 : d.target)}"></label>
              <label>Einheit<input name="unit" type="text" placeholder="ml, min, …" value="${esc(d.unit || '')}"></label>
              <label>Schritt pro Tipp<input name="step" type="number" inputmode="decimal" min="0" placeholder="z.B. 250" value="${esc(d.step || '')}"></label></div>
            <div class="hb-f3"><label>Häufigkeit<select name="perWeek">${[7, 6, 5, 4, 3, 2, 1].map(n => `<option value="${n}" ${(+d.perWeek || 7) === n ? 'selected' : ''}>${n === 7 ? 'Täglich' : n + '× pro Woche'}</option>`).join('')}</select></label>
              <label>Start am<input name="start" type="date" value="${esc(hbStart(d.start ? d : { start: todayISO() }))}"></label>
              <label>Erinnerung um<input name="remind" type="time" value="${esc(d.remind || '')}"></label></div>
            <input name="note" type="text" placeholder="Notiz, z.B. Brustdehnung / Nacken dehnen" value="${esc(d.note || '')}">
            <div class="row-btns">${h ? `<button type="button" class="btn danger ghost" data-act="hb-delete" data-id="${esc(h.id)}">Löschen</button>` : ''}<button class="btn">Speichern</button></div>
          </form></section>
      </div></div>`;
    $('#hb-form').addEventListener('submit', ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const num = k => { const n = parseFloat(String(f.get(k)).replace(',', '.')); return isFinite(n) ? n : 0; };
      S.saveHabit({ ...(h || { order: Date.now() }), name: String(f.get('name')).trim(), icon: String(f.get('icon')).trim(), color: String(f.get('color') || d.color),
        kind: String(f.get('kind')), target: f.get('kind') === 'avoid' ? num('target') : Math.max(1, num('target') || 1), unit: String(f.get('unit')).trim(), step: num('step') || 0,
        perWeek: +f.get('perWeek') || 7, start: String(f.get('start')) || todayISO(), remind: String(f.get('remind') || ''), note: String(f.get('note')).trim() });
      closeSettings(); toast('Gewohnheit gespeichert');
    });
    const val = $('#hb-val');
    if (val) val.addEventListener('change', () => S.setLog(h.id, date, parseFloat(val.value) || 0));
  }

  // ---------- Pflege-Check ----------
  // Prüft die letzten 30 Tage: Tage ohne Eintrag, Einträge ohne Ort (wichtig für den Länderzähler) und offene Gewohnheiten.
  function careCheck() {
    const today = todayISO();
    const have = new Set(), located = new Set();
    let first = today;
    S.entries.forEach(e => { if (!e.date) return; have.add(e.date); if (e.date < first) first = e.date; if (e.loc && e.loc.lat != null) located.add(e.date); });
    const missing = [], noLoc = [];
    if (have.size) for (let i = 1; i <= 30; i++) {
      const d = addDays(today, -i);
      if (d < first) break;
      if (!have.has(d)) missing.push(d); else if (!located.has(d)) noLoc.push(d);
    }
    const idx = habitIndex();
    const open = S.habits.filter(h => !h.archived && h.kind !== 'avoid' && hbDaily(h) && hbStart(h) <= today && !hbDone(h, (idx.get(h.id) || new Map()).get(today)));
    const todayMissing = have.size > 0 && !have.has(today);
    const todayNoLoc = have.has(today) && !located.has(today);
    const count = missing.length + noLoc.length + (todayMissing || todayNoLoc ? 1 : 0);
    const level = missing.length + noLoc.length >= 2 ? 'bad' : count || open.length ? 'warn' : 'ok';
    return { missing, noLoc, open, todayMissing, todayNoLoc, count, level };
  }
  function careBanner(c) {
    if (c.level === 'ok') return '';
    const bits = [];
    if (c.missing.length) bits.push(`${c.missing.length} ${c.missing.length === 1 ? 'Tag' : 'Tage'} ohne Eintrag`);
    if (c.noLoc.length) bits.push(`${c.noLoc.length} ${c.noLoc.length === 1 ? 'Tag' : 'Tage'} ohne Ort`);
    if (c.todayMissing) bits.push('heute noch kein Eintrag');
    else if (c.todayNoLoc) bits.push('heute fehlt der Ort');
    if (c.open.length) bits.push(`${c.open.length} ${c.open.length === 1 ? 'Gewohnheit' : 'Gewohnheiten'} offen`);
    return `<button class="care ${c.level}" data-act="care-open">${ms('warning')}<span>${c.level === 'bad' ? '<b>Bitte nachpflegen:</b> ' : ''}${esc(bits.join(' · '))}</span>${ms('chevron_right')}</button>`;
  }
  function openCare() {
    const c = careCheck();
    const o = $('#overlay');
    o.hidden = false;
    const row = (d, act, extra) => `<button class="listrow" data-act="${act}" ${extra}>${ms(act === 'new' ? 'add' : 'location_on')}<span>${esc(fmtLong(d))}</span>${ms('chevron_right')}</button>`;
    const entryOn = d => (byDate(d).find(e => !(e.loc && e.loc.lat != null)) || byDate(d)[0] || {}).id;
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Pflege-Check">
      <header class="sheet-head"><button class="icon-btn" data-act="set-close" aria-label="Zurück">${ms('arrow_back')}</button><b>Pflege-Check</b></header>
      <div class="sheet-body">
        <p class="hint">Geprüft werden die letzten 30 Tage. Nur Tage mit Eintrag und Ort zählen im Länderzähler sicher für ein Land.</p>
        ${c.todayMissing ? `<section class="set"><h3>Heute</h3>${row(todayISO(), 'new', `data-date="${todayISO()}"`)}</section>` : ''}
        ${c.todayNoLoc ? `<section class="set"><h3>Heute fehlt der Ort</h3>${row(todayISO(), 'open', `data-id="${esc(entryOn(todayISO()))}"`)}</section>` : ''}
        ${c.missing.length ? `<section class="set"><h3>Tage ohne Eintrag (${c.missing.length})</h3><p class="hint">Tippe auf einen Tag, um den Eintrag nachzutragen. Den Ort suchst du im Eintrag unter „Ort suchen“.</p>${c.missing.map(d => row(d, 'new', `data-date="${d}"`)).join('')}</section>` : ''}
        ${c.noLoc.length ? `<section class="set"><h3>Einträge ohne Ort (${c.noLoc.length})</h3>${c.noLoc.map(d => row(d, 'open', `data-id="${esc(entryOn(d))}"`)).join('')}</section>` : ''}
        ${c.open.length ? `<section class="set"><h3>Heute offene Gewohnheiten (${c.open.length})</h3>${c.open.map(h => `<button class="listrow" data-nav="habits"><i class="hb-mini">${esc(h.icon || '✅')}</i><span>${esc(h.name)}</span>${h.remind ? `<small>${esc(h.remind)}</small>` : ''}${ms('chevron_right')}</button>`).join('')}</section>` : ''}
        ${c.level === 'ok' ? empty('check', 'Alles gepflegt', 'In den letzten 30 Tagen fehlt kein Eintrag und kein Ort.') : ''}
      </div></div>`;
  }

  // ---------- Ansicht: Tags ----------
  function viewTags(main) {
    const tags = tagCounts();
    main.innerHTML = `<div class="page">
      <header class="page-head"><h1>Tags</h1></header>
      ${tags.length ? `<div class="list">${tags.map(([t, n]) => `<button class="listrow" data-act="tag-go" data-tag="${esc(t)}">${ms('sell')}<span>${esc(t)}</span><small>${n}</small>${ms('chevron_right')}</button>`).join('')}</div>`
        : empty('sell', 'Noch keine Tags', 'Tags vergibst du im Eintrag, zum Beispiel „Glückstag“.')}
    </div>`;
    ui.built = 'tags';
  }

  // ---------- Ansicht: Karte ----------
  let map = null, cluster = null, mapFitted = false;
  // Runde Bild-Kreise wie in Diarium; bei Gruppen steht die Anzahl in der Mitte.
  function pinIcon(photoId, count, rating) {
    const size = count ? Math.round(54 + Math.min(46, Math.log10(count) * 17)) : photoId ? 46 : 24;
    const label = count || (!photoId && rating) || '';
    return L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
      html: `<div class="pin ${photoId ? '' : 'pin-dot'}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * (count ? 0.3 : 0.5))}px">${photoId ? `<img data-thumb="${esc(photoId)}" alt="">` : ''}${label ? `<b>${label}</b>` : ''}</div>` });
  }
  function showMap() {
    $('#mapview').hidden = false;
    if (!window.L) { $('#map-empty').hidden = false; $('#map-empty').innerHTML = empty('map', 'Karte nicht verfügbar', 'Die Karte braucht eine Internetverbindung.'); return; }
    if (!map) {
      map = L.map('map', { zoomControl: false, worldCopyJump: true, maxZoom: 19 }).setView([48.37, 10.9], 5);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      // Gleiche Kartenquelle wie die Reisekarte (OpenFreeMap), mit OpenStreetMap-Kacheln als Rückfall
      const attr = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      let base = null;
      const webgl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
      if (webgl && L.maplibreGL) base = L.maplibreGL({ style: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`, attribution: attr }).addTo(map);
      if (!base) L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: attr }).addTo(map);
      cluster = L.markerClusterGroup({
        showCoverageOnHover: false, maxClusterRadius: 70,
        iconCreateFunction: c => {
          const kids = c.getAllChildMarkers();
          const withPhoto = kids.find(k => k.options.photoId);
          return pinIcon(withPhoto && withPhoto.options.photoId, kids.length, null);
        },
      });
      map.addLayer(cluster);
    }
    map.invalidateSize();
    refreshMap();
  }
  function refreshMap() {
    if (!map) return;
    const years = [...new Set(S.entries.map(e => (e.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    $('#map-chips').innerHTML = years.length > 1 ? [`<button class="chip" data-act="map-year" data-year="" aria-pressed="${!ui.mapYear}">Alle Jahre</button>`]
      .concat(years.map(y => `<button class="chip" data-act="map-year" data-year="${y}" aria-pressed="${ui.mapYear === y}">${y}</button>`)).join('') : '';
    cluster.clearLayers();
    const markers = [];
    S.entries.forEach(e => {
      if (ui.mapYear && !(e.date || '').startsWith(ui.mapYear)) return;
      const popup = (photoId, kind) => `<div class="pop">${photoId ? `<img data-thumb="${esc(photoId)}" data-act="lightbox" data-id="${esc(photoId)}" data-kind="${kind || 'photo'}" alt="">` : ''}
        <small>${esc(fmtLong(e.date))}</small><b>${esc(headline(e))}</b>${e.loc && e.loc.name ? `<span>${esc(e.loc.name)}</span>` : ''}
        <button class="btn small" data-act="open" data-id="${esc(e.id)}">Eintrag öffnen</button></div>`;
      let placed = false;
      (e.photos || []).forEach(p => {
        // Position des Bildes: eigene Geodaten, sonst der Ort des Eintrags
        const pos = p.lat != null ? p : e.loc;
        if (!pos || pos.lat == null) return;
        placed = true;
        markers.push(L.marker([pos.lat, pos.lng], { icon: pinIcon(p.id), photoId: p.id }).bindPopup(popup(p.id, p.kind), { minWidth: 220, maxWidth: 260 }));
      });
      if (!placed && e.loc && e.loc.lat != null) {
        markers.push(L.marker([e.loc.lat, e.loc.lng], { icon: pinIcon(null, null, e.rating) }).bindPopup(popup(null), { minWidth: 200, maxWidth: 260 }));
      }
    });
    cluster.addLayers(markers);
    const none = !markers.length;
    $('#map-empty').hidden = !none;
    if (none) $('#map-empty').innerHTML = empty('map', 'Noch keine Orte', 'Einträge und Bilder mit Standort erscheinen hier auf der Karte.');
    else if (!mapFitted) { mapFitted = true; map.fitBounds(cluster.getBounds(), { padding: [50, 50], maxZoom: 13 }); }
  }

  // ---------- Rahmen ----------
  const views = { timeline: viewTimeline, calendar: viewCalendar, memories: viewMemories, attachments: viewAttachments, tags: viewTags, countries: viewCountries, habits: viewHabits };
  const TITLES = { calendar: 'Kalender', timeline: 'Zeitleiste', map: 'Karte', travel: 'Reisekarte', attachments: 'Anhänge', tags: 'Tags', countries: 'Länderzähler', memories: 'An diesem Tag', habits: 'Gewohnheiten' };
  function render() {
    $$('#nav [data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === ui.view ? 'page' : 'false'));
    const isMap = ui.view === 'map';
    const isTravel = ui.view === 'travel';
    const care = careCheck();
    $('#app').dataset.view = ui.view;
    $('#top-title').textContent = TITLES[ui.view] || 'Daily';
    $('#menu-dot').hidden = care.level === 'ok';
    $('#menu-dot').dataset.level = care.level;
    try { if (navigator.setAppBadge) { if (care.count + care.open.length) navigator.setAppBadge(care.count + care.open.length); else navigator.clearAppBadge(); } } catch {}
    $('#main').hidden = isMap || isTravel;
    $('#travelview').hidden = !isTravel;
    if (isTravel) {
      // Die Reisekarte läuft als eigene App im Rahmen und bleibt beim Wechseln der Ansicht geladen
      $('#mapview').hidden = true;
      if (!$('#travelview iframe')) {
        const f = document.createElement('iframe');
        f.title = 'Reisekarte'; f.allow = 'geolocation';
        f.src = /github\.io$/.test(location.hostname) ? '/reisekarte/' : 'https://patrickhintersberger.github.io/reisekarte/';
        $('#travelview').appendChild(f);
      }
    } else if (isMap) { if ($('#mapview').hidden) showMap(); else refreshMap(); }
    else {
      $('#mapview').hidden = true;
      const main = $('#main');
      views[ui.view](main);
      // Pflege-Hinweis oben in der Ansicht
      $$('.care', main).forEach(el => el.remove());
      const page = $('.page', main);
      if (page) page.insertAdjacentHTML('afterbegin', careBanner(care));
    }
    const btn = $('#sync-btn');
    btn.dataset.status = S.status;
    btn.title = S.statusText;
  }
  function go(view) {
    closeMenu();
    if (!ed && !$('#overlay').hidden) { editTpl = null; $('#overlay').hidden = true; $('#overlay').innerHTML = ''; }
    // „Suche“ ist die Zeitleiste mit Fokus im Suchfeld
    if (view === 'search') { go('timeline'); const q = $('#tl-q'); if (q) q.focus(); return; }
    if (ui.view !== view) { ui.built = null; $('#main').scrollTop = 0; }
    ui.view = view;
    render();
  }

  function closeMenu() { $('#nav').classList.remove('open'); $('#nav-backdrop').hidden = true; }
  let toastTimer = null;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------- Editor ----------
  let ed = null; // { entry, isNew, timer }
  function hasContent(e) { return !!(e.title || (e.text || '').trim() || e.rating || (e.tags || []).length || (e.photos || []).length); }

  function openEditor(id, preset = {}) {
    const existing = id && S.entry(id);
    const now = new Date();
    ed = {
      isNew: !existing,
      entry: existing ? JSON.parse(JSON.stringify(existing)) : {
        id: S.uid(), date: preset.date || todayISO(), time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        title: '', text: '', rating: null, tags: [], loc: null, photos: [],
      },
    };
    const e = ed.entry;
    e.tags = e.tags || []; e.photos = e.photos || [];
    const o = $('#overlay');
    o.hidden = false;
    o.innerHTML = `<div class="sheet editor" role="dialog" aria-label="Eintrag">
      <header class="sheet-head">
        <button class="icon-btn" data-act="ed-close" aria-label="Zurück">${ms('arrow_back')}</button>
        <b id="ed-head"></b>
        <button class="icon-btn" data-act="ed-templates" aria-label="Vorlage einfügen" title="Vorlage einfügen">${ms('description')}</button>
        <button class="icon-btn" data-act="ed-delete" aria-label="Eintrag löschen" title="Löschen">${ms('delete')}</button>
        <button class="btn" data-act="ed-close">Fertig</button>
      </header>
      <div class="sheet-body">
        <div id="ed-tplmenu" class="menu" hidden></div>
        <div class="ed-when"><input type="date" id="ed-date" value="${esc(e.date)}" aria-label="Datum"><input type="time" id="ed-time" value="${esc(e.time || '')}" aria-label="Uhrzeit"></div>
        <input id="ed-title" class="ed-title" type="text" placeholder="Titel" value="${esc(e.title)}" autocomplete="off">
        <textarea id="ed-text" class="ed-text" placeholder="Was ist heute passiert?">${esc(e.text)}</textarea>

        <section class="field"><label>${ms('star')} Bewertung des Tages</label><div class="rate" id="ed-rate"></div></section>
        <section class="field"><label>${ms('sell')} Tags</label><div id="ed-tags"></div></section>
        <section class="field"><label>${ms('location_on')} Ort</label><div id="ed-loc"></div></section>
        <section class="field"><label>${ms('add_a_photo')} Bilder & Videos</label><div class="photos" id="ed-photos"></div>
          <input type="file" id="ed-file" accept="image/*,video/*" multiple hidden></section>
        <div id="ed-memory"></div>
      </div>
    </div>`;
    edHead(); edRate(); edTags(); edLoc(); edPhotos(); edMemory(); grow();
    ['ed-title', 'ed-text', 'ed-time'].forEach(i => $('#' + i).addEventListener('input', () => { if (i === 'ed-text') grow(); scheduleCommit(); }));
    $('#ed-date').addEventListener('change', () => { readInputs(); edHead(); edMemory(); scheduleCommit(); });
    $('#ed-file').addEventListener('change', ev => { addPhotos([...ev.target.files]); ev.target.value = ''; });
    if (ed.isNew && autoLoc() && e.date === todayISO()) locate(true);
    // Ort ohne Namen (z.B. offline gespeichert): Namen jetzt nachschlagen
    if (e.loc && e.loc.lat != null && !e.loc.name) {
      const cur = ed, { lat, lng } = e.loc;
      reverse(lat, lng).then(n => {
        if (ed !== cur || !n || !cur.entry.loc || cur.entry.loc.lat !== lat || cur.entry.loc.name) return;
        cur.entry.loc.name = n; edLoc(); scheduleCommit();
      });
    }
    if (ed.isNew && !('ontouchstart' in window)) $('#ed-text').focus();
  }
  function grow() { const t = $('#ed-text'); if (!t) return; t.style.height = 'auto'; t.style.height = Math.max(180, t.scrollHeight + 4) + 'px'; }
  function readInputs() {
    if (!ed) return;
    const e = ed.entry;
    e.title = $('#ed-title').value.trim();
    e.text = $('#ed-text').value;
    e.date = $('#ed-date').value || e.date;
    e.time = $('#ed-time').value || '';
  }
  function commit() {
    if (!ed) return;
    clearTimeout(ed.timer);
    readInputs();
    if (!hasContent(ed.entry) && ed.isNew) return;
    const before = S.entry(ed.entry.id);
    const strip = x => { const { createdAt, updatedAt, ...rest } = x || {}; return JSON.stringify(rest); };
    if (before && strip(before) === strip(ed.entry)) return;
    S.saveEntry(ed.entry);
    ed.isNew = false;
  }
  function scheduleCommit() { if (!ed) return; clearTimeout(ed.timer); ed.timer = setTimeout(commit, 700); }
  function closeEditor(skipSave) {
    if (!ed) return;
    if (skipSave) clearTimeout(ed.timer); else commit();
    ed = null;
    $('#overlay').hidden = true;
    $('#overlay').innerHTML = '';
    ui.built = null;
    render();
    S.sync();
  }
  function edHead() { $('#ed-head').textContent = fmtLong(ed.entry.date); }
  function edMemory() { $('#ed-memory').innerHTML = memoryBlock(ed.entry.date, true); }
  function edRate() {
    const r = ed.entry.rating;
    $('#ed-rate').innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
      `<button data-act="ed-rate" data-n="${n}" aria-pressed="${r === n}" style="--rc:${ratingColor(n)}" aria-label="${n} von 10">${n}</button>`).join('');
  }
  function edTags() {
    const e = ed.entry;
    const sug = tagCounts().map(t => t[0]).filter(t => !e.tags.includes(t)).slice(0, 12);
    if (!sug.includes('Glückstag') && !e.tags.includes('Glückstag') && sug.length < 12) sug.push('Glückstag');
    $('#ed-tags').innerHTML = `<div class="tagrow">${e.tags.map(t => `<span class="tag on">${esc(t)}<button data-act="ed-tag-del" data-tag="${esc(t)}" aria-label="Tag entfernen">${ms('close')}</button></span>`).join('')}
      <input id="ed-tag-in" type="text" placeholder="Tag hinzufügen" autocomplete="off" autocapitalize="sentences" enterkeyhint="done"></div>
      ${sug.length ? `<div class="tagrow sug">${sug.map(t => `<button class="tag" data-act="ed-tag-add" data-tag="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}`;
    const inp = $('#ed-tag-in');
    const take = () => { const parts = inp.value.split(',').map(s => s.trim()).filter(Boolean); if (!parts.length) return; parts.forEach(addTag); edTags(); $('#ed-tag-in').focus(); };
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); take(); } });
    inp.addEventListener('blur', () => { if (inp.value.trim()) { inp.value.split(',').map(s => s.trim()).filter(Boolean).forEach(addTag); edTags(); } });
  }
  function addTag(t) {
    t = t.replace(/^#/, '').trim();
    if (!t || ed.entry.tags.some(x => x.toLowerCase() === t.toLowerCase())) return;
    ed.entry.tags.push(t);
    scheduleCommit();
  }
  function edLoc() {
    const l = ed.entry.loc;
    $('#ed-loc').innerHTML = (l ? `<div class="locbox">
        <input id="ed-loc-name" type="text" value="${esc(l.name || '')}" placeholder="Ort wird ermittelt …" autocomplete="off">
        <small>${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}</small>
        <button class="icon-btn" data-act="ed-loc-clear" aria-label="Ort entfernen">${ms('close')}</button></div>` : '') +
      `<div class="locrow"><button class="btn ghost" data-act="ed-locate">${ms('my_location')} ${l ? 'Standort aktualisieren' : 'Aktueller Standort'}</button>
        <form id="ed-loc-search" class="search small">${ms('search')}<input type="search" placeholder="Ort suchen" autocomplete="off" enterkeyhint="search"></form></div>
      <div id="ed-loc-results" class="menu inline" hidden></div>`;
    const name = $('#ed-loc-name');
    if (name) name.addEventListener('input', () => { ed.entry.loc.name = name.value.trim(); scheduleCommit(); });
    $('#ed-loc-search').addEventListener('submit', ev => { ev.preventDefault(); searchPlace($('#ed-loc-search input').value); });
  }
  function placeName(p) {
    const parts = [p.name || [p.street, p.housenumber].filter(Boolean).join(' '), p.city || p.town || p.village || p.county, p.country];
    return [...new Set(parts.filter(Boolean))].join(', ');
  }
  async function reverse(lat, lng) {
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=de`);
      const data = await res.json();
      const f = data.features && data.features[0];
      return f ? placeName(f.properties) : '';
    } catch { return ''; }
  }
  function setLoc(lat, lng, name) {
    const cur = ed;
    lat = +(+lat).toFixed(6); lng = +(+lng).toFixed(6);
    cur.entry.loc = { lat, lng, name: name || '' };
    edLoc(); scheduleCommit();
    if (!name) reverse(lat, lng).then(n => {
      if (ed !== cur || !cur.entry.loc || cur.entry.loc.lat !== lat || cur.entry.loc.name) return;
      if (n) { cur.entry.loc.name = n; edLoc(); scheduleCommit(); }
    });
  }
  function locate(silent) {
    if (!navigator.geolocation) { if (!silent) toast('Dieses Gerät gibt keinen Standort frei.'); return; }
    const cur = ed;
    navigator.geolocation.getCurrentPosition(pos => {
      if (ed !== cur) return;
      if (silent && cur.entry.loc) return;
      setLoc(pos.coords.latitude, pos.coords.longitude);
    }, err => {
      if (silent) return;
      toast(err.code === 1 ? 'Standortzugriff wurde nicht erlaubt. Bitte in den Browser-Einstellungen freigeben.' : 'Standort konnte nicht ermittelt werden.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  async function searchPlace(q) {
    q = q.trim(); if (!q) return;
    const box = $('#ed-loc-results');
    box.hidden = false; box.innerHTML = '<p class="hint">Suche …</p>';
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=de`);
      const data = await res.json();
      const feats = (data.features || []).filter(f => f.geometry && f.geometry.coordinates);
      if (!$('#ed-loc-results')) return;
      box.innerHTML = feats.length ? feats.map(f => `<button data-act="ed-loc-pick" data-lat="${f.geometry.coordinates[1]}" data-lng="${f.geometry.coordinates[0]}" data-name="${esc(placeName(f.properties))}">${ms('location_on')}${esc(placeName(f.properties))}</button>`).join('')
        : '<p class="hint">Kein Ort gefunden.</p>';
    } catch { box.innerHTML = '<p class="hint">Die Ortssuche ist gerade nicht erreichbar.</p>'; }
  }
  function edPhotos() {
    $('#ed-photos').innerHTML = ed.entry.photos.map(p => `<figure><img data-thumb="${esc(p.id)}" data-act="lightbox" data-id="${esc(p.id)}" data-kind="${p.kind || 'photo'}" alt="">${p.kind === 'video' ? `<span class="play">${ms('play_arrow', 'fill')}</span>` : ''}
      ${p.lat != null ? `<span class="geo" title="Bild enthält Geodaten">${ms('location_on')}</span>` : ''}
      <button data-act="ed-photo-del" data-id="${esc(p.id)}" aria-label="Bild entfernen">${ms('close')}</button></figure>`).join('') +
      `<button class="add" data-act="ed-photo-add" aria-label="Bild hinzufügen">${ms('add_a_photo')}<span>Bild oder Video</span></button>`;
  }
  async function addPhotos(files) {
    const cur = ed;
    for (const f of files) {
      try {
        const meta = isVideo(f) ? await S.addVideo(f) : await S.addPhoto(f);
        if (ed !== cur) return;
        cur.entry.photos.push(meta);
        // Eintrag ohne Ort übernimmt die Geodaten des Bildes
        if (!cur.entry.loc && meta.lat != null) setLoc(meta.lat, meta.lng);
        edPhotos(); scheduleCommit();
      } catch (err) { toast(err.message || 'Bild konnte nicht hinzugefügt werden.'); }
    }
  }
  function insertTemplate(t) {
    const ta = $('#ed-text');
    const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const before = ta.value.slice(0, start), after = ta.value.slice(ta.selectionEnd == null ? start : ta.selectionEnd);
    const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    ta.value = before + lead + t.body + (after && !t.body.endsWith('\n') ? '\n' : '') + after;
    if (!$('#ed-title').value.trim()) $('#ed-title').value = t.name;
    (t.tags || []).forEach(addTag);
    edTags(); grow(); scheduleCommit();
    const pos = (before + lead + t.body).length;
    ta.focus(); ta.setSelectionRange(pos, pos);
  }

  // ---------- Import aus Diarium ----------
  // Wandelt das HTML eines Diarium-Eintrags in Text um: Absätze -> Zeilen, fette Absätze -> Überschriften,
  // Listen -> "- ", durchgestrichen -> ~~…~~.
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const inline = node => [...node.childNodes].map(n => {
      if (n.nodeType === 3) return n.textContent;
      if (n.nodeType !== 1) return '';
      const t = inline(n), tag = n.tagName;
      if (!t.trim()) return t;
      if (tag === 'STRONG' || tag === 'B') return `**${t.trim()}**`;
      if (tag === 'S' || tag === 'DEL') return `~~${t.trim()}~~`;
      if (tag === 'BR') return '\n';
      if (tag === 'A') { const h = n.getAttribute('href') || ''; return h && h !== t.trim() ? `${t} (${h})` : t; }
      return t;
    }).join('');
    const lines = [];
    const block = node => [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) { if (n.textContent.trim()) lines.push(n.textContent.trim()); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'UL' || n.tagName === 'OL') return block(n);
      if (n.tagName === 'LI') return lines.push('- ' + inline(n).trim());
      let t = inline(n).trim();
      const whole = t.match(/^\*\*([^*]+)\*\*$/);
      if (whole) t = '## ' + whole[1];
      lines.push(t);
    });
    block(doc.body);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function fromDiarium(list) {
    return list.filter(x => x && x.date).map(x => {
      const loc = Array.isArray(x.location) && x.location.length === 2 && isFinite(x.location[0]) && isFinite(x.location[1])
        ? { lat: +(+x.location[0]).toFixed(6), lng: +(+x.location[1]).toFixed(6), name: '' } : null;
      const when = Date.parse(x.date) || Date.now();
      return {
        id: 'dia-' + String(x.date).replace(/\D/g, ''), // feste ID: erneutes Einlesen erzeugt keine Doppelten
        date: String(x.date).slice(0, 10), time: String(x.date).slice(11, 16),
        title: (x.heading || '').trim(), text: htmlToText(x.html),
        rating: null, tags: (x.tags || []).map(String), loc, photos: [],
        ...(x.weather ? { weather: String(x.weather) } : {}),
        source: 'diarium', createdAt: when,
      };
    });
  }
  // Diarium benennt die Medienordner nach dem Zeitstempel des Eintrags: 2024-09-10_072219081
  const diariumKey = d => { d = String(d); return d.slice(0, 10) + '_' + d.slice(11, 19).replace(/:/g, '') + (d.slice(20, 23) || '000').padEnd(3, '0'); };

  // Liest einen entpackten Diarium-Export ein (JSON-Dateien + Ordner "media/<Zeitstempel>/…").
  // Neue Einträge werden angelegt; an vorhandene werden nur fehlende Bilder angehängt, der Text bleibt unberührt.
  const isVideo = f => /^video\//.test(f.type || '') || /\.(mp4|mov|m4v|webm)$/i.test(f.name || '');
  let importing = false;
  async function importDiariumFolder(files, progress = () => {}) {
    if (importing) return null;
    importing = true;
    try {
      const pathOf = f => f.webkitRelativePath || f.relPath || f.name;
      const raw = [];
      const media = new Map(); // Zeitstempel -> Bilddateien
      let videos = 0, other = 0;
      for (const f of files) {
        const path = pathOf(f), name = path.split('/').pop();
        if (name.startsWith('.')) continue;
        const m = path.match(/(?:^|\/)media\/([^/]+)\/[^/]+$/);
        if (m) {
          if (/\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|m4v|webm)$/i.test(name)) { if (!media.has(m[1])) media.set(m[1], []); media.get(m[1]).push(f); }
          else other++;
        } else if (/\.json$/i.test(name)) {
          progress(`Lese ${name} …`);
          try { const data = JSON.parse((await f.text()).replace(/^\uFEFF/, '')); if (Array.isArray(data)) raw.push(...data); } catch {}
        }
      }
      if (!raw.length) return { error: 'In diesem Ordner wurde kein Diarium-Export (JSON) gefunden.' };
      const added = S.importData({ entries: fromDiarium(raw) });
      const total = [...media.values()].reduce((n, l) => n + l.length, 0);
      let done = 0, photos = 0, failed = 0, orphans = 0;
      const keys = new Map(raw.filter(x => x && x.date).map(x => [diariumKey(x.date), 'dia-' + String(x.date).replace(/\D/g, '')]));
      for (const [key, list] of media) {
        const entry = keys.has(key) ? S.entry(keys.get(key)) : null;
        if (!entry) { orphans += list.length; done += list.length; continue; }
        const have = new Set((entry.photos || []).map(p => p.src).filter(Boolean));
        const fresh = [];
        for (const f of list.sort((a, b) => a.name.localeCompare(b.name))) {
          done++;
          if (have.has(f.name)) continue;
          progress(`Anhang ${done} von ${total} …`);
          try {
            if (isVideo(f)) { fresh.push({ ...(await S.addVideo(f)), src: f.name }); videos++; }
            else { fresh.push({ ...(await S.addPhoto(f)), src: f.name }); photos++; }
          } catch { failed++; }
        }
        if (fresh.length) {
          const cur = S.entry(entry.id) || entry;
          S.saveEntry({ ...cur, photos: [...(cur.photos || []), ...fresh] });
        }
      }
      await S.flush();
      return { added, photos, failed, videos, other, orphans, total };
    } finally { importing = false; }
  }

  // ---------- Einstellungen ----------
  let editTpl = null; // ID der Vorlage, die gerade bearbeitet wird ('new' = neue)
  function openSettings() {
    const o = $('#overlay');
    o.hidden = false;
    const tpls = S.templates;
    const tplForm = t => `<form class="tplform" data-id="${esc(t.id || '')}">
      <input name="name" type="text" placeholder="Name der Vorlage" value="${esc(t.name || '')}" required>
      <input name="tags" type="text" placeholder="Tags (mit Komma getrennt)" value="${esc((t.tags || []).join(', '))}">
      <textarea name="body" rows="10" placeholder="Text der Vorlage. Zeilen mit ## werden zu Überschriften.">${esc(t.body || '')}</textarea>
      <div class="row-btns">${t.id ? `<button type="button" class="btn danger ghost" data-act="tpl-delete" data-id="${esc(t.id)}">Löschen</button>` : ''}
        <button type="button" class="btn ghost" data-act="tpl-cancel">Abbrechen</button><button class="btn">Speichern</button></div></form>`;
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Einstellungen">
      <header class="sheet-head"><button class="icon-btn" data-act="set-close" aria-label="Zurück">${ms('arrow_back')}</button><b>Einstellungen</b></header>
      <div class="sheet-body">
        <section class="set"><h3>Vorlagen</h3><p class="hint">Vorlagen fügst du im Eintrag über das Dokument-Symbol oben ein.</p>
          ${tpls.map(t => editTpl === t.id ? tplForm(t) : `<button class="listrow" data-act="tpl-edit" data-id="${esc(t.id)}">${ms('description')}<span>${esc(t.name)}</span>${ms('edit')}</button>`).join('')}
          ${editTpl === 'new' ? tplForm({}) : `<button class="btn ghost" data-act="tpl-edit" data-id="new">${ms('add')} Neue Vorlage</button>`}
        </section>

        <section class="set"><h3>Standort</h3>
          <label class="switch"><input type="checkbox" id="set-autoloc" ${autoLoc() ? 'checked' : ''}><span>Bei neuen Einträgen automatisch den aktuellen Standort speichern</span></label>
        </section>

        <section class="set"><h3>Synchronisation</h3>
          <p class="status" data-status="${esc(S.status)}"><i class="sync-dot"></i>${esc(S.statusText || 'Nur auf diesem Gerät gespeichert')}${S.pendingPhotos ? ` · ${S.pendingPhotos} Bild(er) warten auf Upload` : ''}</p>
          ${S.hasToken() ? `<p class="hint">Verbunden mit <b>${esc(S.repo())}</b>.</p>
            <div class="row-btns left"><button class="btn ghost" data-act="sync-now">${ms('check')} Jetzt synchronisieren</button><button class="btn ghost danger" data-act="token-clear">Trennen</button></div>`
          : `<p class="hint">Damit Einträge und Bilder auf allen Geräten erscheinen und gesichert sind, verbinde die App mit deinem privaten GitHub-Repo <b>${esc(S.repo())}</b>.</p>
            <form id="token-form" class="tplform"><input name="token" type="password" placeholder="GitHub-Token (github_pat_…)" autocomplete="off" required>
              <input name="repo" type="text" value="${esc(S.repo())}" aria-label="Repo"><button class="btn">Verbinden</button></form>
            <details><summary>So bekommst du einen Token</summary><ol>
              <li>Auf github.com einloggen → Profilbild → Settings → Developer settings → Personal access tokens → Fine-grained tokens → „Generate new token“.</li>
              <li>Repository access: „Only select repositories“ → <b>${esc(S.repo().split('/')[1])}</b>.</li>
              <li>Permissions → Repository permissions → „Contents“: <b>Read and write</b>.</li>
              <li>Token erzeugen, kopieren und hier einfügen.</li></ol></details>`}
        </section>

        <section class="set"><h3>Sicherung</h3>
          <div class="row-btns left"><button class="btn ghost" data-act="export">${ms('download')} Einträge exportieren</button>
          <button class="btn ghost" data-act="import">${ms('upload')} Sicherung oder Diarium-Export einlesen</button>
          <button class="btn ghost" data-act="import-folder">${ms('add_a_photo')} Diarium-Ordner mit Bildern & Videos einlesen</button></div>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
          <input type="file" id="import-folder" webkitdirectory multiple hidden>
          <p class="status" id="import-status" hidden></p>
          <p class="hint">Der Export enthält alle Texte, Tags, Bewertungen und Orte als JSON-Datei. Bilder liegen im Daten-Repo. Einen Diarium-Export (JSON) kannst du hier direkt einlesen. Für die Bilder in Diarium mit „Eigene Dateien für Anhänge erstellen“ exportieren, die ZIP entpacken und den Ordner wählen (am Computer). Mehrfaches Einlesen erzeugt keine doppelten Einträge oder Bilder.</p>
        </section>
      </div></div>`;
    $('#set-autoloc').addEventListener('change', e => lsSet('tb-autoloc', e.target.checked ? '1' : '0'));
    $$('.tplform[data-id]', o).forEach(f => f.addEventListener('submit', ev => {
      ev.preventDefault();
      const d = new FormData(f);
      const old = f.dataset.id ? S.template(f.dataset.id) : null;
      S.saveTemplate({ ...(old || {}), name: String(d.get('name')).trim(), body: String(d.get('body')), tags: String(d.get('tags')).split(',').map(s => s.trim()).filter(Boolean) });
      editTpl = null; openSettings(); toast('Vorlage gespeichert');
    }));
    const tf = $('#token-form');
    if (tf) tf.addEventListener('submit', async ev => {
      ev.preventDefault();
      const d = new FormData(tf);
      await S.setToken(String(d.get('token')), String(d.get('repo')));
      if (settingsOpen()) openSettings();
      toast(S.status === 'ok' ? 'Verbunden und synchronisiert' : S.statusText);
    });
    $('#import-folder').addEventListener('change', async ev => {
      const files = [...ev.target.files]; ev.target.value = '';
      if (!files.length) return;
      const show = t => { const el = $('#import-status'); if (el) { el.hidden = false; el.textContent = t; } };
      show('Import läuft …');
      const r = await importDiariumFolder(files, show);
      if (!r) return;
      const text = r.error || `${r.added} neue Einträge, ${r.photos} Bilder und ${r.videos} Videos übernommen`
        + (r.other ? `, ${r.other} andere Dateien übersprungen` : '')
        + (r.failed ? `, ${r.failed} Anhänge nicht lesbar` : '') + (r.orphans ? `, ${r.orphans} Anhänge ohne passenden Eintrag` : '') + '.';
      if (settingsOpen()) openSettings();
      show(text); toast(text);
    });
    $('#import-file').addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse((await f.text()).replace(/^\uFEFF/, ''));
        // Diarium exportiert eine Liste von Einträgen mit "date" und "html"
        const n = S.importData(Array.isArray(data) ? { entries: fromDiarium(data) } : data);
        toast(n ? `${n} Einträge übernommen` : 'Keine neuen Einträge in dieser Datei');
      }
      catch { toast('Diese Datei konnte nicht gelesen werden.'); }
    });
  }
  const settingsOpen = () => !ed && !$('#overlay').hidden;
  function closeSettings() { editTpl = null; $('#overlay').hidden = true; $('#overlay').innerHTML = ''; ui.built = null; render(); }

  // ---------- Aktionen ----------
  function closeLightbox() { const lb = $('#lightbox'); const v = $('video', lb); if (v) { v.pause(); v.remove(); } lb.hidden = true; }
  const shiftDay = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const actions = {
    new: el => { if (!ed && !$('#overlay').hidden) { $('#overlay').hidden = true; $('#overlay').innerHTML = ''; } openEditor(null, { date: el.dataset.date }); },
    open: el => { if (ed && ed.entry.id === el.dataset.id) return; if (ed) commit(); openEditor(el.dataset.id); },
    more: () => { ui.limit += 150; timelineList(); },
    tag: el => { ui.tag = ui.tag === el.dataset.tag ? null : el.dataset.tag; timelineList(); },
    settings: () => { closeMenu(); openSettings(); },
    'set-close': closeSettings,
    'cal-prev': () => { ui.calYear--; render(); },
    'cal-next': () => { ui.calYear++; render(); },
    'cal-today': () => { ui.calYear = new Date().getFullYear(); ui.builtYear = null; render(); },
    'cal-day': el => openDay(el.dataset.date),
    menu: () => { $('#nav').classList.add('open'); $('#nav-backdrop').hidden = false; },
    'menu-close': closeMenu,
    'care-open': openCare,
    'hb-date': el => { ui.hbDate = el.dataset.date; render(); },
    'hb-today': () => { ui.hbDate = todayISO(); ui.built = null; render(); },
    'hb-toggle': el => toggleHabit(el.dataset.id),
    'hb-open': el => openHabit(el.dataset.id),
    'hb-new': () => openHabit(null),
    'hb-delete': el => { if (!confirm('Diese Gewohnheit löschen? Die bisherigen Tageswerte bleiben gespeichert.')) return; S.deleteHabit(el.dataset.id); closeSettings(); },
    'hb-step': el => {
      const h = S.habit(hbEdit); if (!h) return;
      const date = ui.hbDate > todayISO() ? todayISO() : ui.hbDate;
      const v = Math.max(0, S.logValue(h.id, date) + (+el.dataset.d) * (h.step || 1));
      S.setLog(h.id, date, v); $('#hb-val').value = v;
    },
    'hb-full': () => { const h = S.habit(hbEdit); if (!h) return; S.setLog(h.id, ui.hbDate > todayISO() ? todayISO() : ui.hbDate, h.target || 1); closeSettings(); },
    'ct-year': el => { ui.ctYear = el.dataset.year; render(); },
    'att-more': () => { ui.attLimit += 300; render(); },
    'tag-go': el => { ui.tag = el.dataset.tag; ui.q = ''; go('timeline'); },
    'mem-prev': () => { ui.memDate = shiftDay(ui.memDate, -1); render(); },
    'mem-next': () => { ui.memDate = shiftDay(ui.memDate, 1); render(); },
    'mem-today': () => { ui.memDate = todayISO(); render(); },
    'map-year': el => { ui.mapYear = el.dataset.year; mapFitted = false; refreshMap(); },
    lightbox: el => {
      const lb = $('#lightbox'), img = $('img', lb);
      const old = $('video', lb); if (old) old.remove();
      img.removeAttribute('src'); delete img.dataset.h; delete img.dataset.photo;
      const video = el.dataset.kind === 'video';
      img.hidden = video;
      lb.hidden = false;
      if (video) {
        S.photoURL(el.dataset.id, 'video').then(u => {
          if (lb.hidden) return;
          if (!u) { closeLightbox(); return toast('Dieses Video ist auf diesem Gerät nicht verfügbar.'); }
          const v = document.createElement('video');
          v.controls = true; v.autoplay = true; v.playsInline = true; v.src = u;
          lb.insertBefore(v, lb.firstChild);
        });
      } else { img.dataset.photo = el.dataset.id; hydrate(lb); }
    },
    'lightbox-close': () => closeLightbox(),
    'ed-close': () => closeEditor(),
    'ed-delete': () => {
      if (ed.isNew && !hasContent(ed.entry)) return closeEditor(true);
      if (!confirm('Diesen Eintrag wirklich löschen?')) return;
      S.deleteEntry(ed.entry.id);
      closeEditor(true);
      toast('Eintrag gelöscht');
    },
    'ed-rate': el => { const n = +el.dataset.n; ed.entry.rating = ed.entry.rating === n ? null : n; edRate(); scheduleCommit(); },
    'ed-tag-add': el => { addTag(el.dataset.tag); edTags(); },
    'ed-tag-del': el => { ed.entry.tags = ed.entry.tags.filter(t => t !== el.dataset.tag); edTags(); scheduleCommit(); },
    'ed-locate': () => { toast('Standort wird ermittelt …'); locate(false); },
    'ed-loc-clear': () => { ed.entry.loc = null; edLoc(); scheduleCommit(); },
    'ed-loc-pick': el => setLoc(el.dataset.lat, el.dataset.lng, el.dataset.name),
    'ed-photo-add': () => $('#ed-file').click(),
    'ed-photo-del': el => { ed.entry.photos = ed.entry.photos.filter(p => p.id !== el.dataset.id); edPhotos(); scheduleCommit(); },
    'ed-templates': () => {
      const m = $('#ed-tplmenu');
      if (!m.hidden) { m.hidden = true; return; }
      const list = S.templates;
      m.innerHTML = list.length ? list.map(t => `<button data-act="ed-tpl" data-id="${esc(t.id)}">${ms('description')}${esc(t.name)}</button>`).join('') : '<p class="hint">Keine Vorlagen vorhanden. Lege sie in den Einstellungen an.</p>';
      m.hidden = false;
    },
    'ed-tpl': el => { $('#ed-tplmenu').hidden = true; const t = S.template(el.dataset.id); if (t) insertTemplate(t); },
    'tpl-edit': el => { editTpl = el.dataset.id; openSettings(); },
    'tpl-cancel': () => { editTpl = null; openSettings(); },
    'tpl-delete': el => { if (!confirm('Diese Vorlage löschen?')) return; S.deleteTemplate(el.dataset.id); editTpl = null; openSettings(); },
    'sync-now': async () => { await S.sync(); if (settingsOpen()) openSettings(); toast(S.statusText); },
    'token-clear': () => { S.setToken(null); openSettings(); },
    export: () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([S.exportJSON()], { type: 'application/json' }));
      a.download = `tagebuch-${todayISO()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
    import: () => $('#import-file').click(),
    'import-folder': () => $('#import-folder').click(),
  };

  document.addEventListener('click', ev => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) return go(nav.dataset.nav);
    const el = ev.target.closest('[data-act]');
    if (!el) { if (ev.target.id === 'lightbox') closeLightbox(); return; }
    const fn = actions[el.dataset.act];
    if (fn) { if (el.tagName === 'BUTTON' && el.type !== 'submit') ev.preventDefault(); fn(el); }
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (!$('#lightbox').hidden) closeLightbox();
      else if (ed) closeEditor();
      else if (!$('#overlay').hidden) closeSettings();
    }
    if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.card')) ev.target.click();
  });
  // Beim Verlassen der App den offenen Eintrag sichern
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ed) commit(); });
  window.addEventListener('pagehide', () => { if (ed) commit(); });

  window.TB_importDiariumFolder = importDiariumFolder;

  // Videos ohne Vorschaubild nachträglich reparieren (einmal pro Start, nur bei sichtbarer App).
  // Fehlversuche merkt sich das Gerät, damit defekte Dateien nicht immer wieder geladen werden.
  let repairing = false;
  async function repairPosters() {
    if (repairing || importing || document.visibilityState !== 'visible') return;
    repairing = true;
    try {
      let failed = [];
      try { failed = JSON.parse(lsGet('tb-poster-fail') || '[]'); } catch {}
      const todo = [];
      S.entries.forEach(e => (e.photos || []).forEach(p => { if (p.kind === 'video' && !p.w && !failed.includes(p.id)) todo.push([e.id, p.id]); }));
      for (const [eid, pid] of todo) {
        if (document.visibilityState !== 'visible') break;
        const r = await S.repairPoster(pid).catch(() => null);
        if (!r) { failed.push(pid); lsSet('tb-poster-fail', JSON.stringify(failed.slice(-500))); continue; }
        const cur = S.entry(eid);
        if (cur && !(ed && ed.entry.id === eid)) S.saveEntry({ ...cur, photos: (cur.photos || []).map(p => p.id === pid ? { ...p, ...r } : p) });
      }
    } finally { repairing = false; }
  }

  // ---------- Start ----------
  S.ready.then(() => {
    S.onChange(() => {
      // Während ein Formular in den Einstellungen offen ist, nichts darunter neu aufbauen, was den Fokus stört
      if (ui.view === 'timeline' && ui.built === 'timeline') { timelineList(); render(); }
      else render();
      if (ed) edMemory();
    });
    render();
    Promise.resolve(S.sync()).then(repairPosters);
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
