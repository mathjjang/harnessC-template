// records.mjs — 기록 종류별 자리. 자주 여는 네 종류는 docs/ 바로 아래 자기 폴더, 나머지는 docs/records.
// new-doc · lint · build-index · harness-status · work · check-branch-record · check-session-log · 훅(guard-scratch·guard-role-write)이 공유한다 (사유 — 판정은 호출자가 한다).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export const RECORD_DIRS = { ADR: 'docs/decisions', RFC: 'docs/research', FDR: 'docs/features', HO: 'docs/handoffs', PLAN: 'docs/records', INC: 'docs/records', RETRO: 'docs/records', MTG: 'docs/records' };
export const RECORD_ROOTS = [...new Set(Object.values(RECORD_DIRS))];
/** docs/ 하위 고정 폴더 (lint ⑬ · guard-scratch · init · new-doc self-test가 같은 목록을 본다) */
export const DOCS_DIRS = ['requirements', 'decisions', 'research', 'features', 'handoffs', 'records', 'specs', 'queue'];
export const ID_RE = /^[A-Z]+-\d{6}-/;
/** 담당 검사(lint ⑤) 기본 시작일 — ID 날짜(YYMMDD)가 이 날부터인 기록. 프로젝트는 harness.yaml ids.owner_from으로 바꾼다(늦게 동기화한 프로젝트의 사이 기록 면제) */
export const OWNER_FROM = '261117';
/** 작성 줄에 담당이 있는가 — `작성: <에이전트(모델)> · 담당 <사람> · <날짜>`. 에이전트가 먼저다(ci가 첫 · 앞을 작성자로 읽어 리뷰어와 견준다) */
export const OWNER_RE = /작성[:：][^\n·]+·\s*담당\s+[^\s·|]/;
/** 담당 = 그 세션을 돌리는 사람. 명시 값 → HARNESS_OWNER → 그 저장소의 git config user.name(커밋 작성자와 같은 이름). 없으면 '' */
export function ownerOf(root, explicit) {
  const clean = (s) => String(s || '').replace(/[\r\n·|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean(explicit)) return clean(explicit);
  if (clean(process.env.HARNESS_OWNER)) return clean(process.env.HARNESS_OWNER);
  try { return clean(execSync('git config user.name', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return ''; }
}
/** 귀속 값에 담당을 붙인다. 이미 붙어 있거나 담당을 모르면 그대로 */
export const withOwner = (agent, owner) => (/·\s*담당\s+\S/.test(String(agent)) || !owner ? agent : `${agent} · 담당 ${owner}`);
/** 기록 경로 매칭: [1]=docs/<자리>, [2]=<ID 또는 ID.md> */
export const RECORD_PATH_RE = new RegExp('^(docs/(?:' + RECORD_ROOTS.map((d) => d.slice(5)).join('|') + '))/([A-Z]+-[0-9]{6}-[^/]+)');
export const recordDir = (id) => RECORD_DIRS[String(id).split('-')[0]] || 'docs/records';
export const recordRel = (id) => `${recordDir(id)}/${id}`;
/** 모든 기록 [{ name, dir, path }] — name은 폴더명 또는 파일명(.md 포함), dir은 docs/… 자리. 이름순 */
export function listRecords(root) {
  const out = [];
  for (const dir of RECORD_ROOTS) { const d = join(root, dir); if (!existsSync(d)) continue; for (const n of readdirSync(d)) if (ID_RE.test(n)) out.push({ name: n, id: n.replace(/\.md$/, ''), dir, path: join(d, n) }); }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

if (process.argv.includes('--self-test') && /records.mjs$/.test(process.argv[1] || '')) {
  const fails = [];
  if (recordDir('ADR-260101-x') !== 'docs/decisions' || recordDir('FDR-260101-x') !== 'docs/features' || recordDir('RFC-260101-x') !== 'docs/research' || recordDir('HO-260101-x') !== 'docs/handoffs' || recordDir('INC-260101-x') !== 'docs/records' || recordDir('XX-1') !== 'docs/records') fails.push('recordDir');
  const m = 'docs/features/FDR-260101-x/fdr.md'.match(RECORD_PATH_RE); if (!m || m[1] !== 'docs/features' || m[2] !== 'FDR-260101-x') fails.push('RECORD_PATH_RE 폴더');
  const m2 = 'docs/decisions/ADR-260101-x.md'.match(RECORD_PATH_RE); if (!m2 || m2[2] !== 'ADR-260101-x.md') fails.push('RECORD_PATH_RE 파일');
  if (RECORD_PATH_RE.test('docs/specs/x/spec.md') || RECORD_PATH_RE.test('src/FDR-260101-x')) fails.push('RECORD_PATH_RE 오탐');
  if (!RECORD_ROOTS.every((d) => DOCS_DIRS.includes(d.slice(5)))) fails.push('RECORD_ROOTS ⊄ DOCS_DIRS');
  if (withOwner('A (m)', 'kim') !== 'A (m) · 담당 kim' || withOwner('A (m) · 담당 lee', 'kim') !== 'A (m) · 담당 lee' || withOwner('A (m)', '') !== 'A (m)') fails.push('withOwner');
  if (ownerOf('.', ' kim·a|b\n') !== 'kim a b') fails.push('ownerOf 명시 값 정리');
  if (!OWNER_RE.test('- 작성: A (m) · 담당 kim · 2026-01-01') || OWNER_RE.test('- 작성: A (m) · 2026-01-01') || OWNER_RE.test('- 작성: 담당 kim · A (m) · 2026-01-01') || OWNER_RE.test('- 작성: A (m) · 담당  · 2026-01-01')) fails.push('OWNER_RE');
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : `self-test OK (자리 ${RECORD_ROOTS.length}곳 · 경로 매칭 · 담당 붙이기·검사)`);
  process.exit(fails.length ? 1 : 0);
}
