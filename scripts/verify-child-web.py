import collections
import json
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/verify-child-web.py /absolute/path/to/web-extension/index.ts')
extension = pathlib.Path(sys.argv[1]).resolve(strict=True)
work = ROOT / '.work' / 'child-web-verification'
work.mkdir(parents=True, exist_ok=True)
directory = pathlib.Path(tempfile.mkdtemp(prefix='run-', dir=work))
agent = directory / 'agent'
agent.mkdir()
(agent / 'settings.json').write_text(json.dumps({'retry': {'enabled': False}, 'compaction': {'enabled': False}}))
argv = ['node', str(ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
        '--offline', '--mode', 'json', '--print', '--session', str(directory / 'parent.jsonl'),
        '--no-extensions', '--no-skills', '--no-themes', '--no-context-files', '--no-prompt-templates',
        '-e', str(ROOT / 'tests/web-smoke-extension.ts'), '-e', str(extension), '-e', str(ROOT / 'extensions/index.ts'),
        '--provider', 'web-smoke', '--model', 'root', '--thinking', 'off', 'Verify child web tools']
env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent), PSTACK_WEB_SMOKE_DIR=str(directory),
           EXA_API_KEY='fixture-not-a-credential', PI_OFFLINE='1')
print(f'Evidence: {directory}', flush=True)
with (directory / 'stdout.jsonl').open('w') as output, (directory / 'stderr.log').open('w') as errors:
    completed = subprocess.run(argv, cwd=directory, env=env, stdout=output, stderr=errors, timeout=90)
assert completed.returncode == 0, (directory / 'stderr.log').read_text()
events = [json.loads(line) for line in (directory / 'stdout.jsonl').read_text().splitlines()]
messages = [event['message'] for event in events if event.get('type') == 'message_end']
assert any(message.get('role') == 'assistant' and message.get('stopReason') == 'stop' and
           any(part.get('type') == 'text' and part.get('text') == 'WEB_SMOKE_PASSED'
               for part in message.get('content', [])) for message in messages), 'Native root did not confirm successful child and grandchild execution'
network = [json.loads(line) for line in (directory / 'network.jsonl').read_text().splitlines()]
assert collections.Counter(request['mode'] for request in network) == {'mock-search': 2, 'live-fetch': 2}, network
result = {'status': 'passed', 'extension': str(extension), 'search': 'actual extension with mocked Exa transport',
          'fetch': 'live public GitHub retrieval and cached continuation in child and grandchild', 'directory': str(directory)}
(directory / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
