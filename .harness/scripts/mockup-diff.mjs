#!/usr/bin/env node
// mockup-diff.mjs — 확정 목업 ↔ 구현 화면 승인본 픽셀 대조 (.harness/HARNESS.md §6 · .harness/runbooks/mockup.md).
//
//   promote <FDR-ID> <모듈>/<화면>|<폴더> [--by …]     확정 목업을 docs/features/<FDR>/mockup/<화면>/ 으로 승격(사본 + rev.yaml 스탬프 — rev+1 · 공용 자산은 FDR 루트 _assets/). 코드보다 먼저.
//                                                    <모듈>/<화면>은 harness.yaml references role: mockup 저장소(harnessC-mockup-template)의 screens/ 아래 — confirmed만, 해시가 확정본과 같아야 한다.
//   run     <FDR-ID>|--all [--state <이름>]          상태마다 목업(file://)을 기준본으로 다시 찍고 구현(<origin_env> + path)을 찍어 BackstopJS로 비교
//                                                    → evidence/mockup-diff/rev<N>/results.json + 캡처(구현 전건 · 기준본·diff는 초과 건만)
//   engine  [--install]                              엔진 위치 확인 · PC당 1회 설치(~/.harness/tools — 프로젝트마다 설치하지 않는다)
//   check   [<FDR-ID>|--all]                         완료 게이트(lint ⑯과 같은 검사): shipped·closed인데 같은 rev의 기록이 없거나·미커버·초과 미등재·캡처 위조면 위반
//
// 설정 harness.yaml `mockup:` — origin_env(구현 오리진을 담은 환경변수 **이름** · 값은 적지 않는다, 폴백 없음) · viewport · threshold(%) · wait(ms) · login(캡처 전 로그인 모듈 경로, 프로젝트 소유).
// 엔진 backstopjs(+playwright)는 PC에 한 번 설치해 전 프로젝트가 빌려 쓴다(HARNESS_BACKSTOP → 프로젝트 → ~/.harness/tools → npm -g 순으로 찾는다) — 코어·프로젝트에는 설치하지 않는다. promote·check·self-test는 엔진이 필요 없다.
// 기준본은 매 실행 목업에서 다시 찍는다(backstop reference → test). 저장된 기준본·approve는 없다: 낡은 기준본과 비교한 거짓 수치를 구조로 막는다.
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
import { findReference, refPath } from './lib/refs.mjs';
import { fetchSource, readUpstream } from './lib/upstream.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
/** 지문 — 텍스트는 CRLF→LF 정규화 뒤, 바이너리(NUL)는 바이트 그대로. 목업 저장소 scripts/lib/mockup.mjs sha()와 같은 규약 — 한쪽만 바꾸면 확정 지문이 어긋나 같은 내용에 거짓 경보(Windows CRLF 실사고) */
const isBinary = (buf) => { const n = Math.min(buf.length, 8000); for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true; return false; };
const sha = (buf) => createHash('sha256').update(Buffer.isBuffer(buf) && isBinary(buf) ? buf : Buffer.from(String(buf).replace(/\r\n/g, '\n'), 'utf8')).digest('hex');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
const frontmatter = (t) => (t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
const today = () => new Date().toISOString().slice(0, 10);
const posix = (p) => p.split('\\').join('/');

// ---------- 설정 ----------
export function mockupConfig(root) {
  const hy = rd(join(root, 'harness.yaml'));
  const block = (hy.match(/^mockup:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '';
  const v = (k, d) => { const m = block.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')); const x = m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; return x || d; };
  const [w, h] = v('viewport', '1440x900').split('x').map(Number);
  const scratch = ((hy.match(/^scratch:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '').match(/^\s*dir:\s*(\S+)/m)?.[1] || '.scratch';
  return { originEnv: v('origin_env', 'APP_ORIGIN'), viewport: { width: w || 1440, height: h || 900 }, threshold: Number(v('threshold', '0.01')), wait: Number(v('wait', '1000')), login: v('login', ''), scratch };
}

// ---------- 기록 읽기 ----------
const fdrDirOf = (root, id) => join(root, recordDir(id), id);
function fdrStatus(dir) { const m = rd(join(dir, 'manifest.yaml')); return yamlScalar(m || frontmatter(rd(join(dir, 'fdr.md'))), 'status'); }
export function readRev(dir) {
  const t = rd(join(dir, 'mockup', 'rev.yaml')); if (!t) return null;
  const files = {}; for (const m of t.matchAll(/^  ([^:\n]+\.html):\s*([0-9a-f]{64})\s*$/gm)) files[m[1]] = m[2];   // 대조 시나리오는 상태 html만
  const policy = {}; for (const m of t.matchAll(/^  ([^:\n]+\.(?:md|css)):\s*([0-9a-f]{64})\s*$/gm)) policy[m[1]] = m[2];   // 정책·css 사본 지문 — 개발이 사본을 고치면 check가 잡는다(RFC-261029 P1)
  return { policy, rev: Number(yamlScalar(t, 'rev')) || 0, promoted: yamlScalar(t, 'promoted'), source: yamlScalar(t, 'source'), sourceScreen: yamlScalar(t, 'source_screen'), sourceRev: Number(yamlScalar(t, 'source_rev')) || 0, files };
}
export function readScenarios(dir) { const p = join(dir, 'mockup', 'diff-scenarios.json'); if (!existsSync(p)) return null; return JSON.parse(rd(p)).filter((s) => s && s.state); }
const readDeviations = (dir) => { const p = join(dir, 'mockup', 'deviations.json'); return existsSync(p) ? JSON.parse(rd(p)) : []; };
const evidenceDir = (dir, rev) => join(dir, 'evidence', 'mockup-diff', `rev${rev}`);
const resultsPath = (dir, rev) => join(evidenceDir(dir, rev), 'results.json');
function listFdrs(root) { const d = join(root, RECORD_DIRS.FDR); return existsSync(d) ? readdirSync(d).filter((n) => /^FDR-\d{6}-/.test(n) && statSync(join(d, n)).isDirectory()).map((n) => join(d, n)) : []; }

// ---------- promote ----------
/** 목업 저장소(harnessC-mockup-template)의 rev.yaml — visual_status·rev·confirmed_by·files. 없으면 null(일반 폴더) */
function readSourceRev(src) {
  const t = rd(join(src, 'rev.yaml')); if (!t) return null;
  const files = {}; for (const m of t.matchAll(/^  ([^:\n]+\.(?:html|md|css)):\s*([0-9a-f]{64})\s*$/gm)) files[m[1]] = m[2];   // 상태 html + policy.md(목업 v0.1.6+) + 폴더 css(v0.1.7+)
  return { rev: Number(yamlScalar(t, 'rev')) || 0, visual_status: yamlScalar(t, 'visual_status'), confirmed: yamlScalar(t, 'confirmed'), confirmed_by: yamlScalar(t, 'confirmed_by'), screen: yamlScalar(t, 'screen'), files };
}
/** html이 참조하는 로컬 자산 중 디스크에 없는 것 — 승격 사본이 무스타일이면 기준본이 못 된다 */
function unresolvedAssets(htmlPath) {
  const html = rd(htmlPath); const refs = new Set();
  for (const m of html.matchAll(/<(?:link|script|img|source)\b[^>]*?\b(?:href|src)=["']([^"']+)["']/gi)) refs.add(m[1]);
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) refs.add(m[1]);
  return [...refs].map((r) => r.split('#')[0].split('?')[0]).filter((r) => r && !/^(https?:|data:|\/\/|mailto:)/i.test(r) && !existsSync(resolve(dirname(htmlPath), r)));
}
/**
 * 승격. 원본은 ① 경로 ② `<모듈>/<화면>` — harness.yaml references role: mockup 저장소의 screens/ 아래.
 * 사본 자리: docs/features/<FDR>/mockup/<화면>/ (html이 `../../_assets/`로 참조하는 공용 자산은 FDR 루트 `_assets/`로 — 참조가 열리는 자리에 둔다).
 * 원본에 rev.yaml이 있으면 confirmed만 받고, 파일 해시가 확정본과 같아야 한다(reopen 중인 목업 거부).
 */
export function promote(root, fdrId, srcDir, { by = '(모델 미확인)' } = {}) {
  const dir = fdrDirOf(root, fdrId);
  if (!existsSync(dir)) throw new Error(`FDR이 없다: ${posix(relative(root, dir))} — 먼저 node .harness/scripts/new-doc.mjs fdr`);
  const ref = findReference(rd(join(root, 'harness.yaml')), 'mockup');
  let src = resolve(root, srcDir);
  if (!existsSync(src) && ref) src = join(refPath(root, ref), 'screens', srcDir);
  if (!existsSync(src) || !readdirSync(src).some((f) => f.endsWith('.html'))) throw new Error(`목업 폴더에 .html이 없다: ${srcDir}${ref ? ` (references role: mockup → ${ref.path}/screens/${srcDir} 도 없음)` : ' (harness.yaml references에 role: mockup 저장소를 등록하면 <모듈>/<화면>으로 지정할 수 있다)'}`);
  const srcRev = readSourceRev(src);
  const htmls = readdirSync(src).filter((f) => f.endsWith('.html')).sort();
  if (srcRev) {
    if (srcRev.visual_status !== 'confirmed') throw new Error(`${srcDir}: visual_status가 ${srcRev.visual_status || '없음'} — confirmed 목업만 승격한다 (목업 저장소에서 confirm.mjs)`);
    for (const f of [...new Set([...htmls, ...Object.keys(srcRev.files)])]) if (!existsSync(join(src, f)) || sha(readFileSync(join(src, f))) !== srcRev.files[f]) throw new Error(`${srcDir}/${f}: 확정본(rev ${srcRev.rev}) 해시와 다르다 — 원본이 reopen 중이거나 몰래 고쳐졌다. 재확정 뒤 승격`);
  }
  const screen = basename(src); const dst = join(dir, 'mockup'); const dstScreen = join(dst, screen);
  const prev = readRev(dir); const rev = (prev ? prev.rev : 0) + 1;
  const keep = ['diff-scenarios.json', 'deviations.json'].filter((f) => existsSync(join(dst, f))).map((f) => [f, readFileSync(join(dst, f))]);
  rmSync(dst, { recursive: true, force: true }); mkdirSync(dstScreen, { recursive: true });
  cpSync(src, dstScreen, { recursive: true, filter: (s) => !/node_modules|\.git($|[\\/])|rev\.yaml$/.test(s) });
  const assets = join(src, '..', '..', '_assets');
  if (existsSync(assets)) { rmSync(join(dir, '_assets'), { recursive: true, force: true }); cpSync(assets, join(dir, '_assets'), { recursive: true }); }
  for (const [f, b] of keep) writeFileSync(join(dst, f), b);
  const files = htmls.map((f) => `${screen}/${f}`);
  for (const f of files) { const miss = unresolvedAssets(join(dst, f)); if (miss.length) { rmSync(dst, { recursive: true, force: true }); throw new Error(`승격 실패 — ${f}의 자산 참조가 열리지 않는다(무스타일 기준본): ${miss.join(', ')}. 자산을 참조가 열리는 자리에 둔다`); } }
  const lines = ['# 확정 목업 승격 스탬프 — node .harness/scripts/mockup-diff.mjs promote 가 쓴다. 손 편집 금지. 목업을 고치려면 원본에서 고치고 다시 promote(rev+1).', `rev: ${rev}`, `promoted: ${today()}`, `source: ${posix(relative(root, src)) || '.'}`, `by: "${by}"`];
  if (srcRev) lines.push(`source_screen: ${srcRev.screen}`, `source_rev: ${srcRev.rev}`, `source_confirmed: ${srcRev.confirmed}`, `source_confirmed_by: "${srcRev.confirmed_by}"`);
  lines.push('files:'); for (const f of files) lines.push(`  ${f}: ${sha(readFileSync(join(dst, f)))}`);
  // 정책·css 사본도 지문 — 화면은 픽셀로 대조되지만 정책은 복사된 뒤 아무도 안 봤다(RFC-261029 P1). 개발이 사본을 고치면 check가 거부
  const policyFiles = readdirSync(dstScreen).filter((f) => f === 'policy.md' || f.endsWith('.css')).sort().map((f) => `${screen}/${f}`);
  if (policyFiles.length) { lines.push('policy:'); for (const f of policyFiles) lines.push(`  ${f}: ${sha(readFileSync(join(dst, f)))}`); }
  writeFileSync(join(dst, 'rev.yaml'), lines.join('\n') + '\n');
  if (!existsSync(join(dst, 'diff-scenarios.json'))) writeFileSync(join(dst, 'diff-scenarios.json'), JSON.stringify([{ _comment: '상태 파일 전수를 적는다(rev.yaml files와 1:1). path는 구현 화면 경로(오리진 제외). 도달 불가는 excluded + 사유. 대조 범위는 selectors(화면이 소유한 영역).' }, ...files.map((f) => ({ state: f, path: '/' }))], null, 2) + '\n');
  const bi = join(root, '.harness', 'scripts', 'build-index.mjs'); if (existsSync(bi)) { try { execSync(`"${process.execPath}" "${bi}"`, { cwd: root, stdio: 'ignore' }); } catch { /* */ } }
  return { id: fdrId, rev, files, path: dst, source: srcRev ? { screen: srcRev.screen, rev: srcRev.rev, confirmed_by: srcRev.confirmed_by } : null };
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
      label: `${fdrId}__${s.state.replace(/\.html$/, '').replace(/\//g, '__')}`, state: s.state,
      referenceUrl: pathToFileURL(join(dir, 'mockup', s.state)).href,
      url: origin + (s.path || '/'),
      // 조작은 엔진 스크립트(lib/backstop-onReady.cjs)가 한다 — backstop playwright 엔진은 clickSelectors를 구현하지 않는다
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
    const base = s.state.replace(/\.html$/, '').replace(/\//g, '__');
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
  const bi = join(root, '.harness', 'scripts', 'build-index.mjs');   // 증거가 늘었다 — 생성 인덱스를 같이 갱신해야 커밋이 된다(pre-commit build-index --check)
  if (existsSync(bi)) { try { execSync(`"${process.execPath}" "${bi}"`, { cwd: root, stdio: 'ignore' }); } catch { /* 인덱스는 pre-commit이 다시 묻는다 */ } }
  for (const e of results.scenarios) console.log(`  ${e.status.padEnd(8)} ${e.state}${e.mismatchPct !== undefined ? `  ${Number(e.mismatchPct).toFixed(4)}%` : ''}${e.error ? '  ' + e.error : ''}${e.warning ? '  ⚠ ' + e.warning : ''}`);
  return results;
}

// ---------- init: 목업 저장소 자리 선택 ----------
export const MOCKUP_TEMPLATE = 'https://github.com/mathjjang/harnessC-mockup-template';
/** 템플릿 재료를 dst에 놓는다 — 출처는 --from <경로|주소@태그> → harness.yaml upstream.mockup_repo@mockup_ref → 기본 저장소. .git은 두지 않는다 */
function fetchTemplate(root, dst, from) {
  const up = readUpstream(root);
  const spec = from || (up.mockup_repo ? `${up.mockup_repo}${up.mockup_ref ? '@' + up.mockup_ref : ''}` : MOCKUP_TEMPLATE);
  const s = fetchSource(spec, { cwd: root });
  try { cpSync(s.dir, dst, { recursive: true, filter: (p) => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(relative(s.dir, p)) }); } finally { s.cleanup(); }
  return s.label;
}
/** harness.yaml references에 role: mockup 항목을 넣는다(이미 있으면 교체) */
export function registerMockupRef(root, entry) {
  const p = join(root, 'harness.yaml'); let hy = rd(p); if (!hy) throw new Error('harness.yaml이 없다 — 개발 저장소 루트에서 실행');
  const line = `  - { path: ${entry.path}, role: mockup, mode: ${entry.mode}${entry.writable ? `, writable: [${entry.writable.join(', ')}]` : ''}${entry.embedded ? ', embedded: true' : ''} }`;
  hy = hy.split('\n').filter((l) => !/^\s*-\s*\{[^}]*role:\s*mockup\b/.test(l)).join('\n');
  if (/^references:\s*\[\]/m.test(hy)) hy = hy.replace(/^references:\s*\[\][^\n]*/m, (m) => m.replace(/\[\][ \t]*/, '') + '\n' + line);
  else if (/^references:/m.test(hy)) hy = hy.replace(/^(references:[^\n]*\n(?:[ \t]+-[^\n]*\n?)*)/m, (m) => m.replace(/\n?$/, '\n') + line + '\n');
  else hy = hy.replace(/\n?$/, '\n') + `references:\n${line}\n`;
  writeFileSync(p, hy); return line.trim();
}
/**
 * separate: 별도 GitHub 저장소(기획·디자인 분리 — 기본). gh가 있으면 템플릿으로 생성·clone, 없으면 clone 후 origin 제거. 자리 ../<이름>-mockups, references read-only
 * embedded: 개발 저장소 안 mockups/ (혼자 개발). 런타임 입구 폴더는 걷어낸다(개발 저장소의 harness-build가 mockups/runbooks에서 만든다). references read-write + embedded
 */
export function initMockup(root, mode, { name, from, gh = true, owner } = {}) {
  if (!['separate', 'embedded'].includes(mode)) throw new Error('init separate|embedded — separate: 별도 GitHub 저장소(기획·디자인 분리, 기본) · embedded: 개발 저장소 안 mockups/(혼자 개발)');
  name = name || yamlScalar(rd(join(root, 'harness.yaml')), 'project') || basename(root);
  if (!name || /\{\{/.test(name)) throw new Error('--name <프로젝트> 필요 (harness.yaml project가 비어 있다)');
  const rel = mode === 'embedded' ? 'mockups' : `../${name}-mockups`; const dst = resolve(root, rel);
  if (existsSync(dst)) throw new Error(`이미 있다: ${rel}`);
  let created = 'copy';
  if (mode === 'separate' && !from && gh) {
    try { execSync('gh auth status', { stdio: 'ignore' }); const repo = `${owner || execSync('gh api user -q .login', { encoding: 'utf8' }).trim()}/${name}-mockups`; execSync(`gh repo create ${repo} --template mathjjang/harnessC-mockup-template --private --clone`, { cwd: dirname(dst), stdio: 'inherit' }); created = `gh:${repo}`; } catch { /* gh 없음·실패 → clone 경로 */ }
  }
  if (!existsSync(dst)) { mkdirSync(dirname(dst), { recursive: true }); const label = fetchTemplate(root, dst, from); if (mode === 'separate') { execSync('git init -q -b main', { cwd: dst }); created = `clone ${label} (원격 없음 — GitHub에 비공개 저장소를 만들어 push)`; } else created = `copy ${label}`; }
  if (existsSync(join(dst, 'init.mjs'))) execSync(`"${process.execPath}" init.mjs --name "${name}"`, { cwd: dst, stdio: 'ignore' });
  if (mode === 'embedded') { for (const d of ['.claude', '.agents', '.gemini', 'CLAUDE.md', 'GEMINI.md', '.gitignore', '.gitattributes']) rmSync(join(dst, d), { recursive: true, force: true }); }
  else execSync('git config core.hooksPath scripts/git-hooks', { cwd: dst, stdio: 'ignore' });
  // separate도 read-write지만 writable: [qa/]뿐 — 개발은 검수 건의 resolution.md만 쓴다(guard-reference). 목업·정책은 그 저장소에서만
  const ref = registerMockupRef(root, { path: rel, mode: 'read-write', writable: mode === 'embedded' ? undefined : ['qa/'], embedded: mode === 'embedded' });
  return { mode, path: rel, created, ref };
}

// ---------- check (완료 게이트) ----------
/** 원본 드리프트 — 승격 스탬프 source_rev ↔ 목업 저장소 원본 rev.yaml의 rev. 원본을 읽을 수 있을 때만(source 경로 또는 references role: mockup) 판정, 못 읽으면 []. 감지만으로는 사람이 발견해야 일이 생기므로 완료 시점에 막는다 */
export function sourceDrift(root, rev, st) {
  if (!rev.sourceRev) return [];
  let src = rev.source ? resolve(root, rev.source) : '';
  if (!(src && existsSync(join(src, 'rev.yaml'))) && rev.sourceScreen) { const ref = findReference(rd(join(root, 'harness.yaml')), 'mockup'); if (ref) src = join(refPath(root, ref), 'screens', rev.sourceScreen); }
  if (!(src && existsSync(join(src, 'rev.yaml')))) return [];
  const cur = readSourceRev(src); const name = rev.sourceScreen || posix(relative(root, src));
  if (cur.rev > rev.sourceRev) return [`${st}인데 원본 ${name}이 rev ${cur.rev}로 재확정됐다(승격 사본은 rev ${rev.sourceRev}) — 옛 판으로 완료할 수 없다. 다시 promote → run`];
  if (cur.visual_status === 'reopened' && cur.rev === rev.sourceRev) return [`${st}인데 원본 ${name}이 reopen 중이다(rev ${cur.rev}) — 재확정을 기다려 다시 promote → run`];
  return [];
}
/** 스펙이 정책을 인용하는가 — 지문은 "안 바뀌었다"만 보장한다. 정책이 스펙에 들어가야 테스트가 검증하고 리뷰가 본다(RFC-261029 P8).
 *  스펙(lite fdr.md §1 · standard 01-spec.md)에 `mockup/<화면>/policy.md` 경로와 그 rev가 적혀 있어야 한다. 정책 사본이 없는(일반 폴더 승격) FDR은 대상 아님 */
export function specCitesPolicy(dir, rev) {
  const pol = Object.keys(rev.policy).filter((f) => f.endsWith('/policy.md')); if (!pol.length) return [];
  const spec = existsSync(join(dir, '01-spec.md')) ? rd(join(dir, '01-spec.md')) : ((rd(join(dir, 'fdr.md')).split(/^## 1\. Spec[^\n]*$/m)[1] || '').split(/^## /m)[0]);
  return pol.filter((f) => !new RegExp(`mockup/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\brev\\s*${rev.rev}\\b`).test(spec))
    .map((f) => `스펙이 정책을 인용하지 않는다 — §1(스펙)에 \`mockup/${f} rev ${rev.rev}\`를 출처로 적고 7절을 시나리오(WHEN/THEN)로 옮긴다. 정책이 스펙에 없으면 테스트도 리뷰도 그것을 보지 않는다`);
}

/** 반환 [] = 통과. FDR 폴더에 mockup/이 없으면 대상 아님 */
export function checkMockup(root, dir) {
  const problems = []; const m = join(dir, 'mockup');
  if (!existsSync(m)) return problems;
  const rev = readRev(dir); if (!rev) return ['mockup/rev.yaml 없음 — 승격은 mockup-diff.mjs promote로'];
  const sc = readScenarios(dir); if (!sc) return ['mockup/diff-scenarios.json 없음 — 상태 파일 전수를 적는다(도달 불가는 excluded + 사유)'];
  // 정책·css 사본 불변 — 작업 중에도 검사한다. 사본은 정본이 아니라 승격본이다; 고치고 싶으면 목업 저장소에서(기획수정 접수) 고치고 다시 promote
  for (const [f, h] of Object.entries(rev.policy)) { const p = join(m, f); if (!existsSync(p)) problems.push(`승격 사본 ${f}가 사라졌다 — 다시 promote`); else if (sha(readFileSync(p)) !== h) problems.push(`승격 사본 ${f}가 승격 때와 다르다 — 사본을 고치지 않는다. 정책을 바꾸려면 목업 저장소에서 reopen → 재확정 → 다시 promote`); }
  problems.push(...specCitesPolicy(dir, rev));
  const states = new Set(Object.keys(rev.files)); const declared = new Set(sc.map((s) => s.state));
  for (const f of states) if (!declared.has(f)) problems.push(`시나리오 미커버: ${f} (rev.yaml에 있는데 diff-scenarios.json에 없음)`);
  for (const s of sc) if (!states.has(s.state)) problems.push(`유령 시나리오: ${s.state} (rev.yaml files에 없음)`);
  const live = sc.filter((s) => states.has(s.state) && !s.excluded);
  if (states.size && !live.length) problems.push('전 상태 excluded — 게이트가 한 번도 돌지 않는 완전 우회. 확정 목업 기반 완료를 주장할 수 없다');
  const st = fdrStatus(dir);
  if (!/^(shipped|closed)$/.test(st)) return problems;   // 작업 중에는 형식만. 완료 주장 시점에 산출물을 묻는다
  problems.push(...sourceDrift(root, rev, st));
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
  writeFileSync(join(tmp, 'harness.yaml'), 'scratch:   # 주석\n  dir: .scratch\nmockup:   # 주석\n  origin_env: T_ORIGIN\n  viewport: 800x600\n  threshold: 0.5\n');
  try {
    try { promote(tmp, 'FDR-000000-none', 'src-mock'); fails.push('없는 FDR 통과'); } catch { /* 기대 */ }
    const p1 = promote(tmp, 'FDR-000000-m', 'src-mock', { by: 't' });
    const r1 = readRev(fdr); if (p1.rev !== 1 || !r1 || Object.keys(r1.files).length !== 2 || !existsSync(join(fdr, 'mockup', 'diff-scenarios.json'))) fails.push('promote rev1');
    writeFileSync(join(fdr, 'mockup', 'diff-scenarios.json'), JSON.stringify([{ state: 'src-mock/01-default.html', path: '/list', clicks: ['#a'], selectors: ['.pane'], hide: ['.clock'] }, { state: 'src-mock/02-empty.html', excluded: '빈 계정 필요' }]));
    const p2 = promote(tmp, 'FDR-000000-m', 'src-mock', { by: 't' }); if (p2.rev !== 2 || !/excluded/.test(rd(join(fdr, 'mockup', 'diff-scenarios.json')))) fails.push('promote rev2 · 시나리오 보존');
    if (checkMockup(tmp, fdr).length) fails.push('in-progress 형식 통과여야: ' + checkMockup(tmp, fdr).join(' | '));
    // 목업 저장소 원본(rev.yaml) — draft 거부 · 변조 거부 · confirmed 통과 + source_* 스탬프 + _assets 복사 · 무스타일 거부
    const mk = join(tmp, 'mockups'); mkdirSync(join(mk, 'screens', 'ds', 'list'), { recursive: true }); mkdirSync(join(mk, 'screens', '_assets'), { recursive: true });
    writeFileSync(join(mk, 'screens', '_assets', 'tokens.css'), ':root{}'); writeFileSync(join(mk, 'screens', 'ds', 'list', '_screen.css'), '');
    const h1 = '<html><head><link rel="stylesheet" href="../../_assets/tokens.css"><link rel="stylesheet" href="./_screen.css"></head><body>x</body></html>'; writeFileSync(join(mk, 'screens', 'ds', 'list', '01-default.html'), h1);
    const revY = (st, h) => `screen: ds/list\nrev: 3\nvisual_status: ${st}\nconfirmed: 2026-01-02\nconfirmed_by: "cto"\nfiles:\n  01-default.html: ${h}\n`;
    writeFileSync(join(mk, 'screens', 'ds', 'list', 'rev.yaml'), revY('draft', sha(h1)));
    writeFileSync(join(tmp, 'harness.yaml'), 'scratch:\n  dir: .scratch\nmockup:\n  origin_env: T_ORIGIN\n  viewport: 800x600\n  threshold: 0.5\nreferences:\n  - { path: mockups, role: mockup, mode: read-only }\n');
    const fdr2 = join(tmp, RECORD_DIRS.FDR, 'FDR-000000-n'); mkdirSync(fdr2, { recursive: true }); writeFileSync(join(fdr2, 'fdr.md'), '---\nid: FDR-000000-n\nstatus: in-progress\n---\n- 작성: t\n');
    try { promote(tmp, 'FDR-000000-n', 'ds/list', { by: 't' }); fails.push('draft 원본 통과'); } catch (e) { if (!/confirmed 목업만/.test(e.message)) fails.push('draft 거부 사유: ' + e.message); }
    writeFileSync(join(mk, 'screens', 'ds', 'list', 'rev.yaml'), revY('confirmed', 'f'.repeat(64)));
    try { promote(tmp, 'FDR-000000-n', 'ds/list', { by: 't' }); fails.push('변조 원본 통과'); } catch (e) { if (!/해시와 다르다/.test(e.message)) fails.push('변조 거부 사유: ' + e.message); }
    writeFileSync(join(mk, 'screens', 'ds', 'list', 'rev.yaml'), revY('confirmed', sha(h1)));
    const pn = promote(tmp, 'FDR-000000-n', 'ds/list', { by: 't' }); const rn = rd(join(fdr2, 'mockup', 'rev.yaml'));
    if (pn.files[0] !== 'list/01-default.html' || !/source_rev: 3/.test(rn) || !/source_confirmed_by: "cto"/.test(rn) || !/source_screen: ds\/list/.test(rn) || !existsSync(join(fdr2, '_assets', 'tokens.css')) || !existsSync(join(fdr2, 'mockup', 'list', '_screen.css')) || existsSync(join(fdr2, 'mockup', 'list', 'rev.yaml'))) fails.push('참조 승격: ' + JSON.stringify(pn) + rn);
    writeFileSync(join(mk, 'screens', 'ds', 'list', '01-default.html'), h1.replace('./_screen.css', './nope.css')); writeFileSync(join(mk, 'screens', 'ds', 'list', 'rev.yaml'), revY('confirmed', sha(rd(join(mk, 'screens', 'ds', 'list', '01-default.html')))));
    try { promote(tmp, 'FDR-000000-n', 'ds/list', { by: 't' }); fails.push('무스타일 통과'); } catch (e) { if (!/자산 참조가 열리지 않는다/.test(e.message)) fails.push('무스타일 거부 사유: ' + e.message); }
    if (existsSync(join(fdr2, 'mockup'))) fails.push('실패한 승격의 잔해가 남음');
    // 원본 드리프트 — 승격(rev 3) 뒤 원본이 rev 4로 재확정되면 shipped 거부 · reopen 중이면 거부 · 같은 rev면 통과 · in-progress는 막지 않음 · policy.md 변조는 승격 거부
    writeFileSync(join(mk, 'screens', 'ds', 'list', '01-default.html'), h1); writeFileSync(join(mk, 'screens', 'ds', 'list', 'policy.md'), '# p\n');
    const revP = (st, r) => `screen: ds/list\nrev: ${r}\nvisual_status: ${st}\nconfirmed: 2026-01-02\nconfirmed_by: "cto"\nfiles:\n  01-default.html: ${sha(h1)}\n  policy.md: ${sha('# p\n')}\n`;
    writeFileSync(join(mk, 'screens', 'ds', 'list', 'rev.yaml'), revP('confirmed', 3));
    promote(tmp, 'FDR-000000-n', 'ds/list', { by: 't' }); writeFileSync(join(fdr2, 'mockup', 'diff-scenarios.json'), JSON.stringify([{ state: 'list/01-default.html', excluded: 't' }]));
    const stN = (s) => writeFileSync(join(fdr2, 'fdr.md'), `---\nid: FDR-000000-n\nstatus: ${s}\n---\n- 작성: t\n`);
    const sd = () => checkMockup(tmp, fdr2).filter((p) => /재확정됐다|reopen 중/.test(p));
    stN('shipped'); if (sd().length) fails.push('같은 rev 드리프트 오탐: ' + sd().join(' | '));
    writeFileSync(join(mk, 'screens', 'ds', 'list', 'rev.yaml'), revP('confirmed', 4)); if (!sd().some((p) => /rev 4로 재확정/.test(p))) fails.push('원본 rev 증가 미검출');
    writeFileSync(join(mk, 'screens', 'ds', 'list', 'rev.yaml'), revP('reopened', 3)); if (!sd().some((p) => /reopen 중/.test(p))) fails.push('원본 reopen 미검출');
    stN('in-progress'); writeFileSync(join(mk, 'screens', 'ds', 'list', 'rev.yaml'), revP('confirmed', 4)); if (sd().length) fails.push('in-progress에 드리프트 차단(작업 중은 막지 않는다)');
    // 정책이 개발까지(RFC-261029 A) — 스탬프 policy: 블록 · 스펙 인용 없음 → 위반 · 인용 → 통과 · 사본 변조 → 위반
    const stampN = rd(join(fdr2, 'mockup', 'rev.yaml')); if (!/^policy:\n/m.test(stampN) || !/^  list\/policy\.md: [0-9a-f]{64}$/m.test(stampN) || !/^  list\/_screen\.css: [0-9a-f]{64}$/m.test(stampN)) fails.push('승격 스탬프에 policy: 블록(policy.md·css) 없음: ' + stampN);
    const cite = () => checkMockup(tmp, fdr2).filter((p) => /정책을 인용|승격 사본/.test(p));
    if (!cite().some((p) => /정책을 인용하지 않는다/.test(p))) fails.push('스펙 인용 없음 미검출');
    writeFileSync(join(fdr2, 'fdr.md'), `---\nid: FDR-000000-n\nstatus: in-progress\n---\n- 작성: t\n\n## 1. Spec\n\n- 출처: mockup/list/policy.md rev ${readRev(fdr2).rev}\n\n## 2. Design\n`);
    if (cite().length) fails.push('인용 뒤 오탐: ' + cite().join(' | '));
    writeFileSync(join(fdr2, 'mockup', 'list', 'policy.md'), '# p\n- 개발이 몰래\n'); if (!cite().some((p) => /승격 사본 list\/policy\.md가 승격 때와 다르다/.test(p))) fails.push('사본 변조 미검출');
    writeFileSync(join(fdr2, 'mockup', 'list', 'policy.md'), '# p\n');
    writeFileSync(join(mk, 'screens', 'ds', 'list', 'policy.md'), '# p\n- 몰래\n');
    try { promote(tmp, 'FDR-000000-n', 'ds/list', { by: 't' }); fails.push('policy.md 변조 원본 통과'); } catch (e) { if (!/policy\.md: 확정본/.test(e.message)) fails.push('policy 변조 거부 사유: ' + e.message); }
    writeFileSync(join(mk, 'screens', 'ds', 'list', 'policy.md'), '# p\n'); rmSync(join(fdr2, 'mockup'), { recursive: true, force: true });
    // init — 가짜 템플릿으로 embedded·separate(clone 경로) 둘 다, references 등록·교체
    const tpl = join(tmp, 'tpl'); mkdirSync(join(tpl, 'scripts'), { recursive: true }); mkdirSync(join(tpl, '.claude'), { recursive: true }); mkdirSync(join(tpl, 'runbooks'), { recursive: true });
    writeFileSync(join(tpl, 'mockup.yaml'), 'project: "{{PROJECT_NAME}}"\n'); writeFileSync(join(tpl, 'AGENTS.md'), '# {{PROJECT_NAME}}\n'); writeFileSync(join(tpl, 'CLAUDE.md'), 'x'); writeFileSync(join(tpl, 'scripts', 'validate.mjs'), 'process.exit(0)');
    writeFileSync(join(tpl, 'init.mjs'), "import{readFileSync,writeFileSync,unlinkSync}from'node:fs';const n=process.argv[process.argv.indexOf('--name')+1];for(const f of['mockup.yaml','AGENTS.md'])writeFileSync(f,readFileSync(f,'utf8').replace(/\\{\\{PROJECT_NAME\\}\\}/g,n));unlinkSync('init.mjs');");
    const devA = join(tmp, 'dev-a'); mkdirSync(devA, { recursive: true }); writeFileSync(join(devA, 'harness.yaml'), 'project: "alpha"\nreferences: []               # 설명\nmetrics:\n  enabled: true\n');
    const e1 = initMockup(devA, 'embedded', { from: tpl });
    const hyA = rd(join(devA, 'harness.yaml'));
    if (e1.path !== 'mockups' || !existsSync(join(devA, 'mockups', 'scripts', 'validate.mjs')) || existsSync(join(devA, 'mockups', '.claude')) || existsSync(join(devA, 'mockups', 'init.mjs')) || !/project: "alpha"/.test(rd(join(devA, 'mockups', 'mockup.yaml'))) || !/^references:[^\n]*\n  - \{ path: mockups, role: mockup, mode: read-write, embedded: true \}\n/m.test(hyA) || !/^metrics:/m.test(hyA)) fails.push('init embedded: ' + JSON.stringify(e1) + '\n' + hyA);
    try { initMockup(devA, 'embedded', { from: tpl }); fails.push('init 중복 통과'); } catch { /* 기대 */ }
    try { initMockup(devA, 'nowhere', { from: tpl }); fails.push('잘못된 mode 통과'); } catch { /* 기대 */ }
    const devB = join(tmp, 'dev-b'); mkdirSync(devB, { recursive: true }); writeFileSync(join(devB, 'harness.yaml'), 'project: "beta"\nreferences:\n  - { path: ../ro, mode: read-only }\n');
    const e2 = initMockup(devB, 'separate', { from: tpl, gh: false });
    const hyB = rd(join(devB, 'harness.yaml'));
    if (e2.path !== '../beta-mockups' || !existsSync(join(tmp, 'beta-mockups', '.git')) || !existsSync(join(tmp, 'beta-mockups', 'CLAUDE.md')) || !/^  - \{ path: \.\.\/ro, mode: read-only \}\n  - \{ path: \.\.\/beta-mockups, role: mockup, mode: read-write, writable: \[qa\/\] \}\n/m.test(hyB)) fails.push('init separate: ' + JSON.stringify(e2) + '\n' + hyB);
    registerMockupRef(devB, { path: 'mockups', mode: 'read-write', embedded: true }); if ((rd(join(devB, 'harness.yaml')).match(/role: mockup/g) || []).length !== 1) fails.push('references 교체');
    const cfg = mockupConfig(tmp); if (cfg.originEnv !== 'T_ORIGIN' || cfg.viewport.width !== 800 || cfg.threshold !== 0.5) fails.push('config');
    // 설정 생성
    const built = buildConfig(tmp, 'FDR-000000-m', { origin: 'http://x:1', cfg });
    const s0 = built.config.scenarios[0];
    if (built.config.scenarios.length !== 1 || built.excluded.length !== 1 || s0.url !== 'http://x:1/list' || !/^file:/.test(s0.referenceUrl) || s0.selectors[0] !== '.pane' || s0.hideSelectors[0] !== '.clock' || s0.harnessClicks[0] !== '#a' || s0.misMatchThreshold !== 0.5 || built.config.viewports[0].width !== 800 || !existsSync(join(built.config.paths.engine_scripts, 'backstop-onReady.cjs'))) fails.push('buildConfig');
    if (buildConfig(tmp, 'FDR-000000-m', { origin: 'http://x:1', cfg, states: ['src-mock/02-empty'] }).config.scenarios.length !== 0) fails.push('--state 필터');
    // 기록기 — 가짜 backstop 리포트 + 캡처
    const jr = join(built.config.paths.json_report); mkdirSync(join(built.config.paths.bitmaps_test, 'r1'), { recursive: true }); mkdirSync(jr, { recursive: true }); mkdirSync(join(built.config.paths.bitmaps_reference), { recursive: true });
    const cap = Buffer.from('PNGFAKE-target'); writeFileSync(join(built.config.paths.bitmaps_test, 'r1', 't.png'), cap); writeFileSync(join(built.config.paths.bitmaps_reference, 'r.png'), 'PNGFAKE-ref'); writeFileSync(join(built.config.paths.bitmaps_test, 'r1', 'd.png'), 'PNGFAKE-diff');
    const report = (status, pct) => ({ tests: [{ status, pair: { label: s0.label, reference: '../reference/r.png', test: '../test/r1/t.png', diffImage: status === 'fail' ? '../test/r1/d.png' : undefined, diff: { isSameDimensions: true, rawMisMatchPercentage: pct, misMatchPercentage: String(pct) } } }] });
    const res1 = record(tmp, 'FDR-000000-m', { report: report('pass', 0.0031), built, agent: 't', cfg });
    const e = res1.scenarios.find((x) => x.state === 'src-mock/01-default.html');
    if (res1.summary.pass !== 1 || res1.summary.excluded !== 1 || !e || e.status !== 'pass' || e.mismatchPct !== 0.0031 || e.captures.target !== 'src-mock__01-default.target.png' || e.captureSha256.target !== sha(cap) || !existsSync(join(fdr, 'evidence', 'mockup-diff', 'rev2', 'src-mock__01-default.target.png')) || e.stateSha256 !== readRev(fdr).files['src-mock/01-default.html']) fails.push('record pass: ' + JSON.stringify(e));
    const res2 = record(tmp, 'FDR-000000-m', { report: report('fail', 3.2), built, agent: 't', cfg });
    const f = res2.scenarios.find((x) => x.state === 'src-mock/01-default.html'); if (f.status !== 'fail' || !f.captures.ref || !f.captures.diff || !existsSync(join(fdr, 'evidence', 'mockup-diff', 'rev2', 'src-mock__01-default.diff.png'))) fails.push('record fail: ' + JSON.stringify(f));
    const res3 = record(tmp, 'FDR-000000-m', { report: { tests: [] }, built, agent: 't', cfg }); if (res3.summary.error !== 1) fails.push('record error');
    // check — 완료 게이트
    writeFileSync(join(fdr, 'fdr.md'), '---\nid: FDR-000000-m\nstatus: shipped\n---\n- 작성: t\n');
    if (!checkMockup(tmp, fdr).some((x) => /대조 오류/.test(x))) fails.push('error 기록 미검출');
    record(tmp, 'FDR-000000-m', { report: report('pass', 0), built, agent: 't', cfg }); let pr = checkMockup(tmp, fdr); if (pr.length) fails.push('양성 오탐: ' + pr.join(' | '));
    record(tmp, 'FDR-000000-m', { report: report('fail', 3.2), built, agent: 't', cfg }); if (!checkMockup(tmp, fdr).some((x) => /임계 초과 미등재/.test(x))) fails.push('초과 미등재 미검출');
    writeFileSync(join(fdr, 'mockup', 'deviations.json'), JSON.stringify([{ state: 'src-mock/01-default.html', reason: '승인된 차이', approved_by: 'cto', date: '2026-01-01' }])); if (checkMockup(tmp, fdr).length) fails.push('등재된 초과가 통과여야');
    rmSync(join(fdr, 'mockup', 'deviations.json'));
    record(tmp, 'FDR-000000-m', { report: report('pass', 0), built, agent: 't', cfg });
    writeFileSync(join(fdr, 'evidence', 'mockup-diff', 'rev2', 'src-mock__01-default.target.png'), 'tampered'); if (!checkMockup(tmp, fdr).some((x) => /캡처 해시 불일치/.test(x))) fails.push('캡처 위조 미검출');
    rmSync(join(fdr, 'evidence', 'mockup-diff', 'rev2', 'results.json')); if (!checkMockup(tmp, fdr).some((x) => /대조 기록이 없다/.test(x))) fails.push('기록 없음 미검출');
    promote(tmp, 'FDR-000000-m', 'src-mock', { by: 't' }); record(tmp, 'FDR-000000-m', { report: report('pass', 0), built, agent: 't', cfg });   // built는 rev2 — rev3 스탬프와 어긋남
    if (!checkMockup(tmp, fdr).some((x) => /대조 기록이 없다|옛 목업/.test(x))) fails.push('옛 rev 미검출');
    writeFileSync(join(fdr, 'mockup', 'diff-scenarios.json'), JSON.stringify([{ state: 'src-mock/01-default.html', excluded: 'x' }, { state: 'src-mock/02-empty.html', excluded: 'y' }])); if (!checkMockup(tmp, fdr).some((x) => /전 상태 excluded/.test(x))) fails.push('전 상태 excluded 미검출');
    writeFileSync(join(fdr, 'mockup', 'diff-scenarios.json'), JSON.stringify([{ state: 'src-mock/01-default.html', path: '/' }, { state: 'src-mock/99-ghost.html', path: '/' }])); const pr3 = checkMockup(tmp, fdr); if (!pr3.some((x) => /미커버: src-mock\/02-empty/.test(x)) || !pr3.some((x) => /유령 시나리오: src-mock\/99-ghost/.test(x))) fails.push('미커버·유령 미검출');
  } catch (e) { fails.push('예외: ' + e.stack.split('\n').slice(0, 2).join(' ')); }
  rmSync(tmp, { recursive: true, force: true });
  const eng = loadBackstop(DEFAULT_ROOT);
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : `self-test OK (promote rev 2회 · 원본 rev.yaml 검증 4 · 원본 드리프트 4 · policy 변조 · 정책 지문·스펙 인용 4 · 설정 생성·필터 · 기록기 pass/fail/error · check 8종 — 캡처 실행은 ${eng ? `backstopjs ${eng.version} @ ${eng.from}(run으로 실측)` : 'backstopjs 없음, 미검증 — engine --install'})`);
  process.exit(fails.length ? 1 : 0);
}

// ---------- CLI ----------
if (IS_MAIN && !process.argv.includes('--self-test')) {
  const argv = process.argv.slice(2); const [cmd, a, b] = argv;
  const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const agent = opt('--agent') || opt('--by') || process.env.HARNESS_AGENT || '(모델 미확인)';
  const targets = (id) => (id === '--all' || argv.includes('--all') ? listFdrs(DEFAULT_ROOT).filter((d) => existsSync(join(d, 'mockup'))).map((d) => basename(d)) : id ? [id] : []);
  try {
    if (cmd === 'promote') { if (!a || !b) throw new Error('사용: promote <FDR-ID> <모듈>/<화면>|<폴더> [--by "<에이전트>"]'); const r = promote(DEFAULT_ROOT, a, b, { by: agent }); console.log(`${r.id} mockup rev ${r.rev} ← ${b}${r.source ? ` (목업 저장소 ${r.source.screen} rev ${r.source.rev} · 확정 ${r.source.confirmed_by})` : ''} (${r.files.length}개 상태) → ${posix(relative(DEFAULT_ROOT, r.path))}\n다음: mockup/diff-scenarios.json에 상태별 path·조작·범위를 적는다. 도달 불가는 excluded + 사유`); }
    else if (cmd === 'run') { const ids = targets(a); if (!ids.length) throw new Error('사용: run <FDR-ID>|--all [--state <이름>]'); let bad = 0; for (const id of ids) { console.log(`${id} (rev ${readRev(fdrDirOf(DEFAULT_ROOT, id))?.rev ?? '?'})`); const r = await run(DEFAULT_ROOT, id, { states: argv.filter((x, i) => argv[i - 1] === '--state'), agent }); const s = r.summary; console.log(`  → 실행 ${s.run} · 통과 ${s.pass} · 초과 ${s.fail} · 오류 ${s.error} · 제외 ${s.excluded} · 기록 ${posix(relative(DEFAULT_ROOT, resultsPath(fdrDirOf(DEFAULT_ROOT, id), r.rev)))}`); bad += s.fail + s.error; } process.exit(bad ? 1 : 0); }
    else if (cmd === 'check') { const ids = a ? targets(a) : targets('--all'); let n = 0; for (const id of ids) { const p = checkMockup(DEFAULT_ROOT, fdrDirOf(DEFAULT_ROOT, id)); if (p.length) { n += p.length; console.log(`${id}:\n- ` + p.join('\n- ')); } } console.log(n ? `목업 대조 위반 ${n}건` : `목업 대조 OK (${ids.length}개 FDR)`); process.exit(n ? 1 : 0); }
    else if (cmd === 'init') { const r = initMockup(DEFAULT_ROOT, a, { name: opt('--name'), from: opt('--from'), owner: opt('--owner'), gh: !argv.includes('--no-gh') }); console.log(`목업 저장소(${r.mode}) → ${r.path} (${r.created})\nharness.yaml references: ${r.ref}\n다음: ${r.mode === 'embedded' ? 'node .harness/scripts/harness-build.mjs (design-mockup 입구 생성) → ' : ''}node ${r.path}/scripts/new-screen.mjs <모듈> <화면> "<제목>"`); }
    else if (cmd === 'engine') { if (argv.includes('--install')) { const d = installEngine(); console.log(`설치 완료 → ${d} (PC 공용 · 프로젝트는 이 경로를 자동으로 찾는다)`); } const e = loadBackstop(DEFAULT_ROOT); console.log(e ? `backstopjs ${e.version} @ ${e.from} (${e.dir})` : `backstopjs 없음 — 찾은 곳: ${engineCandidates(DEFAULT_ROOT).map((c) => `${c.from}=${c.dir}`).join(' · ')}\n설치(PC당 1회): node .harness/scripts/mockup-diff.mjs engine --install`); process.exit(e ? 0 : 1); }
    else { console.error('사용: node .harness/scripts/mockup-diff.mjs promote <FDR-ID> <모듈>/<화면>|<폴더> | run <FDR-ID>|--all [--state <이름>] | check [<FDR-ID>|--all] | engine [--install]'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
