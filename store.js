// Datenhaltung: lokaler Speicher (IndexedDB) + Synchronisation mit einem privaten GitHub-Repo.
// Einträge liegen pro Jahr in einer JSON-Datei (data/2026.json), Vorlagen in data/templates.json,
// Bilder als einzelne Dateien daneben. So wird beim Speichern nur das betroffene Jahr übertragen.
// Zusammenführung pro Eintrag nach updatedAt, Löschungen bleiben als "deleted"-Markierung erhalten.
(function () {
  const LS_TOKEN = 'tb-token';
  const LS_REPO = 'tb-repo';
  const cfg = window.TB_CONFIG;

  const store = {
    entries: {},    // id -> Eintrag
    templates: {},  // id -> Vorlage
    habits: {},     // id -> Gewohnheit
    logs: {},       // id (Gewohnheit_Datum) -> Tageswert einer Gewohnheit
    bucket: {},     // id -> Ziel der Bucket-Liste (id '_profile' = Geburtsdatum)
    push: {},       // id -> Gerät, das die tägliche Erinnerung bekommt (Push-Abo)
    finance: {},    // id -> Buchung (Finanzen), Datei je Jahr: data/f2026.json
    fmeta: {},      // id -> Kategorie-Regel bzw. Einstellung der Finanzen, Datei data/fmeta.json
    pending: [],    // Bild-IDs, die noch hochgeladen werden müssen
    pendingThumbs: [], // nur das Vorschaubild muss noch hochgeladen werden (nachträglich erzeugt)
    shas: {},       // Dateischlüssel ('2026', 'templates') -> zuletzt bekannter Stand im Repo
    dirty: [],      // Dateischlüssel mit lokalen Änderungen, die noch hochgeladen werden müssen
    status: 'local', // local | syncing | ok | error | offline | notoken
    statusText: '',
    listeners: new Set(),
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch {} }

  // ---------- IndexedDB (mit Rückfall auf Arbeitsspeicher) ----------
  let db = null;
  const mem = { kv: new Map(), blobs: new Map() };
  function openDB() {
    return new Promise(resolve => {
      try {
        const r = indexedDB.open('tagebuch', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  function idbGet(name, key) {
    if (!db) return Promise.resolve(mem[name].get(key));
    return new Promise(resolve => {
      try {
        const rq = db.transaction(name, 'readonly').objectStore(name).get(key);
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  }
  function idbSet(name, key, value) {
    if (!db) { mem[name].set(key, value); return Promise.resolve(); }
    return new Promise(resolve => {
      try {
        const tx = db.transaction(name, 'readwrite');
        tx.objectStore(name).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => resolve();
      } catch { resolve(); }
    });
  }

  async function loadLocal() {
    const s = await idbGet('kv', 'state');
    if (s) {
      store.entries = s.entries || {};
      store.templates = s.templates || {};
      store.habits = s.habits || {};
      store.logs = s.logs || {};
      store.push = s.push || {};
      store.bucket = s.bucket || {};
      store.finance = s.finance || {};
      store.fmeta = s.fmeta || {};
      store.pending = s.pending || [];
      store.pendingThumbs = s.pendingThumbs || [];
      store.shas = s.shas || {};
      store.dirty = Array.isArray(s.dirty) ? s.dirty : [];
    }
    // Standard-Vorlagen: feste IDs und updatedAt 1, damit Änderungen von anderen Geräten immer gewinnen.
    (window.TB_DEFAULT_TEMPLATES || []).forEach(t => {
      if (!store.templates[t.id]) store.templates[t.id] = { ...t, createdAt: 1, updatedAt: 1 };
    });
  }
  function saveLocal() {
    return idbSet('kv', 'state', { entries: store.entries, templates: store.templates, habits: store.habits, logs: store.logs, push: store.push, bucket: store.bucket, finance: store.finance, fmeta: store.fmeta, pending: store.pending, pendingThumbs: store.pendingThumbs, shas: store.shas, dirty: store.dirty });
  }

  let saveTimer = null;
  // Bündelt viele Änderungen kurz hintereinander (z.B. beim Import) zu einem Schreibvorgang.
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 400); }

  function emit() { store.listeners.forEach(fn => fn()); }
  function setStatus(s, text = '') { store.status = s; store.statusText = text; emit(); }

  function getToken() { return lsGet(LS_TOKEN); }
  function getRepo() { return lsGet(LS_REPO) || `${cfg.owner}/${cfg.dataRepo}`; }

  // ---------- Base64 ----------
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  // ---------- Zusammenführen ----------
  function mergeMaps(a, b) {
    const out = { ...a };
    for (const [id, item] of Object.entries(b || {})) {
      const mine = out[id];
      if (!mine || (item.updatedAt || 0) > (mine.updatedAt || 0)) out[id] = item;
    }
    return out;
  }
  function toMap(arr) { const m = {}; (arr || []).forEach(x => { if (x && x.id) m[x.id] = x; }); return m; }
  function sameMaps(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => b[k] && (a[k].updatedAt || 0) === (b[k].updatedAt || 0));
  }
  const byWhen = (x, y) => (x.date || '').localeCompare(y.date || '') || (x.time || '').localeCompare(y.time || '') || (x.id || '').localeCompare(y.id || '');
  function serialize() {
    return JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      templates: Object.values(store.templates).sort((x, y) => (x.name || '').localeCompare(y.name || '')),
      entries: Object.values(store.entries).sort(byWhen),
      habits: Object.values(store.habits),
      logs: Object.values(store.logs),
      bucket: Object.values(store.bucket),
      finance: Object.values(store.finance).sort(byWhen),
      fmeta: Object.values(store.fmeta),
    }, null, 1);
  }

  // ---------- Aufteilung in Dateien ----------
  const yearOf = e => (e.date || '0000').slice(0, 4);
  // Dateischlüssel -> Sammlung: 'templates', 'habits', '2026' (Einträge), 'h2026' (Gewohnheits-Tageswerte),
  // 'f2026' (Buchungen der Finanzen), 'fmeta' (Kategorie-Regeln). Wichtig: 'f…' vor dem Rückfall auf Einträge abfangen.
  const SINGLE = ['templates', 'habits', 'push', 'bucket', 'fmeta'];
  const collOf = key => SINGLE.includes(key) ? key : key[0] === 'h' ? 'logs' : key[0] === 'f' ? 'finance' : 'entries';
  function bucket(key) {
    const c = collOf(key);
    if (SINGLE.includes(c)) return Object.values(store[c]);
    if (c === 'logs') return Object.values(store.logs).filter(l => 'h' + yearOf(l) === key);
    if (c === 'finance') return Object.values(store.finance).filter(f => 'f' + yearOf(f) === key);
    return Object.values(store.entries).filter(e => yearOf(e) === key);
  }
  function bucketKeys() { return [...new Set([...SINGLE, ...Object.values(store.entries).map(yearOf), ...Object.values(store.logs).map(l => 'h' + yearOf(l)), ...Object.values(store.finance).map(f => 'f' + yearOf(f))])]; }
  function fileBody(key) {
    const c = collOf(key);
    const items = c === 'entries' || c === 'finance' ? bucket(key).sort(byWhen) : bucket(key).sort((x, y) => String(x.name || x.id).localeCompare(String(y.name || y.id)));
    return JSON.stringify({ version: 1, ...(c === 'entries' ? { year: key } : {}), [c]: items }, null, 1);
  }
  const revs = {}; // zählt Änderungen je Datei, damit Änderungen während eines Uploads nicht verloren gehen
  function markDirty(key) {
    revs[key] = (revs[key] || 0) + 1;
    if (!store.dirty.includes(key)) store.dirty.push(key);
  }

  // ---------- GitHub API ----------
  function gh(method, path, body, accept) {
    const url = `https://api.github.com/repos/${getRepo()}/contents/${path}` + (method === 'GET' ? `?ref=${cfg.branch}` : '');
    // Abbruch nach einer Minute, damit ein hängendes WLAN (z.B. im Flugzeug) die Synchronisation nicht blockiert
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 60000);
    return fetch(url, {
      method,
      cache: 'no-store',
      signal: ctl.signal,
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Accept': accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => { const e = new Error('Offline'); e.offline = true; throw e; });
  }

  const ERR = {
    badToken: 'GitHub kennt diesen Token nicht. Meist wurde er nicht vollständig kopiert. Kopiere ihn auf GitHub neu, tippe hier auf „Trennen“, füge ihn ein und tippe auf „Verbinden“.',
    noRights: 'Der Token darf nicht schreiben. Stelle auf GitHub beim Token unter Permissions → Repository → „Contents“ auf „Read and write“.',
    noRepo: () => `Der Token hat keinen Zugriff auf „${getRepo()}“. Wähle auf GitHub beim Token unter Repository access „Only select repositories“ → „${getRepo().split('/')[1]}“.`,
  };
  function checkAuth(res) {
    if (res.status === 401) throw new Error(ERR.badToken);
    if (res.status === 403) throw new Error(ERR.noRights);
  }

  // Liefert Dateischlüssel -> Stand (sha) aller Datendateien im Repo.
  async function listRemote() {
    const res = await gh('GET', cfg.dataDir);
    checkAuth(res);
    if (res.status === 404) {
      // Unterscheiden: Ordner fehlt noch, oder der Token sieht das Repo gar nicht
      const repo = await fetch(`https://api.github.com/repos/${getRepo()}`, { cache: 'no-store', headers: { 'Authorization': `Bearer ${getToken()}`, 'Accept': 'application/vnd.github+json' } });
      if (!repo.ok) throw new Error(ERR.noRepo());
      return {};
    }
    if (!res.ok) throw new Error(`GitHub antwortet mit Fehler ${res.status}.`);
    const list = await res.json();
    const out = {};
    (Array.isArray(list) ? list : []).forEach(f => { const m = /^(templates|habits|push|bucket|fmeta|[hf]?\d{4})\.json$/.exec(f.name); if (m) out[m[1]] = f.sha; });
    return out;
  }

  async function uploadPending() {
    for (const id of [...store.pending]) {
      for (const [dir, key, ext] of [['photos', 'p:' + id, 'jpg'], ['thumbs', 't:' + id, 'jpg'], ['videos', 'v:' + id, 'mp4']]) {
        const blob = await idbGet('blobs', key);
        if (!blob) continue;
        if (blob.size > cfg.videoUploadMax) continue; // sehr große Videos bleiben nur auf diesem Gerät
        const res = await gh('PUT', `${dir}/${id}.${ext}`, { message: `Anhang ${id}`, content: await blobToB64(blob), branch: cfg.branch });
        checkAuth(res);
        if (res.status === 404) throw new Error(ERR.noRepo());
        // 422 = Datei existiert bereits (z.B. nach abgebrochenem Versuch) -> als erledigt werten
        if (!res.ok && res.status !== 422) throw new Error(`Bild-Upload fehlgeschlagen (Fehler ${res.status}).`);
      }
      store.pending = store.pending.filter(x => x !== id);
      await saveLocal();
    }
    for (const id of [...store.pendingThumbs]) {
      const blob = await idbGet('blobs', 't:' + id);
      if (blob) {
        const res = await gh('PUT', `thumbs/${id}.jpg`, { message: `Vorschaubild ${id}`, content: await blobToB64(blob), branch: cfg.branch });
        checkAuth(res);
        if (!res.ok && res.status !== 422) throw new Error(`Bild-Upload fehlgeschlagen (Fehler ${res.status}).`);
      }
      store.pendingThumbs = store.pendingThumbs.filter(x => x !== id);
      await saveLocal();
    }
  }

  let syncing = null;
  let again = false;

  async function sync() {
    clearTimeout(pushTimer);
    if (!getToken()) { setStatus('notoken', 'Nur auf diesem Gerät gespeichert'); return; }
    if (!navigator.onLine) { setStatus('offline', 'Offline – wird später synchronisiert'); return; }
    if (syncing) { again = true; return syncing; }
    syncing = (async () => {
      setStatus('syncing', 'Synchronisiere …');
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const remote = await listRemote();
          let changedLocal = false;
          // Nur Dateien holen, die sich seit dem letzten Mal geändert haben
          for (const [key, sha] of Object.entries(remote)) {
            if (store.shas[key] === sha) continue;
            const res = await gh('GET', `${cfg.dataDir}/${key}.json`, null, 'application/vnd.github.raw+json');
            checkAuth(res);
            if (!res.ok) throw new Error(`GitHub antwortet mit Fehler ${res.status}.`);
            const text = await res.text();
            const data = text.trim() ? JSON.parse(text) : {};
            const target = collOf(key);
            const rem = toMap(data[target]);
            const merged = mergeMaps(store[target], rem);
            if (!sameMaps(merged, store[target])) changedLocal = true;
            store[target] = merged;
            store.shas[key] = sha;
            if (!sameMaps(toMap(bucket(key)), rem)) markDirty(key);
          }
          Object.keys(store.shas).forEach(k => { if (!(k in remote)) delete store.shas[k]; });
          bucketKeys().forEach(k => { if (!(k in remote) && bucket(k).length) markDirty(k); });
          if (changedLocal) emit();
          await saveLocal();
          await uploadPending();
          let conflict = false;
          for (const key of [...store.dirty]) {
            const rev = revs[key];
            const res = await gh('PUT', `${cfg.dataDir}/${key}.json`, {
              message: `Tagebuch ${key} aktualisiert (${new Date().toLocaleString('de-DE')})`,
              content: b64encode(fileBody(key)),
              branch: cfg.branch,
              ...(store.shas[key] ? { sha: store.shas[key] } : {}),
            });
            if (res.status === 409 || res.status === 422) { delete store.shas[key]; conflict = true; continue; } // anderes Gerät war schneller -> neu zusammenführen
            checkAuth(res);
            if (res.status === 404) throw new Error(ERR.noRepo());
            if (!res.ok) throw new Error(`Speichern fehlgeschlagen (Fehler ${res.status}).`);
            const out = await res.json();
            store.shas[key] = out.content && out.content.sha;
            if (revs[key] === rev) store.dirty = store.dirty.filter(k => k !== key);
          }
          await saveLocal();
          if (!conflict) break;
        }
        setStatus('ok', 'Synchronisiert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        await saveLocal();
        // Keine Verbindung (Netz weg oder WLAN ohne Internet): kein Fehler, die Änderungen bleiben auf dem Gerät
        if (e && e.offline) setStatus('offline', 'Offline – wird später synchronisiert');
        else setStatus('error', e.message || 'Synchronisation fehlgeschlagen');
      } finally {
        syncing = null;
        if (again) { again = false; setTimeout(sync, 300); }
      }
    })();
    return syncing;
  }

  let pushTimer = null;
  function schedulePush() {
    saveSoon();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(sync, 8000);
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // ---------- Bilder ----------
  // GPS-Position aus den EXIF-Daten eines JPEG lesen (falls vorhanden).
  function exifGps(buf) {
    try {
      const v = new DataView(buf);
      if (v.getUint16(0) !== 0xFFD8) return null;
      let o = 2;
      while (o + 4 < v.byteLength) {
        const marker = v.getUint16(o);
        if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
        const len = v.getUint16(o + 2);
        if (marker === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) { // "Exif"
          const t = o + 10;
          const le = v.getUint16(t) === 0x4949;
          const u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
          const ifd0 = t + u32(t + 4);
          let gps = 0;
          for (let i = 0, n = u16(ifd0); i < n; i++) { const e = ifd0 + 2 + i * 12; if (u16(e) === 0x8825) gps = t + u32(e + 8); }
          if (!gps) return null;
          const g = {};
          for (let i = 0, n = u16(gps); i < n; i++) {
            const e = gps + 2 + i * 12, tag = u16(e);
            if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(v.getUint8(e + 8));
            if (tag === 2 || tag === 4) {
              const p = t + u32(e + 8);
              const r = k => u32(p + k * 8) / (u32(p + k * 8 + 4) || 1);
              g[tag] = r(0) + r(1) / 60 + r(2) / 3600;
            }
          }
          if (g[2] == null || g[4] == null) return null;
          const lat = g[1] === 'S' ? -g[2] : g[2], lng = g[3] === 'W' ? -g[4] : g[4];
          if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
          return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
        }
        o += 2 + len;
      }
    } catch {}
    return null;
  }

  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Dieses Bildformat kann der Browser nicht lesen.')); };
      img.src = url;
    });
  }
  function scaled(img, max) {
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    const f = Math.min(1, max / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * f)), h = Math.max(1, Math.round(h0 * f));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => c.toBlob(b => b ? resolve({ blob: b, w, h }) : reject(new Error('Bild konnte nicht verarbeitet werden.')), 'image/jpeg', 0.84));
  }

  const urls = new Map();     // Schlüssel -> Object-URL
  const loading = new Map();  // Schlüssel -> laufende Anfrage

  async function addPhoto(file) {
    let gps = null;
    try { gps = exifGps(await file.slice(0, 512 * 1024).arrayBuffer()); } catch {}
    const img = await decodeImage(file);
    const full = await scaled(img, cfg.photoMax);
    const thumb = await scaled(img, cfg.thumbMax);
    if (img.close) img.close();
    const id = uid();
    await idbSet('blobs', 'p:' + id, full.blob);
    await idbSet('blobs', 't:' + id, thumb.blob);
    store.pending.push(id);
    saveSoon();
    return { id, w: full.w, h: full.h, ...(gps || {}) };
  }

  // Vorschaubild aus einem Video: ein Standbild kurz nach dem Anfang.
  // Zwei Wege parallel, der erste Treffer gewinnt: an eine Stelle springen (Desktop) und stumm anspielen
  // (iPhone lädt Videodaten erst beim Abspielen). Der Blob wird als video/mp4 übergeben, weil manche
  // Browser iPhone-Videos (video/quicktime) sonst ablehnen.
  function videoPoster(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(new Blob([file], { type: 'video/mp4' }));
      const v = document.createElement('video');
      let done = false;
      const finish = out => {
        if (done) return; done = true; clearTimeout(timer);
        try { v.pause(); } catch {}
        URL.revokeObjectURL(url); v.removeAttribute('src'); try { v.load(); } catch {}
        v.remove();
        resolve(out);
      };
      const timer = setTimeout(() => finish(null), 20000);
      const grab = () => {
        if (done || !v.videoWidth) return;
        try {
          const f = Math.min(1, cfg.thumbMax / Math.max(v.videoWidth, v.videoHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(v.videoWidth * f)); c.height = Math.max(1, Math.round(v.videoHeight * f));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          const w = v.videoWidth, h = v.videoHeight, dur = Math.round(v.duration || 0);
          c.toBlob(b => finish(b ? { blob: b, w, h, dur } : null), 'image/jpeg', 0.84);
        } catch { finish(null); }
      };
      const target = () => Math.min(0.5, (v.duration || 1) / 2);
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      // unsichtbar ins Dokument hängen: manche Browser laden Videos außerhalb des Dokuments nicht
      v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(v);
      v.onerror = () => finish(null);
      v.onloadeddata = () => { try { v.currentTime = target(); } catch {} };
      v.onseeked = grab;
      v.ontimeupdate = () => { if (v.currentTime > 0 && v.currentTime >= target() - 0.05) grab(); };
      v.onended = grab;
      v.src = url;
      try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch {}
    });
  }
  // Erzeugt nachträglich ein fehlendes Vorschaubild (z.B. wenn es auf einem anderen Gerät nicht geklappt hat).
  async function repairPoster(id) {
    const url = await photoURL(id, 'video');
    if (!url) return null;
    const poster = await videoPoster(await (await fetch(url)).blob());
    if (!poster) return null;
    await idbSet('blobs', 't:' + id, poster.blob);
    urls.delete('t:' + id);
    if (!store.pendingThumbs.includes(id)) store.pendingThumbs.push(id);
    saveSoon();
    return { w: poster.w, h: poster.h, dur: poster.dur };
  }
  // Videos werden unverändert gespeichert (Diarium liefert sie bereits komprimiert als MP4).
  async function addVideo(file) {
    const id = uid();
    const poster = await videoPoster(file);
    await idbSet('blobs', 'v:' + id, new Blob([file], { type: 'video/mp4' }));
    if (poster) await idbSet('blobs', 't:' + id, poster.blob);
    store.pending.push(id);
    saveSoon();
    return { id, kind: 'video', size: file.size, ...(poster ? { w: poster.w, h: poster.h, dur: poster.dur } : {}) };
  }

  // Liefert eine anzeigbare Adresse für einen Anhang: erst aus dem lokalen Speicher, sonst aus dem Repo.
  // kind: true/'thumb' = Vorschaubild, false = Bild in voller Größe, 'video' = Videodatei.
  function photoURL(id, kind) {
    const video = kind === 'video';
    const thumb = !video && !!kind;
    const key = (video ? 'v:' : thumb ? 't:' : 'p:') + id;
    if (urls.has(key)) return Promise.resolve(urls.get(key));
    if (loading.has(key)) return loading.get(key);
    const p = (async () => {
      let blob = await idbGet('blobs', key);
      if (!blob && getToken() && navigator.onLine) {
        const res = await gh('GET', video ? `videos/${id}.mp4` : `${thumb ? 'thumbs' : 'photos'}/${id}.jpg`, null, 'application/vnd.github.raw');
        if (res.ok) {
          blob = new Blob([await res.arrayBuffer()], { type: video ? 'video/mp4' : 'image/jpeg' });
          await idbSet('blobs', key, blob);
        }
      }
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urls.set(key, url);
      return url;
    })().catch(() => null).finally(() => loading.delete(key));
    loading.set(key, p);
    return p;
  }

  // ---------- öffentliche API ----------
  window.TB_STORE = {
    ready: null,
    get entries() { return Object.values(store.entries).filter(e => !e.deleted); },
    get templates() { return Object.values(store.templates).filter(t => !t.deleted).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.name || '').localeCompare(b.name || '')); },
    entry(id) { const e = store.entries[id]; return e && !e.deleted ? e : null; },
    template(id) { const t = store.templates[id]; return t && !t.deleted ? t : null; },
    get status() { return store.status; },
    get statusText() { return store.statusText; },
    get pendingPhotos() { return store.pending.length; },
    get unsynced() { return store.dirty.length; },
    hasToken() { return !!getToken(); },
    repo: getRepo,
    setToken(token, repo) {
      if (token) lsSet(LS_TOKEN, token.replace(/\s+/g, '')); else lsDel(LS_TOKEN);
      if (repo && repo.trim() && repo.trim() !== `${cfg.owner}/${cfg.dataRepo}`) lsSet(LS_REPO, repo.trim()); else lsDel(LS_REPO);
      store.shas = {};
      return sync();
    },
    onChange(fn) { store.listeners.add(fn); },
    uid,
    saveEntry(e) {
      const now = Date.now();
      const item = { createdAt: now, ...e, updatedAt: now };
      if (!item.id) item.id = uid();
      const old = store.entries[item.id];
      if (old && yearOf(old) !== yearOf(item)) markDirty(yearOf(old));
      store.entries[item.id] = item;
      markDirty(yearOf(item));
      emit(); schedulePush();
      return item;
    },
    deleteEntry(id) {
      const old = store.entries[id];
      if (!old) return;
      // Das Datum bleibt erhalten, damit die Löschung in der richtigen Jahresdatei landet
      store.entries[id] = { id, date: old.date, deleted: true, updatedAt: Date.now() };
      markDirty(yearOf(old));
      emit(); schedulePush();
    },
    saveTemplate(t) {
      const now = Date.now();
      const item = { createdAt: now, ...t, updatedAt: now };
      if (!item.id) item.id = uid();
      store.templates[item.id] = item;
      markDirty('templates');
      emit(); schedulePush();
      return item;
    },
    get habits() { return Object.values(store.habits).filter(h => !h.deleted).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0)); },
    habit(id) { const h = store.habits[id]; return h && !h.deleted ? h : null; },
    get logs() { return Object.values(store.logs); },
    saveHabit(h) {
      const now = Date.now();
      const item = { createdAt: now, ...h, updatedAt: now };
      if (!item.id) item.id = uid();
      store.habits[item.id] = item;
      markDirty('habits');
      emit(); schedulePush();
      return item;
    },
    deleteHabit(id) {
      store.habits[id] = { id, deleted: true, updatedAt: Date.now() };
      markDirty('habits');
      emit(); schedulePush();
    },
    logValue(hid, date) { const l = store.logs[hid + '_' + date]; return l ? l.v || 0 : 0; },
    setLog(hid, date, v) {
      store.logs[hid + '_' + date] = { id: hid + '_' + date, h: hid, date, v: Math.max(0, +v || 0), updatedAt: Date.now() };
      markDirty('h' + date.slice(0, 4));
      emit(); schedulePush();
    },
    get bucket() { return Object.values(store.bucket).filter(b => !b.deleted && b.id !== '_profile'); },
    bucketItem(id) { const b = store.bucket[id]; return b && !b.deleted ? b : null; },
    saveBucket(b) {
      const now = Date.now();
      const item = { createdAt: now, ...b, updatedAt: now };
      if (!item.id) item.id = uid();
      store.bucket[item.id] = item;
      markDirty('bucket');
      emit(); schedulePush();
      return item;
    },
    deleteBucket(id) {
      store.bucket[id] = { id, deleted: true, updatedAt: Date.now() };
      markDirty('bucket');
      emit(); schedulePush();
    },
    get pushSubs() { return Object.values(store.push).filter(p => !p.deleted); },
    savePushSub(item) {
      store.push[item.id] = { ...item, updatedAt: Date.now() };
      markDirty('push');
      emit(); schedulePush();
    },
    deletePushSub(id) {
      store.push[id] = { id, deleted: true, updatedAt: Date.now() };
      markDirty('push');
      emit(); schedulePush();
    },
    // ---------- Finanzen ----------
    get finance() { return Object.values(store.finance).filter(f => !f.deleted); },
    get fmeta() { return Object.values(store.fmeta).filter(m => !m.deleted); },
    // Viele Buchungen auf einmal (Import): vorhandene IDs werden nur überschrieben, wenn replace gesetzt ist.
    saveFinance(list, replace) {
      const now = Date.now();
      let n = 0;
      for (const f of list) {
        if (!f.id || !f.date) continue;
        const old = store.finance[f.id];
        if (old && !old.deleted && !replace) continue;
        store.finance[f.id] = { createdAt: (old && old.createdAt) || now, ...f, updatedAt: now };
        markDirty('f' + yearOf(f));
        n++;
      }
      if (n) { emit(); schedulePush(); }
      return n;
    },
    deleteFinance(id) {
      const old = store.finance[id];
      if (!old) return;
      store.finance[id] = { id, date: old.date, deleted: true, updatedAt: Date.now() };
      markDirty('f' + yearOf(old));
      emit(); schedulePush();
    },
    saveFmeta(m) {
      const now = Date.now();
      const item = { createdAt: now, ...m, updatedAt: now };
      if (!item.id) item.id = uid();
      store.fmeta[item.id] = item;
      markDirty('fmeta');
      emit(); schedulePush();
      return item;
    },
    deleteFmeta(id) {
      store.fmeta[id] = { id, deleted: true, updatedAt: Date.now() };
      markDirty('fmeta');
      emit(); schedulePush();
    },
    deleteTemplate(id) {
      store.templates[id] = { id, deleted: true, updatedAt: Date.now() };
      markDirty('templates');
      emit(); schedulePush();
    },
    importData(data) {
      const now = Date.now();
      let n = 0;
      // Nur fehlende Einträge übernehmen, vorhandene bleiben unverändert.
      (data.entries || []).forEach(e => { if (e && e.id && !store.entries[e.id]) { store.entries[e.id] = { ...e, updatedAt: now }; markDirty(yearOf(e)); n++; } });
      (data.templates || []).forEach(t => { if (t && t.id && !store.templates[t.id]) { store.templates[t.id] = { ...t, updatedAt: now }; markDirty('templates'); } });
      (data.bucket || []).forEach(b => { if (b && b.id && !store.bucket[b.id]) { store.bucket[b.id] = { ...b, updatedAt: now }; markDirty('bucket'); } });
      (data.habits || []).forEach(h => { if (h && h.id && !store.habits[h.id]) { store.habits[h.id] = { ...h, updatedAt: now }; markDirty('habits'); } });
      (data.logs || []).forEach(l => { if (l && l.id && l.date && !store.logs[l.id]) { store.logs[l.id] = { ...l, updatedAt: now }; markDirty('h' + yearOf(l)); } });
      (data.finance || []).forEach(f => { if (f && f.id && f.date && !store.finance[f.id]) { store.finance[f.id] = { ...f, updatedAt: now }; markDirty('f' + yearOf(f)); } });
      (data.fmeta || []).forEach(m => { if (m && m.id && !store.fmeta[m.id]) { store.fmeta[m.id] = { ...m, updatedAt: now }; markDirty('fmeta'); } });
      emit(); schedulePush();
      return n;
    },
    exportJSON: serialize,
    addPhoto,
    addVideo,
    repairPoster,
    photoURL,
    flush: saveLocal,
    sync,
  };

  window.TB_STORE.ready = (async () => {
    db = await openDB();
    await loadLocal();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  })();

  window.addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 120000);
})();
