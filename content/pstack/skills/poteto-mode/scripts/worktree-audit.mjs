#!/usr/bin/env node
// Advisory inventory only: refreshes Git refs and queries the forge; never deletes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const run = promisify(execFile);
const call = async (cmd, args, opts={}) => run(cmd,args,{encoding:"utf8",maxBuffer:32*1024*1024,...opts});
const usage = `Usage: node worktree-audit.mjs [repo-path] [--history-scope '<JSON>']...\nScopes are {cwd,directory} absolute-path pairs; the audit is advisory, non-deleting, refreshes origin/main and queries gh.`;
const fail = (msg) => { console.error(msg); process.exitCode=1; };
const resolve = async p => { try { return await realpath(p); } catch { return path.resolve(p); } };
function scopes(args) {
 const out=[]; for(let i=0;i<args.length;i++) { if(args[i]==="--help") { console.log(usage); process.exit(0); }
  if(args[i]==="--history-scope") { try { const s=JSON.parse(args[++i]); if(!s||typeof s.cwd!=="string"||typeof s.directory!=="string"||!path.isAbsolute(s.cwd)||!path.isAbsolute(s.directory)) throw Error(); out.push(s); } catch { throw Error("--history-scope requires JSON with nonempty absolute cwd and directory"); } }
  else if(args[i].startsWith("--")) throw Error(`Unknown option ${args[i]}`); else if(!args.repo) args.repo=args[i]; else throw Error("Only one repo path is allowed");
 } return out;
}
function worktrees(s) { const chunks=s.split("\0"), out=[]; for(let i=0;i<chunks.length;i++) if(chunks[i].startsWith("worktree ")) out.push(chunks[i].slice(9)); return out; }
function statusCount(buf) { const a=buf.split("\0"); let tracked=0,scratch=0; for(let i=0;i<a.length;i++){ const r=a[i]; if(!r)continue; if(r.slice(0,2)==="??")scratch++; else {tracked++; if(/[RC]/.test(r.slice(0,2))) i++;} } return {tracked,scratch}; }
const enc = cwd => `--${cwd.replace(/^[/\\]+/,"").replace(/[\\/:]/g,"-")}--`;
function strings(v, out=[]) { if(typeof v==="string") out.push(v); else if(Array.isArray(v)) for(const x of v) strings(x,out); else if(v&&typeof v==="object") for(const [k,x] of Object.entries(v)) if(!["systemPrompt","tools","toolDefinitions","images","data"].includes(k)) strings(x,out); return out; }
async function sessionHeader(file) { const fh=await import('node:fs/promises').then(m=>m.open(file,'r')); try { const b=Buffer.alloc(65536); const {bytesRead}=await fh.read(b,0,b.length,0); const line=b.subarray(0,bytesRead).toString('utf8').split(/\r?\n/,1)[0]; const h=JSON.parse(line); if(h.type!=="session"||typeof h.id!=="string"||typeof h.cwd!=="string") throw Error("invalid Pi session header"); return h; } finally { await fh.close(); } }
async function main() {
 const args=process.argv.slice(2), explicit=scopes(args); let repo=args.repo;
 if(!repo) { try { repo=(await call("git",["rev-parse","--show-toplevel"])).stdout.trim(); } catch { throw Error("not in a git repo; pass a repo path"); } }
 const git=async a=>call("git",a,{cwd:repo}); const listing=(await git(["worktree","list","--porcelain","-z"])).stdout, wts=worktrees(listing), main= wts[0];
 const now=Date.now(), gaps=[]; let fetchOk=true, prs=[];
 try { await git(["fetch","origin","main","--quiet"]); } catch(e) { fetchOk=false; gaps.push(`fetch origin/main failed: ${e.message}`); }
 let prOk=true; try { prs=JSON.parse((await call("gh",["pr","list","--author","@me","--state","all","--limit","1000","--json","number,state,headRefName"],{cwd:repo})).stdout); if(!Array.isArray(prs)) throw Error("expected array"); } catch(e) { prOk=false; gaps.push(`gh PR query failed: ${e.message}`); }
 const agent=(process.env.PI_CODING_AGENT_DIR||path.join(os.homedir(),".pi","agent")).replace(/^~(?=$|[/\\])/,os.homedir());
 const roots=new Map(); for(const wt of wts) { const cwd=await resolve(wt), dir=path.join(agent,"sessions",enc(cwd)); if(!roots.has(dir)) roots.set(dir,new Set()); roots.get(dir).add(cwd); }
 for(const s of explicit) { const d=await resolve(s.directory), c=await resolve(s.cwd); if(!roots.has(d)) roots.set(d,new Set()); roots.get(d).add(c); }
 const allowed=new Map(), evidenceGaps=[]; for(const [dir,cwds] of roots) { let entries; try { entries=await readdir(dir,{withFileTypes:true}); } catch(e) { evidenceGaps.push(e.code==="ENOENT"?`no stored history in scoped directory ${dir}`:`history directory unreadable ${dir}: ${e.message}`); continue; }
  for(const ent of entries) { if(!ent.name.endsWith(".jsonl")) continue; const file=path.join(dir,ent.name); try { const st=await lstat(file); if(st.isSymbolicLink()) { evidenceGaps.push(`skipped symlink session ${file}`); continue; } if(!st.isFile()) continue; const h=await sessionHeader(file), cwd=await resolve(h.cwd); if(cwds.has(cwd)) allowed.set(file,cwd); } catch(e) { evidenceGaps.push(`invalid/unreadable session header ${file}: ${e.message}`); }
  }
 }
 const current=process.env.PI_SESSION_FILE; if(current) { try { const file=path.resolve(current), st=await lstat(file); if(st.isSymbolicLink()||!st.isFile()) throw Error("not a regular file"); await sessionHeader(file); allowed.set(file,"<current transcript>"); } catch(e) { evidenceGaps.push(`current PI_SESSION_FILE invalid/unreadable ${current}: ${e.message}`); } }
 const matches=new Map(wts.map(w=>[w,{time:0,files:[]} ]));
 // Inspect only validated, admitted transcripts; branch entries are all considered.
 for(const [file,authorized] of allowed) { try { const text=await readFile(file,"utf8"), lines=text.split(/\r?\n/); const h=JSON.parse(lines.shift()); const cwd=await resolve(h.cwd); const contents=[]; for(const line of lines) if(line) { try { const x=JSON.parse(line); if(x.type!=="message"&&!/summary|custom-title|file/.test(x.type||"")) continue; strings(x,contents); } catch { evidenceGaps.push(`malformed/partial session entry ${file}`); } }
   const body=contents.join("\n"); for(const wt of wts.slice(1)) { if(authorized!=="<current transcript>"&&cwd!==await resolve(wt)) continue; const escaped=wt.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); const re=new RegExp(`${escaped}(?=[/\\\\"'\\s]|$)`); if(re.test(body)) { const st=await import('node:fs/promises').then(m=>m.stat(file)); const x=matches.get(wt); if(st.mtimeMs>x.time){x.time=st.mtimeMs;x.files=[`${h.id}:${file}`]} else if(st.mtimeMs===x.time)x.files.push(`${h.id}:${file}`); } }
  } catch(e) { evidenceGaps.push(`session body unreadable ${file}: ${e.message}`); } }
 const rows=[]; for(const wt of wts.slice(1)) { let size="?", head="", ts=0, merged="?", dirty="?", remote="?", branch="", prRecords=[]; try { size=(await call("du",["-s","-B1","--",wt])).stdout.trim().split(/\s+/)[0]; } catch(e){gaps.push(`du failed ${wt}: ${e.message}`)}
  try { head=(await call("git",["-C",wt,"rev-parse","HEAD"])).stdout.trim(); ts=Number((await call("git",["-C",wt,"log","-1","--format=%ct","HEAD"])).stdout.trim())||0; } catch(e){gaps.push(`Git head read failed ${wt}: ${e.message}`)}
  if(head&&fetchOk) { try { await git(["merge-base","--is-ancestor",head,"origin/main"]); merged="YES"; } catch(e){ if(e.code===1) merged="no"; else gaps.push(`merge check failed ${wt}: ${e.message}`); } }
  try { const s=await call("git",["--no-optional-locks","-C",wt,"status","--porcelain=v1","-z","--untracked-files=all","--ignore-submodules=none"]); const c=statusCount(s.stdout); dirty=c.tracked?`wip:${c.tracked}`:c.scratch?`scratch:${c.scratch}`:"clean"; } catch(e){gaps.push(`status failed ${wt}: ${e.message}`)}
  try { branch=(await call("git",["-C",wt,"symbolic-ref","--quiet","--short","HEAD"])).stdout.trim(); if(!branch) remote="detached"; else { const ref=`refs/remotes/origin/${branch}`; try { await call("git",["-C",wt,"show-ref","--verify","--quiet",ref]); const r=(await call("git",["-C",wt,"rev-parse",`origin/${branch}`])).stdout.trim(); remote=r===head?"pushed":`ahead${(await call("git",["-C",wt,"rev-list","--count",`origin/${branch}..HEAD`])).stdout.trim()}`; } catch{remote="no-remote";} } } catch(e){gaps.push(`branch read failed ${wt}: ${e.message}`)}
  if(prOk&&branch) prRecords=prs.filter(p=>p.headRefName===branch); const pr=prRecords.length?prRecords.map(p=>`#${p.number}/${p.state}`).join(","):"-";
  const m=matches.get(wt), days=m.time?Math.floor((now-m.time)/86400000):Infinity, last=m.time?new Date(m.time).toISOString().slice(0,10):"-";
  let bucket="review"; if(dirty.startsWith("wip:")) bucket="hold-wip"; else if(prRecords.some(p=>p.state==="OPEN")) bucket="hold-open-pr"; else if(days<=4) bucket="verify-recent-chat"; else if(merged==="YES"||prRecords.some(p=>p.state!=="OPEN")) bucket="safe";
  if(!fetchOk||!prOk||dirty==="?"||merged==="?"||size==="?"||gaps.some(g=>g.includes(wt))) bucket="review";
  rows.push({size:Number(size)||0, age:ts?`${Math.floor((now-ts*1000)/86400000)}d`:"?",merged,dirty,remote,pr,last,bucket,wt, refs:m.files}); }
 rows.sort((a,b)=>a.size-b.size); console.log("SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE"); for(const r of rows) console.log(`${r.size} B\t${r.age}\t${r.merged}\t${r.dirty}\t${r.remote}\t${r.pr}\t${r.last}\t${r.bucket}\t${r.wt}`);
 if(!fetchOk||!prOk||evidenceGaps.length||gaps.length) { console.error("Evidence gaps (no inactivity or cleanup inference):"); for(const g of [...gaps,...evidenceGaps]) console.error(`- ${g}`); }
 for(const r of rows) if(r.refs.length) console.error(`History evidence ${r.wt}: ${r.refs.join(", ")}`);
 console.error("Advisory, non-deleting audit; refreshes Git refs and queries forge. Live/pinned usage is not discovered.");
}
try { await main(); } catch(e) { fail(e.message); }
