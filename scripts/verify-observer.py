import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / '.work' / 'observer-verification'
WORK.mkdir(parents=True, exist_ok=True)
DIRECTORY = pathlib.Path(tempfile.mkdtemp(prefix='run-', dir=WORK))
SOCKET = 'pstack-observer-' + DIRECTORY.name
TARGET = 'observer'
SETTINGS = pathlib.Path(os.environ.get('PI_CODING_AGENT_DIR', str(pathlib.Path.home() / '.pi/agent')))
DISPLAY = json.loads((SETTINGS / 'settings.json').read_text()) if (SETTINGS / 'settings.json').exists() else {}


def tmux(*args):
    return subprocess.check_output(['tmux', '-L', SOCKET, *args], text=True, stderr=subprocess.PIPE)


def screen():
    return tmux('capture-pane', '-p', '-t', TARGET)


def wait(predicate, label, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = screen()
        if predicate(value):
            return value
        time.sleep(0.1)
    raise AssertionError(f'{label}\n{screen()}')


def contains(text, timeout=30):
    return wait(lambda value: text in value, f'Missing {text!r}', timeout)


def absent(text):
    return wait(lambda value: text not in value, f'Still visible {text!r}')


def key(value):
    tmux('send-keys', '-t', TARGET, value)


def command(value):
    tmux('send-keys', '-l', '-t', TARGET, value)
    key('Enter')


def capture(name):
    (DIRECTORY / f'{name}.txt').write_text(screen())
    (DIRECTORY / f'{name}.ansi').write_text(tmux('capture-pane', '-e', '-p', '-t', TARGET))


def requests(work):
    path = work / 'requests.jsonl'
    return len(path.read_text().splitlines()) if path.exists() else 0


def transcripts(work):
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in work.rglob('*.jsonl') if path.name != 'requests.jsonl'}


def task_records(work):
    result = {}
    for path in work.rglob('*.jsonl'):
        if path.name == 'requests.jsonl':
            continue
        for line in path.read_text().splitlines():
            entry = json.loads(line)
            if entry.get('type') == 'custom' and entry.get('customType') == 'pstack-task':
                result[entry['data']['id']] = entry['data']
    return result


def position(text=None):
    text = screen() if text is None else text
    match = re.search(r'Lines (\d+)-(\d+) of (\d+)', text)
    assert match, text
    return tuple(map(int, match.groups()))


