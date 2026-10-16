#!/usr/bin/env node
// check-session-log.mjs — Stop 훅. 오늘 커밋·수정이 닿은 활성 FDR/RFC/PLAN 폴더에 오늘자 session-log 행이 없으면 경고한다.
// 차단하지 않는다(exit 0 + systemMessage). 강제 등급: report. --self-test 보유.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const today = new Date().toISOString().slice(0, 10);

export function findMissing(root, changedPaths, date = today) {
  const touched = new Set();
  for (const p of changedPaths) { const m = p.replace(/\\/g, '/').match(/^docs\/(features|research|plans)\/([^/]+)\//); if (m) touched.add(`docs/${m[1]}/${m[2]}`); }
  const missing = [];
  for (const d of touched) { const log = join(root, d, 'session-log.md'); if (!existsSync(log) || !readFileSync(log, 'utf8').includes(`| ${date} `)) missing.push(d); }
  return missing;
}

if (process.argv.includes('--self-test')) {
  const miss = findMissing('/nonexistent', ['docs/features/FDR-260101-x/05-impl.md', 'src/a.ts'], '2026-01-01');
  const ok = miss.length === 1 && miss[0] === 'docs/features/FDR-260101-x';
  console.log(ok ? 'self-test OK (닿은 FDR 1건 검출)' : 'self-test FAIL ' + JSON.stringify(miss));
  process.exit(ok ? 0 : 1);
}

let changed = [];
try { changed = execSync('git status --porcelain --untracked-files=all', { cwd: ROOT, encoding: 'utf8' }).split('\n').map((l) => l.slice(3).trim()).filter(Boolean); } catch { /* git 없음 */ }
const missing = findMissing(ROOT, changed);
if (missing.length) console.log(JSON.stringify({ systemMessage: `세션 로그 미기록: ${missing.join(', ')} — session-log.md에 오늘 행(완료·가설·미결·재개점)을 남기라 (rules/HARNESS.md §8)` }));
process.exit(0);
