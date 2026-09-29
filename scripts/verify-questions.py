import json
import pathlib
import shlex
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
work = ROOT / '.work' / 'question-verification'
work.mkdir(parents=True, exist_ok=True)
directory = pathlib.Path(tempfile.mkdtemp(prefix='run-', dir=work))
agent = directory / 'agent'
agent.mkdir()
(agent / 'settings.json').write_text(json.dumps({'retry': {'enabled': False}, 'compaction': {'enabled': False}}))
socket = f'pstack-questions-{directory.name}'
print(f'Evidence: {directory}', flush=True)

def tmux(*args):
    return subprocess.check_output(['tmux', '-L', socket, *args], text=True, stderr=subprocess.PIPE)

def screen():
    return tmux('capture-pane', '-p', '-t', 'questions')

def wait_text(text):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        output = screen()
        if text in output:
            return output
        time.sleep(0.05)
    raise AssertionError(f'No {text!r} in terminal:\n{output}')

def keys(*values):
    for value in values:
        tmux('send-keys', '-t', 'questions', value)
    time.sleep(0.05)

def text(value):
    tmux('send-keys', '-l', '-t', 'questions', value)

def command(value):
    text(value)
    keys('Enter')

def capture(name):
    (directory / f'{name}.txt').write_text(screen())
    (directory / f'{name}.ansi').write_text(tmux('capture-pane', '-e', '-p', '-t', 'questions'))

def outcomes(count):
    path = directory / 'outcomes.jsonl'
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if path.exists():
            values = [json.loads(line) for line in path.read_text().splitlines()]
            if len(values) == count:
                return values
        time.sleep(0.05)
    raise AssertionError(f'Expected {count} submitted outcomes')

