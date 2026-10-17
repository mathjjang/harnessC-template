#!/usr/bin/env node
// check-session-log.mjs — Stop 훅. 오늘 커밋·수정이 닿은 기록 폴더(docs/records/*)에 session-log.md가 있는데 오늘자 행이 없으면 경고한다.
// session-log.md가 없는 기록(lite FDR·RFC·HO)은 본문 안에 로그를 두므로 검사하지 않는다. 차단하지 않는다(exit 0 + systemMessage). 강제 등급: report.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const today = new Date().toISOString().slice(0, 10);

export function findMissing(root, changedPaths, date = today, exists = existsSync, read = (p) => readFileSync(p, 'utf8')) {
  const touched = new Set();
  for (const p of changedPaths) { const m = p.replace(/\\/g, '/').match(/^docs\/records\/([A-Z]+-\d{6}-[^/]+)\//); if (m) touched.add(`docs/records/${m[1]}`); }
  const missing = [];
  for (const d of touched) { const log = join(root, d, 'session-log.md'); if (exists(log) && !read(log).includes(`| ${date} `)) missing.push(d); }
  return missing;
}

if (process.argv.includes('--self-test')) {
  const fake = { 'docs/records/FDR-260101-x/session-log.md': '| 2025-12-31 | a |' };
  const ex = (p) => Object.keys(fake).some((k) => p.replace(/\\/g, '/').endsWith(k));
  const rd = (p) => fake[Object.keys(fake).find((k) => p.replace(/\\/g, '/').endsWith(k))];
  const miss = findMissing('/r', ['docs/records/FDR-260101-x/03-impl.md', 'docs/records/FDR-260101-lite/fdr.md', 'src/a.ts'], '2026-01-01', ex, rd);
  const ok = miss.length === 1 && miss[0] === 'docs/records/FDR-260101-x';
  console.log(ok ? 'self-test OK (닿은 FDR 1건 검출 · lite 제외)' : 'self-test FAIL ' + JSON.stringify(miss));
  process.exit(ok ? 0 : 1);
}

let changed = [];
try { changed = execSync('git status --porcelain --untracked-files=all', { cwd: ROOT, encoding: 'utf8' }).split('\n').map((l) => l.slice(3).trim()).filter(Boolean); } catch { /* git 없음 */ }
const missing = findMissing(ROOT, changed);
if (missing.length) console.log(JSON.stringify({ systemMessage: `세션 로그 미기록: ${missing.join(', ')} — session-log.md에 오늘 행(완료·가설·미결·재개점)을 남기라 (.harness/HARNESS.md §8)` }));
process.exit(0);
