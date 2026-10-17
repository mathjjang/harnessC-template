#!/usr/bin/env node
// guard-scratch.mjs — PreToolUse 훅 (Write|Edit|NotebookEdit · Bash). 임시 파일이 저장소를 어지럽히는 것을 **쓰기 전에** 막는다.
//
// 막는 것:
//   ① 저장소 루트에 새 파일·폴더를 만드는 것 — 허용 목록(git이 추적하는 루트 항목 + 설정 root_allow + 기본 이름) 밖이면 거부
//   ② 임시 패턴 이름(.tmp* · tmp-* · *.log · probe-* · sweep-* · watch-* · *.bak · scratch* · *~ · *-test2.*)을
//      허용 구역(.scratch/ · evidence/ · **/evidence/** · **/_assets/** · 세션 scratchpad_dir) 밖에 만드는 것
//   ③ Bash의 리다이렉션·tee·touch·cp·mv·mkdir·Out-File·Set-Content·New-Item 대상이 위 ①②에 해당하는 것
// 막지 않는 것: 기존 파일 편집 · 허용 구역 · node_modules/.git · 저장소 밖 경로(scratchpad 포함)
// 설정: harness.yaml `scratch:` 또는 .harness/scripts/clutter-config.json (없으면 기본값). 우회 플래그 없음 — 갈 곳을 바꾸는 것이 시정이다.
// 자기 검사: node .claude/hooks/guard-scratch.mjs --self-test
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { writeTargets } from '../../.harness/scripts/lib/write-targets.mjs';
import { DOCS_DIRS } from '../../.harness/scripts/lib/records.mjs';

const TEMP_RE = /^(\.?tmp[-_.]?|probe-|sweep-|watch-|scratch)|(\.log|\.bak|~|-test\d+\.[a-z]+)$/i;
const DEFAULT_ROOT_ALLOW = ['.gitignore', '.gitattributes', '.editorconfig', 'README.md', 'LICENSE', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', '.env.example', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'harness.yaml', 'init.mjs', '.scratch', '.worktrees', '.harness', 'rules', 'docs', 'src', 'app', 'tests', 'scripts', 'config', '.claude', '.github', '.vscode'];
const ALLOWED_DIR_RE = /(^|[\\/])(\.scratch|evidence|_assets|node_modules|\.git)([\\/]|$)/;
const DOCS_ALLOW = [...DOCS_DIRS, 'methodology'];   // docs/ 하위 폴더는 고정(lib/records.mjs) — 기록은 자기 자리, 도메인 자료는 specs/ 파일 (lint ⑬과 동일)
const RULES_ALLOW = ['product.md', 'human-only.yaml', 'runbooks', 'domain', 'README.md'];

function loadConfig(root) {
  const cfg = { rootAllow: [], scratchDir: '.scratch', allowDirs: [] };
  const hy = existsSync(resolve(root, 'harness.yaml')) ? readFileSync(resolve(root, 'harness.yaml'), 'utf8') : '';
  const m = hy.match(/^scratch:\s*\n((?:[ \t]+.*\n?)*)/m);
  if (m) { const list = m[1].match(/root_allow:\s*\[([^\]]*)\]/); if (list) cfg.rootAllow = list[1].split(',').map((s) => s.trim()).filter(Boolean); const d = m[1].match(/dir:\s*(\S+)/); if (d) cfg.scratchDir = d[1]; }
  const jp = resolve(root, '.harness', 'clutter-config.json');
  if (existsSync(jp)) { try { const j = JSON.parse(readFileSync(jp, 'utf8')); cfg.rootAllow.push(...(j.rootAllow || [])); cfg.allowDirs.push(...(j.allowDirs || [])); if (j.scratchDir) cfg.scratchDir = j.scratchDir; } catch { /* 무시 */ } }
  return cfg;
}
function trackedRoot(root) {
  try { return new Set(execSync('git ls-files --cached --others --exclude-standard', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean).map((p) => p.split('/')[0])); } catch { return new Set(); }
}

