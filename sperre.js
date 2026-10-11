// Sperre: Ohne GitHub-Token mit Zugriff auf das private Daten-Repo startet die App nicht.
// Fremde, die den Link öffnen, sehen nur diese Anmeldung und können nichts anlegen.
// Der Token wird beim Anmelden gegen das Daten-Repo geprüft (privat, also nur mit gültigem Token erreichbar).
(function () {
  'use strict';
  const cfg = window.TB_CONFIG;
  let token = null, repo = null;
  try { token = localStorage.getItem('tb-token'); repo = localStorage.getItem('tb-repo'); } catch {}
  if (token) return;
  window.TB_GESPERRT = true;
  repo = repo || `${cfg.owner}/${cfg.dataRepo}`;

  document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    if (app) app.remove();
    const box = document.createElement('div');
    box.className = 'sperre';
    box.innerHTML = `
      <form class="sperre-karte">
        <div class="brand"><span class="ms fill">auto_stories</span><b>Daily</b></div>
        <p>Dieses Tagebuch ist privat. Zum Öffnen mit dem GitHub-Token anmelden.</p>
        <input name="token" type="password" placeholder="GitHub-Token (github_pat_…)" autocomplete="off" required>
        <button type="submit" class="btn wide">Anmelden</button>
        <p class="sperre-fehler" hidden></p>
      </form>`;
    document.body.appendChild(box);
    const form = box.querySelector('form');
    const err = box.querySelector('.sperre-fehler');
    const btn = form.querySelector('button');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const t = String(new FormData(form).get('token') || '').replace(/\s+/g, '');
      if (!t) return;
      btn.disabled = true; err.hidden = true;
      let ok = false, msg = 'Dieser Token hat keinen Zugriff auf das Tagebuch.';
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}`, {
          cache: 'no-store',
          headers: { 'Authorization': `Bearer ${t}`, 'Accept': 'application/vnd.github+json' },
        });
        ok = res.ok;
      } catch { msg = 'Keine Verbindung. Zum Anmelden wird Internet gebraucht.'; }
      if (ok) {
        try { localStorage.setItem('tb-token', t); } catch {}
        location.reload();
        return;
      }
      err.textContent = msg; err.hidden = false; btn.disabled = false;
    });
  });
})();
