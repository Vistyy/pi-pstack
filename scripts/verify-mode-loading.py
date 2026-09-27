import json
import os
import pathlib
import queue
import subprocess
import tempfile
import threading

ROOT = pathlib.Path(__file__).resolve().parents[1]
work = ROOT / '.work' / 'mode-loading-verification'
work.mkdir(parents=True, exist_ok=True)
directory = pathlib.Path(tempfile.mkdtemp(prefix='run-', dir=work))
agent = directory / 'agent'
agent.mkdir()
(agent / 'settings.json').write_text(json.dumps({'retry': {'enabled': False}, 'compaction': {'enabled': False, 'keepRecentTokens': 128, 'reserveTokens': 1024}}))
mode_path = ROOT / 'content/pstack/skills/poteto-mode/SKILL.md'
body = mode_path.read_text().split('---', 2)[2].strip()
argv = ['node', str(ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
        '--offline', '--mode', 'rpc', '--session', str(directory / 'parent.jsonl'),
        '--no-extensions', '--no-skills', '--no-themes', '--no-context-files', '--no-prompt-templates',
        '--skill', str(mode_path), '-e', str(ROOT / 'tests/mode-extension.ts'),
        '-e', str(ROOT / 'extensions/index.ts'), '--provider', 'mode-fixture', '--model', 'root', '--thinking', 'off']
env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent), PSTACK_MODE_DIR=str(directory), PI_OFFLINE='1')
print(f'Evidence: {directory}', flush=True)
events = queue.Queue()
serial = 0
measurements = []

def collect(stream):
    with (directory / 'stdout.jsonl').open('w') as log:
        for line in stream:
            log.write(line)
            log.flush()
            events.put(json.loads(line))
    events.put({'type': 'process_exit'})

def send(process, command):
    global serial
    serial += 1
    identity = str(serial)
    process.stdin.write(json.dumps(dict(command, id=identity)) + '\n')
    process.stdin.flush()
    return identity

def request(process, command, turn=False):
    identity = send(process, command)
    answered = False
    settled = not turn
    while not (answered and settled):
        event = events.get(timeout=30)
        assert event['type'] != 'process_exit', 'Owned Pi exited before completing the request'
        if event['type'] == 'agent_settled':
            settled = True
        if event.get('id') == identity and event['type'] == 'response':
            assert event.get('success'), event
            answered = True

def measure(label, expected, expected_user=0):
    requests = [json.loads(line) for line in (directory / 'requests.jsonl').read_text().splitlines()]
    messages = requests[-1]['context']['messages']
    system = next(message['content'] for message in reversed(messages)
                  if message['role'] == 'system' and isinstance(message.get('content'), str))
    users = [''.join(part.get('text', '') for part in message['content'] if part['type'] == 'text')
             if isinstance(message['content'], list) else message['content']
             for message in messages if message['role'] == 'user']
    assert label in users[-1], f'Task text missing for {label}'
    measurements.append({'case': label, 'expectedSystemCopies': expected, 'expectedUserCopies': expected_user,
                         'systemModeCopies': system.count(body), 'userModeCopies': sum(text.count(body) for text in users),
                         'lastUserCharacters': len(users[-1]), 'modeCharacters': len(body)})

def prompt(process, label, message, expected):
    request(process, {'type': 'prompt', 'message': message}, turn=True)
    measure(label, expected)

with (directory / 'stderr.log').open('w') as errors:
    process = subprocess.Popen(argv, cwd=directory, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=errors, text=True, bufsize=1)
    threading.Thread(target=collect, args=(process.stdout,), daemon=True).start()
    try:
        prompt(process, 'plain', 'plain', 0)
        send(process, {'type': 'prompt', 'message': 'hold'})
        while True:
            event = events.get(timeout=30)
            assert event['type'] != 'process_exit'
            if event['type'] == 'tool_execution_start' and event.get('toolName') == 'mode_hold':
                break
        request(process, {'type': 'prompt', 'message': '/skill:poteto-mode queued', 'streamingBehavior': 'followUp'})
        (directory / 'release').write_text('release')
        while True:
            event = events.get(timeout=30)
            assert event['type'] != 'process_exit'
            if event['type'] == 'agent_settled':
                break
        measure('queued', 0, 1)
        prompt(process, 'after-queued', 'after-queued', 1)
        request(process, {'type': 'prompt', 'message': '/poteto-mode on'})
        prompt(process, 'enabled', 'enabled', 1)
        request(process, {'type': 'prompt', 'message': '/poteto-mode off'})
        prompt(process, 'native', '/skill:poteto-mode native', 1)
        prompt(process, 'repeat', '/skill:poteto-mode repeat', 1)
        prompt(process, 'subsequent', 'subsequent', 1)
        prompt(process, 'alias', '/poteto-mode alias', 1)
        request(process, {'type': 'compact'})
        prompt(process, 'compacted', 'compacted', 1)
        process.stdin.write(json.dumps({'type': 'prompt', 'message': '/mode-exit'}) + '\n')
        process.stdin.flush()
        process.wait(timeout=10)
        assert process.returncode == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()

(directory / 'counts.json').write_text(json.dumps(measurements, indent=2) + '\n')
for result in measurements:
    print(json.dumps(result))
    assert result['systemModeCopies'] == result['expectedSystemCopies'] and result['userModeCopies'] == result['expectedUserCopies'], result
print('Mode loading verified. Native session history and raw provider requests are retained.')
