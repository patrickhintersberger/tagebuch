// Feedback von Claude zum Wochen-Review.
// Der Browser ruft die Claude-API direkt auf (offizielles Anthropic-SDK, bei Bedarf vom CDN geladen).
// Der API-Schlüssel bleibt nur auf diesem Gerät (localStorage) und geht ausschließlich an api.anthropic.com.
(function () {
  'use strict';
  const LS_KEY = 'tb-claude-key';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
  const MODEL = 'claude-opus-5-5';
  const HEADING = '## Feedback von Claude';

  const SYSTEM = `Du bist ein ehrlicher, zugewandter Coach für Patricks Wochenreflexion. Patrick beantwortet jeden Abend eine Abendroutine (was lief gut, was störte, wie fühlte ich mich, Erkenntnis, was würde ich anders machen, Glückstag) und schreibt am Sonntag ein Wochen-Review nach eigener Vorlage. Die Antworten der Tage sind darin bereits übernommen; darunter stehen automatisch erstellte Zahlen zu Tagebuch und Gewohnheiten.

Du bekommst sein Wochen-Review dieser Woche und, falls vorhanden, das der Vorwoche. Gib ihm Feedback auf Deutsch in Du-Form mit genau diesen Abschnitten:

### Was mir auffällt
3 bis 5 Muster über die Tage hinweg: wiederkehrende Störungen, Verlauf von Stimmung und Energie, Zusammenhänge zwischen Gewohnheiten, Bewertungen und Gefühlen. Nenne konkrete Tage.

### Was im Review fehlt
Fragen, die leer oder nur oberflächlich beantwortet sind, konkret benennen und kurz sagen, warum sich die Antwort lohnt. Widersprüche aufzeigen, zum Beispiel Learnings, die in den Zielen für nächste Woche nicht vorkommen.

### Ziele der Vorwoche
Nur wenn es „Meine letzten Wochenziele“ oder „Meine letzten Wochenaufgaben“ gibt: Was davon ist erkennbar erledigt, was nicht, woran sieht man das?

### Vorschlag für nächste Woche
Genau 3 konkrete, überprüfbare Punkte, abgeleitet aus seinen eigenen Worten dieser Woche.

Regeln: Beziehe dich auf seine Formulierungen. Keine Floskeln, kein Lob ohne Grund, keine medizinischen oder psychologischen Diagnosen. Wenn kaum etwas ausgefüllt ist, sag das offen und konzentriere dich auf das Vorhandene. Format: nur die Überschriften oben mit ###, sonst Listen mit „- “, kein Fettdruck. Höchstens 350 Wörter.`;

  const getKey = () => { try { return localStorage.getItem(LS_KEY) || ''; } catch { return ''; } };
  const setKey = k => { try { if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY); } catch {} };

  let sdk = null;
  async function client() {
    if (!sdk) sdk = import(SDK_URL).catch(e => { sdk = null; throw e; });
    const { default: Anthropic } = await sdk;
    // Eigener Schlüssel im eigenen Browser: Direktzugriff ausdrücklich erlauben
    return new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true });
  }

  // Text ohne vorheriges Claude-Feedback (bei erneutem Anfordern wird es ersetzt)
  const withoutFeedback = t => String(t || '').split('\n' + HEADING)[0].replace(/\s+$/, '');

  async function feedback(reviewText, prevText, onText) {
    if (!getKey()) throw new Error('Bitte zuerst den API-Schlüssel eintragen.');
    if (!navigator.onLine) throw new Error('Feedback geht nur mit Internet.');
    const c = await client();
    const user = (prevText ? `<vorwoche>\n${withoutFeedback(prevText)}\n</vorwoche>\n\n` : '') + `<diese_woche>\n${withoutFeedback(reviewText)}\n</diese_woche>`;
    const stream = c.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      // Lehnt das Modell ab, springt automatisch ein passendes anderes ein
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    if (onText) stream.on('text', onText);
    let msg;
    try { msg = await stream.finalMessage(); }
    catch (e) { throw new Error(explain(e)); }
    if (msg.stop_reason === 'refusal') throw new Error('Claude hat das Feedback zu diesem Text abgelehnt.');
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) throw new Error('Claude hat keine Antwort geliefert. Bitte noch einmal versuchen.');
    return text;
  }

  function explain(e) {
    const s = e && e.status;
    if (s === 401) return 'Der API-Schlüssel stimmt nicht. Bitte neu eintragen.';
    if (s === 403) return 'Dieser API-Schlüssel darf das Modell nicht nutzen.';
    if (s === 429) return 'Zu viele Anfragen oder das Guthaben ist aufgebraucht. In ein paar Minuten noch einmal versuchen oder das Guthaben in der Claude Console prüfen.';
    if (s === 529 || s >= 500) return 'Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.';
    if (e && /fetch|network|load/i.test(e.message || '')) return 'Keine Verbindung zu Claude. Bitte die Internetverbindung prüfen.';
    return 'Feedback fehlgeschlagen: ' + ((e && e.message) || 'unbekannter Fehler');
  }

  // Neues Feedback anhängen bzw. ein vorhandenes ersetzen
  function attach(text, fb) {
    const d = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${withoutFeedback(text)}\n\n${HEADING} (${d})\n${fb}\n`;
  }

  window.TB_CLAUDE = { getKey, setKey, feedback, attach, hasFeedback: t => String(t || '').includes('\n' + HEADING) };
})();
