#!/usr/bin/env node
// mockup-diff.mjs — 확정 목업 ↔ 구현 화면 승인본 픽셀 대조 (.harness/HARNESS.md §6 · ADR-261017-mockup-diff). V2 ADR-0097 · backstop.mockup.config · record-mockup-diff의 코어 이식.
//
//   promote <FDR-ID> <목업 폴더> [--by "<에이전트>"]   확정 목업을 docs/features/<FDR>/mockup/ 으로 승격(사본 + rev.yaml 스탬프 — rev+1). 코드보다 먼저.
//   run     <FDR-ID>|--all [--state <이름>]          상태마다 목업(file://)을 기준본으로 다시 찍고 구현(<origin_env> + path)을 찍어 BackstopJS로 비교
//                                                    → evidence/mockup-diff/rev<N>/results.json + 캡처(구현 전건 · 기준본·diff는 초과 건만)
//   engine  [--install]                              엔진 위치 확인 · PC당 1회 설치(~/.harness/tools — 프로젝트마다 설치하지 않는다)
//   check   [<FDR-ID>|--all]                         완료 게이트(lint ⑯과 같은 검사): shipped·closed인데 같은 rev의 기록이 없거나·미커버·초과 미등재·캡처 위조면 위반
//
// 설정 harness.yaml `mockup:` — origin_env(구현 오리진을 담은 환경변수 **이름** · 값은 적지 않는다, 폴백 없음) · viewport · threshold(%) · wait(ms) · login(캡처 전 로그인 모듈 경로, 프로젝트 소유).
// 엔진 backstopjs(+playwright)는 PC에 한 번 설치해 전 프로젝트가 빌려 쓴다(HARNESS_BACKSTOP → 프로젝트 → ~/.harness/tools → npm -g 순으로 찾는다) — 코어·프로젝트에는 설치하지 않는다. promote·check·self-test는 엔진이 필요 없다.
// 기준본은 매 실행 목업에서 다시 찍는다(backstop reference → test). 저장된 기준본·approve는 없다: 낡은 기준본과 비교한 거짓 수치(V2 2026-08-06)를 구조로 막는다.
// 판정은 숫자다 — 에이전트의 이미지 판독 "일치" 단정은 판정이 아니다.
// 시나리오 정본 mockup/diff-scenarios.json — [{ state, path, clicks[], keypress[{selector,text}], clicksAfter[], selectors[](대조 범위), hide[], remove[], excluded:"사유" }]
//   도달 불가 상태는 excluded + 사유(침묵 축소 금지). 전 상태 excluded는 통과가 아니다. 승인된 차이는 mockup/deviations.json [{ state, reason, approved_by, date }].
// --self-test: promote·설정 생성·기록기·check를 엔진 없이 검증한다.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { RECORD_DIRS, recordDir } from './lib/records.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
const frontmatter = (t) => (t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
const today = () => new Date().toISOString().slice(0, 10);
const posix = (p) => p.split('\\').join('/');

// ---------- 설정 ----------
export function mockupConfig(root) {
  const hy = rd(join(root, 'harness.yaml'));
  const block = (hy.match(/^mockup:\s*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '';
  const v = (k, d) => { const m = block.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')); const x = m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; return x || d; };
  const [w, h] = v('viewport', '1440x900').split('x').map(Number);
  const scratch = ((hy.match(/^scratch:\s*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '').match(/^\s*dir:\s*(\S+)/m)?.[1] || '.scratch';
  return { originEnv: v('origin_env', 'APP_ORIGIN'), viewport: { width: w || 1440, height: h || 900 }, threshold: Number(v('threshold', '0.01')), wait: Number(v('wait', '1000')), login: v('login', ''), scratch };
}

// ---------- 기록 읽기 ----------
const fdrDirOf = (root, id) => join(root, recordDir(id), id);
function fdrStatus(dir) { const m = rd(join(dir, 'manifest.yaml')); return yamlScalar(m || frontmatter(rd(join(dir, 'fdr.md'))), 'status'); }
export function readRev(dir) {
  const t = rd(join(dir, 'mockup', 'rev.yaml')); if (!t) return null;
  const files = {}; for (const m of t.matchAll(/^  ([^:\n]+\.html):\s*([0-9a-f]{64})\s*$/gm)) files[m[1]] = m[2];
  return { rev: Number(yamlScalar(t, 'rev')) || 0, promoted: yamlScalar(t, 'promoted'), source: yamlScalar(t, 'source'), files };
}
export function readScenarios(dir) { const p = join(dir, 'mockup', 'diff-scenarios.json'); if (!existsSync(p)) return null; return JSON.parse(rd(p)).filter((s) => s && s.state); }
const readDeviations = (dir) => { const p = join(dir, 'mockup', 'deviations.json'); return existsSync(p) ? JSON.parse(rd(p)) : []; };
const evidenceDir = (dir, rev) => join(dir, 'evidence', 'mockup-diff', `rev${rev}`);
const resultsPath = (dir, rev) => join(evidenceDir(dir, rev), 'results.json');
function listFdrs(root) { const d = join(root, RECORD_DIRS.FDR); return existsSync(d) ? readdirSync(d).filter((n) => /^FDR-\d{6}-/.test(n) && statSync(join(d, n)).isDirectory()).map((n) => join(d, n)) : []; }

// ---------- promote ----------
export function promote(root, fdrId, srcDir, { by = '(모델 미확인)' } = {}) {
  const dir = fdrDirOf(root, fdrId);
  if (!existsSync(dir)) throw new Error(`FDR이 없다: ${posix(relative(root, dir))} — 먼저 node .harness/scripts/new-doc.mjs fdr`);
  const src = resolve(root, srcDir);
  if (!existsSync(src) || !readdirSync(src).some((f) => f.endsWith('.html'))) throw new Error(`목업 폴더에 .html이 없다: ${srcDir}`);
  const dst = join(dir, 'mockup');
  const prev = readRev(dir); const rev = (prev ? prev.rev : 0) + 1;
  const keep = ['diff-scenarios.json', 'deviations.json'].filter((f) => existsSync(join(dst, f))).map((f) => [f, readFileSync(join(dst, f))]);
  rmSync(dst, { recursive: true, force: true }); mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true, filter: (s) => !/node_modules|\.git($|[\\/])/.test(s) });
  for (const [f, b] of keep) writeFileSync(join(dst, f), b);
  const files = readdirSync(dst).filter((f) => f.endsWith('.html')).sort();
  const lines = ['# 확정 목업 승격 스탬프 — node .harness/scripts/mockup-diff.mjs promote 가 쓴다. 손 편집 금지. 목업을 고치려면 원본에서 고치고 다시 promote(rev+1).', `rev: ${rev}`, `promoted: ${today()}`, `source: ${posix(relative(root, src)) || '.'}`, `by: "${by}"`, 'files:'];
  for (const f of files) lines.push(`  ${f}: ${sha(readFileSync(join(dst, f)))}`);
  writeFileSync(join(dst, 'rev.yaml'), lines.join('\n') + '\n');
  if (!existsSync(join(dst, 'diff-scenarios.json'))) writeFileSync(join(dst, 'diff-scenarios.json'), JSON.stringify([{ _comment: '상태 파일 전수를 적는다(rev.yaml files와 1:1). path는 구현 화면 경로(오리진 제외). 도달 불가는 excluded + 사유. 대조 범위는 selectors(화면이 소유한 영역).' }, ...files.map((f) => ({ state: f, path: '/' }))], null, 2) + '\n');
  return { id: fdrId, rev, files, path: dst };
}

// ---------- backstop 설정 생성 ----------
/** FDR 하나의 시나리오 → backstop config 객체. 화면 지식은 diff-scenarios.json에만 있다 */
export function buildConfig(root, fdrId, { states = [], origin, cfg = mockupConfig(root) } = {}) {
  const dir = fdrDirOf(root, fdrId);
  const rev = readRev(dir); if (!rev) throw new Error(`${fdrId}: mockup/rev.yaml 없음 — promote부터`);
  const sc = readScenarios(dir); if (!sc) throw new Error(`${fdrId}: mockup/diff-scenarios.json 없음`);
  const out = join(root, cfg.scratch, 'mockup-diff', fdrId);
  const scenarios = [], excluded = [];
  for (const s of sc) {
    if (states.length && !states.includes(s.state) && !states.includes(s.state.replace(/\.html$/, ''))) continue;
    if (s.excluded) { excluded.push(s); continue; }
    if (!rev.files[s.state]) throw new Error(`${fdrId}: 유령 시나리오 ${s.state} — rev.yaml files에 없다`);
    scenarios.push({
      label: `${fdrId}__${s.state.replace(/\.html$/, '')}`, state: s.state,
      referenceUrl: pathToFileURL(join(dir, 'mockup', s.state)).href,
      url: origin + (s.path || '/'),
      // 조작은 엔진 스크립트(lib/backstop-onReady.cjs)가 한다 — backstop playwright 엔진은 clickSelectors를 구현하지 않는다(V2 실측)
      harnessClicks: s.clicks || [], harnessKeypress: s.keypress || [], harnessClicksAfter: s.clicksAfter || [], harnessWait: cfg.wait,
      selectors: s.selectors && s.selectors.length ? s.selectors : ['document'],
      hideSelectors: s.hide || [], removeSelectors: s.remove || [],
      readyEvent: null, delay: 0, misMatchThreshold: cfg.threshold, requireSameDimensions: false,
      onBeforeScript: 'backstop-onBefore.cjs', onReadyScript: 'backstop-onReady.cjs',
    });
  }
  return {
    config: {
      id: 'mockup', viewports: [{ label: 'vp', width: cfg.viewport.width, height: cfg.viewport.height }], scenarios,
      paths: { bitmaps_reference: join(out, 'reference'), bitmaps_test: join(out, 'test'), engine_scripts: join(HERE, 'lib'), html_report: join(out, 'html'), json_report: join(out, 'json') },
      report: ['json'], engine: 'playwright', engineOptions: { browser: 'chromium', ignoreHTTPSErrors: true }, asyncCaptureLimit: 3, asyncCompareLimit: 20, debug: false, debugWindow: false,
    },
    excluded, rev, outDir: out,
  };
}

// ---------- 기록기 ----------
/** backstop jsonReport + 캡처 → evidence/mockup-diff/rev<N>/results.json. 구현 캡처 전건, 기준본·diff는 초과 건만 */
export function record(root, fdrId, { report, built, agent = '(모델 미확인)', cfg = mockupConfig(root), fontsDir }) {
  const dir = fdrDirOf(root, fdrId); const rev = built.rev.rev; const out = evidenceDir(dir, rev); mkdirSync(out, { recursive: true });
  let commit = ''; try { commit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* git 밖 */ }
  const results = { _about: '목업 대조 실행 기록 — mockup-diff.mjs run이 쓴다. 손 편집 금지(게이트가 캡처 해시를 대조한다). 수치는 backstop이 낸 그대로(반올림·"diff=0" 표기 금지)', fdr: fdrId, rev, runAt: new Date().toISOString(), commit, agent, engine: 'backstopjs/playwright', originEnv: cfg.originEnv, viewport: `${cfg.viewport.width}x${cfg.viewport.height}`, threshold: cfg.threshold, scenarios: [], summary: { run: 0, pass: 0, fail: 0, error: 0, excluded: 0 } };
  const revFiles = readRev(dir).files;
  for (const s of built.excluded) { results.scenarios.push({ state: s.state, status: 'excluded', excluded: s.excluded }); results.summary.excluded++; }
  for (const s of built.config.scenarios) {
    const tests = (report.tests || []).filter((t) => t.pair && t.pair.label === s.label);
    const base = s.state.replace(/\.html$/, '');
    const entry = { state: s.state, stateSha256: revFiles[s.state], path: s.url.replace(/^[a-z]+:\/\/[^/]+/, ''), selectors: s.selectors, hide: s.hideSelectors, remove: s.removeSelectors, parts: [] };
    results.summary.run++;
    const fontFile = fontsDir ? join(fontsDir, `${s.label}.json`) : null; const fonts = fontFile && existsSync(fontFile) ? JSON.parse(rd(fontFile)) : null;
    if (fonts) entry.fonts = fonts;
    if (!tests.length) { entry.status = 'error'; entry.error = 'backstop 결과 없음(캡처 실패)'; }
    else if (fonts && (fonts.reference?.loaded === false || fonts.test?.loaded === false)) { entry.status = 'error'; entry.error = `폰트 미로드 (목업 ${fonts.reference?.family}:${fonts.reference?.loaded} · 구현 ${fonts.test?.family}:${fonts.test?.loaded}) — 미로드는 전 픽셀을 조용히 오염시킨다`; }
    else {
      let worst = 0, anyFail = false;
      tests.forEach((t, i) => {
        const d = t.pair.diff || {}; const pct = Number(d.rawMisMatchPercentage ?? d.misMatchPercentage ?? 0); worst = Math.max(worst, pct);
        const failed = t.status !== 'pass'; anyFail = anyFail || failed;
        const part = { selector: s.selectors[i] || s.selectors[0], status: failed ? 'fail' : 'pass', mismatchPct: pct, sameDimensions: d.isSameDimensions !== false, captures: {}, captureSha256: {} };
        const copy = (field, suffix) => { const src = t.pair[field]; if (!src) return; const abs = resolve(dirname(join(built.config.paths.json_report, 'jsonReport.json')), src); const p = existsSync(abs) ? abs : resolve(root, src); if (!existsSync(p)) return; const name = `${base}${tests.length > 1 ? `.${i}` : ''}.${suffix}.png`; cpSync(p, join(out, name)); part.captures[suffix] = name; part.captureSha256[suffix] = sha(readFileSync(p)); };
        copy('test', 'target'); if (failed) { copy('reference', 'ref'); copy('diffImage', 'diff'); }
        entry.parts.push(part);
      });
      entry.mismatchPct = worst; entry.status = anyFail ? 'fail' : 'pass';
      const first = entry.parts[0]; entry.captures = first.captures; entry.captureSha256 = first.captureSha256;
      if (fonts && fonts.reference && fonts.test && fonts.reference.family !== fonts.test.family) entry.warning = `폰트 패밀리 다름: 목업 ${fonts.reference.family} · 구현 ${fonts.test.family}`;
    }
    results.summary[entry.status]++;
    results.scenarios.push(entry);
  }
  writeFileSync(resultsPath(dir, rev), JSON.stringify(results, null, 2) + '\n');
  return results;
}

// ---------- run ----------
/** 엔진은 PC에 한 번 설치하고 전 프로젝트가 빌려 쓴다. 찾는 순서: HARNESS_BACKSTOP env → 프로젝트 node_modules → ~/.harness/tools → npm -g */
export const TOOLS_DIR = join(process.env.HARNESS_TOOLS_DIR || join(process.env.USERPROFILE || process.env.HOME || '.', '.harness', 'tools'));
export function engineCandidates(root) {
  const out = [];
  if (process.env.HARNESS_BACKSTOP) out.push({ from: 'HARNESS_BACKSTOP', dir: process.env.HARNESS_BACKSTOP });
  out.push({ from: '프로젝트', dir: root }, { from: '~/.harness/tools', dir: TOOLS_DIR });
  try { out.push({ from: 'npm -g', dir: dirname(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) }); } catch { /* npm 없음 */ }
  return out;
}
export function loadBackstop(root) {
  for (const c of engineCandidates(root)) {
    try { const req = createRequire(join(c.dir, 'package.json')); const pkg = req.resolve('backstopjs/package.json'); return { backstop: req('backstopjs'), from: c.from, dir: dirname(pkg), version: JSON.parse(rd(pkg)).version, req }; } catch { /* 다음 후보 */ }
  }
  return null;
}
/** ~/.harness/tools 에 backstopjs + chromium 설치 (PC당 1회) */
export function installEngine(dir = TOOLS_DIR) {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, 'package.json'))) writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'harness-tools', private: true, description: '하네스C 공용 엔진 — 프로젝트가 아니라 PC에 한 번 (mockup-diff.mjs engine --install)' }, null, 2) + '\n');
  execSync('npm install backstopjs', { cwd: dir, stdio: 'inherit' });
  const req = createRequire(join(dir, 'package.json'));
  execSync(`"${process.execPath}" "${join(dirname(req.resolve('playwright/package.json')), 'cli.js')}" install chromium`, { stdio: 'inherit' });
  return dir;
}
export async function run(root, fdrId, { states = [], agent = '(모델 미확인)', backstop } = {}) {
  const cfg = mockupConfig(root);
  const origin = process.env[cfg.originEnv]; if (!origin) throw new Error(`${cfg.originEnv} 필요 (harness.yaml mockup.origin_env) — 폴백 없음: 값 없이 돌리면 다른 화면을 찍고도 그럴듯한 수치가 나온다`);
  const eng = backstop ? { backstop } : loadBackstop(root); if (!eng) throw new Error('backstopjs가 없다 — PC에 한 번: node .harness/scripts/mockup-diff.mjs engine --install (~/.harness/tools · 프로젝트에는 설치하지 않는다)');
  const bs = eng.backstop;
  const built = buildConfig(root, fdrId, { states, origin, cfg });
  rmSync(built.outDir, { recursive: true, force: true }); mkdirSync(built.outDir, { recursive: true });
  const fontsDir = join(built.outDir, 'fonts'); mkdirSync(fontsDir, { recursive: true });
  const env = { HARNESS_MOCKUP_FONTS: fontsDir, HARNESS_MOCKUP_LOGIN: cfg.login ? resolve(root, cfg.login) : '', HARNESS_MOCKUP_ORIGIN: origin };
  const saved = {}; for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  try {
    for (const s of built.excluded) console.log(`  (제외) ${s.state}: ${s.excluded}`);
    for (const s of built.config.scenarios) { if (s.hideSelectors.length) console.log(`  (가림) ${s.state}: ${s.hideSelectors.join(' · ')}`); if (s.removeSelectors.length) console.log(`  (걷어냄) ${s.state}: ${s.removeSelectors.join(' · ')}`); }
    if (built.config.scenarios.length) {
      await bs('reference', { config: built.config });               // 기준본은 매번 목업에서 — 낡은 기준본 없음
      try { await bs('test', { config: built.config }); } catch { /* 불일치는 기록기가 수치로 적는다 */ }
    }
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  const rp = join(built.config.paths.json_report, 'jsonReport.json');
  const report = existsSync(rp) ? JSON.parse(rd(rp)) : { tests: [] };
  const results = record(root, fdrId, { report, built, agent, cfg, fontsDir });
  for (const e of results.scenarios) console.log(`  ${e.status.padEnd(8)} ${e.state}${e.mismatchPct !== undefined ? `  ${Number(e.mismatchPct).toFixed(4)}%` : ''}${e.error ? '  ' + e.error : ''}${e.warning ? '  ⚠ ' + e.warning : ''}`);
  return results;
}

// ---------- check (완료 게이트) ----------
/** 반환 [] = 통과. FDR 폴더에 mockup/이 없으면 대상 아님 */
export function checkMockup(root, dir) {
  const problems = []; const m = join(dir, 'mockup');
  if (!existsSync(m)) return problems;
  const rev = readRev(dir); if (!rev) return ['mockup/rev.yaml 없음 — 승격은 mockup-diff.mjs promote로'];
  const sc = readScenarios(dir); if (!sc) return ['mockup/diff-scenarios.json 없음 — 상태 파일 전수를 적는다(도달 불가는 excluded + 사유)'];
  const states = new Set(Object.keys(rev.files)); const declared = new Set(sc.map((s) => s.state));
  for (const f of states) if (!declared.has(f)) problems.push(`시나리오 미커버: ${f} (rev.yaml에 있는데 diff-scenarios.json에 없음)`);
  for (const s of sc) if (!states.has(s.state)) problems.push(`유령 시나리오: ${s.state} (rev.yaml files에 없음)`);
  const live = sc.filter((s) => states.has(s.state) && !s.excluded);
  if (states.size && !live.length) problems.push('전 상태 excluded — 게이트가 한 번도 돌지 않는 완전 우회. 확정 목업 기반 완료를 주장할 수 없다');
  const st = fdrStatus(dir);
  if (!/^(shipped|closed)$/.test(st)) return problems;   // 작업 중에는 형식만. 완료 주장 시점에 산출물을 묻는다
  const rp = resultsPath(dir, rev.rev);
  if (!existsSync(rp)) return [...problems, `${st}인데 rev ${rev.rev}의 대조 기록이 없다: ${posix(relative(dir, rp))} — node .harness/scripts/mockup-diff.mjs run`];
  let res; try { res = JSON.parse(rd(rp)); } catch { return [...problems, `${posix(relative(dir, rp))} 파싱 실패`]; }
  const dev = new Map(readDeviations(dir).map((d) => [d.state, d]));
  const byState = new Map((res.scenarios || []).map((s) => [s.state, s]));
  for (const s of live) {
    const r = byState.get(s.state);
    if (!r) { problems.push(`대조 기록 없음: ${s.state}`); continue; }
    if (r.stateSha256 !== rev.files[s.state]) { problems.push(`옛 목업으로 대조: ${s.state} (기록 해시 ≠ rev ${rev.rev} 해시) — 재실행`); continue; }
    if (r.status === 'error') { problems.push(`대조 오류: ${s.state} — ${r.error || ''}`); continue; }
    const cap = r.captures && r.captures.target ? join(evidenceDir(dir, rev.rev), r.captures.target) : null;
    if (!cap || !existsSync(cap)) problems.push(`캡처 없음: ${s.state}`);
    else if (sha(readFileSync(cap)) !== (r.captureSha256 || {}).target) problems.push(`캡처 해시 불일치(기록 수기 조작?): ${s.state}`);
    if (r.status === 'fail') { const d = dev.get(s.state); if (!d || !d.reason) problems.push(`임계 초과 미등재: ${s.state} ${Number(r.mismatchPct).toFixed(4)}% > ${res.threshold}% — 해소하거나 mockup/deviations.json에 사유·승인자 등재`); }
  }
  return problems;
}

// ---------- self-test ----------
const IS_MAIN = Boolean(process.argv[1]) && /mockup-diff\.mjs$/.test(process.argv[1]);
if (IS_MAIN && process.argv.includes('--self-test')) {
  const fails = [];
  const tmp = join(HERE, '..', '.mockup-selftest'); rmSync(tmp, { recursive: true, force: true });
  const fdr = join(tmp, RECORD_DIRS.FDR, 'FDR-000000-m'); mkdirSync(fdr, { recursive: true }); mkdirSync(join(tmp, 'src-mock'), { recursive: true });
  writeFileSync(join(fdr, 'fdr.md'), '---\nid: FDR-000000-m\nstatus: in-progress\n---\n- 작성: t\n');
  writeFileSync(join(tmp, 'src-mock', '01-default.html'), '<html><body>a</body></html>'); writeFileSync(join(tmp, 'src-mock', '02-empty.html'), '<html><body>b</body></html>');
  writeFileSync(join(tmp, 'harness.yaml'), 'scratch:\n  dir: .scratch\nmockup:\n  origin_env: T_ORIGIN\n  viewport: 800x600\n  threshold: 0.5\n');
  try {
    try { promote(tmp, 'FDR-000000-none', 'src-mock'); fails.push('없는 FDR 통과'); } catch { /* 기대 */ }
    const p1 = promote(tmp, 'FDR-000000-m', 'src-mock', { by: 't' });
    const r1 = readRev(fdr); if (p1.rev !== 1 || !r1 || Object.keys(r1.files).length !== 2 || !existsSync(join(fdr, 'mockup', 'diff-scenarios.json'))) fails.push('promote rev1');
    writeFileSync(join(fdr, 'mockup', 'diff-scenarios.json'), JSON.stringify([{ state: '01-default.html', path: '/list', clicks: ['#a'], selectors: ['.pane'], hide: ['.clock'] }, { state: '02-empty.html', excluded: '빈 계정 필요' }]));
    const p2 = promote(tmp, 'FDR-000000-m', 'src-mock', { by: 't' }); if (p2.rev !== 2 || !/excluded/.test(rd(join(fdr, 'mockup', 'diff-scenarios.json')))) fails.push('promote rev2 · 시나리오 보존');
    if (checkMockup(tmp, fdr).length) fails.push('in-progress 형식 통과여야: ' + checkMockup(tmp, fdr).join(' | '));
    const cfg = mockupConfig(tmp); if (cfg.originEnv !== 'T_ORIGIN' || cfg.viewport.width !== 800 || cfg.threshold !== 0.5) fails.push('config');
    // 설정 생성
    const built = buildConfig(tmp, 'FDR-000000-m', { origin: 'http://x:1', cfg });
    const s0 = built.config.scenarios[0];
    if (built.config.scenarios.length !== 1 || built.excluded.length !== 1 || s0.url !== 'http://x:1/list' || !/^file:/.test(s0.referenceUrl) || s0.selectors[0] !== '.pane' || s0.hideSelectors[0] !== '.clock' || s0.harnessClicks[0] !== '#a' || s0.misMatchThreshold !== 0.5 || built.config.viewports[0].width !== 800 || !existsSync(join(built.config.paths.engine_scripts, 'backstop-onReady.cjs'))) fails.push('buildConfig');
    if (buildConfig(tmp, 'FDR-000000-m', { origin: 'http://x:1', cfg, states: ['02-empty'] }).config.scenarios.length !== 0) fails.push('--state 필터');
    // 기록기 — 가짜 backstop 리포트 + 캡처
    const jr = join(built.config.paths.json_report); mkdirSync(join(built.config.paths.bitmaps_test, 'r1'), { recursive: true }); mkdirSync(jr, { recursive: true }); mkdirSync(join(built.config.paths.bitmaps_reference), { recursive: true });
    const cap = Buffer.from('PNGFAKE-target'); writeFileSync(join(built.config.paths.bitmaps_test, 'r1', 't.png'), cap); writeFileSync(join(built.config.paths.bitmaps_reference, 'r.png'), 'PNGFAKE-ref'); writeFileSync(join(built.config.paths.bitmaps_test, 'r1', 'd.png'), 'PNGFAKE-diff');
    const report = (status, pct) => ({ tests: [{ status, pair: { label: s0.label, reference: '../reference/r.png', test: '../test/r1/t.png', diffImage: status === 'fail' ? '../test/r1/d.png' : undefined, diff: { isSameDimensions: true, rawMisMatchPercentage: pct, misMatchPercentage: String(pct) } } }] });
    const res1 = record(tmp, 'FDR-000000-m', { report: report('pass', 0.0031), built, agent: 't', cfg });
    const e = res1.scenarios.find((x) => x.state === '01-default.html');
    if (res1.summary.pass !== 1 || res1.summary.excluded !== 1 || !e || e.status !== 'pass' || e.mismatchPct !== 0.0031 || e.captures.target !== '01-default.target.png' || e.captureSha256.target !== sha(cap) || !existsSync(join(fdr, 'evidence', 'mockup-diff', 'rev2', '01-default.target.png')) || e.stateSha256 !== readRev(fdr).files['01-default.html']) fails.push('record pass: ' + JSON.stringify(e));
    const res2 = record(tmp, 'FDR-000000-m', { report: report('fail', 3.2), built, agent: 't', cfg });
    const f = res2.scenarios.find((x) => x.state === '01-default.html'); if (f.status !== 'fail' || !f.captures.ref || !f.captures.diff || !existsSync(join(fdr, 'evidence', 'mockup-diff', 'rev2', '01-default.diff.png'))) fails.push('record fail: ' + JSON.stringify(f));
    const res3 = record(tmp, 'FDR-000000-m', { report: { tests: [] }, built, agent: 't', cfg }); if (res3.summary.error !== 1) fails.push('record error');
    // check — 완료 게이트
    writeFileSync(join(fdr, 'fdr.md'), '---\nid: FDR-000000-m\nstatus: shipped\n---\n- 작성: t\n');
    if (!checkMockup(tmp, fdr).some((x) => /대조 오류/.test(x))) fails.push('error 기록 미검출');
    record(tmp, 'FDR-000000-m', { report: report('pass', 0), built, agent: 't', cfg }); let pr = checkMockup(tmp, fdr); if (pr.length) fails.push('양성 오탐: ' + pr.join(' | '));
    record(tmp, 'FDR-000000-m', { report: report('fail', 3.2), built, agent: 't', cfg }); if (!checkMockup(tmp, fdr).some((x) => /임계 초과 미등재/.test(x))) fails.push('초과 미등재 미검출');
    writeFileSync(join(fdr, 'mockup', 'deviations.json'), JSON.stringify([{ state: '01-default.html', reason: '승인된 차이', approved_by: 'cto', date: '2026-01-01' }])); if (checkMockup(tmp, fdr).length) fails.push('등재된 초과가 통과여야');
    rmSync(join(fdr, 'mockup', 'deviations.json'));
    record(tmp, 'FDR-000000-m', { report: report('pass', 0), built, agent: 't', cfg });
    writeFileSync(join(fdr, 'evidence', 'mockup-diff', 'rev2', '01-default.target.png'), 'tampered'); if (!checkMockup(tmp, fdr).some((x) => /캡처 해시 불일치/.test(x))) fails.push('캡처 위조 미검출');
    rmSync(join(fdr, 'evidence', 'mockup-diff', 'rev2', 'results.json')); if (!checkMockup(tmp, fdr).some((x) => /대조 기록이 없다/.test(x))) fails.push('기록 없음 미검출');
    promote(tmp, 'FDR-000000-m', 'src-mock', { by: 't' }); record(tmp, 'FDR-000000-m', { report: report('pass', 0), built, agent: 't', cfg });   // built는 rev2 — rev3 스탬프와 어긋남
    if (!checkMockup(tmp, fdr).some((x) => /대조 기록이 없다|옛 목업/.test(x))) fails.push('옛 rev 미검출');
    writeFileSync(join(fdr, 'mockup', 'diff-scenarios.json'), JSON.stringify([{ state: '01-default.html', excluded: 'x' }, { state: '02-empty.html', excluded: 'y' }])); if (!checkMockup(tmp, fdr).some((x) => /전 상태 excluded/.test(x))) fails.push('전 상태 excluded 미검출');
    writeFileSync(join(fdr, 'mockup', 'diff-scenarios.json'), JSON.stringify([{ state: '01-default.html', path: '/' }, { state: '99-ghost.html', path: '/' }])); const pr3 = checkMockup(tmp, fdr); if (!pr3.some((x) => /미커버: 02-empty/.test(x)) || !pr3.some((x) => /유령 시나리오: 99-ghost/.test(x))) fails.push('미커버·유령 미검출');
  } catch (e) { fails.push('예외: ' + e.stack.split('\n').slice(0, 2).join(' ')); }
  rmSync(tmp, { recursive: true, force: true });
  const eng = loadBackstop(DEFAULT_ROOT);
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : `self-test OK (promote rev 2회 · 설정 생성·필터 · 기록기 pass/fail/error · check 8종 — 캡처 실행은 ${eng ? `backstopjs ${eng.version} @ ${eng.from}(run으로 실측)` : 'backstopjs 없음, 미검증 — engine --install'})`);
  process.exit(fails.length ? 1 : 0);
}