/** 경로 하나를 판정한다. 반환 null = 허용, 문자열 = 거부 사유 */
export function judge(path, { root, cwd, scratchpad, config, tracked }) {
  if (!path) return null;
  const norm = (p) => p.replace(/^\/([a-zA-Z])\/(.*)$/, (m, d, r) => `${d.toUpperCase()}:/${r}`); // MSYS /d/x → D:/x
  path = norm(path);
  const abs = isAbsolute(path) ? path : resolve(cwd || root, path);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;                 // 저장소 밖 (scratchpad 포함)
  if (scratchpad && !relative(scratchpad, abs).startsWith('..')) return null;
  const relPosix = rel.split(sep).join('/');
  if (ALLOWED_DIR_RE.test(relPosix)) return null;
  if ((config.allowDirs || []).some((d) => relPosix === d || relPosix.startsWith(d.replace(/\/$/, '') + '/'))) return null;
  const top = relPosix.split('/')[0];
  const name = basename(relPosix);
  if (TEMP_RE.test(name)) return `임시 파일 이름(${name})은 ${config.scratchDir}/ 또는 세션 scratchpad에만 만든다 — 증거면 evidence/, 보존 자산이면 _assets/`;
  if (!relPosix.includes('/')) {
    const allow = new Set([...DEFAULT_ROOT_ALLOW, ...config.rootAllow, ...tracked]);
    if (!allow.has(top) && !existsSync(abs)) return `저장소 루트에 새 항목(${top})을 만들지 않는다 — 임시면 ${config.scratchDir}/, 영구면 rules/·docs/·src/ 아래. 루트가 필요하면 harness.yaml scratch.root_allow에 등재(ADR)`;
  }
  const seg = relPosix.split('/');
  if (seg[0] === 'docs' && seg.length > 1 && !DOCS_ALLOW.includes(seg[1]) && !(seg.length === 2 && /\.md$/.test(seg[1]))) return `docs/${seg[1]}/는 만들지 않는다 — docs/ 폴더는 ${DOCS_DIRS.join('·')}뿐. 기록은 자기 자리(ADR→decisions · RFC→research · FDR→features · HO→handoffs · 그 밖→records), 도메인 조건은 docs/specs/<name>.md`;
  if (seg[0] === 'rules' && seg.length > 1 && !RULES_ALLOW.includes(seg[1])) return `rules/${seg[1]}는 만들지 않는다 — rules/는 ${RULES_ALLOW.slice(0, 4).join('·')}뿐. 방법론은 .harness/ (템플릿에서만 고친다)`;
  return null;
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[guard-scratch] ${reason}` } }));
}

if (process.argv.includes('--self-test')) {
  const root = resolve('/repo');
  const ctx = { root, cwd: root, scratchpad: resolve('/tmp/sp'), config: { rootAllow: ['Makefile'], scratchDir: '.scratch' }, tracked: new Set(['src', 'README.md']) };
  const cases = [
    ['src/a.ts', null], ['.tmp-probe.mjs', 'deny'], ['.harness/scripts/probe-x.mjs', 'deny'], ['.scratch/probe-x.mjs', null], ['docs/features/FDR-1/evidence/run.log', null], ['docs/prompts/x.md', 'deny'], ['docs/decisions/ADR-1.md', null], ['docs/research/RFC-1/rfc.md', null], ['docs/handoffs/HO-1/request.md', null], ['docs/records/INC-1.md', null], ['docs/README.md', null], ['rules/packs/x.md', 'deny'], ['rules/domain/x.md', null],
    ['newfile.txt', 'deny'], ['Makefile', null], ['README.md', null], ['/tmp/sp/x.log', null], ['../outside/x.log', null], ['app/build.log', 'deny'], ['docs/x/_assets/a.log', null],
  ];
  let fail = 0;
  for (const [p, want] of cases) { const got = judge(p, ctx) ? 'deny' : null; if (got !== want) { fail++; console.error(`FAIL ${p}: want ${want} got ${got}`); } }
  const bt = writeTargets('node x.mjs > .tmp-out.log 2>&1; echo hi | tee -a app/build.log; cp a b.txt; mkdir -p .scratch/s; Out-File -FilePath C:\\x\\y.log');
  const wantT = ['.tmp-out.log', 'app/build.log', 'b.txt', '.scratch/s', 'C:\\x\\y.log'];
  if (JSON.stringify([...bt].sort()) !== JSON.stringify([...wantT].sort())) { fail++; console.error('FAIL targets', bt); }
  console.log(fail ? `self-test FAIL (${fail})` : `self-test OK (경로 ${cases.length} · Bash 대상 추출)`);
  process.exit(fail ? 1 : 0);
}

let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* */ }
let input = {}; try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }
const cwd = input.cwd || process.cwd();
let root = cwd; try { root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* git 밖 */ }
const ctx = { root, cwd, scratchpad: input.scratchpad_dir || process.env.CLAUDE_SCRATCHPAD_DIR || '', config: loadConfig(root), tracked: trackedRoot(root) };
const tool = input.tool_name || '';
const ti = input.tool_input || {};
let reason = null;
if (/^(Write|Edit|NotebookEdit)$/.test(tool)) reason = judge(ti.file_path || ti.notebook_path, ctx);
else if (tool === 'Bash') for (const t of writeTargets(ti.command)) { reason = judge(t, ctx); if (reason) break; }
if (process.env.GUARD_SCRATCH_DEBUG) console.error(JSON.stringify({ tool, root, cwd, scratchpad: ctx.scratchpad, trackedCount: ctx.tracked.size, reason }));
if (reason) deny(reason);
process.exit(0);
