#!/usr/bin/env node
// sync-core.mjs — 템플릿의 코어(모든 프로젝트 동일 부분)를 이 프로젝트에 내려받는다. lint ⑫가 막은 차이를 푸는 유일한 길.
// 사용: node .harness/scripts/sync-core.mjs [--from <경로 | 주소@태그 | owner/repo@태그>] [--dry-run]
//   --from이 없으면 harness.yaml `upstream.repo`@`upstream.ref`(릴리스 태그)에서 받는다 — 로컬 clone 없이 정해진 버전을 내려받는 길. 받은 출처·SHA는 manifest에 남는다.
//   CORE_PATHS(lib/core-files.mjs)를 복사하고 {{PROJECT_NAME}}·{{TIER}}를 harness.yaml 값으로 치환한 뒤 .harness/init-manifest.json의 core 해시를 갱신한다.
//   프로젝트 고유 파일(rules/ · docs/ · harness.yaml · README.md)은 건드리지 않는다. --self-test: 임시 모형에서 복사·치환·해시 갱신 확인.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corePathsOf, hashCore, sha } from './lib/core-files.mjs';
import { fetchSource, readUpstream } from './lib/upstream.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();

export function sync(root, from, { dryRun = false, source = null } = {}) {
  if (!existsSync(join(from, '.harness', 'HARNESS.md'))) throw new Error(`템플릿이 아니다: ${from}`);
  const hy = readFileSync(join(root, 'harness.yaml'), 'utf8');
  const vars = { PROJECT_NAME: yamlScalar(hy, 'project').replace(/^"|"$/g, ''), TIER: yamlScalar(hy, 'tier') };
  const before = hashCore(root, corePathsOf(root));
  const paths = corePathsOf(from);   // 새 버전의 코어 목록 — 이번 릴리스에서 코어가 된 파일도 한 번에 내려온다
  if (!dryRun) {
    for (const rel of paths) {
      const src = join(from, rel); if (!existsSync(src)) continue;
      const dst = join(root, rel);
      if (statSync(src).isDirectory()) { rmSync(dst, { recursive: true, force: true }); cpSync(src, dst, { recursive: true, filter: (s) => !/init-manifest\.json$|[\\/]tiers([\\/]|$)/.test(s) }); }
      else { mkdirSync(dirname(dst), { recursive: true }); cpSync(src, dst); }
    }
    // 티어 오버레이(.harness 아래만 — 예: L의 templates/FDR-full) — 위에서 templates를 통째로 바꿨으므로 다시 얹는다. 안 하면 L 프로젝트가 FDR-full을 잃는다
    const ov = join(from, '.harness', 'tiers', vars.TIER || 'M', '.harness');
    if (existsSync(ov)) cpSync(ov, join(root, '.harness'), { recursive: true });
    // 치환은 프로젝트명이 들어가는 입구 파일 셋만 — 스크립트·템플릿·런북의 {{…}}는 원본 그대로여야 한다
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) { const p = join(root, f); if (!existsSync(p)) continue; const t = readFileSync(p, 'utf8'); const u = t.replace(/\{\{(PROJECT_NAME|TIER)\}\}/g, (m, k) => vars[k] || m); if (u !== t) writeFileSync(p, u); }
  }
  let after;
  if (dryRun) {
    after = hashCore(from, paths);
    // 티어 오버레이도 센다 — 실제 동기화가 얹는 것과 같게
    const ov = join(from, '.harness', 'tiers', vars.TIER || 'M', '.harness');
    const walk = (d, rel) => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name), r2 = `${rel}/${e.name}`; if (e.isDirectory()) walk(f, r2); else if (!/\.gitkeep$/.test(e.name)) after[`.harness${r2}`] = sha(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')); } };
    walk(ov, '');
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) if (existsSync(join(from, f))) after[f] = sha(readFileSync(join(from, f), 'utf8').replace(/\r\n/g, '\n').replace(/\{\{(PROJECT_NAME|TIER)\}\}/g, (m, k) => vars[k] || m)); }
  else after = hashCore(root, paths);
  const changed = Object.keys({ ...before, ...after }).filter((f) => before[f] !== after[f]);
  if (!dryRun) {
    const mp = join(root, '.harness', 'init-manifest.json');
    const m = existsSync(mp) ? JSON.parse(readFileSync(mp, 'utf8')) : { schema: 'harnessC.init-manifest', version: 2 };
    m.core = after; m.coreVersion = yamlScalar(readFileSync(join(from, 'harness.yaml'), 'utf8'), 'harness'); m.syncedAt = new Date().toISOString().slice(0, 10);
    if (source) m.upstream = { source: source.label, sha: source.sha };   // 어디서 어떤 커밋을 받았나 — 재현 근거
    writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
    // 런타임 입구(.claude/skills 등)는 코어가 아니라 생성물 — 내려받은 런북으로 다시 만든다
    const hb = join(root, '.harness', 'scripts', 'harness-build.mjs');
    if (existsSync(hb)) { try { execSync(`"${process.execPath}" "${hb}"`, { cwd: root, stdio: 'ignore' }); } catch { /* pre-commit --check가 알린다 */ } }
  }
  return { changed, vars };
}

