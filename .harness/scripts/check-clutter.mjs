#!/usr/bin/env node
// check-clutter.mjs — 잡동사니 게이트·보고·정리 (rules/HARNESS.md §8 임시 파일 규율).
//   (기본)      pre-commit: 스테이징된 파일 중 임시 패턴·루트 신규 항목이 있으면 exit 1
//   --report    루트·.harness/scripts/의 미추적 잡동사니와 .scratch/ 오래된 항목 수를 한 줄로 (세션 카드용). baseline 등재분은 "기존"으로 구분
//   --archive [--apply]  루트 잡동사니를 .scratch/archive-<날짜>/ 로 이동 (기본 dry-run)
//   --gc <days> [--apply]  .scratch/ 에서 <days>일 넘은 항목 삭제 (기본 dry-run)
//   --self-test
// baseline: .harness/scripts/clutter-baseline.json (있으면 그 이름들은 차단 대상이 아니라 보고 대상 — 래칫: 늘지 않는다)
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(HERE, '..', '..');
const TEMP_RE = /^(\.?tmp[-_.]?|probe-|sweep-|watch-|scratch)|(\.log|\.bak|~|-test\d+\.[a-z]+)$/i;
const ALLOWED_DIR_RE = /(^|\/)(\.scratch|evidence|_assets|node_modules|\.git)(\/|$)/;
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => (has(f) ? args[args.indexOf(f) + 1] : undefined);

function baseline(root) { const p = join(root, '.harness', 'clutter-baseline.json'); if (!existsSync(p)) return new Set(); try { return new Set(JSON.parse(readFileSync(p, 'utf8')).items || []); } catch { return new Set(); } }
function scratchDir(root) { const hy = existsSync(join(root, 'harness.yaml')) ? readFileSync(join(root, 'harness.yaml'), 'utf8') : ''; return (hy.match(/^scratch:[\s\S]*?dir:\s*(\S+)/m) || [])[1] || '.scratch'; }
export function isClutter(relPosix) { if (ALLOWED_DIR_RE.test(relPosix)) return false; return TEMP_RE.test(basename(relPosix)); }

export function scan(root) {
  const base = baseline(root);
  const items = [];
  for (const e of readdirSync(root, { withFileTypes: true })) { if (['.git', 'node_modules'].includes(e.name)) continue; if (TEMP_RE.test(e.name) && !/^\.scratch$/.test(e.name)) items.push({ path: e.name, where: 'root', known: base.has(e.name) }); }
  for (const rel of ['scripts', '.harness/scripts']) { const sd = join(root, rel); if (existsSync(sd)) for (const f of readdirSync(sd)) if (TEMP_RE.test(f)) items.push({ path: `${rel}/${f}`, where: 'scripts', known: base.has(`${rel}/${f}`) }); }
  const sc = join(root, scratchDir(root));
  let old = 0, total = 0;
  if (existsSync(sc)) for (const f of readdirSync(sc)) { if (f === 'README.md') continue; total++; const age = (Date.now() - statSync(join(sc, f)).mtimeMs) / 86400000; if (age > 14) old++; }
  return { items, scratch: { total, old } };
}

if (has('--self-test')) {
  const tmp = join(HERE, '..', '.clutter-selftest'); rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'scripts'), { recursive: true }); mkdirSync(join(tmp, '.harness', 'scripts'), { recursive: true }); mkdirSync(join(tmp, '.scratch'), { recursive: true });
  for (const f of ['.tmp-a.log', 'probe-b.mjs', 'ok.md']) writeFileSync(join(tmp, f), '');
  writeFileSync(join(tmp, 'scripts', 'sweep-c.mjs'), ''); writeFileSync(join(tmp, 'scripts', 'good.mjs'), ''); writeFileSync(join(tmp, '.harness', 'scripts', 'probe-d.mjs'), '');
  writeFileSync(join(tmp, '.scratch', 'x.log'), '');
  writeFileSync(join(tmp, '.harness', 'clutter-baseline.json'), JSON.stringify({ items: ['.tmp-a.log'] }));
  const r = scan(tmp); rmSync(tmp, { recursive: true, force: true });
  const names = r.items.map((i) => `${i.path}:${i.known ? 'known' : 'new'}`).sort().join(',');
  const want = '.harness/scripts/probe-d.mjs:new,.tmp-a.log:known,probe-b.mjs:new,scripts/sweep-c.mjs:new';
  const okStaged = isClutter('src/.tmp-x.mjs') && !isClutter('docs/f/evidence/run.log') && !isClutter('.scratch/a.log') && !isClutter('src/ok.ts');
  const ok = names === want && okStaged && r.scratch.total === 1;
  console.log(ok ? 'self-test OK (루트·scripts 검출 · baseline 구분 · 허용 구역 제외)' : `self-test FAIL ${names} staged=${okStaged} scratch=${JSON.stringify(r.scratch)}`);
  process.exit(ok ? 0 : 1);
}

