#!/usr/bin/env node
// Advisory only. History is admitted by its first line before any transcript body is read.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, readdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);
const call = (command, args, options = {}) => exec(command, args, {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options,
});
const usage = "Usage: node worktree-audit.mjs [repo-path] [--history-scope '{\"cwd\":\"/absolute\",\"directory\":\"/absolute\"}']...\nNon-deleting, not read-only: fetches origin/main and queries your GitHub PRs.";
const gaps = [];
const error = (label) => { gaps.push(label); };
const absolute = value => typeof value === 'string' && value.length > 0 && path.isAbsolute(value);
const normalized = value => path.resolve(value);

function argumentsFor(argv) {
  let repo;
  const scopes = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') { console.log(usage); process.exit(0); }
    if (arg === '--history-scope') {
      let scope;
      try { scope = JSON.parse(argv[++i]); } catch { throw Error('Invalid --history-scope JSON'); }
      if (!scope || !absolute(scope.cwd) || !absolute(scope.directory)) {
        throw Error('--history-scope requires nonempty absolute cwd and directory');
      }
      scopes.push({ cwd: normalized(scope.cwd), directory: normalized(scope.directory) });
    } else if (arg.startsWith('--') || repo) throw Error(`Unexpected argument: ${arg}`);
    else repo = arg;
  }
  return { repo, scopes };
}

function pathsFromListing(text) {
  return text.split('\0').filter(x => x.startsWith('worktree ')).map(x => x.slice(9));
}
function status(text) {
  let tracked = 0, scratch = 0;
  const parts = text.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    if (!record) continue;
    const code = record.slice(0, 2);
    if (code === '??') scratch++;
    else {
      tracked++;
      if (/[RC]/.test(code)) i++; // porcelain -z rename/copy has an extra NUL name
    }
  }
  return tracked ? `wip:${tracked}` : scratch ? `scratch:${scratch}` : 'clean';
}
function encoded(cwd) {
  return `--${cwd.replace(/^[/\\]+/, '').replace(/[\\/:]/g, '-')}--`;
}

// Read a bounded FIRST line, not an arbitrary prefix of an unadmitted body.
async function header(file) {
  const handle = await open(file, 'r');
  try {
    const bytes = [];
    const byte = Buffer.alloc(1);
    for (let offset = 0; offset < 65536; offset++) {
      const { bytesRead } = await handle.read(byte, 0, 1, offset);
      if (!bytesRead || byte[0] === 10) break;
      bytes.push(byte[0]);
    }
    if (bytes.length === 65536) throw Error('oversize header');
    let value;
    try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); }
    catch { throw Error('invalid header JSON'); }
    if (value?.type !== 'session' || typeof value.id !== 'string' || !value.id.trim() ||
        !absolute(value.cwd)) throw Error('invalid Pi session header');
    return { id: value.id, cwd: normalized(value.cwd) };
  } finally { await handle.close(); }
}

// Tool arguments are arbitrary JSON, unlike the typed transcript envelope.
function argumentText(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'image' || value.type === 'binary') return [];
  return Object.values(value).flatMap(argumentText);
}

