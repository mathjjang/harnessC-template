#!/usr/bin/env node
// guard-reference.mjs — PreToolUse 훅 (Write|Edit|NotebookEdit). 참조 저장소(harness.yaml `references`)에 대한 쓰기를 쓰기 전에 판정한다.
//
//   mode: read-only(기본)  → 모든 쓰기 거부 (AGENTS.md "참조 저장소는 읽되 고치지 않는다")
//   trust: external        → ① writable 폴더 밖 거부
//                            ② 내용에 개발 저장소 경로(docs/decisions/ …)·기록 ID(FDR-·ADR-·RFC-·PLAN-·PG-·INC-)가 있으면 거부 (원칙 14 — 의존은 한 방향)
//                            ③ ask_words(기본 원가·공수·내부 판단)가 있으면 사람에게 묻는다(ask)
// 막지 않는 것: 개발 저장소 안 · 등록되지 않은 경로 · mode: read-write이면서 trust가 external이 아닌 저장소
// 자기 검사: node .claude/hooks/guard-reference.mjs --self-test
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReferences } from '../../scripts/lib/refs.mjs';

const DEV_MARK_RE = /docs\/(decisions|features|research|plans|queue|specs|incidents)\/|\b(FDR|ADR|RFC|PLAN|PG|INC)-\d{6}-[a-z0-9-]+/;
const DEFAULT_ASK = ['원가', '공수', '내부 판단'];
const norm = (p) => String(p).replace(/^\/([a-zA-Z])\/(.*)$/, (m, d, r) => `${d.toUpperCase()}:/${r}`); // MSYS /d/x → D:/x

/** 반환 null = 허용, { decision: 'deny'|'ask', reason } */
export function judge(path, content, { root, cwd, refs }) {
  if (!path) return null;
  const abs = isAbsolute(norm(path)) ? norm(path) : resolve(cwd || root, norm(path));
  for (const ref of refs) {
    const refAbs = resolve(root, norm(ref.path));
    const rel = relative(refAbs, abs);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    const mode = ref.mode || 'read-only';
    if (mode === 'read-only') return { decision: 'deny', reason: `참조 저장소 ${ref.path}는 읽기 전용(mode: ${mode}) — 결함은 그 저장소 담당에게` };
    if (ref.trust !== 'external') return null;
    const relPosix = rel.split(sep).join('/');
    const w = (ref.writable || []).map((d) => d.replace(/\/$/, ''));
    if (w.length && !w.some((d) => relPosix === d || relPosix.startsWith(d + '/'))) return { decision: 'deny', reason: `외부 협업 저장소 ${ref.path}에는 writable(${w.join(' ')}) 폴더에만 쓴다 — 다른 폴더가 필요하면 harness.yaml references.writable 등재(ADR)` };
    const text = String(content || '');
    const mark = text.match(DEV_MARK_RE);
    if (mark) return { decision: 'deny', reason: `외부 협업 저장소에 개발 저장소 참조(${mark[0]})를 쓰지 않는다 — 의존은 개발→협업 한 방향(원칙 14). DEC·MTG ID만 인용 가능` };
    const words = ref.ask_words && ref.ask_words.length ? ref.ask_words : DEFAULT_ASK;
    const hit = words.find((wd) => text.includes(wd));
    if (hit) return { decision: 'ask', reason: `외부 협업 저장소 ${ref.path}에 "${hit}"가 들어간다 — 상대 조직이 봐도 되는 내용인지 확인` };
    return null;
  }
  return null;
}

function emit(d) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision, permissionDecisionReason: `[guard-reference] ${d.reason}` } }));
}

if (process.argv.includes('--self-test')) {
  const root = resolve('/repo');
  const refs = [
    { path: '../collab', role: 'collab', trust: 'external', mode: 'read-write', writable: ['meetings/', 'decisions/'], ask_words: ['원가'] },
    { path: '../ro', mode: 'read-only' },
    { path: '../rw', mode: 'read-write' },
  ];
  const ctx = { root, cwd: root, refs };
  const cases = [
    ['/collab/meetings/MTG-261016-kickoff/agenda.md', '안건', null],
    ['/collab/requirements/x.md', '요구', 'deny'],
    ['/collab/meetings/x.md', '근거 docs/decisions/0001.md', 'deny'],
    ['/collab/decisions/DEC-261016-x.md', '출처 FDR-261016-foo', 'deny'],
    ['/collab/decisions/DEC-261016-x.md', '출처 MTG-261016-kickoff', null],
    ['/collab/meetings/x.md', '원가 800만', 'ask'],
    ['/ro/x.md', '', 'deny'],
    ['/rw/x.md', 'FDR-261016-foo', null],
    ['/repo/docs/x.md', 'FDR-261016-foo', null],
    ['../other/x.md', '', null],
  ];
  let fail = 0;
  for (const [p, c, want] of cases) { const got = (judge(p, c, ctx) || {}).decision || null; if (got !== want) { fail++; console.error(`FAIL ${p}: want ${want} got ${got}`); } }
  console.log(fail ? `self-test FAIL (${fail})` : `self-test OK (경로·내용 ${cases.length}건)`);
  process.exit(fail ? 1 : 0);
}

let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* */ }
let input = {}; try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }
const tool = input.tool_name || '';
if (!/^(Write|Edit|NotebookEdit)$/.test(tool)) process.exit(0);
const cwd = input.cwd || process.cwd();
let root = cwd; try { root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* git 밖 */ }
const hyPath = resolve(root, 'harness.yaml');
const hy = existsSync(hyPath) ? readFileSync(hyPath, 'utf8') : (existsSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../harness.yaml')) ? readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../harness.yaml'), 'utf8') : '');
const refs = parseReferences(hy);
if (!refs.length) process.exit(0);
const ti = input.tool_input || {};
const d = judge(ti.file_path || ti.notebook_path, ti.content ?? ti.new_string ?? ti.new_source ?? '', { root, cwd, refs });
if (d) emit(d);
process.exit(0);
