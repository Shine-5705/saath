const $ = id => document.getElementById(id);
const API = new URLSearchParams(location.search).get('api') || (location.hostname.endsWith('github.io') ? 'http://localhost:8797' : '');
const LANGS = {'hi-IN':'Hindi · हिन्दी','en-IN':'English','bn-IN':'Bengali · বাংলা','ta-IN':'Tamil · தமிழ்','te-IN':'Telugu · తెలుగు','mr-IN':'Marathi · मराठी','gu-IN':'Gujarati · ગુજરાતી','kn-IN':'Kannada · ಕನ್ನಡ','ml-IN':'Malayalam · മലയാളം','pa-IN':'Punjabi · ਪੰਜਾਬੀ','od-IN':'Odia · ଓଡ଼ିଆ'};
const ROOM = new URLSearchParams(location.search).get('room') || 'diwali-' + Math.random().toString(36).slice(2, 6);
let CFG = null, es = null; const lats = [];
const audioQ = []; let playing = false;
function playNext(){ if(playing || !audioQ.length) return; playing = true; const b64 = audioQ.shift(); const a = new Audio('data:audio/wav;base64,' + b64); (window.__outs = window.__outs || []).push({t: Date.now(), b64}); a.onended = a.onerror = () => { playing = false; playNext(); }; a.play().catch(()=>{ playing=false; }); }
async function boot(){
  try { CFG = await (await fetch(API + '/api/config')).json(); }
  catch { $('sys').textContent = 'Backend offline: run npm start'; $('sys').className='chip warn'; return; }
  $('sys').textContent = CFG.sarvam ? 'Sarvam AI connected' : 'Sarvam key missing'; $('sys').className = 'chip ' + (CFG.sarvam ? 'ok' : 'warn');
  $('flagsrc').textContent = 'Flags: ' + CFG.flag_source; $('models').textContent = `STT ${CFG.models.stt} · MT ${CFG.models.mt} · TTS ${CFG.models.tts}`;
  const langs = (CFG.flags.languages.value || 'hi-IN,en-IN').split(',').map(s=>s.trim());
  for (const [sel, def] of [['la','en-IN'],['lb','hi-IN']]) { $(sel).innerHTML = langs.map(l=>`<option value="${l}">${LANGS[l]||l}</option>`).join(''); $(sel).value = def; }
  $('lat').classList.toggle('hidden', !CFG.flags.latency_badge.enabled);
}
function pushPeople(){ for (const s of ['a','b']) fetch(API + `/api/room/${ROOM}/people`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({side:s, person:{name:$('n'+s).value, lang:$('l'+s).value, voice: s==='a'?'male':'female'}})}); }
function startCall(){
  $('landing').classList.add('hidden'); $('call').classList.remove('hidden'); $('roomId').textContent = ROOM;
  history.replaceState(null, '', '?room=' + ROOM + (API && !location.hostname.endsWith('github.io') ? '&api=' + API : '') + '#call');
  pushPeople(); ['la','lb','na','nb'].forEach(id => $(id).onchange = pushPeople);
  es = new EventSource(API + `/api/room/${ROOM}/events`);
  es.addEventListener('status', e => { const d = JSON.parse(e.data); $('s'+d.from).textContent = d.stage === 'listening' ? 'Transcribing with saarika…' : 'Translating: “' + (d.original||'') + '”'; });
  es.addEventListener('turn', e => render(JSON.parse(e.data)));
}
function render(t){
  const f = $('feed'); const empty = f.querySelector('.empty'); if (empty) empty.remove();
  $('s'+t.from).textContent = '';
  const el = document.createElement('div'); el.className = 'msg ' + t.from;
  const showLat = CFG.flags.latency_badge.enabled;
  el.innerHTML = `<div class="who"><span>${t.speaker} · ${LANGS[t.src_lang]||t.src_lang} → ${LANGS[t.tgt_lang]||t.tgt_lang}</span><span>${new Date(t.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div><div class="orig"></div><div class="tr"></div>${showLat?`<div class="lat">STT ${t.timing.stt} ms · Translate ${t.timing.translate} ms · Voice ${t.timing.tts} ms · <b>${(t.timing.total/1000).toFixed(2)} s total</b></div>`:''}`;
  el.querySelector('.orig').textContent = t.original; el.querySelector('.tr').textContent = t.translated;
  f.appendChild(el); f.scrollTop = f.scrollHeight;
  lats.push(t.timing.total); const avg = lats.reduce((a,b)=>a+b,0)/lats.length; $('lat').textContent = `Latency: ${(t.timing.total/1000).toFixed(2)} s · avg ${(avg/1000).toFixed(2)} s`;
  if (t.audio) { audioQ.push(t.audio); playNext(); }
}
async function sendTurn(side, blob){
  $('s'+side).textContent = 'Sending…';
  const r = await fetch(API + `/api/room/${ROOM}/turn?from=${side}`, {method:'POST', headers:{'Content-Type': blob.type || 'audio/wav'}, body: blob});
  if (!r.ok) $('s'+side).textContent = 'Error: ' + ((await r.json().catch(()=>({}))).error || r.status);
}
// Push-to-talk with MediaRecorder
document.querySelectorAll('.talk').forEach(btn => {
  let rec, chunks, stream;
  const start = async () => { stream = await navigator.mediaDevices.getUserMedia({audio:true}); chunks=[]; rec = new MediaRecorder(stream); rec.ondataavailable = e => chunks.push(e.data); rec.onstop = () => { stream.getTracks().forEach(t=>t.stop()); sendTurn(btn.dataset.side, new Blob(chunks, {type: rec.mimeType})); }; rec.start(); btn.classList.add('rec'); btn.querySelector('.lbl').textContent = 'Listening… release to send'; };
  const stop = () => { if (rec && rec.state === 'recording') rec.stop(); btn.classList.remove('rec'); btn.querySelector('.lbl').textContent = 'Hold to talk'; };
  btn.onpointerdown = start; btn.onpointerup = stop; btn.onpointerleave = stop;
});
// Used by scripts/record-demo.py: plays a pre-made clip as if it came from the mic and sends it through the real pipeline.
window.saathSpeak = async (side, url) => {
  const btn = document.querySelector(`.talk[data-side="${side}"]`); btn.classList.add('rec'); btn.querySelector('.lbl').textContent = 'Listening…';
  const blob = await (await fetch(url)).blob(); const a = new Audio(URL.createObjectURL(blob)); (window.__ins = window.__ins || []).push({t: Date.now(), url}); await a.play().catch(()=>{});
  await new Promise(r => a.onended = r); btn.classList.remove('rec'); btn.querySelector('.lbl').textContent = 'Hold to talk';
  await sendTurn(side, blob);
};
$('startBtn').onclick = startCall; $('endBtn').onclick = () => { es && es.close(); location.href = location.pathname; };
boot().then(() => { if (location.hash === '#call') startCall(); });

window.saathIdle = () => !playing && !audioQ.length;
