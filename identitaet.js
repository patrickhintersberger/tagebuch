// Identität: Identity-Script, der perfekte Tag und die eigenen Werte – unabhängig vom Tagebuch.
// Alle 90 Tage beginnt eine neue Runde: die Texte der letzten Runde werden übernommen und neu geschrieben,
// die alten Fassungen bleiben zum Nachlesen erhalten.
// Daten: data/identity.json im privaten Daten-Repo, je Runde { id, date, script, day, values }.
(function () {
  'use strict';
  const S = window.TB_STORE;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = name => `<span class="ms">${name}</span>`;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const fmt = s => parse(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const INTERVAL = 90;

  const SECTIONS = {
    'id-script': { key: 'script', title: 'Identity-Script', icon: 'fingerprint',
      hint: 'Wer bist du – als die Person, die du werden willst? Schreib in der Gegenwart und in der Ich-Form.',
      placeholder: 'Ich bin …' },
    'id-tag': { key: 'day', title: 'Der perfekte Tag', icon: 'wb_sunny',
      hint: 'Wie sieht ein ganz normaler, perfekter Tag in deinem Leben aus – vom Aufwachen bis zum Schlafengehen?',
      placeholder: 'Ich wache um … auf …' },
    'id-werte': { key: 'values', title: 'Meine Werte', icon: 'diamond',
      hint: 'Wofür stehst du? Ein Wert pro Zeile, gern mit einem Satz, was er für dich bedeutet.',
      placeholder: '## Freiheit\nIch entscheide selbst, …' },
  };

  // Einfache Formatierung wie im Tagebuch: # Überschriften, **fett**, ~~durchgestrichen~~, Listen und Checklisten
  function render(text) {
    return String(text || '').split('\n').map(l => {
      if (!l.trim()) return '<div class="ln blank"></div>';
      const ind = [...l.match(/^[\t ]*/)[0]].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0);
      const style = ind ? ` style="padding-left:${(ind / 4) * 1.4}em"` : '';
      let t = esc(l.trim());
      const h = t.match(/^(#{1,3})\s+(.*)$/);
      if (h) return `<div class="ln id-h id-h${h[1].length}"${style}>${h[2]}</div>`;
      t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/~~(.+?)~~/g, '<s>$1</s>')
        .replace(/^- \[[xX]\] (.*)$/, '<s>☑ $1</s>').replace(/^- \[ \] /, '☐ ').replace(/^[-*] /, '• ');
      return `<div class="ln"${style}>${t}</div>`;
    }).join('');
  }

  const rounds = () => S.identity;
  const current = () => rounds().slice(-1)[0] || null;
  function due() {
    const c = current();
    if (!c) return null;
    const next = addDays(c.date, INTERVAL), today = iso(new Date());
    return { next, left: daysBetween(today, next), over: today >= next };
  }

  let editing = null; // Ansicht, deren Text gerade bearbeitet wird
  let saveTimer = null;
  let force = false;  // Neuaufbau trotz offenem Textfeld (nach Knopfdruck)
  function rerender() { force = true; window.TB_RERENDER(); }

  function view(main, name) {
    const sec = SECTIONS[name];
    // Solange das Textfeld offen ist, nicht neu aufbauen (Speichern löst sonst einen Neuaufbau aus und der Cursor springt)
    if ($('#id-text', main) && main.dataset.idView === name && !force) return;
    force = false;
    if (editing && editing !== name) editing = null;
    main.dataset.idView = name;
    const cur = current(), d = due();
    const text = cur ? cur[sec.key] || '' : '';
    const isEdit = editing === name || !text.trim();
    const older = rounds().slice(0, -1).reverse().filter(r => (r[sec.key] || '').trim());
    main.innerHTML = `<div class="page id-page">
      <header class="page-head"><h1>${esc(sec.title)}</h1></header>
      <p class="id-kicker">${ms(sec.icon)} Identität${cur ? ` · Runde vom ${esc(fmt(cur.date))}` : ''}</p>
      ${d && d.over ? `<section class="id-due">${ms('autorenew')}<div><b>Die 90 Tage sind um.</b><span>Zeit, Identity-Script, perfekten Tag und Werte neu zu schreiben. Die jetzigen Texte werden übernommen, die alte Fassung bleibt erhalten.</span></div><button class="btn" data-act="id-round">Neue Runde beginnen</button></section>`
        : d ? `<p class="hint">Nächste Überarbeitung am ${esc(fmt(d.next))} (in ${d.left} ${d.left === 1 ? 'Tag' : 'Tagen'}).</p>` : ''}
      <section class="set id-box">
        ${isEdit
          ? `<p class="hint">${esc(sec.hint)}</p>
             <textarea id="id-text" class="ed-text id-text" placeholder="${esc(sec.placeholder)}">${esc(text)}</textarea>
             <div class="row-btns"><button class="btn" data-act="id-done">Fertig</button></div>`
          : `<div class="ed-read id-read" data-act="id-edit">${render(text)}</div>
             <div class="row-btns"><button class="btn ghost" data-act="id-edit">${ms('edit')} Bearbeiten</button></div>`}
      </section>
      ${older.length ? `<section class="set"><h3>Frühere Fassungen</h3>${older.map(r => `<details class="id-old"><summary>Runde vom ${esc(fmt(r.date))}</summary><div class="ed-read">${render(r[sec.key])}</div></details>`).join('')}</section>` : ''}
      ${cur && !(d && d.over) ? `<p class="hint id-foot"><button class="btn ghost small" data-act="id-round">Neue Runde schon jetzt beginnen</button></p>` : ''}
    </div>`;
    const area = $('#id-text', main);
    if (area) {
      const grow = () => { area.style.height = 'auto'; area.style.height = Math.max(240, area.scrollHeight + 4) + 'px'; };
      grow();
      area.addEventListener('input', () => { grow(); clearTimeout(saveTimer); saveTimer = setTimeout(() => save(sec.key, area.value), 600); });
      area.addEventListener('blur', () => { clearTimeout(saveTimer); save(sec.key, area.value); });
      if (editing === name) area.focus();
    }
  }

  function save(key, value) {
    const cur = current();
    if (!cur) { if (value.trim()) S.saveIdentity({ date: iso(new Date()), script: '', day: '', values: '', [key]: value }); return; }
    if ((cur[key] || '') !== value) S.saveIdentity({ ...cur, [key]: value });
  }

  function newRound() {
    const cur = current();
    if (!cur) return;
    if (!confirm('Neue 90-Tage-Runde beginnen? Die jetzigen Texte werden als Startpunkt übernommen, die alte Fassung bleibt unter „Frühere Fassungen“ erhalten.')) return;
    S.saveIdentity({ date: iso(new Date()), script: cur.script || '', day: cur.day || '', values: cur.values || '' });
  }

  const actions = {
    'id-edit': () => { editing = $('#main').dataset.idView; rerender(); },
    'id-done': () => { const a = $('#id-text'); if (a) { clearTimeout(saveTimer); save(SECTIONS[$('#main').dataset.idView].key, a.value); } editing = null; rerender(); },
    'id-round': () => { editing = null; newRound(); rerender(); },
  };

  window.TB_IDENTITAET = { view, actions, due, SECTIONS };
})();