if (process.argv.includes('--self-test')) {
  const tmp = join(HERE, '..', '.sync-selftest'); rmSync(tmp, { recursive: true, force: true });
  const tpl = join(tmp, 'tpl'), proj = join(tmp, 'proj');
  for (const d of ['.harness/scripts/lib', '.claude/hooks']) { mkdirSync(join(tpl, d), { recursive: true }); mkdirSync(join(proj, d), { recursive: true }); }
  writeFileSync(join(tpl, '.harness', 'HARNESS.md'), '# core v2\n'); writeFileSync(join(tpl, 'AGENTS.md'), '# AGENTS — {{PROJECT_NAME}}\n'); writeFileSync(join(tpl, 'harness.yaml'), 'harness: 0.2.0\n');
  writeFileSync(join(tpl, '.claude', 'hooks', 'g.mjs'), 'v2'); writeFileSync(join(tpl, '.harness', 'scripts', 'x.mjs'), 'v2');
  writeFileSync(join(proj, '.harness', 'HARNESS.md'), '# core v1\n'); writeFileSync(join(proj, 'AGENTS.md'), '# AGENTS — old\n'); writeFileSync(join(proj, 'harness.yaml'), 'harness: 0.1.0\nproject: "p1"\ntier: S\n');
  writeFileSync(join(proj, 'rules-keep.md'), 'mine'); writeFileSync(join(proj, '.harness', 'scripts', 'stale.mjs'), 'old');
  const fails = [];
  try {
    const r = sync(proj, tpl);
    if (!/core v2/.test(readFileSync(join(proj, '.harness', 'HARNESS.md'), 'utf8'))) fails.push('코어 미복사');
    if (!/AGENTS — p1/.test(readFileSync(join(proj, 'AGENTS.md'), 'utf8'))) fails.push('치환 누락');
    if (!/v2/.test(readFileSync(join(proj, '.harness', 'scripts', 'x.mjs'), 'utf8'))) fails.push('스크립트 미복사');
    if (existsSync(join(proj, '.harness', 'scripts', 'stale.mjs'))) fails.push('낡은 코어 파일 잔존');
    if (!existsSync(join(proj, 'rules-keep.md'))) fails.push('프로젝트 파일 손상');
    const m = JSON.parse(readFileSync(join(proj, '.harness', 'init-manifest.json'), 'utf8'));
    if (m.coreVersion !== '0.2.0' || !m.core['.harness/HARNESS.md'] || !r.changed.length) fails.push('manifest 미갱신');
    if (JSON.stringify(hashCore(proj)) !== JSON.stringify(m.core)) fails.push('해시 불일치');
    // 티어 L 오버레이 — templates 통째 교체 뒤에도 FDR-full이 남는다 · dry-run이 오버레이를 셈
    mkdirSync(join(tpl, '.harness', 'tiers', 'L', '.harness', 'templates', 'FDR-full'), { recursive: true }); writeFileSync(join(tpl, '.harness', 'tiers', 'L', '.harness', 'templates', 'FDR-full', '01-spec.md'), 'full');
    // 먼저 S로 동기화 직후 dry-run = 변경 0 (오버레이 추가 전 상태)
    if (sync(proj, tpl, { dryRun: true }).changed.length) fails.push('동기화 직후 dry-run이 변경을 보고');
    writeFileSync(join(proj, 'harness.yaml'), 'harness: 0.1.0\nproject: "p1"\ntier: L\n'); sync(proj, tpl);
    if (!existsSync(join(proj, '.harness', 'templates', 'FDR-full', '01-spec.md'))) fails.push('L 오버레이 유실');
    if (sync(proj, tpl, { dryRun: true }).changed.length) fails.push('L dry-run이 오버레이를 변경으로 봄');
    // 새 버전에서 코어가 된 파일 — 템플릿의 core-files.mjs가 목록을 늘리면 한 번의 동기화로 내려와야 한다(받는 쪽 옛 목록이 아니라)
    writeFileSync(join(tpl, '.harness', 'scripts', 'lib', 'core-files.mjs'), "export const CORE_PATHS = [\n  '.harness/HARNESS.md', '.harness/NEWCORE', // 주석 'x'\n  '.harness/scripts', '.claude/hooks', 'AGENTS.md',\n];\n");
    writeFileSync(join(tpl, '.harness', 'NEWCORE'), 'new');
    sync(proj, tpl);
    if (!existsSync(join(proj, '.harness', 'NEWCORE'))) fails.push('새 코어 파일이 한 번에 안 내려옴');
    if (!JSON.parse(readFileSync(join(proj, '.harness', 'init-manifest.json'), 'utf8')).core['.harness/NEWCORE']) fails.push('새 코어 파일이 manifest에 없음');
    if (corePathsOf(tpl).includes('x')) fails.push('주석 안 문자열을 경로로 읽음');
  } catch (e) { fails.push('예외: ' + e.message); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (복사·치환·낡은 파일 제거·프로젝트 파일 보존·manifest · 티어 L 오버레이 보존·dry-run · 새 코어 경로 한 번에)');
  process.exit(fails.length ? 1 : 0);
}

const ROOT = join(HERE, '..', '..');
const i = process.argv.indexOf('--from');
const up = readUpstream(ROOT);
const spec = i >= 0 ? process.argv[i + 1] : up.repo ? `${up.repo}${up.ref ? '@' + up.ref : ''}` : '';
if (!spec) { console.error('사용: node .harness/scripts/sync-core.mjs [--from <경로 | 주소@태그 | owner/repo@태그>] [--dry-run]\n--from이 없으면 harness.yaml upstream.repo / upstream.ref 를 쓴다 — 둘 다 비어 있다'); process.exit(2); }
let src;
try { src = fetchSource(spec, { cwd: ROOT }); } catch (e) { console.error(e.message); process.exit(1); }
try {
  const r = sync(ROOT, src.dir, { dryRun: process.argv.includes('--dry-run'), source: src });
  console.log(`${process.argv.includes('--dry-run') ? '[dry-run] ' : ''}출처 ${src.label}${src.sha ? ` (${src.sha.slice(0, 7)})` : ''} · 코어 ${r.changed.length}개 파일 갱신${r.changed.length ? ':\n  ' + r.changed.join('\n  ') : ''}`);
} catch (e) { console.error(e.message); process.exit(1); } finally { src.cleanup(); }