// Inspect activity fields, not system prompts, tool declarations or image payloads.
function textual(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textual);
  if (!value || typeof value !== 'object') return [];
  if (value.type === 'image' || value.type === 'binary') return [];
  if (value.type === 'toolCall') return argumentText(value.arguments);
  return ['text', 'thinking', 'result', 'output', 'command', 'path',
    'file', 'files', 'summary', 'content'].flatMap(key => textual(value[key]));
}
function entryText(entry) {
  if (!entry || typeof entry !== 'object') return [];
  if (entry.type === 'message') {
    const message = entry.message;
    if (!message || !['user', 'assistant', 'toolResult', 'tool', 'bashExecution'].includes(message.role)) return [];
    return textual(message.content).concat(textual(message.arguments), textual(message.command),
      textual(message.output), textual(message.result));
  }
  if (entry.type === 'custom_message') return textual(entry.content);
  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return textual(entry.summary).concat(textual(entry.details?.readFiles),
      textual(entry.details?.modifiedFiles));
  }
  return [];
}
function mentions(text, location) {
  // Both boundaries: reject prefix siblings, but accept quoted paths and descendants.
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w/\\.\\-])${escape(location)}(?=$|[/\\s"'\\)\\],;:])`).test(text);
}

async function history(worktrees, scopes) {
  const agent = (process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent'))
    .replace(/^~(?=$|[/\\])/, os.homedir());
  const knownCwds = new Set(worktrees);
  const directories = new Map();
  console.error(`Repository history cwds: ${JSON.stringify(worktrees)}`);
  const add = (directory, cwd) => {
    const dir = normalized(directory);
    if (!directories.has(dir)) directories.set(dir, new Set());
    directories.get(dir).add(cwd);
  };
  for (const wt of worktrees) add(path.join(agent, 'sessions', encoded(wt)), wt);
  for (const scope of scopes) add(scope.directory, scope.cwd);
  const admitted = new Map();
  let uncertain = false;
  for (const [dir, cwds] of directories) {
    console.error(`History scope: ${JSON.stringify({ directory: dir, additionalCwds: [...cwds].filter(cwd => !knownCwds.has(cwd)) })}`);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (e) {
      if (e.code === 'ENOENT') error(`No stored history: ${dir}`);
      else { uncertain = true; error(`History directory unreadable: ${dir}`); }
      continue;
    }
    for (const entry of entries) {
      if (!entry.name.endsWith('.jsonl')) continue;
      const file = path.join(dir, entry.name);
      try {
        const stat = await lstat(file);
        if (stat.isSymbolicLink()) { error(`Skipped symlink session: ${file}`); continue; }
        if (!stat.isFile()) continue;
        const h = await header(file);
        if (knownCwds.has(h.cwd) || cwds.has(h.cwd)) admitted.set(file, h);
      } catch {
        uncertain = true;
        error(`Invalid/unreadable session header: ${file}`);
      }
    }
  }
  // Native session file permits precisely this file, not its containing directory.
  if (process.env.PI_SESSION_FILE) {
    const file = normalized(process.env.PI_SESSION_FILE);
    console.error(`Current transcript only: ${JSON.stringify(file)}`);
    try {
      const st = await lstat(file);
      if (!st.isFile() || st.isSymbolicLink()) throw Error('not regular');
      admitted.set(file, await header(file));
    } catch { uncertain = true; error(`Invalid/unreadable current session: ${file}`); }
  }
  const activity = new Map(worktrees.map(wt => [wt, { time: 0, refs: [] }]));
  for (const [file, h] of admitted) {
    try {
      const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
      lines.shift();
      const chunks = [];
      for (const line of lines) {
        if (!line) continue;
        try { chunks.push(...entryText(JSON.parse(line))); }
        catch { uncertain = true; error(`Malformed/partial session entry: ${file}`); }
      }
      const mtime = (await lstat(file)).mtimeMs;
      const body = chunks.join('\n');
      for (const wt of worktrees) {
        if (h.cwd !== wt && !mentions(body, wt)) continue;
        const found = activity.get(wt);
        if (mtime > found.time) { found.time = mtime; found.refs = [`${h.id}:${file}`]; }
        else if (mtime === found.time) found.refs.push(`${h.id}:${file}`);
      }
    } catch { uncertain = true; error(`Session body unreadable: ${file}`); }
  }
  return { activity, uncertain };
}

async function main() {
  const { repo: requested, scopes } = argumentsFor(process.argv.slice(2));
  let repo = requested;
  if (!repo) repo = (await call('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
  const git = args => call('git', args, { cwd: repo });
  const worktrees = pathsFromListing((await git(['worktree', 'list', '--porcelain', '-z'])).stdout)
    .map(normalized);
  if (!worktrees.length) throw Error('No Git worktrees found');
  const { activity, uncertain } = await history(worktrees, scopes);
  let fetchOk = true, prOk = true, prs = [];
  try { await git(['fetch', 'origin', 'main', '--quiet']); }
  catch { fetchOk = false; error('Fetch origin main failed'); }
  try {
    prs = JSON.parse((await call('gh', ['pr', 'list', '--author', '@me', '--state', 'all',
      '--limit', '1000', '--json', 'number,state,headRefName'], { cwd: repo })).stdout);
    if (!Array.isArray(prs) || prs.some(p => !p || !Number.isInteger(p.number) ||
        p.number <= 0 || typeof p.headRefName !== 'string' || !p.headRefName ||
        !['OPEN', 'CLOSED', 'MERGED'].includes(p.state))) throw Error('invalid records');
  } catch { prOk = false; error('PR query failed or returned malformed records'); }
  const now = Date.now(), rows = [];
  for (const wt of worktrees.slice(1)) {
    let size = 0, sizeOk = true, head, timestamp, merged = '?', dirty = '?';
    let remote = '?', branch = '', gitOk = true;
    try {
      const value = (await call('du', ['-s', '-B1', '--', wt])).stdout.split(/\s/)[0];
      size = Number(value);
      if (!Number.isFinite(size)) throw Error('invalid size');
    } catch { sizeOk = false; error(`Size unreadable: ${wt}`); }
    try {
      head = (await call('git', ['-C', wt, 'rev-parse', 'HEAD'])).stdout.trim();
      timestamp = Number((await call('git', ['-C', wt, 'log', '-1', '--format=%ct', 'HEAD'])).stdout.trim());
      if (!head || !timestamp) throw Error('invalid HEAD');
    } catch { gitOk = false; error(`Git HEAD unreadable: ${wt}`); }
    if (head && fetchOk) {
      try { await git(['merge-base', '--is-ancestor', head, 'origin/main']); merged = 'YES'; }
      catch (e) {
        if (e.code === 1) merged = 'no';
        else { gitOk = false; error(`Merge check failed: ${wt}`); }
      }
    }
    try {
      dirty = status((await call('git', ['--no-optional-locks', '-C', wt, 'status',
        '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'])).stdout);
    } catch { gitOk = false; error(`Git status unreadable: ${wt}`); }
    try {
      branch = (await call('git', ['-C', wt, 'symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim();
    } catch (e) { if (e.code !== 1) { gitOk = false; error(`Git branch unreadable: ${wt}`); } }
    if (!branch) remote = gitOk ? 'detached' : '?';
    else {
      const ref = `refs/remotes/origin/${branch}`;
      try {
        await call('git', ['-C', wt, 'show-ref', '--verify', '--quiet', ref]);
        const remoteHead = (await call('git', ['-C', wt, 'rev-parse', ref])).stdout.trim();
        remote = remoteHead === head ? 'pushed' : `ahead${(await call('git', ['-C', wt,
          'rev-list', '--count', `${ref}..HEAD`])).stdout.trim()}`;
      } catch (e) {
        if (e.code === 1) remote = 'no-remote';
        else { gitOk = false; error(`Remote ref unreadable: ${wt}`); }
      }
    }
    const records = prOk && branch ? prs.filter(p => p.headRefName === branch) : [];
    const evidence = activity.get(wt);
    const age = evidence.time ? Math.floor((now - evidence.time) / 86400000) : Infinity;
    let bucket = 'review';
    if (dirty.startsWith('wip:')) bucket = 'hold-wip';
    else if (records.some(p => p.state === 'OPEN')) bucket = 'hold-open-pr';
    else if (age <= 4) bucket = 'verify-recent-chat';
    else if (!uncertain && fetchOk && prOk && gitOk && sizeOk && merged !== '?' &&
      dirty !== '?' && (merged === 'YES' || records.length)) bucket = 'safe';
    rows.push({ size, sizeLabel: sizeOk ? `${size} B` : '?', age: timestamp ? `${Math.floor((now - timestamp * 1000) / 86400000)}d` : '?',
      merged, dirty, remote, pr: records.map(p => `#${p.number}/${p.state}`).join(',') || '-',
      last: evidence.time ? new Date(evidence.time).toISOString().slice(0, 10) : '-',
      bucket, wt, refs: evidence.refs });
  }
  rows.sort((a, b) => a.size - b.size);
  console.log('SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE');
  for (const r of rows) {
    const location = /[\t\r\n]/.test(r.wt) ? JSON.stringify(r.wt) : r.wt;
    console.log(`${r.sizeLabel}\t${r.age}\t${r.merged}\t${r.dirty}\t${r.remote}\t${r.pr}\t${r.last}\t${r.bucket}\t${location}`);
  }
  for (const r of rows) if (r.refs.length) console.error(`History evidence ${JSON.stringify({ worktree: r.wt, sessions: r.refs })}`);
  if (gaps.length) {
    console.error('Evidence gaps (not proof of inactivity):');
    for (const gap of gaps) console.error(`- ${gap}`);
  }
  console.error('Advisory, non-deleting, not read-only: attempted Git ref refresh and PR query (author @me, limit 1000). LAST_CHAT is file mtime, not proof of activity or inactivity. Live/pinned usage is not discovered; no cleanup authority.');
}
try { await main(); } catch { console.error('Audit failed: invalid arguments or Git inventory unavailable'); process.exitCode = 1; }