def launch(work):
    agent = work / 'agent'
    agent.mkdir(exist_ok=True)
    (agent / 'settings.json').write_text(json.dumps({'retry': {'enabled': False}, 'compaction': {'enabled': False}}))
    argv = ['node', str(ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
            '--offline', '--session', str(work / 'parent.jsonl'),
            '--no-extensions', '--no-skills', '--no-themes', '--no-context-files', '--no-prompt-templates',
            '-e', str(ROOT / 'tests/observer-extension.ts'), '-e', str(ROOT / 'extensions/index.ts'),
            '--provider', 'observer-fixture', '--model', 'root', '--thinking', 'off']
    theme = DISPLAY.get('theme')
    if theme:
        source = SETTINGS / 'themes' / f'{theme}.json'
        if source.exists():
            argv.extend(['--theme', str(source)])
        argv.extend(['--use-theme', theme])
    env = {'PI_CODING_AGENT_DIR': str(agent), 'PSTACK_OBSERVER_DIR': str(work),
           'PI_OFFLINE': '1', 'COLORTERM': 'truecolor'}
    invocation = 'exec env ' + ' '.join(shlex.quote(f'{k}={v}') for k, v in env.items()) + ' ' + shlex.join(argv)
    tmux('new-session', '-d', '-s', TARGET, '-x', '128', '-y', '44', '-c', str(work), invocation)
    tmux('set-option', '-t', TARGET, 'remain-on-exit', 'on')
    contains('(observer-fixture) root')
    capture(f'{work.name}-startup-{requests(work)}')


def close_session():
    command('/observer-fixture-exit')
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if tmux('display-message', '-p', '-t', TARGET, '#{pane_dead}').strip() == '1':
            assert tmux('display-message', '-p', '-t', TARGET, '#{pane_dead_status}').strip() == '0'
            tmux('kill-session', '-t', TARGET)
            return
        time.sleep(0.1)
    raise AssertionError('Owned Pi did not exit cleanly')


def prepare(name):
    work = DIRECTORY / name
    work.mkdir()
    (work / 'proof.txt').write_text('TRANSCRIPT_START\n' + '\n'.join(f'Proof line {i:03d}: native read result' for i in range(1, 121)) + '\nPROOF_END\n')
    return work


def run():
    live = prepare('live')
    launch(live)
    before = requests(live)
    command('/subagents')
    contains('No subagents to inspect.')
    capture('01-empty')
    key('Escape')
    absent('Native Pi transcript')
    assert requests(live) == before == 0
    absent('Subagents')
    capture('01b-empty-no-rail')
    command('observer-run')
    contains('1 running · 1 waiting', timeout=40)
    assert 'Failure needs attention' not in screen()
    capture('02-live-rail')
    command('/subagents')
    contains('Coordinator inspection')
    contains('Nested transcript')
    contains('Model observer-fixture/coordinator · Thinking off')
    contains('Own session 4,000 tokens · Pi estimate $0.0400')
    capture('03-nested-tree')
    key('Left')
    absent('Nested transcript')
    key('Right')
    contains('Nested transcript')
    key('Down')
    contains('TOOL_STREAM_START')
    contains('Model observer-fixture/leaf:revision · Thinking high')
    contains('Tokens in 2,400 · out 600 · cache read 800 · write 200')
    contains('Own session 4,000 tokens · Pi estimate $0.0400')
    capture('04-tool-stream')
    key('Home')
    contains('TRANSCRIPT_START')
    held = position()[0]
    assert held == 1
    capture('05-history-start')
    (live / 'release').touch()
    key('End')
    contains('ASSISTANT_STREAM_START')
    assert 'ASSISTANT_STREAM_END' not in screen(), 'The streaming check only saw the final response'
    capture('05b-assistant-stream')
    key('Home')
    contains('TRANSCRIPT_START')
    contains('0 running · 0 waiting', timeout=60)
    assert position()[0] == held, 'New output moved the held transcript'
    contains('TRANSCRIPT_START')
    capture('06-held-after-completion')
    key('End')
    contains('ASSISTANT_STREAM_END')
    contains('Tokens in 3,600 · out 900 · cache read 1,200 · write 300')
    contains('Own session 6,000 tokens · Pi estimate $0.0600')
    capture('07-completed-transcript')
    latest = position()[0]
    key('PPage')
    contains('Earlier output')
    wait(lambda value: position(value)[0] < latest, 'Page Up did not move backward')
    earlier = position()[0]
    key('NPage')
    wait(lambda value: position(value)[0] > earlier, 'Page Down did not move forward')
    key('Home')
    contains('TRANSCRIPT_START')
    expanded_total = position()[2]
    key('C-o')
    wait(lambda value: position(value)[2] < expanded_total, 'Tool collapse did not reduce displayed output')
    capture('08-collapsed-tools')
    key('C-o')
    wait(lambda value: position(value)[2] == expanded_total, 'Tool expansion did not restore output')
    key('End')
    contains('ASSISTANT_STREAM_END')
    key('Enter')
    contains('ASSISTANT_STREAM_END')
    capture('09-full-transcript')
    key('Escape')
    key('Down')
    contains('Deliberate observer fixture failure')
    contains('Own session 2,000 tokens · Pi estimate $0.0200')
    capture('10-failure')
    tmux('resize-window', '-t', TARGET, '-x', '72', '-y', '28')
    absent('Lines ')
    key('Enter')
    contains('Deliberate observer fixture failure')
    contains('Model observer-fixture/failure · Thinking off')
    contains('Own session 2,000 tokens · Pi estimate $0.0200')
    capture('11-narrow-transcript')
    tmux('resize-window', '-t', TARGET, '-x', '52', '-y', '28')
    contains('Pi estimate')
    contains('$0.0200')
    contains('Deliberate observer fixture failure')
    capture('11b-wrapped-summary')
    tmux('resize-window', '-t', TARGET, '-x', '52', '-y', '12')
    contains('Enlarge terminal for task details.')
    capture('11c-short-terminal')
    tmux('resize-window', '-t', TARGET, '-x', '72', '-y', '28')
    contains('Pi estimate $0.0200')
    key('Escape')
    absent('Lines ')
    key('Escape')
    absent('Native Pi transcript')
    absent('Subagents')
    count = requests(live)
    saved = transcripts(live)
    command('/subagents')
    contains('Native Pi transcript')
    key('Escape')
    absent('Native Pi transcript')
    assert requests(live) == count, 'Inspection triggered a model request'
    assert transcripts(live) == saved, 'Inspection changed a native transcript'
    absent('Subagents')
    capture('12-settled-no-rail')
    close_session()

    recovered = prepare('recovered')
    launch(recovered)
    command('observer-run')
    contains('1 running · 1 waiting', timeout=40)
    command('/subagents')
    contains('Nested transcript')
    key('Down')
    contains('TOOL_STREAM_START')
    capture('12b-before-interruption')
    key('Escape')
    absent('Native Pi transcript')
    close_session()
    count = requests(recovered)
    launch(recovered)
    assert requests(recovered) == count, 'Reopening restarted model work'
    saved = transcripts(recovered)
    command('/subagents')
    contains('Nested transcript')
    contains('interrupted')
    capture('13-recovered-tree')
    key('Down')
    key('Home')
    contains('TRANSCRIPT_START')
    contains('Model observer-fixture/leaf:revision · Thinking high')
    contains('Own session 4,000 tokens · Pi estimate $0.0400')
    capture('14-recovered-native-history')
    key('Escape')
    absent('Native Pi transcript')
    assert requests(recovered) == count, 'Inspecting recovered tasks started model work'
    assert transcripts(recovered) == saved, 'Inspecting recovered tasks rewrote history'
    absent('Subagents')
    capture('14b-interrupted-no-rail')
    before_resume = task_records(recovered)
    (recovered / 'release').touch()
    command('observer-resume')
    contains('1 running · 1 waiting', timeout=40)
    command('/subagents')
    contains('Native Pi transcript')
    capture('15-foreground-resume')
    key('Down')
    contains('ASSISTANT_STREAM_END', timeout=60)
    contains('0 running · 0 waiting', timeout=60)
    contains('Own session 6,000 tokens · Pi estimate $0.0600')
    capture('16-resumed-transcript')
    key('Escape')
    absent('Native Pi transcript')
    absent('Subagents')
    capture('16b-resumed-no-rail')
    after_resume = task_records(recovered)
    assert set(after_resume) == set(before_resume), 'Resumption replaced task IDs'
    for task_id, before in before_resume.items():
        after = after_resume[task_id]
        assert after['transcript'] == before['transcript'], 'Resumption replaced a conversation'
        if before['outcome']['status'] == 'interrupted':
            assert after['outcome']['status'] == 'completed'
            assert after['attempt'] == 2
    close_session()
    leaf = next(record for record in after_resume.values()
                if record['config']['selector'] == 'observer-fixture/leaf:revision:high')
    missing = pathlib.Path(leaf['transcript'])
    assert missing.resolve().is_relative_to(recovered.resolve())
    assert json.loads(missing.read_text().splitlines()[0])['id'] == leaf['sessionId']
    held = missing.with_suffix('.jsonl.held')
    missing.rename(held)
    try:
        launch(recovered)
        count = requests(recovered)
        saved = transcripts(recovered)
        command('/subagents')
        contains('Nested transcript')
        key('Down')
        contains('Session usage unavailable')
        contains('Transcript unavailable.')
        absent('Pi estimate $')
        capture('16c-missing-history')
        key('Escape')
        absent('Native Pi transcript')
        assert requests(recovered) == count
        assert transcripts(recovered) == saved
        assert not missing.exists(), 'Inspection recreated a missing transcript'
        close_session()
    finally:
        held.rename(missing)
    corrupt = prepare('corrupt')
    damaged = []
    for line in (recovered / 'parent.jsonl').read_text().splitlines():
        entry = json.loads(line)
        if entry.get('type') == 'custom' and entry.get('customType') == 'pstack-task':
            entry['data']['version'] = 999
        damaged.append(json.dumps(entry))
    (corrupt / 'parent.jsonl').write_text('\n'.join(damaged) + '\n')
    launch(corrupt)
    contains('Subagents unavailable.')
    command('/subagents')
    contains('Esc closes the observer.')
    capture('17-invalid-record-report')
    key('Escape')
    absent('Esc closes the observer.')
    assert requests(corrupt) == 0
    close_session()
    theme_verified = False
    theme_path = SETTINGS / 'themes' / f'{DISPLAY.get("theme")}.json'
    if theme_path.exists():
        theme = json.loads(theme_path.read_text())
        accent = theme['colors']['accent']
        accent = theme.get('vars', {}).get(accent, accent).removeprefix('#')
        rgb = [int(accent[index:index + 2], 16) for index in (0, 2, 4)]
        sequence = ';'.join(map(str, [38, 2, *rgb]))
        assert sequence in (DIRECTORY / '03-nested-tree.ansi').read_text(), 'Configured accent is missing'
        theme_verified = True
    return {'status': 'passed', 'theme': DISPLAY.get('theme'), 'theme_verified': theme_verified, 'directory': str(DIRECTORY)}


try:
    result = run()
    (DIRECTORY / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
except BaseException:
    try:
        capture('failure')
    except subprocess.CalledProcessError:
        pass
    print(f'Evidence retained at {DIRECTORY}')
    raise
finally:
    for work in DIRECTORY.iterdir():
        if work.is_dir() and (work / 'proof.txt').exists():
            (work / 'release').touch()
    try:
        tmux('send-keys', '-t', TARGET, 'Escape')
        time.sleep(0.2)
        tmux('send-keys', '-t', TARGET, 'Escape')
        time.sleep(0.2)
        command('/observer-fixture-exit')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if tmux('display-message', '-p', '-t', TARGET, '#{pane_dead}').strip() == '1':
                break
            time.sleep(0.1)
        tmux('kill-session', '-t', TARGET)
    except subprocess.CalledProcessError:
        pass
