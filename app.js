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
    bkFilter: 'open',
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
    let t = (e.text || '').replace(/^\s*#+\s*/gm, '').replace(/^(\s*)- \[[xX ]\] /gm, '$1').replace(/\*\*|~~/g, '').replace(/\n{2,}/g, '\n').trim();
    return t.length > max ? t.slice(0, max).trimEnd() + ' …' : t;
  }
  // Text mit einfacher Formatierung: "## Überschrift" und **fett**.
  function richText(text) {
    return esc(text || '').split('\n').map(l => {
      const h = l.match(/^(\t*)#{1,3}\s+(.*)$/);
      if (h) return `${h[1]}<b class="rt-h">${h[2]}</b>`;
      // Listen und Checkboxen (auch eingerückt, z.B. aus Notion)
      return l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/^(\s*)- \[[xX]\] /, '$1☑ ').replace(/^(\s*)- \[ \] /, '$1☐ ').replace(/^(\s*)- /, '$1• ');
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
      (!q || [e.title, e.text, e.loc && e.loc.name, (e.tags || []).join(' ')].join(' ').replace(/\u0336/g, '').toLowerCase().includes(q)));
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
          <button class="icon-btn" data-act="cal-next" aria-label="Nächstes Jahr">${ms('chevron_right')}</button>
          <button class="btn ghost small cal-review" data-act="week-review" title="Wochen-Review automatisch erstellen">${ms('description')}<span>Wochen-Review</span></button></div>
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
  window.TB_GEO = { load: loadGeo, at: (lat, lng) => countryAt(lat, lng), ready: () => !!geo };
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
  // Tageswert v: bei „Erreichen“ der Fortschritt (z.B. 1500 von 2500 ml), bei „Vermeiden“ die Menge (z.B. Minuten);
  // über dem Limit gilt der Tag als Ausrutscher.
  const HB_COLORS = ['#f6a5ad', '#8fe3cf', '#9ad4f5', '#43e0b5', '#b548e6', '#e884bd', '#f74c4c', '#9ebfd6', '#f5c451', '#7c8cf8'];
  // Patricks Woche läuft von Sonntag bis Samstag
  const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - d.getDay()); return iso(d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  function habitIndex() {
    const m = new Map();
    S.logs.forEach(l => { if (!l.v) return; if (!m.has(l.h)) m.set(l.h, new Map()); m.get(l.h).set(l.date, l.v); });
    return m;
  }
  const hbStart = h => h.start || iso(new Date(h.createdAt || Date.now()));
  const hbDaily = h => h.kind === 'avoid' || !(h.perWeek >= 1 && h.perWeek <= 6);
  const hbDone = (h, v) => h.kind === 'avoid' ? (v || 0) <= (h.target || 0) : (v || 0) >= (h.target || 1);
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
  const hbProgress = (h, v) => h.kind === 'avoid' ? (h.target ? `${v || 0}/${h.target}${h.unit ? ' ' + h.unit : ''} Limit` : v ? `${v}× passiert` : 'Gehalten')
    : `${v || 0}/${h.target || 1}${h.unit ? ' ' + h.unit : ''}`;

  // Stand einer Wochen-Gewohnheit in der Woche (So–Sa) eines Datums: erledigte Tage, Ziel, verbleibende Tage
  function hbWeek(h, days, date) {
    const mon = mondayOf(date), today = todayISO();
    let n = 0;
    for (let i = 0; i < 7; i++) { const d = addDays(mon, i); if (d <= today && hbDone(h, days.get(d))) n++; }
    const goal = h.perWeek || 7;
    const left = mon > today ? 7 : Math.max(0, 7 - Math.round((parse(today) - parse(mon)) / 864e5)); // Tage inkl. heute
    return { n, goal, left, met: n >= goal, risk: n < goal && goal - n >= left - 1 };
  }
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
      let extra = '';
      if (!hbDaily(h)) {
        // Wochen-Gewohnheit: zeigen, wie oft sie diese Woche schon erledigt ist
        const w = hbWeek(h, days, sel);
        extra = `<i class="${w.met ? 'wk-ok' : w.risk && sel === today ? 'wk-risk' : ''}">${w.met ? '✓ ' : ''}${w.n}/${w.goal} diese Woche</i>`
          + (done && w.n > w.goal ? '<i>Extra Tag</i>' : '')
          + (!w.met && sel === today ? `<em>noch ${w.goal - w.n}× in ${w.left} ${w.left === 1 ? 'Tag' : 'Tagen'}</em>` : '');
      }
      const slip = h.kind === 'avoid';
      return `<div class="hb ${slip ? (done ? 'done' : 'slip') : done ? 'done' : ''}" style="--hc:${esc(h.color || HB_COLORS[0])}" data-act="hb-open" data-id="${esc(h.id)}" tabindex="0">
        <span class="hb-ico">${esc(h.icon || '✅')}</span>
        <div class="hb-main"><b>${esc(h.name)}</b><span class="hb-sub"><i>${esc(hbProgress(h, v))}</i>${extra}${h.note ? `<em>${esc(h.note)}</em>` : ''}</span></div>
        <div class="hb-side">${st.n ? `<small>🔥 ${st.n} ${st.unit}</small>` : '<small>&nbsp;</small>'}
          <button class="hb-check" data-act="hb-toggle" data-id="${esc(h.id)}" aria-label="${slip ? 'Ausrutscher eintragen' : 'Erledigt'}" aria-pressed="${slip ? !done : done}">${ms(slip ? 'close' : 'check')}</button></div>
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
    if (h.kind === 'avoid') return S.setLog(id, date, hbDone(h, v) ? (h.target || 0) + 1 : 0);
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
        ${h && (h.kind === 'avoid' ? true : (h.target || 1) > 1) ? `<section class="set"><h3>${esc(date === todayISO() ? 'Heute' : fmtLong(date))}</h3>
          <div class="hb-stepper"><button class="btn ghost" data-act="hb-step" data-d="-1">${ms('remove')}</button>
            <input id="hb-val" type="number" inputmode="decimal" min="0" value="${v}"><span>${h.kind === 'avoid' ? (h.target ? `Limit ${h.target} ${esc(h.unit || '')}` : 'mal passiert') : `von ${h.target} ${esc(h.unit || '')}`}</span>
            <button class="btn ghost" data-act="hb-step" data-d="1">${ms('add')}</button>${h.kind === 'avoid' ? '' : '<button class="btn" data-act="hb-full">Erledigt</button>'}</div></section>` : ''}
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

  // ---------- Wochen-Review automatisch ----------
  // Baut das Wochen-Review nach Patricks Vorlage (Sonntag bis Samstag) und übernimmt aus den Abendroutinen jedes Tages
  // die Antworten: was gut lief, was störte, wie es sich anfühlte, Erkenntnisse, was anders laufen sollte, Glückstag.
  // Die Wochenziele und -aufgaben vom letzten Wochen-Review kommen als „Meine letzten …“ mit hinein.
  // Am Sonntag gilt die gerade beendete Woche.
  function reviewWeekStart() { const t = todayISO(); return parse(t).getDay() === 0 ? addDays(t, -7) : mondayOf(t); }
  const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  // Fragen der Abendroutine (auch leicht abgewandelte Formulierungen)
  const DAY_Q = {
    good: /dinge,? die gut liefen|was lief heute gut|was war heute gut/i,
    bad: /lief heute nicht so gut|störte mich/i,
    feel: /wie fühlte ich mich/i,
    learn: /erkenntnis|gelernt oder erkannt|heute gelernt/i,
    redo: /anders machen/i,
    happy: /glückstag/i,
  };
  // Antwort unter einer Frage: Rest der Fragezeile plus die Zeilen darunter, bis zur nächsten Frage.
  // Für die Tage zählt nur eine Frage am Zeilenanfang (nicht eingerückt), damit z.B. ein Monats-Review mit
  // denselben Fragen in einer Unterliste nicht mitgenommen wird.
  const DAY_STOP = l => Object.values(DAY_Q).some(r => r.test(l)) || /^[-*•]\s/.test(l) || /^#/.test(l) || /^(Morgens|Mittags|Nachmittags|Abends)\b/i.test(l);
  function answerAfter(text, re, stop = DAY_STOP) {
    const lines = String(text || '').split('\n');
    const i = lines.findIndex(l => re.test(l) && !/^\s/.test(l));
    if (i < 0) return '';
    const out = [];
    const rest = lines[i].replace(/^.*?[?:](\s*)/, '').trim();
    if (rest && rest !== lines[i].trim() && !/^[-–]?\s*$/.test(rest) && !/^\(.*\)$/.test(rest)) out.push(rest); // „(3 Punkte)“ gehört zur Frage
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (stop(l)) break; // nächste Frage
      if (l.trim()) out.push(l.replace(/^\s+/, ''));
    }
    return out.filter(l => !/^([-*•]|\d+\.)?\s*$/.test(l)).join('\n');
  }
  // Zahlen und Feedback der Woche: Tagebuch, Gewohnheiten im Vergleich zur Vorwoche, Hinweise und Vorschläge
  function weekStats(start, days, ents) {
    const end = days[6], today = todayISO();
    const past = days.filter(d => d <= today);
    const short = d => parse(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const wd = d => WD[parse(d).getDay()];
    const L = [];
    const withEntry = new Set(ents.map(e => e.date));
    const missing = past.filter(d => !withEntry.has(d));
    const noEvening = past.filter(d => withEntry.has(d) && !ents.some(e => e.date === d && Object.values(DAY_Q).some(r => answerAfter(e.text, r))));
    const rated = ents.filter(e => e.rating);
    L.push('## Tagebuch in Zahlen');
    L.push(`- Einträge an ${withEntry.size} von ${past.length} Tagen${missing.length ? ` (ohne Eintrag: ${missing.map(d => wd(d) + ' ' + short(d)).join(', ')})` : ''}`);
    if (noEvening.length) L.push(`- Abendroutine nicht ausgefüllt: ${noEvening.map(d => wd(d) + ' ' + short(d)).join(', ')}`);
    if (rated.length) {
      const best = rated.reduce((a, b) => b.rating > a.rating ? b : a), worst = rated.reduce((a, b) => b.rating < a.rating ? b : a);
      L.push(`- Bester Tag: ${wd(best.date)} mit ${best.rating}${worst !== best ? `, schwächster: ${wd(worst.date)} mit ${worst.rating}` : ''}`);
    }
    const places = [...new Set(ents.filter(e => e.loc && e.loc.name).map(e => e.loc.name.split(',').slice(-2).map(x => x.trim()).join(', ')))];
    if (places.length) L.push(`- Orte: ${places.join(' · ')}`);
    const tagc = new Map(); ents.forEach(e => (e.tags || []).forEach(t => tagc.set(t, (tagc.get(t) || 0) + 1)));
    if (tagc.size) L.push(`- Tags: ${[...tagc].map(([t, n]) => n > 1 ? `${t} (${n}×)` : t).join(', ')}`);
    // Gewohnheiten
    const idx = habitIndex();
    const good = [], weak = [], notes = [];
    const habits = S.habits.filter(h => !h.archived && hbStart(h) <= end);
    if (habits.length) L.push('', '## Gewohnheiten');
    habits.forEach(h => {
      const dv = idx.get(h.id) || new Map();
      const act = past.filter(d => d >= hbStart(h));
      if (!act.length) return;
      const okDays = act.filter(d => hbDone(h, dv.get(d))).length;
      const prev = days.map(d => addDays(d, -7)).filter(d => d >= hbStart(h));
      const prevOk = prev.filter(d => hbDone(h, dv.get(d))).length;
      const unitPrev = h.kind === 'avoid' ? `${prevOk} Tage gehalten` : hbDaily(h) ? `${prevOk} Tage` : `${prevOk}×`;
      const trend = prev.length ? (okDays - prevOk > 0 ? ` (besser als Vorwoche: ${unitPrev})` : okDays - prevOk < 0 ? ` (schlechter als Vorwoche: ${unitPrev})` : ' (wie Vorwoche)') : '';
      const st = hbStreak(h, dv, today);
      const streak = st.n > 1 ? ` · Serie ${st.n} ${st.unit}` : '';
      if (h.kind === 'avoid') {
        const slips = act.length - okDays;
        L.push(`- ${h.icon || ''} ${h.name}: ${okDays} von ${act.length} Tagen gehalten${slips ? `, ${slips} Ausrutscher` : ''}${trend}${streak}`);
        (slips ? weak : good).push(h.name);
        if (slips >= 2) notes.push(`${h.name}: ${slips} Ausrutscher. Was war an diesen Tagen anders?`);
      } else if (!hbDaily(h)) {
        const goal = h.perWeek;
        L.push(`- ${h.icon || ''} ${h.name}: ${okDays} von ${goal}× ${okDays >= goal ? '✓' : '✗'}${trend}${streak}`);
        (okDays >= goal ? good : weak).push(h.name);
        if (okDays < goal) notes.push(`${h.name}: Wochenziel ${goal}× verfehlt (${okDays}×). Feste Tage im Kalender blocken.`);
      } else {
        const pct = Math.round(okDays / act.length * 100);
        let extra = '';
        if ((h.target || 1) > 1) {
          const vals = act.map(d => dv.get(d) || 0), avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          extra = ` · Schnitt ${Math.round(avg).toLocaleString('de-DE')} von ${(+h.target).toLocaleString('de-DE')}${h.unit ? ' ' + h.unit : ''}`;
        }
        L.push(`- ${h.icon || ''} ${h.name}: ${okDays} von ${act.length} Tagen (${pct} %)${extra}${trend}${streak}`);
        (pct === 100 ? good : pct < 70 ? weak : []).push(h.name);
        if (pct < 70) notes.push(`${h.name}: nur ${okDays} von ${act.length} Tagen. An eine feste Uhrzeit oder Gewohnheit koppeln.`);
      }
    });
    // Feedback
    L.push('', '## Feedback');
    const fb = L.length;
    if (good.length) L.push(`- Stark: ${good.join(', ')}`);
    if (weak.length) L.push(`- Mehr Aufmerksamkeit: ${weak.join(', ')}`);
    notes.forEach(n => L.push('- ' + n));
    if (missing.length >= 2) L.push(`- ${missing.length} Tage ohne Tagebucheintrag. Für den Länderzähler zählt jeder Tag mit Ort.`);
    if (noEvening.length >= 2) L.push(`- An ${noEvening.length} Tagen fehlt die Abendroutine. Genau diese Antworten füllen das Wochen-Review.`);
    if (L.length === fb) L.push('- Alles im grünen Bereich.');
    // Vorschläge
    const sug = bucketSuggestions(3);
    if (weak.length || sug.length) {
      L.push('', '## Für nächste Woche');
      if (weak.length) L.push(`- Fokus-Gewohnheit: ${weak[0]}`);
      sug.forEach(({ b, reason }) => L.push(`- Bucket-Liste: ${b.title} (${reason})`));
    }
    return L;
  }
  function buildWeekReview(start) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const end = days[6], today = todayISO();
    const short = d => parse(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const isReview = e => (e.tags || []).includes('Wochen-Review') || /^Wochen-?review/i.test(e.title || '');
    const isOther = e => (e.tags || []).some(t => /review|rückblick|planung/i.test(t)); // Monats-Review, Jahresplanung …
    const ents = S.entries.filter(e => e.date >= start && e.date <= end && !isReview(e) && !isOther(e))
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const byDay = d => ents.filter(e => e.date === d);
    // Pro Tag die Antwort auf eine Frage, mehrzeilige Antworten eingerückt darunter
    const perDay = key => days.map(d => {
      let ans = byDay(d).map(e => answerAfter(e.text, DAY_Q[key])).filter(Boolean).join('\n');
      if (key === 'happy' && !ans && byDay(d).some(e => (e.tags || []).includes('Glückstag'))) ans = 'Glückstag';
      const label = `- ${WD_LONG[parse(d).getDay()]} (${short(d)}):`;
      if (!ans) return label;
      const ls = ans.split('\n');
      return ls.length === 1 && !/^\d+\./.test(ls[0]) ? `${label} ${ls[0]}` : `${label}\n${ls.map(l => '\t' + l).join('\n')}`;
    });
    // Bewertungen der Tage als Hilfe für die eigene Wochenbewertung
    const rated = days.map(d => [d, byDay(d).map(e => e.rating).filter(Boolean)]).filter(([, r]) => r.length).map(([d, r]) => [d, Math.max(...r)]);
    const avg = rated.length ? rated.reduce((n, [, r]) => n + r, 0) / rated.length : 0;
    const ratingLine = rated.length ? `Schnitt der Tage: ${avg.toFixed(1).replace('.', ',')} von 10 (${rated.map(([d, r]) => `${WD[parse(d).getDay()]} ${r}`).join(' · ')})` : '';
    // Letztes Wochen-Review: Ziele und Aufgaben für diese Woche
    const prev = S.entries.filter(e => isReview(e) && e.date < start).sort((a, b) => b.date.localeCompare(a.date))[0];
    const RV_Q = /^\s*(#+\s*)?(\*\*)?(was |wie |wenn |welche|meine |notion|»)/i; // Fragezeilen des Wochen-Reviews
    const prevAns = re => prev ? answerAfter(prev.text, re, l => RV_Q.test(l) && !re.test(l)) : '';
    const lastGoals = prevAns(/noch besser zu werden/i);
    const lastTasks = prevAns(/wichtigsten Aufgaben nächste Woche/i);
    const block = t => t ? t.split('\n').map(l => /^([-*•]|\d+\.)\s/.test(l) ? l : '- ' + l).join('\n') : '';

    const L = [
      '## Was war alles gut? (Sonntag – Samstag)', ...perDay('good'), '',
      '## Was für eine Bewertung privat habe ich diese Woche?', ...(ratingLine ? [ratingLine] : []), '', '',
      '## Was lief nicht so gut oder störte mich?', ...perDay('bad'), '',
      '## Wie fühlte ich mich diese Woche?', ...perDay('feel'), '',
      '## Meine Learnings der Woche', ...perDay('learn'), '',
      '## Was macht mich wirklich glücklich?', ...perDay('happy').filter(l => l.includes('\n') || !/:$/.test(l)), '', '',
      '## Wenn ich exakt die gleiche Woche nochmal so durchleben dürfte, mit allem, was ich weiß, was kommt und kommen wird: Was würde ich beim nächsten Mal anders machen?',
      ...perDay('redo').filter(l => l.includes('\n') || !/:$/.test(l)), '', '',
      '## Wie viel Zeit habe ich für was benötigt?', '- Videos schauen: ', '- Fulfillment: ', '- Am Unternehmen: ', '- Vertrieb: ', '- Privat: ', '',
      '## Was sind die 20 % der Dinge, die mich 80 % weiterbringen?',
      'Was mache ich zu 80 %, was mir nur 20 % Ergebnis bringt? Being busy but going nowhere: Nur weil du viel tust, heißt es noch lange nicht, dass du auch effektiv bist.', '', '',
      '## Welches ist die EINE Sache, die ich tun kann, sodass alles andere einfacher oder sogar überflüssig wird?', '', '',
      '## Wie war die Woche für meine Jahresziele?',
      '- Beruf / Karriere: ', '- Finanzen / Wohlstand: ', '- Körper / Fitness / Gesundheit: ', '- Spiritualität: ', '- Liebe / Partnerschaft: ',
      '- Emotionale Fitness: ', '- Umfeld / Sozialleben: ', '- Organisation / Zeit: ', '',
      '## Meine letzten Wochenziele', ...(lastGoals ? [block(lastGoals)] : []), '',
      '## Was muss ich nächste Woche machen, um noch besser zu werden? (3 Punkte)', '1. ', '2. ', '3. ', '',
      '## Meine letzten Wochenaufgaben', ...(lastTasks ? [block(lastTasks)] : []), '',
      '## Was sind die 3 wichtigsten Aufgaben nächste Woche?', '1. ', '2. ', '3. ', '',
      ...weekStats(start, days, ents), '',
    ];
    return { title: `Wochen-Review ${short(start)}–${short(end)}`, text: L.join('\n'), date: end > today ? today : end };
  }
  function createWeekReview() {
    const r = buildWeekReview(reviewWeekStart());
    const old = S.entries.find(e => e.title === r.title && (e.tags || []).includes('Wochen-Review'));
    if (old && !confirm('Für diese Woche gibt es schon ein Wochen-Review. Ein neues anlegen?')) return openEditor(old.id);
    const now = new Date();
    const e = S.saveEntry({ date: r.date, time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, title: r.title, text: r.text, rating: null, tags: ['Wochen-Review'], loc: null, photos: [] });
    if (!$('#overlay').hidden && !ed) { $('#overlay').hidden = true; $('#overlay').innerHTML = ''; }
    openEditor(e.id);
    toast('Wochen-Review erstellt');
  }
  window.TB_buildWeekReview = buildWeekReview;

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
    const open = S.habits.filter(h => !h.archived && h.kind !== 'avoid' && hbStart(h) <= today && (hbDaily(h)
      ? !hbDone(h, (idx.get(h.id) || new Map()).get(today))
      : !hbDone(h, (idx.get(h.id) || new Map()).get(today)) && hbWeek(h, idx.get(h.id) || new Map(), today).risk)); // Wochen-Ziel wird knapp
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

  // ---------- Ansicht: Bucket-Liste ----------
  // Ziele mit Lebensphase (Alter von–bis), Ort und passenden Monaten. Daraus entstehen Vorschläge:
  // was sich bald schließt, was gerade in der Nähe liegt, was in die Jahreszeit passt.
  const BK_CATS = ['Reise', 'Erlebnis', 'Sport', 'Menschen', 'Lernen', 'Beruf', 'Sonstiges'];
  const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const bkProfile = () => S.bucketItem('_profile') || {};
  function bkAge() {
    const b = bkProfile().birth; if (!b) return null;
    const t = new Date(), d = parse(b);
    return t.getFullYear() - d.getFullYear() - (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate()) ? 1 : 0);
  }
  const kmBetween = (a, b) => {
    const R = 6371, rad = x => x * Math.PI / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const lastPlace = () => { const e = sorted().find(x => x.loc && x.loc.lat != null); return e ? e.loc : null; };
  const eur = n => Math.round(n).toLocaleString('de-DE') + ' €';
  // Kosten des Erlebnisses vor Ort (ohne Anreise): einmalig oder pro Tag
  // Rechnung „10 Tage vor Ort“: Anreise + 10 × Tagesbudget (+ einmalige Kosten des Erlebnisses)
  const TRIP_DAYS = 10;
  const bkDayRate = b => b.dayRate || (b.costPer === 'day' ? b.cost : 0);
  const bkTrip = b => b.travel != null && bkDayRate(b) ? b.travel + TRIP_DAYS * bkDayRate(b) + (b.costPer !== 'day' && b.cost ? b.cost : 0) : null;
  const bkCost = b => b.cost ? `ca. ${eur(b.cost)}${b.costPer === 'day' ? ' pro Tag' : ''}` : b.cost === 0 ? 'kostenlos' : '';
  const bkSub = b => [bkCost(b), b.cat, b.loc && b.loc.name, b.ageTo ? `bis ${b.ageTo} Jahre` : '', (b.months || []).length ? (b.months || []).map(m => MONTHS[m]).join(', ') : '', b.plan ? 'geplant ' + parse(b.plan + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : ''].filter(Boolean).join(' · ');

  // Vorschläge mit Begründung, wichtigste zuerst
  function bucketSuggestions(max = 5) {
    const open = S.bucket.filter(b => !b.done);
    const age = bkAge(), here = lastPlace(), now = new Date();
    const m = now.getMonth(), ym = `${now.getFullYear()}-${pad(m + 1)}`;
    const out = [], seen = new Set();
    const add = (b, reason) => { if (!seen.has(b.id) && out.length < max) { seen.add(b.id); out.push({ b, reason }); } };
    open.filter(b => b.plan && b.plan <= ym).forEach(b => add(b, b.plan === ym ? 'Für diesen Monat geplant' : 'War schon geplant und ist noch offen'));
    const hereCountry = here && here.name ? here.name.split(',').pop().trim() : '';
    if (here) open.filter(b => b.loc && b.loc.lat != null && !b.loc.wide).map(b => [b, kmBetween(here, b.loc)]).filter(x => x[1] <= 150).sort((x, y) => x[1] - y[1])
      .forEach(([b, km]) => add(b, `In der Nähe: rund ${Math.max(1, Math.round(km))} km von ${here.name ? here.name.split(',').slice(-2, -1)[0].trim() || 'deinem letzten Ort' : 'deinem letzten Ort'}`));
    if (hereCountry) open.filter(b => b.loc && b.loc.country === hereCountry).forEach(b => add(b, `Du bist gerade in ${hereCountry}`));
    if (age != null) open.filter(b => b.ageTo && b.ageTo - age <= 2).sort((x, y) => x.ageTo - y.ageTo)
      .forEach(b => add(b, b.ageTo < age ? `Zeitfenster war bis ${b.ageTo}, jetzt nachholen` : b.ageTo === age ? 'Zeitfenster endet dieses Lebensjahr' : `Zeitfenster endet mit ${b.ageTo}`));
    open.filter(b => (b.months || []).includes(m) || (b.months || []).includes((m + 1) % 12)).forEach(b => add(b, (b.months || []).includes(m) ? 'Passt in diesen Monat' : 'Passt in den nächsten Monat'));
    [...open].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0)).forEach(b => add(b, 'Steht schon länger auf deiner Liste'));
    return out;
  }
  // Als Nächstes: alles mit „Geplant für“, nach Monat sortiert. Dazu Hinweise, was sich kombinieren lässt:
  // geplante Ziele nah beieinander in verschiedenen Monaten und offene Ziele in der Nähe eines geplanten.
  const BK_NEAR_KM = 350;
  const bkMonthName = ym => parse(ym + '-01').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const bkMonthShort = ym => parse(ym + '-01').toLocaleDateString('de-DE', { month: 'short' }).replace('.', '');
  function bkUntil(ym) {
    const now = new Date(), d = (+ym.slice(0, 4) - now.getFullYear()) * 12 + (+ym.slice(5, 7) - 1 - now.getMonth());
    return d < 0 ? 'schon vorbei, noch offen' : d === 0 ? 'diesen Monat' : d === 1 ? 'nächsten Monat' : `in ${d} Monaten`;
  }
  const hasPos = b => b.loc && b.loc.lat != null;
  function bkTips(planned, open) {
    const tips = [];
    planned.forEach((a, i) => planned.slice(i + 1).forEach(b => {
      if (!hasPos(a) || !hasPos(b) || a.plan === b.plan) return;
      const km = Math.round(kmBetween(a.loc, b.loc));
      if (km > BK_NEAR_KM) return;
      const save = Math.min(a.travel || 0, b.travel || 0);
      tips.push({ text: `${a.title} (${bkMonthShort(a.plan)}) und ${b.title} (${bkMonthShort(b.plan)}) liegen nur rund ${km} km auseinander. In einer Reise kombiniert sparst du eine Anreise${save ? ` von ca. ${eur(save)}` : ''}.` });
    }));
    planned.forEach(p => {
      const m = +p.plan.slice(5, 7) - 1;
      if ((p.months || []).length && !p.months.includes(m)) tips.push({ text: `${p.title} passt laut deinen Monaten eher in ${p.months.map(x => MONTHS[x]).join(', ')}, geplant ist ${bkMonthShort(p.plan)}.` });
    });
    // Jedes offene Ziel nur beim nächstgelegenen geplanten Ziel vorschlagen
    const withPos = planned.filter(hasPos);
    open.filter(b => !b.plan && hasPos(b) && !b.loc.wide).map(b => {
      const [p, km] = withPos.map(p => [p, Math.round(kmBetween(p.loc, b.loc))]).sort((x, y) => x[1] - y[1])[0] || [];
      return { b, p, km };
    }).filter(x => x.p && x.km <= BK_NEAR_KM).sort((x, y) => x.km - y.km)
      .forEach(({ b, p, km }) => tips.push({ id: b.id, plan: p.plan, text: `${b.title} liegt rund ${km} km von ${p.title} entfernt, gleich mitnehmen${bkCost(b) ? ` (vor Ort ${bkCost(b)})` : ''}.` }));
    return tips;
  }
  function bkNext(open) {
    const planned = open.filter(b => b.plan).sort((x, y) => x.plan.localeCompare(y.plan) || (x.createdAt || 0) - (y.createdAt || 0));
    if (!planned.length) return '';
    const byMonth = new Map();
    planned.forEach(b => { if (!byMonth.has(b.plan)) byMonth.set(b.plan, []); byMonth.get(b.plan).push(b); });
    const tips = bkTips(planned, open);
    return `<h2 class="ct-h">Als Nächstes</h2>
      ${[...byMonth.entries()].map(([ym, items]) => `<p class="bk-mon">${ms('calendar_month')}<b>${esc(bkMonthName(ym))}</b><span class="bk-until">${bkUntil(ym)}</span></p><div class="list">${items.map(bkRow).join('')}</div>`).join('')}
      ${tips.length ? `<section class="memory bk-tips"><header>${ms('star')}<div><b>Passt dazu</b><span>Was sich mit deinen Plänen verbinden lässt</span></div></header>
        ${tips.map(t => `<div class="bk sug"><div><small>${esc(t.text)}</small></div>${t.id ? `<button class="btn small ghost" data-act="bk-plan-at" data-id="${esc(t.id)}" data-plan="${esc(t.plan)}">Mit einplanen</button>` : ''}</div>`).join('')}</section>` : ''}`;
  }
  function bkRow(b) {
    return `<div class="bk ${b.done ? 'done' : ''}" data-act="bk-open" data-id="${esc(b.id)}" tabindex="0">
      <button class="hb-check" data-act="bk-toggle" data-id="${esc(b.id)}" aria-pressed="${!!b.done}" aria-label="Erledigt">${ms('check')}</button>
      <div><b>${esc(b.title)}</b>${bkSub(b) ? `<small>${esc(bkSub(b))}</small>` : ''}${b.costNote ? `<small class="bk-note">${esc(b.costNote)}</small>` : ''}${bkTrip(b) ? `<small class="bk-trip">${TRIP_DAYS} Tage vor Ort inkl. Anreise: ca. ${eur(bkTrip(b))}</small>` : ''}${b.travel != null ? `<small class="bk-travel">${ms('luggage')}Anreise ab Deutschland: ${b.travel ? 'ca. ' + eur(b.travel) : 'keine'}${b.travelNote ? ' · ' + esc(b.travelNote) : ''}</small>` : ''}</div></div>`;
  }
  function viewBucket(main) {
    const all = S.bucket;
    const age = bkAge();
    const open = all.filter(b => !b.done), done = all.filter(b => b.done);
    const list = ui.bkFilter === 'done' ? done : ui.bkFilter === 'all' ? all : open;
    // Lebensphasen in 5-Jahres-Abschnitten, wie die „Zeit-Eimer“ aus Die with Zero
    const phase = b => b.done && ui.bkFilter !== 'open' ? 'Erledigt' : !b.ageTo ? 'Ohne Zeitfenster' : age != null && b.ageTo < age ? 'Zeitfenster überschritten' : `Bis ${Math.ceil(b.ageTo / 5) * 5} Jahre`;
    const groups = new Map();
    // Geplante stehen bei „Offen“ oben unter „Als Nächstes“, nicht noch einmal in den Lebensphasen
    list.filter(b => ui.bkFilter !== 'open' || !b.plan).sort((x, y) => (x.ageTo || 999) - (y.ageTo || 999) || (x.createdAt || 0) - (y.createdAt || 0)).forEach(b => { const k = phase(b); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
    const sug = ui.bkFilter === 'open' ? bucketSuggestions(4) : [];
    // Summe der offenen einmaligen Erlebnisse; Tagesbudgets und Anschaffungen laufen getrennt
    const buy = b => b.cat === 'Sonstiges' || b.cat === 'Beruf';
    const sumOnce = open.filter(b => b.cost && b.costPer !== 'day' && !buy(b)).reduce((n, b) => n + b.cost, 0);
    const sumBuy = open.filter(b => b.cost && buy(b)).reduce((n, b) => n + b.cost, 0);
    const noCost = open.filter(b => b.cost == null).length;
    const sumTravel = open.filter(b => b.travel).reduce((n, b) => n + b.travel, 0);
    const trips = open.filter(b => bkTrip(b)), sumTrips = trips.reduce((n, b) => n + bkTrip(b), 0);
    main.innerHTML = `<div class="page">
      <header class="page-head row"><div><h1>Bucket-Liste</h1><p>${open.length} offen · ${done.length} erledigt${age != null ? ` · du bist ${age}` : ''}</p></div>
        <div class="row-btns"><button class="btn" data-act="bk-new">${ms('add')} Ziel</button></div></header>
      ${bkProfile().birth ? '' : `<section class="set"><h3>Geburtsdatum</h3><p class="hint">Damit die Liste nach Lebensphasen sortiert und warnt, wenn sich ein Zeitfenster schließt.</p>
        <form id="bk-birth" class="hb-stepper"><input type="date" name="birth" required style="width:auto"><button class="btn">Speichern</button></form></section>`}
      ${ui.bkFilter === 'open' ? bkNext(open) : ''}
      ${sug.length ? `<section class="memory"><header>${ms('star')}<div><b>Vorschläge für jetzt</b><span>Für deine Wochen- und Monatsplanung</span></div></header>
        ${sug.map(({ b, reason }) => `<div class="bk sug" data-act="bk-open" data-id="${esc(b.id)}" tabindex="0"><div><em>${esc(reason)}</em><b>${esc(b.title)}</b>${bkSub(b) ? `<small>${esc(bkSub(b))}</small>` : ''}</div>
          <button class="btn small ghost" data-act="bk-plan" data-id="${esc(b.id)}">Diesen Monat</button></div>`).join('')}</section>` : ''}
      ${sumOnce || sumBuy ? `<div class="ct-tiles bk-cost"><div><b>${eur(sumOnce)}</b><span>einmalige Erlebnisse vor Ort</span></div><div><b>${eur(sumTrips)}</b><span>${trips.length} Reiseziele mit je ${TRIP_DAYS} Tagen vor Ort inkl. Anreise</span></div><div><b>${eur(sumTravel)}</b><span>nur Anreise ab Deutschland, alle Ziele einzeln</span></div><div><b>${eur(sumBuy)}</b><span>offene Anschaffungen</span></div></div>
        <p class="hint">Geschätzte Kosten des Erlebnisses vor Ort, ohne Anreise. Reiseziele stehen als Tagesbudget in der Zeile und sind in der Summe nicht enthalten. Die Anreise ab Deutschland steht je Ziel in einer eigenen Zeile, falls du schon in der Gegend bist. Bei Reisezielen rechnet die App zusätzlich mit ${TRIP_DAYS} Tagen vor Ort: Anreise plus ${TRIP_DAYS} × Tagesbudget plus Eintritt. ${noCost ? `${noCost} Ziele haben noch keine Kostenangabe.` : ''}</p>` : ''}
      <div class="chips">${[['open', 'Offen'], ['done', 'Erledigt'], ['all', 'Alle']].map(([k, n]) => `<button class="chip" data-act="bk-filter" data-f="${k}" aria-pressed="${ui.bkFilter === k}">${n}</button>`).join('')}</div>
      ${all.length ? [...groups.entries()].map(([k, items]) => `<h2 class="ct-h">${esc(k)}</h2><div class="list">${items.map(bkRow).join('')}</div>`).join('') || '<p class="hint">Hier ist nichts.</p>'
        : empty('flag', 'Noch keine Ziele', 'Trage ein, was du in deinem Leben noch machen willst. Mit „+ Ziel“ gehen auch mehrere Zeilen auf einmal.')}
    </div>`;
    const bf = $('#bk-birth');
    if (bf) bf.addEventListener('submit', ev => { ev.preventDefault(); S.saveBucket({ id: '_profile', birth: new FormData(bf).get('birth') }); });
    ui.built = 'bucket';
  }
  let bkEdit = null, bkLoc = null;
  function openBucket(id) {
    const b = id ? S.bucketItem(id) : null;
    bkEdit = id || null;
    bkLoc = b && b.loc ? { ...b.loc } : null;
    const d = b || { title: '', cat: 'Erlebnis', note: '', ageFrom: '', ageTo: '', months: [], plan: '' };
    const o = $('#overlay');
    o.hidden = false;
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Ziel">
      <header class="sheet-head"><button class="icon-btn" data-act="set-close" aria-label="Zurück">${ms('arrow_back')}</button><b>${b ? 'Ziel bearbeiten' : 'Neues Ziel'}</b></header>
      <div class="sheet-body"><section class="set">
        <form id="bk-form" class="tplform">
          ${b ? `<input name="title" type="text" value="${esc(d.title)}" placeholder="Was willst du erleben?" required>`
            : `<textarea name="title" rows="3" placeholder="Was willst du erleben? Mehrere Ziele: eine Zeile pro Ziel." required></textarea>`}
          <div class="hb-f3"><label>Bereich<select name="cat">${BK_CATS.map(c => `<option ${c === d.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            <label>Ab Alter<input name="ageFrom" type="number" inputmode="numeric" min="0" max="120" value="${esc(d.ageFrom || '')}"></label>
            <label>Bis Alter<input name="ageTo" type="number" inputmode="numeric" min="0" max="120" value="${esc(d.ageTo || '')}" placeholder="z.B. 40"></label></div>
          <label>Passende Monate</label>
          <div class="bk-months">${MONTHS.map((m, i) => `<label><input type="checkbox" name="months" value="${i}" ${(d.months || []).includes(i) ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div>
          <label>Ort (für Vorschläge in der Nähe)</label>
          <div id="bk-loc"></div>
          <div class="hb-f3"><label>Geplant für<input name="plan" type="month" value="${esc(d.plan || '')}"></label>
            ${b ? `<label>Erledigt am<input name="done" type="date" value="${esc(d.done || '')}"></label>` : ''}</div>
          <div class="hb-f3"><label>Kosten vor Ort (€)<input name="cost" type="number" inputmode="decimal" min="0" value="${esc(d.cost == null ? '' : d.cost)}" placeholder="ohne Anreise"></label>
            <label>Gilt<select name="costPer"><option value="" ${d.costPer !== 'day' ? 'selected' : ''}>einmalig</option><option value="day" ${d.costPer === 'day' ? 'selected' : ''}>pro Tag</option></select></label></div>
          <input name="costNote" type="text" value="${esc(d.costNote || '')}" placeholder="Wofür genau, z.B. Tandemsprung pro Person">
          <div class="hb-f3"><label>Tagesbudget vor Ort (€)<input name="dayRate" type="number" inputmode="decimal" min="0" value="${esc(d.dayRate || '')}" placeholder="${d.costPer === 'day' && d.cost ? 'wie oben' : 'für die 10-Tage-Rechnung'}"></label><label>Anreise ab Deutschland (€)<input name="travel" type="number" inputmode="decimal" min="0" value="${esc(d.travel == null ? '' : d.travel)}" placeholder="hin und zurück"></label></div>
          <input name="travelNote" type="text" value="${esc(d.travelNote || '')}" placeholder="Womit, z.B. Hin- und Rückflug pro Person">
          <textarea name="note" rows="3" placeholder="Notiz: mit wem, was es braucht, warum es dir wichtig ist">${esc(d.note || '')}</textarea>
          <div class="row-btns">${b ? `<button type="button" class="btn danger ghost" data-act="bk-delete" data-id="${esc(b.id)}">Löschen</button>` : ''}<button class="btn">Speichern</button></div>
        </form></section></div></div>`;
    bkLocBox();
    $('#bk-form').addEventListener('submit', ev => {
      if (ev.submitter && ev.submitter.dataset.act) return;
      ev.preventDefault();
      const f = new FormData(ev.target);
      const int = k => { const n = parseInt(f.get(k), 10); return isFinite(n) && n > 0 ? n : null; };
      const base = { cat: String(f.get('cat')), ageFrom: int('ageFrom'), ageTo: int('ageTo'), months: f.getAll('months').map(Number), plan: String(f.get('plan') || ''), note: String(f.get('note')).trim(), loc: bkLoc,
        cost: String(f.get('cost')).trim() === '' ? null : Math.max(0, parseFloat(String(f.get('cost')).replace(',', '.')) || 0), costPer: String(f.get('costPer') || ''), costNote: String(f.get('costNote')).trim(),
        travel: String(f.get('travel')).trim() === '' ? null : Math.max(0, parseFloat(String(f.get('travel')).replace(',', '.')) || 0), travelNote: String(f.get('travelNote')).trim(),
        dayRate: Math.max(0, parseFloat(String(f.get('dayRate')).replace(',', '.')) || 0) || null };
      if (b) S.saveBucket({ ...b, ...base, title: String(f.get('title')).trim(), done: String(f.get('done') || '') });
      else String(f.get('title')).split('\n').map(t => t.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean).forEach((title, i) => S.saveBucket({ ...base, title, done: '', createdAt: Date.now() + i }));
      closeSettings(); toast('Gespeichert');
    });
  }
  function bkLocBox() {
    const box = $('#bk-loc'); if (!box) return;
    box.innerHTML = (bkLoc ? `<div class="locbox"><input type="text" value="${esc(bkLoc.name || '')}" readonly><button type="button" class="icon-btn" data-act="bk-loc-clear" aria-label="Ort entfernen">${ms('close')}</button></div>` : '')
      + `<div class="locrow"><div class="search small">${ms('search')}<input id="bk-loc-q" type="search" placeholder="Ort suchen und Enter drücken" autocomplete="off" enterkeyhint="search"></div></div><div id="bk-loc-results" class="menu inline" hidden></div>`;
    $('#bk-loc-q').addEventListener('keydown', async ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const q = ev.target.value.trim(); if (!q) return;
      const res = $('#bk-loc-results'); res.hidden = false; res.innerHTML = '<p class="hint">Suche …</p>';
      try {
        const data = await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=de`)).json();
        const feats = (data.features || []).filter(f => f.geometry && f.geometry.coordinates);
        if (!$('#bk-loc-results')) return;
        res.innerHTML = feats.length ? feats.map(f => `<button type="button" data-act="bk-loc-pick" data-lat="${f.geometry.coordinates[1]}" data-lng="${f.geometry.coordinates[0]}" data-name="${esc(placeName(f.properties))}" data-country="${esc(f.properties.country || '')}" data-wide="${/^(country|state|continent)$/.test(f.properties.type || '') ? 1 : ''}">${ms('location_on')}${esc(placeName(f.properties))}</button>`).join('') : '<p class="hint">Kein Ort gefunden.</p>';
      } catch { res.innerHTML = '<p class="hint">Die Ortssuche ist gerade nicht erreichbar.</p>'; }
    });
  }

  // ---------- Ansicht: Lebenszeit ----------
  // Wie viel Zeit bleibt bis zum gewählten Alter, und wie viele Sommer, Winter und Weihnachten sind das noch.
  function viewLife(main) {
    const prof = bkProfile();
    const goal = prof.lifeAge || 88;
    if (!prof.birth) {
      main.innerHTML = `<div class="page"><header class="page-head"><h1>Lebenszeit</h1></header>
        <section class="set"><h3>Geburtsdatum</h3><p class="hint">Damit die App ausrechnen kann, wie viel Zeit bis zu deinem Zielalter bleibt.</p>
        <form id="life-form" class="hb-stepper"><input type="date" name="birth" required style="width:auto"><button class="btn">Speichern</button></form></section></div>`;
      $('#life-form').addEventListener('submit', ev => { ev.preventDefault(); S.saveBucket({ ...prof, id: '_profile', birth: new FormData(ev.target).get('birth') }); });
      ui.built = 'life'; return;
    }
    const birth = parse(prof.birth);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const end = new Date(birth.getFullYear() + goal, birth.getMonth(), birth.getDate());
    const left = end > now;
    // Jahre, Monate, Tage bis zum Zieltag
    let y = end.getFullYear() - now.getFullYear(), m = end.getMonth() - now.getMonth(), d = end.getDate() - now.getDate();
    if (d < 0) { m--; d += new Date(end.getFullYear(), end.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    const days = Math.max(0, Math.round((end - now) / 864e5));
    const lived = Math.round((now - birth) / 864e5);
    const share = Math.min(100, lived / (lived + days) * 100);
    // Wie oft kommt ein Datum (Monat, Tag) noch zwischen heute und dem Zieltag?
    const times = (mon, day) => { let n = 0; for (let yy = now.getFullYear(); yy <= end.getFullYear(); yy++) { const t = new Date(yy, mon, day); if (t >= now && t <= end) n++; } return n; };
    // Eine Jahreszeit zählt, wenn sie noch nicht vorbei ist und vor dem Zieltag beginnt
    const seasons = (startMon, endMon) => { let n = 0; for (let yy = now.getFullYear() - 1; yy <= end.getFullYear(); yy++) { const a = new Date(yy, startMon, 1), b = new Date(yy + (endMon < startMon ? 1 : 0), endMon + 1, 0); if (b >= now && a <= end) n++; } return n; };
    const age = bkAge();
    const tiles = left ? [
      ['☀️', seasons(5, 7), 'Sommer'], ['🍂', seasons(8, 10), 'Herbste'], ['❄️', seasons(11, 1), 'Winter'], ['🌷', seasons(2, 4), 'Frühlinge'],
      ['🎄', times(11, 24), 'Weihnachten'], ['🎆', times(11, 31), 'Silvester'], ['🎂', times(birth.getMonth(), birth.getDate()), 'Geburtstage'], ['🗓️', Math.floor(days / 7), 'Wochenenden'],
    ] : [];
    const open = S.bucket.filter(b => !b.done).length;
    main.innerHTML = `<div class="page">
      <header class="page-head"><h1>Lebenszeit</h1><p>Du bist ${age}. Gerechnet wird bis ${goal}.</p></header>
      ${left ? `<section class="life-count"><div><b>${y}</b><span>${y === 1 ? 'Jahr' : 'Jahre'}</span></div><div><b>${m}</b><span>${m === 1 ? 'Monat' : 'Monate'}</span></div><div><b>${d}</b><span>${d === 1 ? 'Tag' : 'Tage'}</span></div></section>
        <p class="life-days">Das sind noch <b>${days.toLocaleString('de-DE')}</b> Tage, bis zum ${end.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
        <div class="life-bar" role="img" aria-label="${Math.round(share)} Prozent der Zeit bis ${goal} sind vorbei"><i style="width:${share}%"></i></div>
        <p class="hint">${share.toFixed(1).replace('.', ',')} % der Zeit bis ${goal} sind vorbei.</p>
        <h2 class="ct-h">Was noch vor dir liegt</h2>
        <div class="life-tiles">${tiles.map(([ico, n, label]) => `<div><i>${ico}</i><b>${n.toLocaleString('de-DE')}</b><span>${label}</span></div>`).join('')}</div>
        <h2 class="ct-h">Deine Jahre</h2>
        <div class="life-grid" role="img" aria-label="${age} von ${goal} Jahren gelebt">${Array.from({ length: goal }, (_, i) => `<i class="${i < age ? 'past' : i === age ? 'now' : ''}" title="${i + 1}. Lebensjahr"></i>`).join('')}</div>
        <p class="hint">Jedes Kästchen ist ein Lebensjahr: gefüllt sind die gelebten, umrandet ist das laufende.</p>`
        : `<p class="hint">Dein Zielalter von ${goal} ist erreicht. Stell es unten höher.</p>`}
      ${open ? `<button class="btn wide" data-nav="bucket">${ms('flag')} ${open} offene Ziele auf der Bucket-Liste</button>` : ''}
      <section class="set life-set"><h3>Einstellung</h3>
        <form id="life-form" class="hb-f3 tplform"><label>Geburtsdatum<input type="date" name="birth" value="${esc(prof.birth)}" required></label>
          <label>Rechnen bis Alter<input type="number" name="lifeAge" min="1" max="130" value="${goal}" required></label><label>&nbsp;<button class="btn">Speichern</button></label></form></section>
    </div>`;
    $('#life-form').addEventListener('submit', ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      S.saveBucket({ ...prof, id: '_profile', birth: f.get('birth'), lifeAge: Math.max(1, parseInt(f.get('lifeAge'), 10) || 88) });
    });
    ui.built = 'life';
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

  // ---------- Ansicht: Vorlagen ----------
  function viewTemplates(main) {
    // Während eine Vorlage bearbeitet wird, nicht neu aufbauen (z.B. nach einer Synchronisation), sonst geht die Eingabe verloren
    if (ui.built === 'templates' && editTpl && $('.tplform', main)) return;
    const tpls = S.templates;
    const tplForm = t => `<form class="tplform" data-id="${esc(t.id || '')}">
      <input name="name" type="text" placeholder="Name der Vorlage" value="${esc(t.name || '')}" required>
      <input name="tags" type="text" placeholder="Tags (mit Komma getrennt)" value="${esc((t.tags || []).join(', '))}">
      <textarea name="body" rows="12" placeholder="Text der Vorlage. Zeilen mit ## werden zu Überschriften.">${esc(t.body || '')}</textarea>
      <div class="row-btns">${t.id ? `<button type="button" class="btn danger ghost" data-act="tpl-delete" data-id="${esc(t.id)}">Löschen</button>` : ''}
        <button type="button" class="btn ghost" data-act="tpl-cancel">Abbrechen</button><button class="btn">Speichern</button></div></form>`;
    main.innerHTML = `<div class="page">
      <header class="page-head"><h1>Vorlagen</h1></header>
      <p class="hint">Vorlagen fügst du im Eintrag über das Dokument-Symbol oben ein.</p>
      <section class="set">
        ${tpls.map(t => editTpl === t.id ? tplForm(t) : `<button class="listrow" data-act="tpl-edit" data-id="${esc(t.id)}">${ms('description')}<span>${esc(t.name)}</span>${ms('edit')}</button>`).join('')}
        ${editTpl === 'new' ? tplForm({}) : `<button class="btn ghost" data-act="tpl-edit" data-id="new">${ms('add')} Neue Vorlage</button>`}
      </section>
    </div>`;
    $$('.tplform[data-id]', main).forEach(f => f.addEventListener('submit', ev => {
      ev.preventDefault();
      const d = new FormData(f);
      const old = f.dataset.id ? S.template(f.dataset.id) : null;
      editTpl = null;
      S.saveTemplate({ ...(old || {}), name: String(d.get('name')).trim(), body: String(d.get('body')), tags: String(d.get('tags')).split(',').map(s => s.trim()).filter(Boolean) });
      ui.built = null; render(); toast('Vorlage gespeichert');
    }));
    const f = $('.tplform', main);
    if (f) f.querySelector('input[name="name"]').focus({ preventScroll: true });
    ui.built = 'templates';
  }

  // ---------- Ansicht: Reisen freigeben ----------
  function viewShare(main) {
    // Die Freigabe aktualisiert sich selbst; nicht neu aufbauen, sonst gehen Eingaben und Fortschritt verloren
    if (ui.built === 'share' && $('#share-box', main)) return;
    main.innerHTML = `<div class="page">
      <header class="page-head"><h1>Reisen freigeben</h1></header>
      <section class="set"><div id="share-box"></div></section>
    </div>`;
    if (window.TB_SHARE) window.TB_SHARE.render($('#share-box', main));
    ui.built = 'share';
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
  const views = { timeline: viewTimeline, calendar: viewCalendar, memories: viewMemories, attachments: viewAttachments, tags: viewTags, countries: viewCountries, habits: viewHabits, bucket: viewBucket, life: viewLife, finanzen: main => { window.TB_FINANZEN.view(main); ui.built = 'finanzen'; }, templates: viewTemplates, share: viewShare };
  const TITLES = { calendar: 'Kalender', timeline: 'Zeitleiste', map: 'Karte', travel: 'Reisekarte', attachments: 'Anhänge', tags: 'Tags', countries: 'Länderzähler', memories: 'An diesem Tag', habits: 'Gewohnheiten', bucket: 'Bucket-Liste', life: 'Lebenszeit', finanzen: 'Finanzen', templates: 'Vorlagen', share: 'Reisen freigeben' };
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
        // Ein Token für beides: hat die Reisekarte auf diesem Gerät noch keinen, bekommt sie den von Daily.
        // Er funktioniert dort, sobald er auf GitHub auch für das Repo „reisekarte-daten“ freigegeben ist.
        try { if (!localStorage.getItem('rk-token') && localStorage.getItem('tb-token')) localStorage.setItem('rk-token', localStorage.getItem('tb-token')); } catch {}
        const f = document.createElement('iframe');
        f.title = 'Reisekarte'; f.allow = 'geolocation';
        // Zeitstempel im Link, damit nie eine alte Version aus dem Zwischenspeicher kommt
        f.src = (/github\.io$/.test(location.hostname) ? '/reisekarte/' : 'https://patrickhintersberger.github.io/reisekarte/') + '?t=' + Date.now();
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
    if (ui.view !== view) { ui.built = null; editTpl = null; $('#main').scrollTop = 0; }
    ui.view = view;
    openActiveGroup();
    render();
  }

  // Aufklappbare Menü-Gruppen; der Zustand bleibt auf dem Gerät gespeichert
  function setGroup(g, open) {
    if (!g) return;
    g.classList.toggle('closed', !open);
    $('.nav-h', g).setAttribute('aria-expanded', open ? 'true' : 'false');
    let closed = [];
    try { closed = JSON.parse(lsGet('tb-navgrp') || '[]'); } catch {}
    closed = closed.filter(x => x !== g.dataset.grp);
    if (!open) closed.push(g.dataset.grp);
    lsSet('tb-navgrp', JSON.stringify(closed));
  }
  function initGroups() {
    let closed = [];
    try { closed = JSON.parse(lsGet('tb-navgrp') || '[]'); } catch {}
    $$('#nav .nav-grp').forEach(g => { const c = closed.includes(g.dataset.grp); g.classList.toggle('closed', c); $('.nav-h', g).setAttribute('aria-expanded', c ? 'false' : 'true'); });
    openActiveGroup();
  }
  // Die Gruppe der gerade geöffneten Seite immer aufklappen
  function openActiveGroup() { const b = $(`#nav [data-nav="${ui.view}"]`); const g = b && b.closest('.nav-grp'); if (g && g.classList.contains('closed')) setGroup(g, true); }
  function closeMenu() { $('#nav').classList.remove('open'); $('#nav-backdrop').hidden = true; }
  let toastTimer = null;
  window.TB_toast = text => toast(text);
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
    ed.base = clone(e); // Stand beim Öffnen: gespeichert wird nur, was hier geändert wurde
    const o = $('#overlay');
    o.hidden = false;
    o.innerHTML = `<div class="sheet editor" role="dialog" aria-label="Eintrag">
      <header class="sheet-head">
        <button class="icon-btn" data-act="ed-close" aria-label="Zurück">${ms('arrow_back')}</button>
        <b id="ed-head"></b>
        <button class="icon-btn" data-act="ed-mode" id="ed-mode" aria-label="Lesen" title="Lesen / Bearbeiten">${ms('chrome_reader_mode')}</button>
        <button class="icon-btn" data-act="ed-check" data-keepfocus aria-label="Checkliste" title="Checkliste (⌘ Umschalt C), abhaken mit ⌘ Enter">${ms('checklist')}</button>
        <button class="icon-btn" data-act="ed-strike" data-keepfocus aria-label="Durchstreichen" title="Durchstreichen (⌘ Umschalt X)">${ms('format_strikethrough')}</button>
        <button class="icon-btn" data-act="ed-templates" aria-label="Vorlage einfügen" title="Vorlage einfügen">${ms('description')}</button>
        <button class="icon-btn" data-act="ed-delete" aria-label="Eintrag löschen" title="Löschen">${ms('delete')}</button>
        <button class="btn" data-act="ed-close">Fertig</button>
      </header>
      <div id="ed-tplmenu" class="menu ed-menu" hidden></div>
      <div class="sheet-body">
        <div class="ed-when"><input type="date" id="ed-date" value="${esc(e.date)}" aria-label="Datum"><input type="time" id="ed-time" value="${esc(e.time || '')}" aria-label="Uhrzeit"></div>
        <input id="ed-title" class="ed-title" type="text" placeholder="Titel" value="${esc(e.title)}" autocomplete="off">
        <textarea id="ed-text" class="ed-text" placeholder="Was ist heute passiert?">${esc(e.text)}</textarea>
        <div id="ed-read" class="ed-read" hidden></div>

        <section class="field"><label>${ms('star')} Bewertung des Tages</label><div class="rate" id="ed-rate"></div></section>
        <section class="field"><label>${ms('sell')} Tags</label><div id="ed-tags"></div></section>
        <section class="field"><label>${ms('location_on')} Ort</label><div id="ed-loc"></div></section>
        <section class="field"><label>${ms('add_a_photo')} Bilder & Videos</label><p class="hint" style="margin-top:-4px">Das erste ist das Titelbild des Tages. Mit dem Stern machst du ein anderes zum Titelbild.</p><div class="photos" id="ed-photos"></div>
          <input type="file" id="ed-file" accept="image/*,video/*" multiple hidden></section>
        <div id="ed-memory"></div>
      </div>
    </div>`;
    edHead(); edRate(); edTags(); edLoc(); edPhotos(); edMemory(); grow();
    ['ed-title', 'ed-text', 'ed-time'].forEach(i => $('#' + i).addEventListener('input', () => { if (i === 'ed-text') grow(); scheduleCommit(); }));
    // Tab rückt im Text ein (statt zum nächsten Feld zu springen), Umschalt+Tab nimmt den Einzug zurück.
    // Mit markierten Zeilen gilt das für alle markierten Zeilen.
    ['focus', 'click', 'keyup'].forEach(t => $('#ed-text').addEventListener(t, () => { if (ed) ed.caretSet = true; }));
    $('#ed-text').addEventListener('keydown', ev => {
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === 'x' || ev.key === 'X')) { ev.preventDefault(); strikeText(); }
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === 'c' || ev.key === 'C')) { ev.preventDefault(); checklistText(); }
      if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === 'Enter') { ev.preventDefault(); checkCurrentLine(); }
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.isComposing && continueChecklist()) ev.preventDefault();
    });
    $('#ed-text').addEventListener('keydown', ev => {
      if (ev.key !== 'Tab' || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      ev.preventDefault();
      const ta = ev.target, v = ta.value;
      let a = ta.selectionStart, b = ta.selectionEnd;
      const lineStart = v.lastIndexOf('\n', a - 1) + 1;
      const body = $('.sheet-body'), y = body.scrollTop;
      if (a === b && !ev.shiftKey) {
        // wie normales Tippen: bleibt an Ort und Stelle und lässt sich mit ⌘Z rückgängig machen
        if (!document.execCommand || !document.execCommand('insertText', false, '\t')) {
          ta.value = v.slice(0, a) + '\t' + v.slice(b);
          ta.selectionStart = ta.selectionEnd = a + 1;
        }
      } else {
        const end = b > a && v[b - 1] === '\n' ? b - 1 : b;
        const lines = v.slice(lineStart, end).split('\n');
        const out = lines.map(l => ev.shiftKey ? l.replace(/^(\t| {1,4})/, '') : '\t' + l);
        const block = out.join('\n');
        ta.value = v.slice(0, lineStart) + block + v.slice(end);
        if (a === b) { const d = out[0].length - lines[0].length; ta.selectionStart = ta.selectionEnd = Math.max(lineStart, a + d); }
        else { ta.selectionStart = lineStart; ta.selectionEnd = lineStart + block.length; }
      }
      body.scrollTop = y;
      grow(); scheduleCommit();
    });
    $('#ed-date').addEventListener('change', () => { readInputs(); edHead(); edMemory(); if (ed.entry.wx && ed.entry.wx !== wxKey(ed.entry)) { delete ed.entry.weather; delete ed.entry.wx; edLoc(); } updateWeather(); scheduleCommit(); });
    $('#ed-file').addEventListener('change', ev => { addPhotos([...ev.target.files]); ev.target.value = ''; });
    if (ed.isNew && autoLoc() && e.date === todayISO()) locate(true);
    updateWeather();
    // Ort ohne Namen (z.B. offline gespeichert): Namen jetzt nachschlagen
    if (e.loc && e.loc.lat != null && !e.loc.name) {
      const cur = ed, { lat, lng } = e.loc;
      reverse(lat, lng).then(n => {
        if (ed !== cur || !n || !cur.entry.loc || cur.entry.loc.lat !== lat || cur.entry.loc.name) return;
        cur.entry.loc.name = n; edLoc(); scheduleCommit();
      });
    }
    // Leseansicht: Tippen auf eine Zeile öffnet das Bearbeiten genau dort, Doppeltippen auf eine Toggle-Zeile ebenso
    $('#ed-read').addEventListener('click', ev => {
      if (ev.target.closest('button, a, summary')) return;
      const ln = ev.target.closest('[data-ln]');
      setMode('edit', ln ? +ln.dataset.ln : null);
    });
    $('#ed-read').addEventListener('dblclick', ev => { const sm = ev.target.closest('summary'); if (sm) { ev.preventDefault(); setMode('edit', +sm.parentElement.dataset.ln); } });
    // Bestehende Einträge mit Gliederung (eingerückte Zeilen, Überschriften) oder Checkliste öffnen in der Leseansicht
    if (!ed.isNew && (hasOutline(e.text) || hasChecklist(e.text))) setMode('read');
    if (ed.isNew && !('ontouchstart' in window)) $('#ed-text').focus();
  }

  // ---------- Leseansicht mit Toggles (wie in Notion) ----------
  // Jede Zeile mit eingerückten Unterzeilen und jede Überschrift (#, ##, ###) mit ihrem Abschnitt lässt sich auf- und zuklappen.
  // Reviews starten zugeklappt, andere Einträge aufgeklappt; der Zustand wird pro Eintrag auf dem Gerät gemerkt.
  function outlineTree(text) {
    const lines = String(text || '').split('\n');
    const root = { w: -1, h: 0, children: [] }, stack = [root];
    const width = l => [...l.match(/^[\t ]*/)[0]].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0);
    const canParent = (p, c) => p === root || c.w > p.w || (c.w === p.w && p.h && (!c.h || c.h > p.h));
    lines.forEach((l, i) => {
      if (!l.trim()) { stack[stack.length - 1].children.push({ i, blank: true, children: [] }); return; }
      const m = l.trim().match(/^(#{1,3})\s/);
      const node = { i, w: width(l), h: m ? m[1].length : 0, line: l, children: [] };
      while (!canParent(stack[stack.length - 1], node)) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    });
    return root;
  }
  const hasKids = n => n.children.some(c => !c.blank);
  function hasOutline(text) { return outlineTree(text).children.some(hasKids); }
  const isReviewEntry = e => (e.tags || []).some(t => /review/i.test(t)) || /review/i.test(e.title || '');
  function foldState(id) { try { return JSON.parse(localStorage.getItem('tb-fold') || '{}')[id] || {}; } catch { return {}; } }
  function saveFold(id, st) {
    try { const all = JSON.parse(localStorage.getItem('tb-fold') || '{}'); all[id] = st; const keys = Object.keys(all); if (keys.length > 200) delete all[keys[0]]; localStorage.setItem('tb-fold', JSON.stringify(all)); } catch {}
  }
  function edRead() {
    const box = $('#ed-read'); if (!box || !ed) return;
    const e = ed.entry, st = foldState(e.id), closed = isReviewEntry(e);
    const pad = n => `padding-left:${(n.w / 4) * 1.4}em`;
    const html = n => {
      if (n.blank) return '<div class="ln blank"></div>';
      if (/^\s*(---|___|\*\*\*)\s*$/.test(n.line)) return `<hr class="ln" data-ln="${n.i}">`;
      const ck = n.line.match(CK);
      const ckHtml = () => `<span class="ck${/[xX]/.test(ck[2]) ? ' done' : ''}"><button type="button" class="ck-box" data-act="ck" data-ln="${n.i}" aria-pressed="${/[xX]/.test(ck[2])}" aria-label="Erledigt">${ms('check')}</button><span class="ck-t">${richText(n.line.slice(ck[0].length))}</span></span>`;
      if (!hasKids(n)) return ck ? `<div class="ln ck-ln" data-ln="${n.i}" style="${pad(n)}">${ckHtml()}</div>` : `<div class="ln" data-ln="${n.i}" style="${pad(n)}">${richText(n.line.trim())}</div>`;
      const body = ck ? ckHtml() : richText(n.line.trim().replace(/^[-*•]\s+/, '')); // Toggle-Zeilen ohne Aufzählungspunkt, wie in Notion
      const open = n.i in st ? st[n.i] : !closed;
      return `<details class="tg${n.h ? ' tg-h' + n.h : ''}" data-ln="${n.i}" ${open ? 'open' : ''}><summary style="${pad(n)}"><span class="tg-t">${body}</span></summary>${n.children.map(html).join('')}</details>`;
    };
    box.innerHTML = `<div class="ed-read-bar"><button class="btn ghost small" data-act="fold-all" data-open="1">${ms('unfold_more')} Alle aufklappen</button><button class="btn ghost small" data-act="fold-all" data-open="0">${ms('unfold_less')} Alle zuklappen</button></div>`
      + (outlineTree(e.text).children.map(html).join('') || '<p class="hint">Noch kein Text. Tippe hier, um zu schreiben.</p>');
    box.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => { const s2 = foldState(e.id); s2[d.dataset.ln] = d.open; saveFold(e.id, s2); }));
  }
  function setMode(mode, line) {
    if (!ed) return;
    const ta = $('#ed-text'), box = $('#ed-read'), btn = $('#ed-mode');
    if (mode === 'read') { readInputs(); ed.mode = 'read'; edRead(); ta.hidden = true; box.hidden = false; }
    else {
      ed.mode = 'edit'; box.hidden = true; ta.hidden = false; grow();
      if (line != null) {
        const pos = ta.value.split('\n').slice(0, line).reduce((n, l) => n + l.length + 1, 0);
        ta.focus({ preventScroll: true }); ta.setSelectionRange(pos, pos);
        const body = $('.sheet-body'), lh = parseFloat(getComputedStyle(ta).lineHeight) || 26;
        body.scrollTop = Math.max(0, ta.offsetTop + line * lh - body.clientHeight / 3);
      }
    }
    if (btn) { btn.innerHTML = ms(ed.mode === 'read' ? 'edit' : 'chrome_reader_mode'); btn.setAttribute('aria-label', ed.mode === 'read' ? 'Bearbeiten' : 'Lesen'); }
  }
  // Text-Ersetzungen und Höhenanpassung verschieben sonst die Scrollposition des Eintrags
  function keepScroll(fn) { const b = $('.sheet-body'), y = b ? b.scrollTop : 0; fn(); if (b) b.scrollTop = y; }
  function grow() { const t = $('#ed-text'); if (!t) return; keepScroll(() => { t.style.height = 'auto'; t.style.height = Math.max(180, t.scrollHeight + 4) + 'px'; }); }
  function readInputs() {
    if (!ed) return;
    const e = ed.entry;
    e.title = $('#ed-title').value.trim();
    e.text = $('#ed-text').value;
    e.date = $('#ed-date').value || e.date;
    e.time = $('#ed-time').value || '';
  }
  const clone = x => JSON.parse(JSON.stringify(x));
  // Felder, die im Editor seit dem Öffnen geändert wurden
  function edChanges() {
    if (!ed || !ed.base) return null;
    // leer, null, fehlend und leere Liste gelten als gleich (z. B. leeres Uhrzeit-Feld)
    const norm = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? 'null' : JSON.stringify(v);
    return Object.keys({ ...ed.entry, ...ed.base }).filter(k => k !== 'createdAt' && k !== 'updatedAt' && norm(ed.entry[k]) !== norm(ed.base[k]));
  }
  // Eintrag im Editor auf einen neueren Stand setzen (z. B. nach einer Synchronisation), ohne Eingaben zu verlieren
  function edRefresh() {
    const e = ed.entry;
    const set = (id, v) => { const el = $('#' + id); if (el && el !== document.activeElement && el.value !== v) el.value = v; };
    set('ed-text', e.text || ''); set('ed-title', e.title || ''); set('ed-date', e.date); set('ed-time', e.time || '');
    edHead(); edRate(); edTags(); edLoc(); edPhotos(); grow();
    if (ed.mode === 'read') edRead();
  }
  // Eine neuere Fassung kam per Synchronisation an: übernehmen, solange im Editor nichts geändert wurde
  function edSync() {
    if (!ed || ed.isNew) return;
    const latest = S.entry(ed.entry.id);
    if (!latest || (latest.updatedAt || 0) <= (ed.base.updatedAt || 0)) return;
    readInputs();
    if (edChanges().length) return; // eigene Änderungen haben Vorrang; beim Speichern wird zusammengeführt
    ed.entry = { tags: [], photos: [], ...clone(latest) }; ed.base = clone(ed.entry);
    edRefresh();
  }
  function commit() {
    if (!ed) return;
    clearTimeout(ed.timer);
    readInputs();
    if (!hasContent(ed.entry) && ed.isNew) return;
    const before = S.entry(ed.entry.id);
    const strip = x => { const { createdAt, updatedAt, ...rest } = x || {}; return JSON.stringify(rest); };
    if (!ed.isNew && before) {
      // Nur die im Editor geänderten Felder auf den neuesten Stand legen. So überschreibt ein lange offener
      // Eintrag keine Änderungen, die inzwischen von einem anderen Gerät oder einer Routine gekommen sind.
      const changed = edChanges();
      if (!changed.length) return;
      const merged = { tags: [], photos: [], ...clone(before) };
      changed.forEach(k => { merged[k] = ed.entry[k]; });
      const stale = (before.updatedAt || 0) > (ed.base.updatedAt || 0);
      ed.entry = merged;
      if (stale) edRefresh();
    }
    if (before && strip(before) === strip(ed.entry)) return;
    const saved = S.saveEntry(ed.entry);
    ed.base = clone(saved || S.entry(ed.entry.id) || ed.entry);
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
        <span class="wx">${ed.entry.weather ? '🌤️ ' + esc(ed.entry.weather) : (ed.wxFail === wxKey(ed.entry) ? 'Kein Wetter verfügbar' : 'Wetter wird geladen …')}</span>
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
  // ---------- Wetter (Open-Meteo) ----------
  // Tageshöchst- und Tiefstwert am Ort des Eintrags, Format wie in den Diarium-Einträgen: „18 / 6 °C, teils bewölkt“.
  const WMO = { 0: 'klar', 1: 'überwiegend klar', 2: 'teils bewölkt', 3: 'bewölkt', 45: 'Nebel', 48: 'Nebel', 51: 'leichter Nieselregen', 53: 'Nieselregen', 55: 'starker Nieselregen',
    56: 'gefrierender Nieselregen', 57: 'gefrierender Nieselregen', 61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen', 66: 'gefrierender Regen', 67: 'gefrierender Regen',
    71: 'leichter Schneefall', 73: 'Schneefall', 75: 'starker Schneefall', 77: 'Schneegriesel', 80: 'Regenschauer', 81: 'Regenschauer', 82: 'heftige Regenschauer',
    85: 'Schneeschauer', 86: 'Schneeschauer', 95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel' };
  async function fetchWeather(date, lat, lng) {
    const days = (parse(date) - parse(todayISO())) / 864e5;
    if (days > 15) return null; // zu weit in der Zukunft
    const host = days < -85 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const url = `${host}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&start_date=${date}&end_date=${date}`;
    try {
      const d = (await (await fetch(url)).json()).daily || {};
      const max = (d.temperature_2m_max || [])[0], min = (d.temperature_2m_min || [])[0];
      if (max == null || min == null) return null;
      const txt = WMO[(d.weather_code || [])[0]];
      return `${Math.round(max)} / ${Math.round(min)} °C${txt ? ', ' + txt : ''}`;
    } catch { return null; }
  }
  const wxKey = e => e.loc && e.loc.lat != null ? `${e.date}|${e.loc.lat.toFixed(2)},${e.loc.lng.toFixed(2)}` : '';
  // Holt das Wetter, wenn es fehlt oder Ort bzw. Datum sich geändert haben
  function updateWeather() {
    const cur = ed; if (!cur) return;
    const e = cur.entry, key = wxKey(e);
    if (!key || (e.weather && (e.wx === key || !e.wx))) return; // vorhandenes (z.B. aus Diarium) nicht ersetzen
    fetchWeather(e.date, e.loc.lat, e.loc.lng).then(w => {
      if (ed !== cur || wxKey(cur.entry) !== key) return;
      if (!w) { cur.wxFail = key; edLoc(); return; }
      cur.entry.weather = w; cur.entry.wx = key;
      edLoc(); scheduleCommit();
    });
  }

  function setLoc(lat, lng, name) {
    const cur = ed;
    lat = +(+lat).toFixed(6); lng = +(+lng).toFixed(6);
    cur.entry.loc = { lat, lng, name: name || '' };
    if (cur.entry.wx !== wxKey(cur.entry)) { delete cur.entry.weather; delete cur.entry.wx; }
    updateWeather();
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
    // Das erste Bild ist das Titelbild des Tages (Kalender, Zeitleiste, Karte); mit dem Stern rückt ein anderes nach vorn.
    $('#ed-photos').innerHTML = ed.entry.photos.map((p, i) => `<figure class="${i === 0 ? 'cover' : ''}">${i === 0 ? '<span class="cover-tag">Titelbild</span>' : `<button class="mk-cover" data-act="ed-photo-cover" data-id="${esc(p.id)}" aria-label="Als Titelbild verwenden" title="Als Titelbild verwenden">${ms('star', 'fill')}</button>`}<img data-thumb="${esc(p.id)}" data-act="lightbox" data-id="${esc(p.id)}" data-kind="${p.kind || 'photo'}" alt="">${p.kind === 'video' ? `<span class="play">${ms('play_arrow', 'fill')}</span>` : ''}
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
  // Scrollt den Eintrag so, dass die Textstelle pos sichtbar ist (Textfeld wächst mit, scrollt also nicht selbst)
  function scrollToText(pos) {
    const ta = $('#ed-text'), body = $('.sheet-body'); if (!ta || !body) return;
    const cs = getComputedStyle(ta), m = document.createElement('div');
    ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'tabSize'].forEach(k => m.style[k] = cs[k]);
    Object.assign(m.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: ta.clientWidth + 'px', left: '-9999px', top: 0 });
    m.textContent = ta.value.slice(0, pos) + '​';
    document.body.appendChild(m);
    const y = m.offsetHeight; m.remove();
    body.scrollTop = ta.offsetTop + y - 120;
  }
  function insertTemplate(t) {
    const ta = $('#ed-text');
    // Hat der Nutzer den Cursor nicht selbst gesetzt, kommt die Vorlage ans Ende (z.B. Abendroutine unter die Morgenroutine)
    const start = ed && ed.caretSet && ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const end = ed && ed.caretSet && ta.selectionEnd != null ? ta.selectionEnd : start;
    const before = ta.value.slice(0, start), after = ta.value.slice(end);
    const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    ta.value = before + lead + t.body + (after && !t.body.endsWith('\n') ? '\n' : '') + after;
    if (!$('#ed-title').value.trim() && t.name) $('#ed-title').value = t.name;
    (t.tags || []).forEach(addTag);
    edTags(); grow(); scheduleCommit();
    const first = (before + lead).length, pos = (before + lead + t.body).length;
    // Cursor in die erste leere Zeile der Vorlage setzen, sonst ans Ende der Vorlage
    const blank = ta.value.slice(first, pos).search(/\n\n|\n(?:\d+\. |- )\n|\n$/);
    const caret = blank >= 0 ? first + blank + 1 : pos;
    ta.focus({ preventScroll: true }); ta.setSelectionRange(caret, caret);
    ed.caretSet = true;
    requestAnimationFrame(() => scrollToText(first));
  }
  // Durchstreichen: markierter Text, sonst die aktuelle Zeile (ohne Einzug und Aufzählungszeichen).
  // Genutzt wird ein Unicode-Durchstrich, damit es auch direkt im Textfeld durchgestrichen aussieht.
  const STRIKE = '̶';
  function strikeText() {
    const ta = $('#ed-text'); if (!ta) return;
    let a = ta.selectionStart, b = ta.selectionEnd;
    const v = ta.value;
    if (a === b) {
      const ls = v.lastIndexOf('\n', a - 1) + 1, le = v.indexOf('\n', a) < 0 ? v.length : v.indexOf('\n', a);
      const lead = v.slice(ls, le).match(/^\s*(?:[-•*]\s+|\d+\.\s+|\[[ xX]\]\s+)*/)[0].length;
      a = ls + lead; b = le;
      if (a >= b) return;
    }
    const part = v.slice(a, b);
    const out = part.includes(STRIKE) ? part.replace(/̶/g, '') : [...part].map(ch => /\s/.test(ch) && ch !== ' ' ? ch : ch + STRIKE).join('');
    keepScroll(() => {
      ta.value = v.slice(0, a) + out + v.slice(b);
      ta.focus({ preventScroll: true }); ta.setSelectionRange(a, a + out.length);
    });
    grow(); scheduleCommit();
  }

  // ---------- Checkliste (wie in Notion) ----------
  // Zeilen "- [ ] Aufgabe" sind offen, "- [x] Aufgabe" erledigt. In der Leseansicht abhaken per Tippen,
  // im Textfeld mit ⌘ Enter. Erledigte Aufgaben erscheinen in der Leseansicht durchgestrichen.
  const CK = /^(\s*)- \[([ xX])\] ?/;
  function lineBounds(v, a, b = a) {
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    const end = b > a && v[b - 1] === '\n' ? b - 1 : b;
    const le = v.indexOf('\n', end) < 0 ? v.length : v.indexOf('\n', end);
    return [ls, le];
  }
  // Textfeld ändern, sodass ⌘Z es rückgängig machen kann
  function replaceRange(ta, a, b, text) {
    ta.focus({ preventScroll: true }); ta.setSelectionRange(a, b);
    const ok = document.execCommand && (text ? document.execCommand('insertText', false, text) : a === b || document.execCommand('delete'));
    if (!ok) ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.setSelectionRange(a + text.length, a + text.length);
  }
  // Aktuelle bzw. markierte Zeilen zu Checklisten-Punkten machen (Aufzählungszeichen werden ersetzt), oder zurück zu normalem Text
  function checklistText() {
    const ta = $('#ed-text'); if (!ta) return;
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    const [ls, le] = lineBounds(v, a, b);
    const lines = v.slice(ls, le).split('\n');
    const all = lines.filter(l => l.trim()).every(l => CK.test(l));
    const out = lines.map(l => {
      if (all) return l.replace(CK, '$1');
      if (!l.trim() && lines.length > 1) return l;
      return CK.test(l) ? l : l.replace(/^(\s*)(?:[-•*]\s+|\d+\.\s+)?/, '$1- [ ] ');
    }).join('\n');
    keepScroll(() => {
      replaceRange(ta, ls, le, out);
      if (a === b) { const p = Math.min(ls + out.length, Math.max(ls, a + out.length - (le - ls))); ta.setSelectionRange(p, p); }
      else ta.setSelectionRange(ls, ls + out.length);
    });
    grow(); scheduleCommit();
  }
  function toggledLine(l) { return l.replace(CK, (m, ind, x) => `${ind}- [${x === ' ' ? 'x' : ' '}] `); }
  function checkCurrentLine() {
    const ta = $('#ed-text'); if (!ta) return;
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    const [ls, le] = lineBounds(v, a);
    const l = v.slice(ls, le);
    if (!CK.test(l)) return checklistText();
    const out = toggledLine(l);
    keepScroll(() => { replaceRange(ta, ls, le, out); const d = out.length - l.length; ta.setSelectionRange(a + d, b + d); });
    grow(); scheduleCommit();
  }
  // Enter in einem Checklisten-Punkt beginnt den nächsten; Enter in einem leeren Punkt beendet die Liste
  function continueChecklist() {
    const ta = $('#ed-text'); if (!ta || ta.selectionStart !== ta.selectionEnd) return false;
    const v = ta.value, a = ta.selectionStart;
    const [ls, le] = lineBounds(v, a);
    const m = v.slice(ls, le).match(CK);
    if (!m || a < ls + m[0].length) return false;
    if (!v.slice(ls + m[0].length, le).trim()) { keepScroll(() => replaceRange(ta, ls, le, m[1])); }
    else keepScroll(() => replaceRange(ta, a, a, '\n' + m[1] + '- [ ] '));
    grow(); scheduleCommit();
    return true;
  }
  // Abhaken in der Leseansicht: Zeile im Text umschalten und speichern
  function checkLine(i) {
    if (!ed) return;
    const ta = $('#ed-text');
    const lines = ta.value.split('\n');
    if (!CK.test(lines[i] || '')) return;
    lines[i] = toggledLine(lines[i]);
    ta.value = lines.join('\n');
    readInputs();
    const row = $(`#ed-read [data-ln="${i}"]`);
    const ck = row && (row.matches('.ck') ? row : $('.ck', row));
    if (ck) { const done = /\[[xX]\]/.test(lines[i]); ck.classList.toggle('done', done); const btn = $('.ck-box', ck); if (btn) btn.setAttribute('aria-pressed', done); }
    else edRead();
    scheduleCommit();
  }
  const hasChecklist = text => /^\s*- \[[ xX]\] /m.test(text || '');

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
    o.innerHTML = `<div class="sheet" role="dialog" aria-label="Einstellungen">
      <header class="sheet-head"><button class="icon-btn" data-act="set-close" aria-label="Zurück">${ms('arrow_back')}</button><b>Einstellungen</b></header>
      <div class="sheet-body">
        <section class="set"><h3>Standort</h3>
          <label class="switch"><input type="checkbox" id="set-autoloc" ${autoLoc() ? 'checked' : ''}><span>Bei neuen Einträgen automatisch den aktuellen Standort speichern</span></label>
        </section>

        <section class="set"><h3>Tägliche Erinnerung</h3>
          <p class="hint">Jeden Tag gegen 17 Uhr deutscher Zeit bekommst du eine Mitteilung, wenn der Tagebucheintrag, der Ort oder Gewohnheiten noch offen sind. Ist alles erledigt, kommt keine.</p>
          <div id="push-box"><p class="hint">Prüfe …</p></div>
        </section>

        <section class="set"><h3>Synchronisation</h3>
          <p class="status" data-status="${esc(S.status)}"><i class="sync-dot"></i>${esc(S.statusText || 'Nur auf diesem Gerät gespeichert')}${S.unsynced && S.status !== 'ok' ? ' · Änderungen warten auf Upload' : ''}${S.pendingPhotos ? ` · ${S.pendingPhotos} Bild(er) warten auf Upload` : ''}</p>
          <p class="hint" id="offline-ready"></p>
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
    pushBox();
    offlineReady();
    $('#set-autoloc').addEventListener('change', e => lsSet('tb-autoloc', e.target.checked ? '1' : '0'));
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
        toast(n ? `${n.toLocaleString('de-DE')} neue Daten übernommen` : 'Keine neuen Daten in dieser Datei – alles ist schon vorhanden');
      }
      catch { toast('Diese Datei konnte nicht gelesen werden.'); }
    });
  }
  // Zeigt, ob die App vollständig auf dem Gerät liegt und damit ohne Internet startet
  async function offlineReady() {
    let ok = false;
    try { ok = !!(navigator.serviceWorker && navigator.serviceWorker.controller && await caches.match(new URL('app.js', location.href).href)); } catch {}
    const el = $('#offline-ready'); if (!el) return;
    el.textContent = ok
      ? 'Die App ist auf diesem Gerät gespeichert und funktioniert auch ohne Internet. Was du offline einträgst, wird synchronisiert, sobald wieder Verbindung besteht.'
      : 'Die App wird gerade für die Nutzung ohne Internet gespeichert. Öffne sie einmal neu, solange du online bist.';
  }
  // ---------- Tägliche Erinnerung (Web Push) ----------
  const pushId = endpoint => { let h = 5381; for (let i = 0; i < endpoint.length; i++) h = ((h << 5) + h + endpoint.charCodeAt(i)) >>> 0; return 'p' + h.toString(36) + endpoint.length.toString(36); };
  const b64urlBytes = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4)), ch => ch.charCodeAt(0));
  const deviceLabel = () => /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Gerät';
  async function currentPushSub() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function pushBox() {
    const box = $('#push-box'); if (!box) return;
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    let html;
    if (location.protocol !== 'https:') html = '<p class="hint">Mitteilungen gibt es nur in der Online-Version der App.</p>';
    else if (!('PushManager' in window) || !('Notification' in window)) html = `<p class="hint">${ios ? 'Auf dem iPhone gehen Mitteilungen nur in der installierten App: in Safari auf Teilen → „Zum Home-Bildschirm“, die App von dort öffnen und hier einschalten.' : 'Dieser Browser unterstützt keine Mitteilungen.'}</p>`;
    else if (!S.hasToken()) html = '<p class="hint">Verbinde die App zuerst unten mit GitHub. Die Erinnerung liest deine Daten von dort.</p>';
    else {
      const sub = await currentPushSub().catch(() => null);
      const known = sub && S.pushSubs.some(p => p.id === pushId(sub.endpoint));
      const others = S.pushSubs.filter(p => !sub || p.id !== pushId(sub.endpoint)).map(p => p.device).filter(Boolean);
      html = (known ? `<p class="status" data-status="ok"><i class="sync-dot"></i>Auf diesem Gerät eingeschaltet</p><div class="row-btns left"><button class="btn ghost danger" data-act="push-off">Auf diesem Gerät ausschalten</button></div>`
        : `<div class="row-btns left"><button class="btn" data-act="push-on">Erinnerung auf diesem Gerät einschalten</button></div>${Notification.permission === 'denied' ? '<p class="hint">Mitteilungen sind für diese App blockiert. Bitte in den Geräte-Einstellungen wieder erlauben.</p>' : ''}`)
        + (others.length ? `<p class="hint">Außerdem eingeschaltet auf: ${esc(others.join(', '))}.</p>` : '');
    }
    if ($('#push-box')) $('#push-box').innerHTML = html;
  }
  async function pushOn() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Mitteilungen wurden nicht erlaubt.'); return pushBox(); }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlBytes(window.TB_CONFIG.vapidPublicKey) });
      S.savePushSub({ id: pushId(sub.endpoint), sub: sub.toJSON(), device: deviceLabel(), createdAt: Date.now() });
      await S.sync();
      reg.showNotification('Daily', { body: 'Die tägliche Erinnerung ist eingeschaltet.', icon: 'icon-512.png', tag: 'daily-erinnerung' }).catch(() => {});
      toast('Erinnerung eingeschaltet');
    } catch (err) { toast('Einschalten fehlgeschlagen: ' + (err && err.message || err)); }
    pushBox();
  }
  async function pushOff() {
    const sub = await currentPushSub().catch(() => null);
    if (sub) { S.deletePushSub(pushId(sub.endpoint)); await sub.unsubscribe().catch(() => {}); S.sync(); }
    pushBox();
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
    'nav-grp': el => setGroup(el.closest('.nav-grp'), el.closest('.nav-grp').classList.contains('closed')),
    'care-open': openCare,
    'hb-date': el => { ui.hbDate = el.dataset.date; render(); },
    'hb-today': () => { ui.hbDate = todayISO(); ui.built = null; render(); },
    'hb-toggle': el => toggleHabit(el.dataset.id),
    'hb-open': el => openHabit(el.dataset.id),
    'hb-new': () => openHabit(null),
    'week-review': () => { if (ed) { $('#ed-tplmenu').hidden = true; closeEditor(); } createWeekReview(); },
    'hb-delete': el => { if (!confirm('Diese Gewohnheit löschen? Die bisherigen Tageswerte bleiben gespeichert.')) return; S.deleteHabit(el.dataset.id); closeSettings(); },
    'hb-step': el => {
      const h = S.habit(hbEdit); if (!h) return;
      const date = ui.hbDate > todayISO() ? todayISO() : ui.hbDate;
      const v = Math.max(0, S.logValue(h.id, date) + (+el.dataset.d) * (h.step || 1));
      S.setLog(h.id, date, v); $('#hb-val').value = v;
    },
    'hb-full': () => { const h = S.habit(hbEdit); if (!h) return; S.setLog(h.id, ui.hbDate > todayISO() ? todayISO() : ui.hbDate, h.target || 1); closeSettings(); },
    'bk-new': () => openBucket(null),
    'bk-open': el => openBucket(el.dataset.id),
    'bk-toggle': el => { const b = S.bucketItem(el.dataset.id); if (b) S.saveBucket({ ...b, done: b.done ? '' : todayISO() }); },
    'bk-plan-at': el => { const b = S.bucketItem(el.dataset.id); if (!b) return; S.saveBucket({ ...b, plan: el.dataset.plan }); toast('Für ' + bkMonthName(el.dataset.plan) + ' eingeplant'); },
    'bk-plan': el => { const b = S.bucketItem(el.dataset.id); if (!b) return; S.saveBucket({ ...b, plan: todayISO().slice(0, 7) }); toast('Für diesen Monat eingeplant'); },
    'bk-filter': el => { ui.bkFilter = el.dataset.f; render(); },
    'bk-delete': el => { if (!confirm('Dieses Ziel löschen?')) return; S.deleteBucket(el.dataset.id); closeSettings(); },
    'bk-loc-pick': el => { bkLoc = { lat: +(+el.dataset.lat).toFixed(6), lng: +(+el.dataset.lng).toFixed(6), name: el.dataset.name, country: el.dataset.country || '', ...(el.dataset.wide ? { wide: true } : {}) }; bkLocBox(); },
    'bk-loc-clear': () => { bkLoc = null; bkLocBox(); },
    'ed-bucket': () => {
      $('#ed-tplmenu').hidden = true;
      const sug = bucketSuggestions(5);
      if (!sug.length) return toast('Deine Bucket-Liste hat keine offenen Ziele.');
      insertTemplate({ name: '', tags: [], body: '## Bucket-Liste: Vorschläge\n' + sug.map(({ b, reason }) => `- ${b.title} (${reason}${bkCost(b) ? ', ' + bkCost(b) : ''})`).join('\n') + '\n' });
    },
    'push-on': pushOn,
    'push-off': pushOff,
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
    'ed-loc-clear': () => { ed.entry.loc = null; delete ed.entry.weather; delete ed.entry.wx; edLoc(); scheduleCommit(); },
    'ed-loc-pick': el => setLoc(el.dataset.lat, el.dataset.lng, el.dataset.name),
    'ed-photo-add': () => $('#ed-file').click(),
    'ed-strike': () => { if (ed && ed.mode === 'read') setMode('edit'); strikeText(); },
    'ed-check': () => { if (ed && ed.mode === 'read') setMode('edit'); checklistText(); },
    'ck': el => checkLine(+el.dataset.ln),
    'ed-mode': () => setMode(ed && ed.mode === 'read' ? 'edit' : 'read'),
    'fold-all': el => { if (!ed) return; const open = el.dataset.open === '1', st = {}; $$('#ed-read details').forEach(d => { d.open = open; st[d.dataset.ln] = open; }); saveFold(ed.entry.id, st); },
    'ed-photo-cover': el => { const ph = ed.entry.photos; const i = ph.findIndex(p => p.id === el.dataset.id); if (i > 0) { ph.unshift(ph.splice(i, 1)[0]); edPhotos(); scheduleCommit(); toast('Titelbild geändert'); } },
    'ed-photo-del': el => { ed.entry.photos = ed.entry.photos.filter(p => p.id !== el.dataset.id); edPhotos(); scheduleCommit(); },
    'ed-templates': () => {
      const m = $('#ed-tplmenu');
      if (!m.hidden) { m.hidden = true; return; }
      const list = S.templates;
      m.innerHTML = list.length ? list.map(t => `<button data-act="ed-tpl" data-id="${esc(t.id)}">${ms('description')}${esc(t.name)}</button>`).join('') + `<button data-act="ed-bucket">${ms('flag')}Bucket-Vorschläge einfügen</button><button data-act="week-review">${ms('task_alt')}Wochen-Review automatisch erstellen</button>` : '<p class="hint">Keine Vorlagen vorhanden. Lege sie in den Einstellungen an.</p>';
      m.hidden = false;
    },
    'ed-tpl': el => { $('#ed-tplmenu').hidden = true; if (ed && ed.mode === 'read') setMode('edit'); const t = S.template(el.dataset.id); if (t) insertTemplate(t); },
    'tpl-edit': el => { editTpl = el.dataset.id; ui.built = null; render(); },
    'tpl-cancel': () => { editTpl = null; ui.built = null; render(); },
    'tpl-delete': el => { if (!confirm('Diese Vorlage löschen?')) return; editTpl = null; S.deleteTemplate(el.dataset.id); ui.built = null; render(); },
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
  document.addEventListener('mousedown', ev => { if (ev.target.closest('[data-keepfocus]')) ev.preventDefault(); });
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
  initGroups();
  S.ready.then(() => {
    S.onChange(() => {
      // Während ein Formular in den Einstellungen offen ist, nichts darunter neu aufbauen, was den Fokus stört
      if (ui.view === 'timeline' && ui.built === 'timeline') { timelineList(); render(); }
      else render();
      if (ed) { edMemory(); edSync(); }
    });
    render();
    Promise.resolve(S.sync()).then(repairPosters).then(() => window.TB_SHARE && window.TB_SHARE.cleanup());
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
