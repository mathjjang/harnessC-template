// records.mjs — 기록 종류별 자리. 자주 여는 네 종류는 docs/ 바로 아래 자기 폴더, 나머지는 docs/records.
// new-doc · lint · build-index · harness-status · work · check-branch-record · check-session-log · 훅(guard-scratch·guard-role-write)이 공유한다 (사유 — 판정은 호출자가 한다).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const RECORD_DIRS = { ADR: 'docs/decisions', RFC: 'docs/research', FDR: 'docs/features', HO: 'docs/handoffs', PLAN: 'docs/records', INC: 'docs/records', RETRO: 'docs/records', MTG: 'docs/records' };
export const RECORD_ROOTS = [...new Set(Object.values(RECORD_DIRS))];
/** docs/ 하위 고정 폴더 (lint ⑬ · guard-scratch · init · new-doc self-test가 같은 목록을 본다) */
export const DOCS_DIRS = ['requirements', 'decisions', 'research', 'features', 'handoffs', 'records', 'specs', 'queue'];
export const ID_RE = /^[A-Z]+-\d{6}-/;
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
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : `self-test OK (자리 ${RECORD_ROOTS.length}곳 · 경로 매칭)`);
  process.exit(fails.length ? 1 : 0);
}