// ---------- CLI ----------
if (IS_MAIN && !process.argv.includes('--self-test')) {
  const argv = process.argv.slice(2); const [cmd, a, b] = argv;
  const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const agent = opt('--agent') || opt('--by') || process.env.HARNESS_AGENT || '(모델 미확인)';
  const targets = (id) => (id === '--all' || argv.includes('--all') ? listFdrs(DEFAULT_ROOT).filter((d) => existsSync(join(d, 'mockup'))).map((d) => basename(d)) : id ? [id] : []);
  try {
    if (cmd === 'promote') { if (!a || !b) throw new Error('사용: promote <FDR-ID> <목업 폴더> [--by "<에이전트>"]'); const r = promote(DEFAULT_ROOT, a, b, { by: agent }); console.log(`${r.id} mockup rev ${r.rev} ← ${b} (${r.files.length}개 상태) → ${posix(relative(DEFAULT_ROOT, r.path))}\n다음: mockup/diff-scenarios.json에 상태별 path·조작·범위를 적는다. 도달 불가는 excluded + 사유`); }
    else if (cmd === 'run') { const ids = targets(a); if (!ids.length) throw new Error('사용: run <FDR-ID>|--all [--state <이름>]'); let bad = 0; for (const id of ids) { console.log(`${id} (rev ${readRev(fdrDirOf(DEFAULT_ROOT, id))?.rev ?? '?'})`); const r = await run(DEFAULT_ROOT, id, { states: argv.filter((x, i) => argv[i - 1] === '--state'), agent }); const s = r.summary; console.log(`  → 실행 ${s.run} · 통과 ${s.pass} · 초과 ${s.fail} · 오류 ${s.error} · 제외 ${s.excluded} · 기록 ${posix(relative(DEFAULT_ROOT, resultsPath(fdrDirOf(DEFAULT_ROOT, id), r.rev)))}`); bad += s.fail + s.error; } process.exit(bad ? 1 : 0); }
    else if (cmd === 'check') { const ids = a ? targets(a) : targets('--all'); let n = 0; for (const id of ids) { const p = checkMockup(DEFAULT_ROOT, fdrDirOf(DEFAULT_ROOT, id)); if (p.length) { n += p.length; console.log(`${id}:\n- ` + p.join('\n- ')); } } console.log(n ? `목업 대조 위반 ${n}건` : `목업 대조 OK (${ids.length}개 FDR)`); process.exit(n ? 1 : 0); }
    else if (cmd === 'engine') { if (argv.includes('--install')) { const d = installEngine(); console.log(`설치 완료 → ${d} (PC 공용 · 프로젝트는 이 경로를 자동으로 찾는다)`); } const e = loadBackstop(DEFAULT_ROOT); console.log(e ? `backstopjs ${e.version} @ ${e.from} (${e.dir})` : `backstopjs 없음 — 찾은 곳: ${engineCandidates(DEFAULT_ROOT).map((c) => `${c.from}=${c.dir}`).join(' · ')}\n설치(PC당 1회): node .harness/scripts/mockup-diff.mjs engine --install`); process.exit(e ? 0 : 1); }
    else { console.error('사용: node .harness/scripts/mockup-diff.mjs promote <FDR-ID> <목업 폴더> | run <FDR-ID>|--all [--state <이름>] | check [<FDR-ID>|--all] | engine [--install]'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
