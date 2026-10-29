#!/usr/bin/env node
// init.mjs — 하네스C 템플릿을 새 프로젝트에 적용한다 (결정론 복사 · {{VAR}} 치환 · 코어 해시 매니페스트).
//
// 사용:  node init.mjs --interactive [--prune] [--remote]                질문으로 정한다(권장) — 사람이 터미널에서
//        node init.mjs --answers <answers.json> [--prune] [--remote]     질문으로 정한다 — 에이전트가 자기 런타임의 질문 도구로 물은 답을 파일로
//        node init.mjs --name <프로젝트명> [--tier S|M|L] [--dry-run] [--prune]   티어를 직접(질문 없이)
//        node init.mjs --self-test
//        질문 모드는 답에서 티어를 판정해 적용한 뒤 .harness/scripts/setup.mjs가 harness.yaml 근거 주석·setup 블록·첫 ADR(project-setup)·후속 동작을 맡는다
// 동작:  ① .harness/tiers/<T>/ 오버레이를 루트에 복사(오버레이는 덮어쓴다 — 저작된 변형이므로)
//        ② 루트 텍스트 파일의 {{PROJECT_NAME}} {{DATE}} {{TIER}} 치환 (템플릿 원본인 .harness/templates/·tiers/는 제외)
//        ③ harness.yaml의 tier·project 갱신
//        ④ .harness/init-manifest.json 에 코어 파일(lib/core-files.mjs CORE_PATHS)의 sha256 기록 — lint ⑫가 "프로젝트에서 코어를 고쳤는지" 검사한다
//        ⑤ --prune 이면 템플릿 전용(.harness/tiers/, init.mjs, README-tier.md, docs/methodology/)을 제거
// 템플릿에는 모든 프로젝트에서 동일하게 동작하는 것만 있다. 도메인 규칙은 프로젝트의 rules/domain/에 직접 쓴다(예시: docs/methodology/domain-rules/).
// 원칙:  의존성 0 · 루트 밖 쓰기 금지 · 비파괴(오버레이 외 기존 파일 보존) · 같은 입력 → 같은 출력.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashCore } from './.harness/scripts/lib/core-files.mjs';
import { DOCS_DIRS } from './.harness/scripts/lib/records.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_EXT = /\.(md|yaml|yml|json|mjs|js|ts|txt|html|css)$/i;
const SKIP_REL = new Set(['.git', 'node_modules', '.scratch', '.harness/tiers', '.harness/templates', '.harness/scripts', '.harness/runbooks', '.claude', '.agents', '.gemini']); // 루트 기준 — 템플릿 원본·스크립트의 {{…}}는 치환하지 않는다 (sync-core와 같은 범위)

function parseArgs(argv) {
  const a = { tier: 'M', name: null, dryRun: false, prune: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--name') a.name = argv[++i];
    else if (k === '--tier') a.tier = String(argv[++i] || '').toUpperCase();
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--prune') a.prune = true;
    else if (k === '--self-test') a.selfTest = true;
    else if (k === '--interactive') a.interactive = true;
    else if (k === '--answers') a.answers = argv[++i];
    else if (k === '--remote') a.remote = true;
    else if (k === '--no-actions') a.noActions = true;
    else if (k === '--agent') a.agent = argv[++i];
  }
  return a;
}

const walk = (dir, out = [], base = dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_REL.has(relative(base, p).split(sep).join('/')) && !(p !== base && existsSync(join(p, '.git')))) walk(p, out, base); }   // 자기 .git을 가진 중첩 체크아웃(다른 저장소)은 건드리지 않는다
    else out.push(p);
  }
  return out;
};
const inside = (root, p) => { const r = relative(root, p); return r && !r.startsWith('..') && !r.includes(`..${sep}`); };

function copyTree(src, dst, log) {
  if (!existsSync(src)) return;
  for (const f of walk(src, [], src)) {
    const rel = relative(src, f);
    const target = join(dst, rel);
    if (!inside(dst, target)) throw new Error(`경로 탈출 차단: ${rel}`);
    mkdirSync(dirname(target), { recursive: true });
    const existed = existsSync(target);
    cpSync(f, target);
    log.push({ path: rel.replaceAll(sep, '/'), status: existed ? 'overlay' : 'create' });
  }
}
function substituteAll(root, vars, log) {
  for (const f of walk(root, [], root)) {
    if (!TEXT_EXT.test(f)) continue;
    const before = readFileSync(f, 'utf8');
    const after = before.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
    if (after !== before) { writeFileSync(f, after); log.push({ path: relative(root, f).replaceAll(sep, '/'), status: 'substitute' }); }
  }
}
function updateHarnessYaml(root, { name, tier }) {
  const p = join(root, 'harness.yaml');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^project:.*$/m, `project: "${name}"`).replace(/^tier:.*$/m, `tier: ${tier}`));
}

