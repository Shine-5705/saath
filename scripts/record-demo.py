# Records the demo: headless Chrome drives the real UI; each turn's input clip goes through the live Sarvam pipeline.
# Audio (input clips + Sarvam TTS output as played by the page) is muxed onto the screen recording with ffmpeg.
import asyncio, base64, glob, os, subprocess, json
from playwright.async_api import async_playwright
OUT = os.environ.get('OUT', 'docs'); os.makedirs('rec', exist_ok=True)
CAP = """(t)=>{let d=document.getElementById('cap');if(!d){d=document.createElement('div');d.id='cap';d.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#000d;border:1px solid #333;color:#fff;padding:10px 18px;border-radius:10px;font:15px Inter,system-ui;z-index:9999;max-width:90%;text-align:center';document.body.appendChild(d)}d.textContent=t}"""
TURNS = sorted(glob.glob('public/demo/*.wav'))[:4]
TOGGLE = lambda st: subprocess.run(['python3', 'scripts/flag-toggle.py', 'latency_badge', st], check=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 860}, record_video_dir='rec', record_video_size={'width': 1440, 'height': 860})
        pg = await ctx.new_page(); t0 = await pg.evaluate('Date.now()')
        await pg.goto('http://localhost:8797/?room=diwali-demo'); await pg.wait_for_timeout(2500)
        await pg.evaluate(CAP, 'Saath: live translated calls home, powered by Sarvam AI'); await pg.wait_for_timeout(3000)
        await pg.click('#startBtn'); await pg.wait_for_timeout(1500)
        await pg.evaluate(CAP, 'Arjun in Toronto speaks English; Dadi in Lucknow speaks Hindi. Input voices are Sarvam-synthesised (no mic on the recording machine)')
        for i, f in enumerate(TURNS):
            side = f.split('-')[-1][0]
            if i == 1: await pg.evaluate(CAP, 'Every turn: saarika STT → mayura translation → bulbul voice. Captions and latency are real API output')
            if i == 2:
                await pg.evaluate(CAP, 'Flagsmith (live): flipping the latency_badge flag OFF via the Flagsmith Admin API…'); TOGGLE('off')
                await pg.wait_for_function("document.body.classList.contains('nolat')", timeout=40000, polling=300)
                await pg.evaluate(CAP, 'latency_badge is OFF in Flagsmith, so the latency readouts disappeared with no redeploy'); await pg.wait_for_timeout(2500)
            if i == 3:
                await pg.evaluate(CAP, 'Flipping latency_badge back ON in Flagsmith…'); TOGGLE('on')
                await pg.wait_for_function("!document.body.classList.contains('nolat')", timeout=40000, polling=300)
                await pg.evaluate(CAP, 'Back on. Voice output, language list and auto-detect are Flagsmith flags too'); await pg.wait_for_timeout(1500)
            await pg.evaluate(f"saathSpeak('{side}', '/demo/{os.path.basename(f)}')")
            await pg.wait_for_function('window.saathIdle() && (window.__outs||[]).length >= %d' % (i + 1), timeout=60000, polling=200)
            await pg.wait_for_function('window.saathIdle()', timeout=60000, polling=200); await pg.wait_for_timeout(700)
        await pg.evaluate(CAP, 'Saath · team TheAdaply (Shine Gupta + Akash) · github.com/Shine-5705/saath'); await pg.wait_for_timeout(3500)
        ins = await pg.evaluate('window.__ins'); outs = await pg.evaluate('window.__outs')
        await ctx.close(); await b.close()
    video = max(glob.glob('rec/*.webm'), key=os.path.getmtime)
    inputs, filt = ['-i', video], []
    for k, (ev, src) in enumerate([(e, 'public' + e['url']) for e in ins] + [(e, None) for e in outs]):
        if src is None:
            src = f'rec/out{k}.wav'; open(src, 'wb').write(base64.b64decode(ev['b64']))
        inputs += ['-i', src]; d = max(0, ev['t'] - t0)
        filt.append(f'[{k+1}:a]aresample=44100,adelay={d}|{d}[a{k}]')
    n = len(filt); filt.append(''.join(f'[a{k}]' for k in range(n)) + f'amix=inputs={n}:normalize=0[aout]')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(filt), '-map', '0:v', '-map', '[aout]',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', f'{OUT}/saath-demo.mp4'], check=True)
    print('wrote', f'{OUT}/saath-demo.mp4')
asyncio.run(main())
