// Saath — live translated calls home. Zero-dependency Node (>=20.6) server.
// Pipeline per spoken turn: Sarvam saarika STT → Sarvam translate → Sarvam bulbul TTS → pushed to the room over SSE.
// Keys stay on the server. Feature flags come from Flagsmith (safe defaults when no key is set).
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8797;
const SARVAM = process.env.SARVAM_API_KEY || '';
const FS_KEY = process.env.FLAGSMITH_ENVIRONMENT_KEY || '';
const FS_API = process.env.FLAGSMITH_API_URL || 'https://edge.api.flagsmith.com/api/v1/';
const NB_TOKEN = process.env.NUDGEBEE_API_TOKEN || '', NB_URL = process.env.NUDGEBEE_API_URL || 'https://app.nudgebee.com';
const STT_MODEL = process.env.SARVAM_STT_MODEL || 'saarika:v2.5';
const MT_MODEL = process.env.SARVAM_MT_MODEL || 'mayura:v1';
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || 'bulbul:v3';
const started = Date.now();
const M = { turns: 0, errors: 0, stt_ms_sum: 0, mt_ms_sum: 0, tts_ms_sum: 0, sarvam_errors: 0 };

const DEFAULT_FLAGS = {
  voice_out: { enabled: true, value: null },              // speak the translation with Sarvam TTS
  auto_detect_language: { enabled: true, value: null },   // let saarika detect the speaker's language
  latency_badge: { enabled: true, value: null },          // show per-stage latency on every caption
  languages: { enabled: true, value: 'hi-IN,en-IN,bn-IN,ta-IN,te-IN,mr-IN,gu-IN,kn-IN,ml-IN,pa-IN,od-IN' },
  max_turn_seconds: { enabled: true, value: 25 },
};
let flagCache = { at: 0, flags: DEFAULT_FLAGS, source: 'defaults' };
async function getFlags() {
  if (!FS_KEY) return { flags: DEFAULT_FLAGS, source: 'defaults (FLAGSMITH_ENVIRONMENT_KEY not set)' };
  if (Date.now() - flagCache.at < (+process.env.FLAGSMITH_CACHE_MS || 5000)) return flagCache;
  try {
    const r = await fetch(FS_API + 'flags/', { headers: { 'X-Environment-Key': FS_KEY } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const flags = { ...DEFAULT_FLAGS };
    for (const f of await r.json()) flags[f.feature.name] = { enabled: f.enabled, value: f.feature_state_value };
    flagCache = { at: Date.now(), flags, source: 'flagsmith' };
  } catch (e) { flagCache = { at: Date.now(), flags: DEFAULT_FLAGS, source: 'defaults (Flagsmith error: ' + e.message + ')' }; }
  return flagCache;
}

async function sarvam(p, body, form) {
  const r = await fetch('https://api.sarvam.ai' + p, { method: 'POST', body: form ? body : JSON.stringify(body),
    headers: form ? { 'api-subscription-key': SARVAM } : { 'api-subscription-key': SARVAM, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { M.sarvam_errors++; throw new Error(`Sarvam ${p} ${r.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 160)}`); }
  return j;
}
const VOICES = { female: 'ritu', male: 'aditya' };

// rooms: id -> { clients:Set<res>, people:{a:{lang,voice,name}, b:{...}}, log:[] }
const rooms = new Map();
function room(id) { if (!rooms.has(id)) rooms.set(id, { clients: new Set(), people: { a: { name: 'You', lang: 'en-IN', voice: 'male' }, b: { name: 'Dadi', lang: 'hi-IN', voice: 'female' } }, log: [] }); return rooms.get(id); }
function broadcast(r, ev, data) { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of r.clients) c.write(s); }

async function turn(roomId, from, audio, mime) {
  const r = room(roomId), { flags } = await getFlags();
  const speaker = r.people[from], listener = r.people[from === 'a' ? 'b' : 'a'];
  const t0 = Date.now(); const id = t0.toString(36);
  broadcast(r, 'status', { id, from, stage: 'listening' });
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type: mime || 'audio/wav' }), 'turn.' + ((mime || '').includes('webm') ? 'webm' : 'wav'));
  fd.append('model', STT_MODEL); fd.append('language_code', flags.auto_detect_language.enabled ? 'unknown' : speaker.lang);
  const stt = await sarvam('/speech-to-text', fd, true); const t1 = Date.now();
  const srcLang = stt.language_code || speaker.lang;
  broadcast(r, 'status', { id, from, stage: 'translating', original: stt.transcript, src_lang: srcLang });
  let translated = stt.transcript;
  if (srcLang !== listener.lang && stt.transcript) {
    const mt = await sarvam('/translate', { input: stt.transcript, source_language_code: srcLang, target_language_code: listener.lang, model: MT_MODEL });
    translated = mt.translated_text;
  }
  const t2 = Date.now(); let audioOut = null;
  if (flags.voice_out.enabled && translated) {
    const tts = await sarvam('/text-to-speech', { text: translated, target_language_code: listener.lang, model: TTS_MODEL, speaker: VOICES[speaker.voice] || 'ritu' });
    audioOut = tts.audios && tts.audios[0];
  }
  const t3 = Date.now();
  const ev = { id, from, speaker: speaker.name, original: stt.transcript, src_lang: srcLang, translated, tgt_lang: listener.lang, audio: audioOut,
    timing: { stt: t1 - t0, translate: t2 - t1, tts: t3 - t2, total: t3 - t0 }, at: new Date().toISOString() };
  M.turns++; M.stt_ms_sum += t1 - t0; M.mt_ms_sum += t2 - t1; M.tts_ms_sum += t3 - t2;
  r.log.push({ ...ev, audio: undefined }); broadcast(r, 'turn', ev); return { ...ev, audio: undefined };
}

const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = async req => { const ch = []; for await (const c of req) ch.push(c); return Buffer.concat(ch); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const parts = u.pathname.split('/').filter(Boolean);
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (u.pathname === '/healthz') return send(res, 200, { ok: true, uptime_s: Math.round((Date.now() - started) / 1000) });
    if (u.pathname === '/metrics') { res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(Object.entries(M).map(([k, v]) => `saath_${k} ${v}`).join('\n') + `\nsaath_rooms ${rooms.size}\n`); }
    if (u.pathname === '/api/config') { const f = await getFlags();
      return send(res, 200, { sarvam: !!SARVAM, models: { stt: STT_MODEL, mt: MT_MODEL, tts: TTS_MODEL }, flags: f.flags, flag_source: f.source, nudgebee: !!NB_TOKEN }); }
    if (u.pathname === '/api/ops') {
      if (!NB_TOKEN) return send(res, 200, { source: 'local', note: 'NUDGEBEE_API_TOKEN not set; local metrics only', metrics: M });
      const r = await fetch(NB_URL + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NB_TOKEN },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'recommendations_list', params: { limit: 5 } }) });
      return send(res, 200, { source: 'nudgebee', result: await r.json(), metrics: M });
    }
    if (parts[0] === 'api' && parts[1] === 'room' && parts[2]) {
      const r = room(parts[2]);
      if (parts[3] === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify({ people: r.people })}\n\n`); r.clients.add(res);
        const ka = setInterval(() => res.write(': ka\n\n'), 15000); req.on('close', () => { clearInterval(ka); r.clients.delete(res); }); return;
      }
      if (parts[3] === 'people' && req.method === 'POST') { const p = JSON.parse(await body(req)); Object.assign(r.people[p.side], p.person); broadcast(r, 'people', r.people); return send(res, 200, r.people); }
      if (parts[3] === 'turn' && req.method === 'POST') {
        if (!SARVAM) return send(res, 503, { error: 'SARVAM_API_KEY not set on the server' });
        return send(res, 200, await turn(parts[2], u.searchParams.get('from') === 'b' ? 'b' : 'a', await body(req), req.headers['content-type']));
      }
      if (parts[3] === 'transcript') return send(res, 200, r.log);
    }
    let p = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
    if (!p.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  } catch (e) { M.errors++; console.error(e.message); send(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`Saath on http://localhost:${PORT}  sarvam=${!!SARVAM} flagsmith=${!!FS_KEY} nudgebee=${!!NB_TOKEN}`));
