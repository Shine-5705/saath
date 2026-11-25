# Synthesises the demo call's *input* speech with Sarvam bulbul TTS (used when no mic is available for recording).
import json, os, base64, urllib.request
KEY = os.environ['SARVAM_API_KEY']
LINES = [
  ('a', 'en-IN', 'rohan', "Happy Diwali Dadi! I'm sorry I couldn't come home this year, the flights from Toronto were too expensive."),
  ('b', 'hi-IN', 'neha',  "कोई बात नहीं बेटा, तुम खुश रहो। बताओ, दिवाली पर क्या खाया?"),
  ('a', 'en-IN', 'rohan', "My friends and I made gulab jamun, but honestly they were nowhere near as good as yours."),
  ('b', 'hi-IN', 'neha',  "अगली बार आओगे तो मैं तुम्हें खुद सिखाऊँगी। दिसंबर में शादी में तो आ रहे हो न?"),
  ('a', 'en-IN', 'rohan', "Yes Dadi, I booked my ticket for the wedding today. See you in December!"),
]
for i, (side, lang, spk, text) in enumerate(LINES):
    req = urllib.request.Request('https://api.sarvam.ai/text-to-speech', method='POST',
        data=json.dumps({'text': text, 'target_language_code': lang, 'model': 'bulbul:v3', 'speaker': spk}).encode(),
        headers={'api-subscription-key': KEY, 'Content-Type': 'application/json'})
    j = json.load(urllib.request.urlopen(req))
    open(f'public/demo/{i}-{side}.wav', 'wb').write(base64.b64decode(j['audios'][0]))
    print('ok', i, side)
