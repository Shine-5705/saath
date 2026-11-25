# Flip a Flagsmith flag via the Admin API (environment uses v2 feature versioning):
#   python3 flag-toggle.py <feature> on|off
# Needs FLAGSMITH_TOKEN (Admin API key), FLAGSMITH_ENVIRONMENT_KEY and FLAGSMITH_ENV_ID in the environment.
import os, sys, json, urllib.request
K, ENV, ENV_ID = os.environ['FLAGSMITH_TOKEN'], os.environ['FLAGSMITH_ENVIRONMENT_KEY'], os.environ['FLAGSMITH_ENV_ID']
B = 'https://api.flagsmith.com/api/v1/'
def call(m, p, d=None):
    r = urllib.request.Request(B + p, method=m, data=json.dumps(d).encode() if d else None, headers={'Authorization': 'Api-Key ' + K, 'Content-Type': 'application/json'})
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: sys.exit(f'{e.code} {e.read().decode()[:300]}')
name, on = sys.argv[1], sys.argv[2] == 'on'
fid = call('GET', f'environments/{ENV}/featurestates/?feature_name={name}')['results'][0]['feature']
call('POST', f'environments/{ENV_ID}/features/{fid}/versions/', {'publish_immediately': True,
     'feature_states_to_update': [{'feature_segment': None, 'enabled': on, 'feature_state_value': {'type': 'unicode', 'string_value': None}}]})
print(name, 'on' if on else 'off')