args = ['node', str(ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
        '--offline', '--session', str(directory / 'session.jsonl'),
        '--no-extensions', '--no-skills', '--no-themes', '--no-context-files', '--no-prompt-templates',
        '-e', str(ROOT / 'tests/question-extension.ts'), '-e', str(ROOT / 'extensions/index.ts'),
        '--provider', 'question-fixture', '--model', 'root', '--thinking', 'off']
env = {'PI_CODING_AGENT_DIR': str(agent), 'PSTACK_QUESTION_DIR': str(directory), 'PI_OFFLINE': '1'}
invocation = 'exec env ' + ' '.join(shlex.quote(f'{key}={value}') for key, value in env.items()) + ' ' + shlex.join(args)
tmux('new-session', '-d', '-s', 'questions', '-x', '128', '-y', '44', '-c', str(directory), invocation)
try:
    tmux('set-option', '-t', 'questions', 'remain-on-exit', 'on')
    wait_text('(question-fixture) root')
    command('questions-mixed')
    wait_text('Question 1/2')
    capture('01-single')
    assert '(question-fixture) root' in screen(), 'Question must replace the input above the footer'
    blocked = directory / 'blocked.jsonl'
    assert blocked.exists() and [json.loads(line) for line in blocked.read_text().splitlines()] == [
        {'active': True, 'label': 'Waiting for questionnaire answers'}
    ], 'Question must report Herdr blocked while awaiting input'
    keys('Down', 'Enter')
    wait_text('Multiple choices')
    keys('Enter')
    wait_text('Select at least one option')
    tmux('resize-window', '-t', 'questions', '-x', '68', '-y', '18')
    keys('PageDown', 'PageDown', 'PageDown')
    wait_text('END OF BODY')
    keys('Down', 'Down', 'Space', 'Up', 'Up', 'Space')
    wait_text('[x] Correctness')
    wait_text('[x] Performance')
    capture('02-multiple-small-terminal')
    assert 'Question 2/2' in screen() and '(question-fixture) root' in screen(), 'Small terminal must show the title and footer'
    keys('Enter')
    wait_text('Review')
    capture('03-review')
    keys('Left')
    wait_text('Question 2/2')
    keys('Space', 'Down', 'Space', 'Enter')
    wait_text('Review')
    wait_text('[x] UX')
    keys('Enter')
    assert outcomes(1)[0] == {'status': 'answered', 'answers': [
        {'id': 'storage', 'kind': 'option', 'value': 'Remote'},
        {'id': 'areas', 'kind': 'options', 'values': ['UX', 'Performance']},
    ]}
    wait_text('Question fixture complete. questions-mixed')
    assert [json.loads(line) for line in blocked.read_text().splitlines()] == [
        {'active': True, 'label': 'Waiting for questionnaire answers'}, {'active': False}
    ], 'Submitting must clear Herdr blocked'
    tmux('resize-window', '-t', 'questions', '-x', '128', '-y', '44')
    command('questions-other')
    wait_text('Question 1/1')
    keys('Space', 'Down', 'Space', 'Down', 'Space', 'Enter')
    wait_text('Other cannot be blank')
    text('custom first')
    keys('C-j')
    text('second')
    keys('Enter')
    wait_text('[x] Other (edit an answer)')
    wait_text('[x] Docs')
    wait_text('[x] Tests')
    capture('04-combined-choices')
    keys('Up', 'Enter')
    wait_text('Other: custom first')
    capture('05-combined-review')
    keys('Left')
    wait_text('[x] Other (edit an answer)')
    keys('Down', 'Down', 'Enter')
    wait_text('save & choices')
    text(' revised')
    keys('Enter', 'Up', 'Enter')
    wait_text('second revised')
    keys('Enter')
    assert outcomes(2)[1] == {'status': 'answered', 'answers': [{'id': 'custom', 'kind': 'options', 'values': ['Docs', 'Tests'], 'other': 'custom first\nsecond revised'}]}
    wait_text('Question fixture complete. questions-other')
    wait_text('custom: Docs, Tests')
    wait_text('Other: custom first')
    capture('06-combined-tool-result')
    command('questions-other')
    wait_text('Question 1/1')
    keys('Space', 'Down', 'Down', 'Space')
    wait_text('save & choices')
    text('deselect this')
    keys('Enter')
    wait_text('[x] Other (edit an answer)')
    keys('Space')
    wait_text('[ ] Other (write an answer)')
    keys('Up', 'Enter')
    review = wait_text('Review')
    assert 'deselect this' not in review
    keys('Enter')
    assert outcomes(3)[2] == {'status': 'answered', 'answers': [{'id': 'custom', 'kind': 'options', 'values': ['Docs']}]}
    wait_text('Question fixture complete. questions-other')
    command('questions-other')
    wait_text('Question 1/1')
    keys('Down', 'Down', 'Space')
    wait_text('save & choices')
    text('standalone')
    keys('Enter', 'Up', 'Enter')
    wait_text('Other: standalone')
    keys('Enter')
    assert outcomes(4)[3] == {'status': 'answered', 'answers': [{'id': 'custom', 'kind': 'other', 'value': 'standalone'}]}
    wait_text('Question fixture complete. questions-other')
    command('questions-cancel')
    wait_text('Question 1/2')
    keys('Enter')
    wait_text('Question 2/2')
    keys('Space', 'Down', 'Down', 'Down', 'Space')
    wait_text('save & choices')
    text('cancelled Other')
    keys('Enter', 'Escape')
    assert outcomes(5)[4] == {'status': 'cancelled', 'answers': []}
    wait_text('Question fixture complete. questions-cancel')
    command('questions-abort')
    wait_text('Question 1/2')
    keys('Enter')
    wait_text('Question 2/2')
    keys('Space', 'Down', 'Down', 'Down', 'Space')
    wait_text('save & choices')
    text('aborted Other')
    keys('Enter')
    wait_text('[x] Other (edit an answer)')
    (directory / 'abort').write_text('abort this owned fixture')
    assert outcomes(6)[5] == {'status': 'cancelled', 'answers': []}
    assert [event['active'] for event in map(json.loads, blocked.read_text().splitlines())] == [True, False] * 6, 'Every answer, cancel, and abort must clear Herdr blocked'
    capture('07-aborted')
    command('/question-fixture-exit')
    deadline = time.monotonic() + 15
    while tmux('display-message', '-p', '-t', 'questions', '#{pane_dead}').strip() != '1':
        assert time.monotonic() < deadline, 'Owned question fixture did not exit'
        time.sleep(0.05)
    assert tmux('display-message', '-p', '-t', 'questions', '#{pane_dead_status}').strip() == '0'
finally:
    capture('last-screen')
    tmux('kill-server')
print(json.dumps({'status': 'passed', 'directory': str(directory), 'cases': ['mixed', 'revision', 'resize', 'combined Other', 'Other revision', 'Other deselection', 'Other alone', 'cancel', 'abort']}))
