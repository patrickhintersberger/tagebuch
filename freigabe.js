// Reisen freigeben: erstellt einen Link mit Ablaufdatum, über den jemand Reisetage (Datum, Ort, Wetter, Bilder),
// Karte und die Orte der Reisekarte ansehen kann. Texte der Einträge, Tags, Bewertungen und die Notizen der
// Reisekarte werden nie übertragen.
// Ablage: öffentliches Repo „freigaben“ (GitHub Pages zeigt die Ansicht), jede Freigabe als Ordner <Ablaufdatum>_<id>.
// Alles darin ist mit AES-GCM verschlüsselt; der Schlüssel steht nur im Link hinter dem # und geht nie an einen Server.
// Abgelaufene Freigaben löscht Daily beim nächsten Start, die Ansicht sperrt sich ab dem Folgetag ohnehin selbst.
(function () {
  'use strict';
  const S = window.TB_STORE;
  const cfg = window.TB_CONFIG;
  const REPO = 'freigaben';
  const VIEW = `https://${cfg.owner}.github.io/${REPO}/`;
  const LS = 'tb-shares';
  const PACK = 4 * 1024 * 1024; // Bilder werden zu Paketen von etwa 4 MB zusammengefasst (weniger Anfragen an GitHub)
  const MAX_PHOTOS = 5000;
  const BLOB_GAP = 1000; // mindestens 1 s zwischen zwei Uploads, damit GitHubs Grenze (80 pro Minute) nicht greift
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = name => `<span class="ms">${name}</span>`;
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => iso(new Date());
  const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const countryName = cc => { try { return new Intl.DisplayNames(['de'], { type: 'region' }).of(cc.toUpperCase()); } catch { return cc.toUpperCase(); } };
  const toast = t => window.TB_toast ? window.TB_toast(t) : alert(t);

  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  const token = () => { try { return localStorage.getItem('tb-token'); } catch { return null; } };

  // ---------- GitHub (Git-Daten-API: viele Dateien in einem Commit) ----------
  const NO_ACCESS = `Der GitHub-Token hat noch keinen Zugriff auf das Repo „${REPO}“. Auf github.com beim Token unter „Repository access“ zusätzlich „${REPO}“ auswählen und bei „Contents“ „Read and write“ lassen. Danach hier erneut versuchen.`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function api(method, path, body, tries = 0) {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${cfg.owner}/${REPO}/${path}`, {
        method, cache: 'no-store',
        headers: { 'Authorization': `Bearer ${token()}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error('Keine Verbindung. Freigaben gehen nur mit Internet.'); }
    if (!res.ok) {
      // Originalmeldung von GitHub mit anzeigen, damit sich die Ursache erkennen lässt
      let gm = ''; try { gm = (await res.json()).message || ''; } catch {}
      // Zu viele Anfragen in kurzer Zeit: warten, wie GitHub es vorgibt, und erneut versuchen
      if ((res.status === 403 || res.status === 429) && /rate limit/i.test(gm) && tries < 6) {
        const wait = (+res.headers.get('retry-after') || 60) * 1000;
        if (api.onWait) api.onWait(Math.round(wait / 1000));
        await sleep(wait);
        return api(method, path, body, tries + 1);
      }
      const detail = ` (GitHub: ${res.status}${gm ? ' – ' + gm : ''}, bei ${method} ${path.split('?')[0]})`;
      if (res.status === 401) throw new Error('GitHub kennt den Token nicht (mehr). Bitte in den Einstellungen neu verbinden.' + detail);
      if (res.status === 403 || res.status === 404) throw Object.assign(new Error(NO_ACCESS + detail), { status: res.status });
      throw Object.assign(new Error(`GitHub antwortet mit Fehler ${res.status}.` + detail), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  }
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // Neuer Stand des Repos: Dateien hinzufügen (sha) oder löschen (sha: null), mit Wiederholung, falls ein anderes Gerät dazwischenkam
  async function commit(message, entries) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await api('GET', 'git/ref/heads/main');
      const head = await api('GET', `git/commits/${ref.object.sha}`);
      const tree = await api('POST', 'git/trees', { base_tree: head.tree.sha, tree: entries.map(e => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })) });
      const c = await api('POST', 'git/commits', { message, tree: tree.sha, parents: [ref.object.sha] });
      try { await api('PATCH', 'git/refs/heads/main', { sha: c.sha }); return; }
      catch (e) { if (e.status !== 422) throw e; }
    }
    throw new Error('GitHub war gerade beschäftigt. Bitte noch einmal versuchen.');
  }

  // ---------- Inhalt zusammenstellen ----------
  function travelState() {
    // Die Reisekarte liegt unter derselben Adresse und speichert ihre Daten im selben Browser-Speicher
    const s = lsGet('rk-state-v1', null) || {};
    const live = o => Object.values(o || {}).filter(x => x && !x.deleted);
    return { places: live(s.places), trips: live(s.trips) };
  }
  const geo = () => window.TB_GEO;
  const entryCC = e => { if (!e.loc || e.loc.lat == null || !geo() || !geo().ready()) return ''; const c = geo().at(e.loc.lat, e.loc.lng); return c ? c.cc.toLowerCase() : ''; };
  const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);

  function select(o) {
    const entries = S.entries.filter(e => e.date && inRange(e.date, o.from, o.to) && (!o.cc || entryCC(e) === o.cc))
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    let places = [], trips = [];
    if (o.places) {
      const t = travelState();
      const tripOk = new Set(t.trips.filter(tr => (o.from || o.to) && tr.start && tr.end ? !(o.to && tr.start > o.to) && !(o.from && tr.end < o.from) : false).map(tr => tr.id));
      places = t.places.filter(p => {
        if (o.cc && (p.country || '').toLowerCase() !== o.cc) return false;
        if (!o.from && !o.to) return true;
        return inRange(p.visitedDate, o.from, o.to) || (p.tripIds || []).some(id => tripOk.has(id));
      });
      const used = new Set(places.flatMap(p => p.tripIds || []));
      trips = t.trips.filter(tr => used.has(tr.id));
    }
    const photos = entries.reduce((n, e) => n + (e.photos || []).filter(p => p.kind !== 'video').length, 0);
    return { entries, places, trips, photos };
  }

  // Bytes verschlüsseln: 12 Byte Zufallswert + verschlüsselte Daten
  async function encrypt(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv); out.set(ct, 12);
    return out;
  }
  async function photoBytes(id, thumb) {
    const blob = await S.photoBlob(id, thumb);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  async function create(o, progress) {
    if (!token()) throw new Error('Verbinde Daily zuerst unten unter „Synchronisation“ mit GitHub.');
    if (!navigator.onLine) throw new Error('Freigaben gehen nur mit Internet.');
    const sel = select(o);
    if (!sel.entries.length && !sel.places.length) throw new Error('Für diese Auswahl gibt es keine Reisetage und keine Orte.');
    if (sel.photos > MAX_PHOTOS) throw new Error(`Das sind ${sel.photos} Bilder. Bitte wähle einen kürzeren Zeitraum (höchstens ${MAX_PHOTOS} Bilder).`);
    await api('GET', 'git/ref/heads/main'); // Zugriff früh prüfen, bevor Bilder verarbeitet werden

    // Bildschirm anlassen, solange hochgeladen wird (sonst bricht das iPhone im Ruhezustand ab)
    // (nicht abwarten: die Anfrage darf das Hochladen nie aufhalten)
    let lock = null;
    const wake = () => { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { lock = l; }, () => {}); } catch {} };
    wake();
    const relock = () => { if (document.visibilityState === 'visible' && (!lock || lock.released)) wake(); };
    document.addEventListener('visibilitychange', relock);
    try {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
      const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
      const folder = `${o.until}_${id}`;

      // Hochladen: jedes Paket sofort, sobald es voll ist, dann ein gemeinsamer Commit am Ende
      const entries = [];
      let sent = 0, lastPost = 0, status = '';
      const show = () => progress(`${status} · ${(sent / 1e6).toFixed(0)} MB hochgeladen`);
      api.onWait = sec => progress(`GitHub bremst kurz, es geht in ${sec} s weiter …`);
      async function upload(name, bytes) {
        const gap = lastPost + BLOB_GAP - Date.now();
        if (gap > 0) await sleep(gap);
        lastPost = Date.now();
        const blob = await api('POST', 'git/blobs', { content: b64(bytes), encoding: 'base64' });
        entries.push({ path: `${folder}/${name}`, sha: blob.sha });
        sent += bytes.length; show();
      }

      // Pakete: Vorschaubilder (t0, t1 …) und große Bilder (p0, p1 …)
      const packers = {};
      const packer = prefix => packers[prefix] || (packers[prefix] = { prefix, n: 0, parts: [], size: 0 });
      async function flush(pk) {
        if (!pk.size) return;
        const buf = new Uint8Array(pk.size); let off = 0;
        pk.parts.forEach(p => { buf.set(p, off); off += p.length; });
        const name = `${pk.prefix}${pk.n}.bin`;
        pk.n++; pk.parts = []; pk.size = 0;
        await upload(name, buf);
      }
      async function put(prefix, bytes) {
        const pk = packer(prefix);
        if (pk.size && pk.size + bytes.length > PACK) await flush(pk);
        const ref = [`${pk.prefix}${pk.n}.bin`, pk.size, bytes.length];
        pk.parts.push(bytes); pk.size += bytes.length;
        return ref;
      }

      const days = [];
      let done = 0, added = 0;
      for (const e of sel.entries) {
        const day = { date: e.date };
        if (o.titles && e.title) day.title = e.title;
        if (e.loc && e.loc.lat != null) { day.lat = e.loc.lat; day.lng = e.loc.lng; }
        if (e.loc && e.loc.name) day.place = e.loc.name;
        const cc = entryCC(e); if (cc) day.cc = cc;
        if (e.weather) day.weather = e.weather;
        day.photos = [];
        for (const p of (e.photos || []).filter(x => x.kind !== 'video')) {
          status = `Bild ${++done} von ${sel.photos}`; show();
          const [t, full] = await Promise.all([photoBytes(p.id, true), photoBytes(p.id, false)]);
          if (!t && !full) continue;
          const ph = { t: await put('t', await encrypt(key, t || full)), p: await put('p', await encrypt(key, full || t)) };
          if (p.w) { ph.w = p.w; ph.h = p.h; }
          if (p.lat != null) { ph.lat = p.lat; ph.lng = p.lng; }
          day.photos.push(ph); added++;
        }
        days.push(day);
      }
      status = 'Letzte Pakete';
      for (const pk of Object.values(packers)) await flush(pk);

      const places = sel.places.map(p => {
        // Persönliche Notiz (note) und interne Felder bleiben draußen
        const out = { name: p.name, category: p.category, lat: p.lat, lng: p.lng, city: p.city, country: (p.country || '').toLowerCase(), info: p.info, visited: !!p.visited, visitedDate: p.visitedDate, tripIds: p.tripIds };
        Object.keys(out).forEach(k => (out[k] == null || out[k] === '') && delete out[k]);
        return out;
      });
      const trips = sel.trips.map(t => ({ id: t.id, name: t.name, color: t.color, start: t.start, end: t.end }));
      const manifest = { v: 1, title: o.title, from: o.from || null, to: o.to || null, cc: o.cc || null, until: o.until, created: Date.now(), days, places, trips };
      status = 'Inhalt';
      await upload('data.bin', await encrypt(key, new TextEncoder().encode(JSON.stringify(manifest))));
      progress('Link wird fertiggestellt …');
      await commit(`Freigabe bis ${o.until}`, entries);

      const link = `${VIEW}#${folder}.${b64url(raw)}`;
      const list = lsGet(LS, []).filter(x => x.folder !== folder);
      list.push({ folder, link, title: o.title, until: o.until, created: Date.now(), days: days.length, photos: added, places: places.length });
      lsSet(LS, list);
      return { link, days: days.length, photos: added, places: places.length };
    } finally {
      api.onWait = null;
      document.removeEventListener('visibilitychange', relock);
      try { if (lock) lock.release(); } catch {}
    }
  }

  async function remoteFolders() {
    const list = await api('GET', 'contents/');
    return (Array.isArray(list) ? list : []).filter(f => f.type === 'dir' && /^\d{4}-\d{2}-\d{2}_[a-z0-9]+$/.test(f.name)).map(f => f.name);
  }
  async function remove(folders, message) {
    if (!folders.length) return;
    const ref = await api('GET', 'git/ref/heads/main');
    const head = await api('GET', `git/commits/${ref.object.sha}`);
    const tree = await api('GET', `git/trees/${head.tree.sha}?recursive=1`);
    const del = tree.tree.filter(t => t.type === 'blob' && folders.some(f => t.path.startsWith(f + '/'))).map(t => ({ path: t.path, sha: null }));
    if (del.length) await commit(message, del);
    lsSet(LS, lsGet(LS, []).filter(s => !folders.includes(s.folder)));
  }

  // Abgelaufene Freigaben entfernen (beim Start, höchstens einmal am Tag)
  async function cleanup() {
    if (!token() || !navigator.onLine || lsGet('tb-shares-clean', '') === today()) return;
    try {
      const old = (await remoteFolders()).filter(f => f.slice(0, 10) < today());
      await remove(old, 'Abgelaufene Freigaben entfernt');
      lsSet('tb-shares-clean', today());
    } catch {}
  }

  // ---------- Oberfläche (in den Einstellungen) ----------
  let box = null, busy = false, last = null;
  async function render(el) {
    box = el;
    if (!box) return;
    if (geo() && !geo().ready()) geo().load().then(() => box && box.isConnected && !busy && draw()).catch(() => {});
    draw();
    refreshList();
  }
  function countries() {
    const set = new Set();
    S.entries.forEach(e => { const c = entryCC(e); if (c) set.add(c); });
    travelState().places.forEach(p => p.country && set.add(p.country.toLowerCase()));
    return [...set].map(cc => [cc, countryName(cc)]).sort((a, b) => a[1].localeCompare(b[1], 'de'));
  }
  function draw() {
    if (!box || !box.isConnected) return;
    const v = last || { title: '', from: '', to: '', cc: '', until: plusDays(14), titles: true, places: true };
    box.innerHTML = `
      <p class="hint">Erstelle einen Link, über den jemand deine Reisen ansehen kann: Karte, Reisetage mit Bildern, Ort und Wetter sowie die Orte aus der Reisekarte. Texte der Einträge, Tags, Bewertungen und persönliche Notizen sind nie dabei. Ab dem Tag nach dem Ablaufdatum funktioniert der Link nicht mehr.</p>
      <form id="share-form" class="share-form">
        <input name="title" type="text" placeholder="Titel, z. B. Kroatien 2025" value="${esc(v.title)}" required>
        <div class="share-two">
          <label>Von<input name="from" type="date" value="${esc(v.from)}"></label>
          <label>Bis<input name="to" type="date" value="${esc(v.to)}"></label>
        </div>
        <label>Land<select name="cc"><option value="">Alle Länder</option>${countries().map(([cc, n]) => `<option value="${cc}" ${cc === v.cc ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label>Link gültig bis einschließlich<input name="until" type="date" min="${today()}" value="${esc(v.until)}" required></label>
        <label class="share-chk"><input name="titles" type="checkbox" ${v.titles ? 'checked' : ''}> Überschriften der Einträge zeigen</label>
        <label class="share-chk"><input name="places" type="checkbox" ${v.places ? 'checked' : ''}> Orte aus der Reisekarte zeigen</label>
        <p class="hint" id="share-count"></p>
        <div class="row-btns left"><button class="btn" ${busy ? 'disabled' : ''}>${ms('link')} Link erstellen</button></div>
      </form>
      <div id="share-result"></div>
      <div id="share-list"></div>`;
    const f = $('#share-form', box);
    const read = () => ({ title: f.title.value.trim(), from: f.from.value, to: f.to.value, cc: f.cc.value, until: f.until.value, titles: f.titles.checked, places: f.places.checked });
    const count = () => {
      const o = read(); last = o;
      const s = select(o);
      const parts = [`${s.entries.length} Reisetage`, `${s.photos} Bilder`];
      if (o.places) parts.push(`${s.places.length} Orte`);
      const mins = Math.ceil(s.photos / 100); // grob: ca. 200 KB je Bild, je nach Leitung 1–3 Minuten pro 100 Bilder
      $('#share-count', box).textContent = `Enthalten: ${parts.join(', ')}.` + (s.photos > MAX_PHOTOS ? ` Das sind zu viele Bilder (höchstens ${MAX_PHOTOS}).` : '')
        + (!o.from && !o.to && !o.cc ? ' Ohne Zeitraum und Land wird alles freigegeben.' : '')
        + (s.photos > 300 ? ` Das Hochladen dauert eine Weile (bei ${s.photos} Bildern grob ${mins}–${mins * 3} Minuten). Lass Daily dabei geöffnet, am besten am Mac im WLAN.` : '');
    };
    f.addEventListener('input', count);
    count();
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (busy) return;
      const o = read();
      if (o.from && o.to && o.from > o.to) { toast('„Von“ liegt nach „Bis“.'); return; }
      if (o.until < today()) { toast('Das Ablaufdatum liegt in der Vergangenheit.'); return; }
      busy = true;
      const btn = f.querySelector('button'); btn.disabled = true;
      const stay = ev2 => { ev2.preventDefault(); ev2.returnValue = ''; };
      addEventListener('beforeunload', stay);
      const out = $('#share-result', box);
      out.innerHTML = '<p class="status"><i class="sync-dot"></i><span id="share-prog">Wird vorbereitet …</span></p>';
      try {
        const r = await create(o, t => { const p = $('#share-prog', box); if (p) p.textContent = t; });
        out.innerHTML = linkHtml(r.link, `Fertig: ${r.days} Reisetage, ${r.photos} Bilder${o.places ? `, ${r.places} Orte` : ''}. Gültig bis ${fmt(o.until)}.`);
        bindLink(out);
        refreshList();
      } catch (e) {
        out.innerHTML = `<p class="hint warn">${esc(e.message || 'Das hat nicht geklappt.')}</p>`;
      } finally { busy = false; btn.disabled = false; removeEventListener('beforeunload', stay); }
    });
  }
  function linkHtml(link, text) {
    return `<div class="share-link"><p class="hint">${esc(text)}</p><input type="text" readonly value="${esc(link)}" aria-label="Link">
      <div class="row-btns left"><button class="btn" data-share="copy">${ms('content_copy')} Link kopieren</button>${navigator.share ? `<button class="btn ghost" data-share="send">${ms('share')} Teilen</button>` : ''}
      <a class="btn ghost" href="${esc(link)}" target="_blank" rel="noopener">${ms('open_in_new')} Ansehen</a></div>
      <p class="hint">Der Link enthält den Schlüssel zu den Bildern. Schicke ihn nur an die Person, die ihn sehen soll.</p></div>`;
  }
  function bindLink(root) {
    const inp = root.querySelector('input[readonly]');
    const c = root.querySelector('[data-share="copy"]');
    if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(inp.value); toast('Link kopiert'); } catch { inp.select(); document.execCommand('copy'); toast('Link kopiert'); } };
    const s = root.querySelector('[data-share="send"]');
    if (s) s.onclick = () => navigator.share({ title: 'Meine Reisen', url: inp.value }).catch(() => {});
  }
  async function refreshList() {
    const el = box && $('#share-list', box);
    if (!el) return;
    const local = lsGet(LS, []);
    let remote = null;
    if (token() && navigator.onLine) { try { remote = await remoteFolders(); } catch {} }
    if (remote) { const keep = local.filter(s => remote.includes(s.folder)); if (keep.length !== local.length) lsSet(LS, keep); }
    const known = new Map(lsGet(LS, []).map(s => [s.folder, s]));
    const all = [...new Set([...(remote || []), ...known.keys()])].sort().reverse();
    if (!el.isConnected) return;
    if (!all.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<h4 class="share-h">Aktive Freigaben</h4>` + all.map(folder => {
      const s = known.get(folder);
      const until = folder.slice(0, 10);
      const gone = until < today();
      return `<div class="share-item"><div><b>${esc(s ? s.title : 'Freigabe')}</b><small>${gone ? 'abgelaufen' : 'gültig bis ' + esc(fmt(until))}${s ? ` · ${s.days} Tage, ${s.photos} Bilder` : ' · auf einem anderen Gerät erstellt'}</small></div>
        <div class="row-btns">${s && !gone ? `<button class="btn ghost" data-copy="${esc(folder)}">${ms('content_copy')}</button>` : ''}<button class="btn ghost danger" data-end="${esc(folder)}">Beenden</button></div></div>`;
    }).join('');
    el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
      const s = known.get(b.dataset.copy);
      try { await navigator.clipboard.writeText(s.link); toast('Link kopiert'); } catch { prompt('Link', s.link); }
    });
    el.querySelectorAll('[data-end]').forEach(b => b.onclick = async () => {
      if (!confirm('Diese Freigabe beenden? Der Link funktioniert danach nicht mehr.')) return;
      b.disabled = true;
      try { await remove([b.dataset.end], 'Freigabe beendet'); toast('Freigabe beendet'); }
      catch (e) { toast(e.message); }
      refreshList();
    });
  }

  window.TB_SHARE = { render, cleanup, create, select };
})();