export function run(opts, root = ROOT) {
  if (!['S', 'M', 'L'].includes(opts.tier)) throw new Error(`tier는 S|M|L: ${opts.tier}`);
  const log = [];
  const date = new Date().toISOString().slice(0, 10);
  const vars = { PROJECT_NAME: opts.name, DATE: date, TIER: opts.tier };
  const tierDir = join(root, '.harness', 'tiers', opts.tier);
  if (opts.dryRun) return { dryRun: true, vars, plan: existsSync(tierDir) ? walk(tierDir, [], tierDir).map((f) => `overlay ${relative(tierDir, f)}`) : [] };
  copyTree(tierDir, root, log);
  substituteAll(root, vars, log);
  updateHarnessYaml(root, opts);
  const yamlScalar = (t, k) => ((t.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
  const manifest = { schema: 'harnessC.init-manifest', version: 2, generatedBy: 'init.mjs (deterministic copy)', date, tier: opts.tier, project: opts.name, coreVersion: yamlScalar(readFileSync(join(root, 'harness.yaml'), 'utf8'), 'harness'), core: hashCore(root), log: log.map((l) => `${l.status} ${l.path}`) };
  writeFileSync(join(root, '.harness', 'init-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (opts.prune) {
    rmSync(join(root, '.harness', 'tiers'), { recursive: true, force: true });
    rmSync(join(root, 'init.mjs'), { force: true });
    rmSync(join(root, 'README-tier.md'), { force: true });
    rmSync(join(root, 'LICENSE'), { force: true });   // 루트 LICENSE는 템플릿 저장소의 것 — 프로젝트는 자기 라이선스를 고른다. 코어의 MIT 고지는 .harness/LICENSE에 남는다(sync-core가 유지)
    rmSync(join(root, 'docs', 'methodology'), { recursive: true, force: true });
  }
  return { dryRun: false, vars, log, manifest };
}

async function selfTest() {
  const tmp = join(ROOT, '.init-selftest');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  for (const name of readdirSync(ROOT)) if (!['.git', 'node_modules', '.init-selftest', '.scratch', 'mockup-template'].includes(name)) cpSync(join(ROOT, name), join(tmp, name), { recursive: true });   // mockup-template: 중첩 체크아웃(별도 저장소 · gitignore)
  const fails = [];
  try {
    const r = run({ name: 'selftest-proj', tier: 'S', dryRun: false, prune: true }, tmp);
    const y = readFileSync(join(tmp, 'harness.yaml'), 'utf8');
    if (!/^tier: S$/m.test(y) || !/^project: "selftest-proj"$/m.test(y)) fails.push('harness.yaml 미갱신');
    if (/\{\{PROJECT_NAME\}\}/.test(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8'))) fails.push('치환 누락');
    const tplReadme = join(tmp, '.harness', 'templates', 'collab-skeleton', 'README.md');
    if (!existsSync(tplReadme) || !/\{\{PROJECT_NAME\}\}/.test(readFileSync(tplReadme, 'utf8'))) fails.push('템플릿 원본이 치환됨');
    if (Object.keys(r.manifest.core).length < 10 || Object.values(r.manifest.core).some((h) => h.length !== 64)) fails.push('core 해시 없음');
    if (existsSync(join(tmp, '.harness', 'tiers')) || existsSync(join(tmp, 'init.mjs')) || existsSync(join(tmp, 'docs', 'methodology'))) fails.push('prune 미동작');
    if (existsSync(join(tmp, 'LICENSE')) || !existsSync(join(tmp, '.harness', 'LICENSE'))) fails.push('prune: 루트 LICENSE는 지우고 .harness/LICENSE는 남겨야');
    const docsTop = readdirSync(join(tmp, 'docs')).filter((n) => !n.includes('.')).sort().join(',');
    if (docsTop !== [...DOCS_DIRS].sort().join(',')) fails.push(`docs/ 폴더 고정 위반: ${docsTop}`);
    try { run({ name: 'x', tier: 'Q', dryRun: true }, tmp); fails.push('잘못된 tier 통과'); } catch { /* 기대: 거부 */ }
    // 질문 모드 — 답 파일로 init: 답에서 티어 판정(동시 3 → M · pr) · 근거 주석 · 첫 ADR · prune
    const tmp2 = join(ROOT, '.init-selftest-q'); rmSync(tmp2, { recursive: true, force: true }); mkdirSync(tmp2);
    for (const name of readdirSync(ROOT)) if (!['.git', 'node_modules', '.init-selftest', '.init-selftest-q', '.scratch', 'mockup-template'].includes(name)) cpSync(join(ROOT, name), join(tmp2, name), { recursive: true });
    writeFileSync(join(tmp2, '.scratch-answers.json'), JSON.stringify({ name: 'qa-proj', concurrent: 3, ui: 'none', duration_months: 4 }));
    try {
      const { execSync } = await import('node:child_process');
      execSync(`"${process.execPath}" init.mjs --answers .scratch-answers.json --prune --no-actions --agent init-selftest`, { cwd: tmp2, stdio: 'ignore' });
      const y = readFileSync(join(tmp2, 'harness.yaml'), 'utf8');
      if (!/^tier: M\s+# 근거:/m.test(y) || !/^  merge: pr\s+# 근거: Q2/m.test(y) || !/^project: "qa-proj"$/m.test(y)) fails.push('질문 모드 harness.yaml');
      if (!readdirSync(join(tmp2, 'docs', 'decisions')).some((f) => /^ADR-\d{6}-project-setup\.md$/.test(f))) fails.push('질문 모드 ADR');
      if (existsSync(join(tmp2, 'init.mjs'))) fails.push('질문 모드 prune');
    } catch (e) { fails.push('질문 모드 실행: ' + e.message.split('\n')[0]); }
    rmSync(tmp2, { recursive: true, force: true });
  } catch (e) { fails.push(`예외: ${e.message}`); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? `self-test FAIL: ${fails.join(' · ')}` : 'self-test OK (적용·치환·템플릿 원본 보존·core 해시·prune·docs 고정·거부 · 질문 모드(답→티어·근거·ADR))');
  process.exit(fails.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) await selfTest();
  else if (opts.interactive || opts.answers) {
    // 질문 모드 — 답 → 티어 판정 → 템플릿 적용 → setup.mjs(설정·근거·ADR·후속 동작)
    const S = await import(pathToFileURL(join(ROOT, '.harness', 'scripts', 'setup.mjs')).href);
    const raw = opts.answers ? JSON.parse(readFileSync(resolve(opts.answers), 'utf8')) : await S.ask(opts.name ? { name: opts.name } : {});
    const { answers, problems } = S.normalize(raw);
    if (problems.length) { console.error('답이 올바르지 않다:\n- ' + problems.join('\n- ')); process.exit(2); }
    const d = S.derive(answers);
    const r = run({ name: answers.name, tier: d.tier, prune: opts.prune, dryRun: false });
    const s = await S.setup(ROOT, raw, { agent: opts.agent || process.env.HARNESS_AGENT || '(모델 미확인)', remote: opts.remote, actions: !opts.noActions });
    console.log(`적용 완료 — ${answers.name} · tier ${d.tier}(FDR ${d.profile}) · merge ${d.merge} · 필수 승인 ${d.reviews} · gate ${d.gate_mode} · 규칙 상한 ${d.always_on_kb}KB · 코어 ${Object.keys(r.manifest.core).length}파일 해시`);
    for (const w of d.warnings) console.log(`주의: ${w}`);
    for (const x of d.actions) console.log(`후속: ${x.why} — ${x.done || (x.remote ? `사람이: ${x.cmd} (또는 --remote)` : x.cmd)}`);
    console.log(`기록: ${s.adr.id} · harness.yaml 「# 근거」·setup 블록 · 조건이 바뀌면 node .harness/scripts/setup.mjs --interactive --reconfigure`);
  }
  else {
    if (!opts.name) { console.error('사용: node init.mjs --interactive [--prune] | --answers <answers.json> [--prune] | --name <프로젝트명> [--tier S|M|L] [--dry-run] [--prune]'); process.exit(2); }
    const r = run(opts);
    if (r.dryRun) { console.log(`[dry-run] tier=${opts.tier}`); for (const l of r.plan) console.log('  ' + l); }
    else { const c = r.log.reduce((m, l) => ((m[l.status] = (m[l.status] || 0) + 1), m), {}); console.log(`적용 완료 tier=${opts.tier} · ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · ')} · 코어 ${Object.keys(r.manifest.core).length}파일 해시 → .harness/init-manifest.json`); }
  }
}