if (has('--report')) {
  const r = scan(ROOT); const fresh = r.items.filter((i) => !i.known).length; const known = r.items.length - fresh;
  console.log(`잡동사니: 신규 ${fresh}${known ? ` · 기존(baseline) ${known}` : ''} · ${scratchDir(ROOT)}/ ${r.scratch.total}개(14일↑ ${r.scratch.old})${fresh ? '  → node .harness/scripts/check-clutter.mjs --archive --apply' : ''}`);
  process.exit(0);
}
if (has('--archive')) {
  const r = scan(ROOT); const dest = join(ROOT, scratchDir(ROOT), `archive-${new Date().toISOString().slice(0, 10)}`);
  const targets = r.items.filter((i) => i.where === 'root');
  if (!targets.length) { console.log('루트 잡동사니 없음'); process.exit(0); }
  console.log(`${has('--apply') ? '이동' : '[dry-run] 이동 예정'} ${targets.length}건 → ${dest}`);
  if (has('--apply')) { mkdirSync(dest, { recursive: true }); for (const t of targets) renameSync(join(ROOT, t.path), join(dest, basename(t.path))); console.log('완료. baseline이 있으면 갱신: node .harness/scripts/check-clutter.mjs --rebaseline'); }
  else for (const t of targets) console.log('  ' + t.path);
  process.exit(0);
}
if (has('--rebaseline')) { const r = scan(ROOT); writeFileSync(join(ROOT, '.harness', 'clutter-baseline.json'), JSON.stringify({ _why: '기존 잡동사니 래칫 — 줄기만 한다. 신규 등재는 우회다.', date: new Date().toISOString().slice(0, 10), items: r.items.map((i) => i.path) }, null, 2) + '\n'); console.log(`baseline ${r.items.length}건 기록`); process.exit(0); }
if (has('--gc')) {
  const days = Number(val('--gc') || 14); const sc = join(ROOT, scratchDir(ROOT)); if (!existsSync(sc)) process.exit(0);
  const victims = readdirSync(sc).filter((f) => f !== 'README.md' && (Date.now() - statSync(join(sc, f)).mtimeMs) / 86400000 > days);
  console.log(`${has('--apply') ? '삭제' : '[dry-run] 삭제 예정'} ${victims.length}건 (${days}일↑): ${victims.join(', ')}`);
  if (has('--apply')) for (const f of victims) rmSync(join(sc, f), { recursive: true, force: true });
  process.exit(0);
}

// 기본: pre-commit 게이트
let staged = [];
try { staged = execSync('git diff --cached --name-only --diff-filter=A', { cwd: ROOT, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean); } catch { /* */ }
const base = baseline(ROOT);
const bad = staged.filter((p) => !base.has(p) && (isClutter(p) || (!p.includes('/') && TEMP_RE.test(p))));
if (bad.length) { console.log('[check-clutter] 임시 파일을 커밋하지 않는다 — ' + scratchDir(ROOT) + '/ 또는 evidence/ 로: ' + bad.join(', ')); process.exit(1); }
const r = scan(ROOT); const fresh = r.items.filter((i) => !i.known);
if (fresh.length) console.log(`[check-clutter] (경고) 미추적 잡동사니 ${fresh.length}건: ${fresh.slice(0, 5).map((i) => i.path).join(', ')}${fresh.length > 5 ? ' …' : ''} → node .harness/scripts/check-clutter.mjs --archive --apply`);
process.exit(0);
