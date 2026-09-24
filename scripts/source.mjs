import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, cp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const command = process.argv[2];
const run = (args, cwd = root, options = {}) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  return result.stdout.trim();
};
const exists = async p => { try { await readFile(p); return true; } catch { return false; } };
async function files(dir) {
  const output = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) output.push(...await files(p)); else output.push(p);
  }
  return output.sort();
}
async function copyTree(from, to) { await mkdir(to, { recursive: true }); for (const f of await files(from)) { const dest = path.join(to, path.relative(from, f)); await mkdir(path.dirname(dest), { recursive: true }); await cp(f, dest); } }
async function generate(target = path.join(root, 'content/pstack')) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pstack-generate-'));
  try {
    await copyTree(path.join(root, 'upstream/pstack'), path.join(temp, 'content/pstack'));
    const patchDir = path.join(root, 'patches');
    const patches = (await readdir(patchDir)).filter(f => f.endsWith('.patch')).sort();
    for (const patch of patches) run(['apply', path.join(patchDir, patch)], path.join(temp, 'content/pstack'));
    await rm(target, { recursive: true, force: true });
    await copyTree(path.join(temp, 'content/pstack'), target);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
async function verify() {
  const lock = JSON.parse(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'));
  const actualTree = run(['rev-parse', `${lock.commit}:${lock.path}`]);
  if (actualTree !== lock.tree) throw new Error(`Pinned source tree mismatch: lock ${lock.tree}; Git ${actualTree}`);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pstack-verify-'));
  try {
    const archive = spawnSync('git', ['archive', `${lock.commit}:${lock.path}`], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error(archive.stderr.toString());
    const unpack = spawnSync('tar', ['-x', '-f', '-', '-C', temp], { input: archive.stdout });
    if (unpack.status !== 0) throw new Error(`Could not unpack pinned upstream: ${unpack.stderr?.toString() || unpack.error?.message || unpack.status}`);
    await compareDirs(path.join(root, 'upstream/pstack'), temp, 'Snapshot differs from recorded source');
    const generated = path.join(temp, 'generated');
    await generate(generated);
    await compareDirs(path.join(root, 'content/pstack'), generated, 'Generated content drift; run source:generate');
    console.log('Source snapshot and generated content verified');
  } finally { await rm(temp, { recursive: true, force: true }); }
}
async function compareDirs(a, b, message) {
  const af = (await files(a)).map(f => path.relative(a, f)); const bf = (await files(b)).map(f => path.relative(b, f));
  if (JSON.stringify(af) !== JSON.stringify(bf)) throw new Error(`${message}: file set differs`);
  for (const f of af) {
    const [left, right] = await Promise.all([stat(path.join(a, f)), stat(path.join(b, f))]);
    if ((left.mode & 0o777) !== (right.mode & 0o777) || !(await readFile(path.join(a, f))).equals(await readFile(path.join(b, f)))) throw new Error(`${message}: ${f}`);
  }
}
async function diff() {
  const runGit = spawnSync('git', ['diff', '--no-index', '--', 'upstream/pstack', 'content/pstack'], { cwd: root, encoding: 'utf8' });
  console.log('Pi content adaptations (snapshot -> generated content):'); console.log(runGit.stdout || '(none)');
  console.log('Pi-only extension code:');
  const entries = (await files(root)).map(f => path.relative(root, f)).filter(f => /^(extensions|src)\//.test(f));
  console.log(entries.join('\n') || '(none)');
}
async function prepare(commit) {
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('prepare-update requires a full commit SHA');
  const work = path.join(root, '.work', `prepare-${commit}`); await rm(work, { recursive: true, force: true }); await mkdir(work, { recursive: true });
  try {
    const lock = JSON.parse(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'));
    const cache = path.join(work, 'source.git'); run(['init', '--bare', cache]);
    run(['-C', cache, 'fetch', lock.repository, commit]);
    const tree = run(['-C', cache, 'rev-parse', `${commit}:${lock.path}`]);
    const arc = spawnSync('git', ['-C', cache, 'archive', `${commit}:${lock.path}`], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
    if (arc.status !== 0) throw new Error(arc.stderr.toString());
    const snap = path.join(work, 'upstream/pstack'); await mkdir(snap, { recursive: true });
    const unpack = spawnSync('tar', ['-x', '-f', '-', '-C', snap], { input: arc.stdout }); if (unpack.status !== 0) throw new Error('Unable to unpack candidate');
    const candidateContent = path.join(work, 'content/pstack');
    try { await copyTree(snap, candidateContent); for (const p of (await readdir(path.join(root, 'patches'))).filter(n => n.endsWith('.patch')).sort()) run(['apply', path.join(root, 'patches', p)], candidateContent); }
    catch (error) { await writeFile(path.join(work, 'failure.txt'), `Patch replay failed against ${commit} (${tree}):\n${error.message}\n`); console.error(`Patch replay failed; evidence: ${path.relative(root, work)}/failure.txt`); process.exitCode = 1; return; }
    await writeFile(path.join(work, 'candidate.lock.json'), JSON.stringify({ ...lock, commit, tree }, null, 2) + '\n');
    console.log(`Candidate prepared in ${path.relative(root, work)}; active snapshot, lock, and content unchanged`);
  } catch (e) { await writeFile(path.join(work, 'failure.txt'), `${e.message}\n`); console.error(`Candidate preparation failed; evidence: ${path.relative(root, work)}/failure.txt`); process.exitCode = 1; }
}
async function check() {
  const lock = JSON.parse(await readFile(path.join(root, 'upstream.lock.json'), 'utf8'));
  const url = process.argv[3] || lock.repository; const requested = process.argv[4] || 'main';
  const cache = path.join(root, '.work', 'upstream-check'); await rm(cache, { recursive: true, force: true }); await mkdir(path.dirname(cache), { recursive: true });
  run(['init', '--bare', cache]);
  run(['-C', cache, 'fetch', '--depth=1', url, requested]);
  const ref = run(['-C', cache, 'rev-parse', 'FETCH_HEAD']).trim();
  run(['-C', cache, 'fetch', lock.repository, lock.commit]);
  const tree = run(['-C', cache, 'rev-parse', `${ref}:${lock.path}`]);
  console.log(`Pinned ${lock.commit} (${lock.tree}); requested ${ref} (${tree})`);
  const d = spawnSync('git', ['-C', cache, 'diff', '--stat', `${lock.commit}:${lock.path}`, `${ref}:${lock.path}`], { cwd: root, encoding: 'utf8' }); console.log(d.stdout || '(no subtree differences reported)');
}
try {
  if (command === 'generate') await generate();
  else if (command === 'verify') await verify();
  else if (command === 'diff') await diff();
  else if (command === 'prepare-update') await prepare(process.argv[3]);
  else if (command === 'check-upstream') await check();
  else throw new Error('Usage: source.mjs generate|verify|diff|check-upstream [url] [ref]|prepare-update <full-sha>');
} catch (error) { console.error(error?.stack || error?.message || String(error)); process.exitCode = 1; }
