// Identität: Arbeitsbuch für den 90-Tage-Zyklus (Du 2.0, Zielbild, Werte, Glaubenssätze, Identity-Skript, Check-In)
// und „Mein Skript“ zum täglichen Lesen morgens und abends – unabhängig vom Tagebuch.
// Die Inhalte des Buchs (Fragen, Werteliste, Manifest) stehen NICHT im Code, weil das App-Repo öffentlich ist,
// sondern als Eintrag '_buch' in data/identity.json im privaten Daten-Repo. Der Code stellt sie nur dar.
// Weitere Einträge dort: Runden (kind 'round', alle Antworten in a), Check-Ins je Monat (kind 'checkin')
// und gelesene Tage (kind 'read'). Alle 90 Tage beginnt eine neue Runde komplett leer – Patrick startet jedes Mal bei null.
(function () {
  'use strict';
  const S = window.TB_STORE;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = name => `<span class="ms">${name}</span>`;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const fmt = s => parse(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtMonth = s => parse(s).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
  const today = () => iso(new Date());
  const INTERVAL = 90;

  // Ansichten im Menü: Ansicht -> [Titel, Symbol, Modul im Buch]
  const VIEWS = {
    'id-heute': ['Mein Skript', 'menu_book'],
    'id-identity': ['Identity-Script', 'fingerprint', 'identity'],
    'id-zielbild': ['Der perfekte Tag', 'wb_sunny', 'zielbild'],
    'id-werte': ['Meine Werte', 'diamond', 'werte'],
    'id-glauben': ['Glaubenssätze', 'psychology', 'glauben'],
    'id-u20': ['Du 2.0', 'self_improvement', 'u20'],
    'id-checkin': ['Check-In', 'speed'],
  };

  // ---------- Daten ----------
  const items = () => S.identity;
  const book = () => items().find(x => x.kind === 'book') || null;
  const rounds = () => items().filter(x => x.kind === 'round' || (!x.kind && x.date));
  const checkins = () => items().filter(x => x.kind === 'checkin').sort((a, b) => a.date.localeCompare(b.date));
  const current = () => rounds().slice(-1)[0] || null;
  // Antworten einer Runde (ältere Runden mit einfachen Textfeldern werden übernommen)
  function answers(r) {
    if (!r) return {};
    const a = { ...(r.a || {}) };
    if (r.script && !a['i.skript']) a['i.skript'] = r.script;
    if (r.day && !a['z.zielbild']) a['z.zielbild'] = r.day;
    if (r.values && !a['w.notiz']) a['w.notiz'] = r.values;
    return a;
  }
  function due() {
    const c = current();
    if (!c) return null;
    const next = addDays(c.date, INTERVAL);
    return { next, left: Math.round((parse(next) - parse(today())) / 864e5), over: today() >= next };
  }

  // Änderungen sammeln und gebündelt speichern
  let draft = null, saveTimer = null;
  function edit(fn) {
    if (!draft) { const c = current(); draft = { round: c, a: JSON.parse(JSON.stringify(answers(c))) }; }
    fn(draft.a);
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (!draft) return;
    const { round, a } = draft; draft = null;
    const base = round && S.identity.find(x => x.id === round.id);
    S.saveIdentity(base ? { ...base, a } : { id: 'r-' + today(), kind: 'round', date: today(), a });
  }

  // Einfache Formatierung wie im Tagebuch: # Überschriften, **fett**, Listen
  function render(text) {
    return String(text || '').split('\n').map(l => {
      if (!l.trim()) return '<div class="ln blank"></div>';
      const ind = [...l.match(/^[\t ]*/)[0]].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0);
      const style = ind ? ` style="padding-left:${(ind / 4) * 1.4}em"` : '';
      let t = esc(l.trim());
      const h = t.match(/^(#{1,3})\s+(.*)$/);
      if (h) return `<div class="ln id-h id-h${h[1].length}"${style}>${h[2]}</div>`;
      t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^- \[[xX]\] (.*)$/, '<s>☑ $1</s>').replace(/^- \[ \] /, '☐ ').replace(/^[-*] /, '• ');
      return `<div class="ln"${style}>${t}</div>`;
    }).join('');
  }

  // ---------- Felder ----------
  const ta = (attrs, v, ph = '') => `<textarea class="id-ta" ${attrs} rows="2" placeholder="${esc(ph)}">${esc(v || '')}</textarea>`;
  // Werte-Vergleich: alle Paare der Werte außer dem intuitiv gewählten
  function pairList(a) {
    const rest = (a['w.picked'] || []).filter(v => v !== a['w.intuitiv']);
    const out = [];
    rest.forEach((x, i) => rest.slice(i + 1).forEach(y => out.push([x, y])));
    return out;
  }
  function ranking(a) {
    const wins = {};
    (a['w.picked'] || []).filter(v => v !== a['w.intuitiv']).forEach(v => { wins[v] = 0; });
    pairList(a).forEach(([x, y]) => { const w = (a['w.pairs'] || {})[x + '|' + y]; if (w in wins) wins[w]++; });
    return Object.entries(wins).sort((p, q) => q[1] - p[1]);
  }
  function field(f, a, bk) {
    const label = f.label ? `<label class="id-q">${esc(f.label)}</label>` : '';
    const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : '';
    switch (f.type) {
      case 'text': return `<div class="id-f">${label}${hint}${ta(`data-k="${f.k}"`, a[f.k])}</div>`;
      case 'list': {
        const v = a[f.k] || [];
        return `<div class="id-f">${label}<ol class="id-list">${Array.from({ length: f.n || 9 }, (_, i) => `<li>${ta(`data-k="${f.k}" data-i="${i}"`, v[i])}</li>`).join('')}</ol></div>`;
      }
      case 'valuepick': {
        const sel = a[f.k] || [];
        const all = [...new Set([...(bk.werteListe || []), ...sel])];
        return `<div class="id-f"><p class="id-count">${sel.length} von ${f.max} gewählt</p><div class="id-chips">${all.map(v => `<button class="id-chip" data-act="id-vpick" data-v="${esc(v)}" aria-pressed="${sel.includes(v)}">${esc(v)}</button>`).join('')}</div></div>`;
      }
      case 'valuepairs': {
        const picked = a['w.picked'] || [];
        if (picked.length < 3) return '<p class="hint">Wähle zuerst oben deine 9 Werte.</p>';
        const pairs = pairList(a), done = pairs.filter(([x, y]) => (a['w.pairs'] || {})[x + '|' + y]).length;
        return `<div class="id-f"><label class="id-q">Dein intuitiver Kernwert</label><div class="id-chips">${picked.map(v => `<button class="id-chip" data-act="id-vintu" data-v="${esc(v)}" aria-pressed="${a['w.intuitiv'] === v}">${esc(v)}</button>`).join('')}</div></div>
          ${a['w.intuitiv'] ? `<div class="id-f"><label class="id-q">Welcher Wert ist dir wichtiger? <span class="id-count">${done} von ${pairs.length}</span></label>
          <div class="id-pairs">${pairs.map(([x, y], i) => { const w = (a['w.pairs'] || {})[x + '|' + y]; return `<div class="id-pair"><i>${i + 1}</i>${[x, y].map(v => `<button class="id-chip" data-act="id-vpair" data-p="${esc(x + '|' + y)}" data-v="${esc(v)}" aria-pressed="${w === v}">${esc(v)}</button>`).join('<span>vs</span>')}</div>`; }).join('')}</div></div>
          <div class="id-f"><label class="id-q">Ergebnis</label><ol class="id-rank">${ranking(a).map(([v, n]) => `<li><b>${esc(v)}</b><span>${n}× wichtiger</span></li>`).join('')}</ol></div>` : ''}`;
      }
      case 'valuecore': {
        const core = a[f.k] || [];
        const pool = [...new Set([...core, ...(a['w.picked'] || [])])];
        const sugg = a['w.intuitiv'] ? [a['w.intuitiv'], ...ranking(a).slice(0, 4).map(r => r[0])] : null;
        return `<div class="id-f"><p class="id-count">${core.length} von ${f.max} gewählt</p><div class="id-chips">${pool.map(v => `<button class="id-chip" data-act="id-vcore" data-v="${esc(v)}" aria-pressed="${core.includes(v)}">${esc(v)}</button>`).join('')}</div>
          <div class="id-row">${sugg ? `<button class="btn ghost small" data-act="id-vsugg">Vorschlag aus dem Vergleich: ${esc(sugg.join(', '))}</button>` : ''}
          <form class="id-addv" data-act-form="id-vadd"><input name="v" placeholder="Anderen Wert hinzufügen" list="id-wl" autocomplete="off"><button class="btn ghost small" aria-label="Hinzufügen">${ms('add')}</button></form>
          <datalist id="id-wl">${(bk.werteListe || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist></div></div>`;
      }
      case 'valueconds': {
        const core = a['w.core'] || [];
        if (!core.length) return '<p class="hint">Lege zuerst deine Kernwerte fest.</p>';
        return core.map((v, i) => `<div class="id-f"><label class="id-q">Wert ${i + 1}: ${esc(v)}</label><p class="hint">Ich lebe diesen Wert jedes Mal, wenn ich …</p>${ta(`data-k="w.cond" data-v="${esc(v)}"`, (a['w.cond'] || {})[v], 'eine Bedingung pro Zeile')}</div>`).join('');
      }
      case 'framework': {
        const list = a[f.k] && a[f.k].length ? a[f.k] : [{}];
        return list.map((b, i) => `<div class="id-fw"><h4>Glaubenssatz Nummer ${i + 1}</h4>${f.steps.map(([s, t, q]) => `<div class="id-f"><label class="id-q">${esc(t)}</label><p class="hint">${esc(q)}</p>${ta(`data-k="${f.k}" data-i="${i}" data-s="${s}"`, b[s])}</div>`).join('')}</div>`).join('')
          + (list.length < 9 ? `<button class="btn ghost small" data-act="id-fwadd">${ms('add')} Weiteren Glaubenssatz bearbeiten</button>` : '');
      }
      case 'inspiration': {
        const sel = a[f.k] || [];
        return `<div class="id-insp">${(bk.inspiration || []).map(t => `<button class="id-ck" data-act="id-insp" data-v="${esc(t)}" aria-pressed="${sel.includes(t)}">${ms('check')}<span>${esc(t)}</span></button>`).join('')}</div>`;
      }
    }
    return '';
  }

  // Ein Feld einer früheren Runde nur zum Lesen
  function readField(f, a) {
    const q = f.label ? `<p class="id-q">${esc(f.label)}</p>` : '';
    const li = l => l.filter(Boolean).length ? `<ol class="id-beliefs">${l.filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '';
    switch (f.type) {
      case 'text': return a[f.k] ? q + `<div class="ed-read">${render(a[f.k])}</div>` : '';
      case 'list': { const h = li(a[f.k] || []); return h ? q + h : ''; }
      case 'valuepick': return (a[f.k] || []).length ? `<p>${esc(a[f.k].join(', '))}</p>` : '';
      case 'valuepairs': return a['w.intuitiv'] ? `<p>Intuitiv: <b>${esc(a['w.intuitiv'])}</b></p><ol class="id-rank">${ranking(a).map(([v, n]) => `<li><b>${esc(v)}</b><span>${n}× wichtiger</span></li>`).join('')}</ol>` : '';
      case 'valuecore': return (a[f.k] || []).length ? `<p><b>${esc(a[f.k].join(', '))}</b></p>` : '';
      case 'valueconds': return (a['w.core'] || []).map(v => (a['w.cond'] || {})[v] ? `<div class="id-value"><b>${esc(v)}</b><ul>${a['w.cond'][v].split('\n').filter(l => l.trim()).map(l => `<li>${esc(l.trim())}</li>`).join('')}</ul></div>` : '').join('');
      case 'framework': return (a[f.k] || []).filter(b => Object.values(b).some(Boolean)).map((b, i) => `<div class="id-fw"><h4>Glaubenssatz Nummer ${i + 1}</h4>${f.steps.filter(([st]) => b[st]).map(([st, t]) => `<p class="id-q">${esc(t)}</p><div class="ed-read">${render(b[st])}</div>`).join('')}</div>`).join('');
      case 'inspiration': return li(a[f.k] || []);
    }
    return '';
  }

  // ---------- Ansichten ----------
  let force = false;
  function rerender() { force = true; window.TB_RERENDER(); }
  function head(name, sub) {
    const cur = current(), d = due();
    return `<header class="page-head"><h1>${esc(VIEWS[name][0])}</h1></header>
      <p class="id-kicker">${ms(VIEWS[name][1])} Identität${sub ? ' · ' + esc(sub) : ''}</p>
      ${d && d.over ? `<section class="id-due">${ms('autorenew')}<div><b>Die 90 Tage sind um.</b><span>Zeit für deinen nächsten Zyklus: Du startest mit leeren Seiten bei null. Deine jetzige Runde bleibt unter „Frühere Runden“ erhalten.</span></div><button class="btn" data-act="id-round">Neue Runde beginnen</button></section>`
        : cur && d ? `<p class="hint">Runde vom ${esc(fmt(cur.date))} · nächste Überarbeitung am ${esc(fmt(d.next))} (in ${d.left} ${d.left === 1 ? 'Tag' : 'Tagen'})</p>` : ''}`;
  }
  const noBook = name => `<div class="page id-page">${head(name)}<section class="set"><p class="hint">Die Inhalte des Buchs liegen in deinem privaten Daten-Repo (data/identity.json) und werden beim Synchronisieren geladen. Prüfe in den Einstellungen, ob Daily mit GitHub verbunden ist.</p></section></div>`;

  function viewModule(main, name) {
    const bk = book(); if (!bk) { main.innerHTML = noBook(name); return; }
    const mod = bk.modules[VIEWS[name][2]], a = draft ? draft.a : answers(current());
    const older = rounds().slice(0, -1).reverse();
    main.innerHTML = `<div class="page id-page">${head(name, mod.kicker)}
      <p class="id-intro">${esc(mod.intro)}</p>
      ${mod.sections.map((s, i) => `<section class="set id-sec"><h3><i>${i + 1}</i>${esc(s.title)}</h3>${s.intro ? `<p class="hint">${esc(s.intro)}</p>` : ''}${s.fields.map(f => field(f, a, bk)).join('')}</section>`).join('')}
      ${older.length ? `<section class="set"><h3>Frühere Runden</h3>${older.map(r => { const oa = answers(r); const txt = mod.sections.map(sec => { const body = sec.fields.map(f => readField(f, oa)).join(''); return body ? `<h4 class="id-oldh">${esc(sec.title)}</h4>${body}` : ''; }).join(''); return `<details class="id-old"><summary>Runde vom ${esc(fmt(r.date))}</summary>${txt || '<p class="hint">Keine Texte in dieser Runde.</p>'}</details>`; }).join('')}</section>` : ''}
      ${current() && !(due() || {}).over ? `<p class="hint id-foot"><button class="btn ghost small" data-act="id-round">Neue Runde schon jetzt beginnen</button></p>` : ''}
    </div>`;
    $$('.id-ta', main).forEach(grow);
  }

  // Zum Lesen morgens und abends: Statement, Skript, Überzeugungen, Werte, Zielbild, Manifest
  function viewToday(main) {
    const bk = book();
    // Je Feld die neueste Runde, in der es ausgefüllt ist (eine neue Runde startet leer)
    const filled = v => Array.isArray(v) ? v.some(Boolean) : v && typeof v === 'object' ? Object.values(v).some(Boolean) : !!v;
    const a = {};
    rounds().forEach(r => Object.entries(answers(r)).forEach(([k, v]) => { if (filled(v)) a[k] = v; }));
    const rd = items().find(x => x.id === 'rd-' + today()) || {};
    const readOn = d => { const x = items().find(y => y.id === 'rd-' + d); return !!(x && (x.m || x.e)); };
    let streak = 0;
    for (let d = readOn(today()) ? today() : addDays(today(), -1); readOn(d); d = addDays(d, -1)) streak++;
    const beliefs = (a['g.top'] || []).filter(Boolean).length ? a['g.top'].filter(Boolean) : (a['g.neu'] || []).filter(Boolean);
    const core = a['w.core'] || [];
    const block = (title, html, view) => html ? `<section class="set id-read-sec"><h3>${esc(title)}${view ? `<button class="icon-btn" data-nav="${view}" aria-label="Bearbeiten">${ms('edit')}</button>` : ''}</h3>${html}</section>` : '';
    main.innerHTML = `<div class="page id-page">${head('id-heute', 'täglich morgens und abends lesen')}
      <div class="id-readbar">
        <button class="btn ${rd.m ? '' : 'ghost'}" data-act="id-readmark" data-w="m">${ms(rd.m ? 'check' : 'wb_sunny')} Morgens gelesen</button>
        <button class="btn ${rd.e ? '' : 'ghost'}" data-act="id-readmark" data-w="e">${ms(rd.e ? 'check' : 'bedtime')} Abends gelesen</button>
        ${streak ? `<span class="id-streak">${streak} ${streak === 1 ? 'Tag' : 'Tage'} in Folge</span>` : ''}
      </div>
      ${a['i.statement'] ? `<section class="id-statement">${render(a['i.statement'])}</section>` : ''}
      ${block('Identity-Skript', a['i.skript'] ? `<div class="ed-read">${render(a['i.skript'])}</div>` : '', 'id-identity')}
      ${block('Meine 9 stärksten Überzeugungen', beliefs.length ? `<ol class="id-beliefs">${beliefs.map(b => `<li>${esc(b)}</li>`).join('')}</ol>` : '', 'id-glauben')}
      ${block('Meine Kernwerte', core.length ? core.map((v, i) => `<div class="id-value"><b>${i + 1}. ${esc(v)}</b><p class="hint">Ich lebe diesen Wert jedes Mal, wenn ich …</p><ul>${String((a['w.cond'] || {})[v] || '').split('\n').filter(l => l.trim()).map(l => `<li>${esc(l.trim())}</li>`).join('')}</ul></div>`).join('') : '', 'id-werte')}
      ${block('Mein Zielbild', a['z.zielbild'] ? `<div class="ed-read">${render(a['z.zielbild'])}</div>` : '', 'id-zielbild')}
      ${bk && bk.manifest ? block('Das umsetzer Manifest', `<p class="hint">Wir feiern keine Erkenntnisse. Wir feiern Umsetzung.</p>${bk.manifest.map(([t, b]) => `<div class="id-mani"><b>${esc(t)}</b><p>${esc(b)}</p></div>`).join('')}`) : ''}
      ${!bk ? '<section class="set"><p class="hint">Die Inhalte des Buchs werden beim Synchronisieren geladen.</p></section>' : ''}
    </div>`;
  }

  function viewCheckin(main) {
    const bk = book(); if (!bk) { main.innerHTML = noBook('id-checkin'); return; }
    const areas = bk.checkin || [], list = checkins(), key = 'ci-' + today().slice(0, 7);
    const cur = list.find(c => c.id === key), prev = list.filter(c => c.id < key).slice(-1)[0];
    const sc = (cur && cur.scores) || {};
    const avg = c => { const v = Object.values(c.scores || {}).filter(Number); return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–'; };
    const hist = list.slice(-6);
    main.innerHTML = `<div class="page id-page">${head('id-checkin', 'Ehrlichkeit schlägt Optimismus')}
      <p class="id-intro">Bewerte einmal pro Monat die Bereiche deines Lebens. Plus oder Minus zeigt, ob sich ein Bereich seit dem letzten Check-In verbessert oder verschlechtert hat.</p>
      <section class="set"><h3>${esc(new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }))}${cur ? '' : ' <span class="id-count">noch offen</span>'}</h3>
        <div class="id-scores">${areas.map(ar => { const v = sc[ar], p = prev && prev.scores ? prev.scores[ar] : null, d = v && p ? v - p : 0;
          return `<div class="id-score"><span>${esc(ar)}${d ? ` <i class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</i>` : ''}</span><div>${Array.from({ length: 10 }, (_, i) => `<button data-act="id-ci" data-a="${esc(ar)}" data-v="${i + 1}" aria-pressed="${v === i + 1}">${i + 1}</button>`).join('')}</div></div>`; }).join('')}</div>
      </section>
      ${hist.length > 1 ? `<section class="set"><h3>Verlauf</h3><div class="id-hist"><table><thead><tr><th></th>${hist.map(c => `<th>${esc(fmtMonth(c.date))}</th>`).join('')}</tr></thead><tbody>
        ${areas.map(ar => `<tr><td>${esc(ar)}</td>${hist.map(c => `<td>${(c.scores || {})[ar] || ''}</td>`).join('')}</tr>`).join('')}
        <tr class="id-avg"><td>Durchschnitt</td>${hist.map(c => `<td>${avg(c)}</td>`).join('')}</tr></tbody></table></div></section>` : ''}
    </div>`;
  }

  function grow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }

  function view(main, name) {
    // Solange ein Feld bearbeitet wird, nicht neu aufbauen (Speichern löst sonst einen Neuaufbau aus und der Cursor springt)
    const ae = document.activeElement;
    if (!force && main.dataset.idView === name && ae && main.contains(ae) && /TEXTAREA|INPUT/.test(ae.tagName)) return;
    force = false;
    const y = main.dataset.idView === name ? main.scrollTop : 0;
    main.dataset.idView = name;
    if (name === 'id-heute') viewToday(main);
    else if (name === 'id-checkin') viewCheckin(main);
    else viewModule(main, name);
    main.scrollTop = y;
    if (!main.dataset.idBound) {
      main.dataset.idBound = '1';
      main.addEventListener('input', ev => {
        const t = ev.target; if (!t.dataset || !t.dataset.k) return;
        if (t.tagName === 'TEXTAREA') grow(t);
        const { k, i, s, v } = t.dataset, val = t.value;
        edit(a => {
          if (v != null) a[k] = { ...(a[k] || {}), [v]: val };
          else if (s != null) { const l = (a[k] || []).slice(); while (l.length <= +i) l.push({}); l[+i] = { ...l[+i], [s]: val }; a[k] = l; }
          else if (i != null) { const l = (a[k] || []).slice(); while (l.length <= +i) l.push(''); l[+i] = val; a[k] = l; }
          else a[k] = val;
        });
      });
      main.addEventListener('focusout', ev => { if (ev.target.dataset && ev.target.dataset.k) flush(); });
      main.addEventListener('submit', ev => {
        const f = ev.target.closest('[data-act-form="id-vadd"]'); if (!f) return;
        ev.preventDefault();
        const v = f.v.value.trim(); if (!v) return;
        change(a => { const c = a['w.core'] || []; if (!c.includes(v) && c.length < 5) a['w.core'] = [...c, v]; });
      });
    }
  }

  // ---------- Aktionen ----------
  const toggle = (list, v, max) => list.includes(v) ? list.filter(x => x !== v) : list.length < max ? [...list, v] : list;
  function change(fn) { edit(fn); flush(); rerender(); }
  function newRound() {
    flush();
    const cur = current(); if (!cur) return;
    if (!confirm('Neue 90-Tage-Runde beginnen? Alle Seiten starten wieder leer. Deine jetzige Runde bleibt unter „Frühere Runden“ erhalten.')) return;
    const id = 'r-' + today();
    S.saveIdentity({ id: rounds().some(r => r.id === id) ? id + '-' + Date.now().toString(36) : id, kind: 'round', date: today(), a: {} });
  }
  const actions = {
    'id-vpick': el => change(a => { a['w.picked'] = toggle(a['w.picked'] || [], el.dataset.v, 9); }),
    'id-vintu': el => change(a => { a['w.intuitiv'] = a['w.intuitiv'] === el.dataset.v ? '' : el.dataset.v; }),
    'id-vpair': el => change(a => { a['w.pairs'] = { ...(a['w.pairs'] || {}), [el.dataset.p]: el.dataset.v }; }),
    'id-vcore': el => change(a => { a['w.core'] = toggle(a['w.core'] || [], el.dataset.v, 5); }),
    'id-vsugg': () => change(a => { a['w.core'] = [a['w.intuitiv'], ...ranking(a).slice(0, 4).map(r => r[0])]; }),
    'id-insp': el => change(a => { a['g.insp'] = toggle(a['g.insp'] || [], el.dataset.v, Infinity); }),
    'id-fwadd': () => change(a => { const l = a['g.fw'] && a['g.fw'].length ? a['g.fw'].slice() : [{}]; l.push({}); a['g.fw'] = l; }),
    'id-round': () => { newRound(); rerender(); },
    'id-readmark': el => {
      const id = 'rd-' + today(), old = items().find(x => x.id === id) || { id, kind: 'read', date: today() };
      S.saveIdentity({ ...old, [el.dataset.w]: !old[el.dataset.w] }); rerender();
    },
    'id-ci': el => {
      const id = 'ci-' + today().slice(0, 7), old = items().find(x => x.id === id) || { id, kind: 'checkin', date: today(), scores: {} };
      const v = +el.dataset.v, scores = { ...(old.scores || {}) };
      if (scores[el.dataset.a] === v) delete scores[el.dataset.a]; else scores[el.dataset.a] = v;
      S.saveIdentity({ ...old, date: today(), scores }); rerender();
    },
  };

  window.TB_IDENTITAET = { view, actions, due, VIEWS, _test: { ranking, pairList } };
})();
