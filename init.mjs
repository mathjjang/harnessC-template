#!/usr/bin/env node
// init.mjs — 하네스C 템플릿을 새 프로젝트에 적용한다 (결정론 복사 · {{VAR}} 치환 · 코어 해시 매니페스트).
//
// 사용:  node init.mjs --name <프로젝트명> [--tier S|M|L] [--dry-run] [--prune]
//        node init.mjs --self-test
// 동작:  ① .harness/tiers/<T>/ 오버레이를 루트에 복사(오버레이는 덮어쓴다 — 저작된 변형이므로)
//        ② 루트 텍스트 파일의 {{PROJECT_NAME}} {{DATE}} {{TIER}} 치환 (템플릿 원본인 .harness/templates/·tiers/는 제외)
//        ③ harness.yaml의 tier·project 갱신
//        ④ .harness/init-manifest.json 에 코어 파일(lib/core-files.mjs CORE_PATHS)의 sha256 기록 — lint ⑫가 "프로젝트에서 코어를 고쳤는지" 검사한다
//        ⑤ --prune 이면 템플릿 전용(.harness/tiers/, init.mjs, README-tier.md, docs/methodology/)을 제거
// 템플릿에는 모든 프로젝트에서 동일하게 동작하는 것만 있다. 도메인 규칙은 프로젝트의 rules/domain/에 직접 쓴다(예시: docs/methodology/domain-rules/).
// 원칙:  의존성 0 · 루트 밖 쓰기 금지 · 비파괴(오버레이 외 기존 파일 보존) · 같은 입력 → 같은 출력.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashCore } from './.harness/scripts/lib/core-files.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_EXT = /\.(md|yaml|yml|json|mjs|js|ts|txt|html|css)$/i;
const SKIP_REL = new Set(['.git', 'node_modules', '.scratch', '.harness/tiers', '.harness/templates']); // 루트 기준 — 템플릿 원본은 치환하지 않는다

function parseArgs(argv) {
  const a = { tier: 'M', name: null, dryRun: false, prune: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--name') a.name = argv[++i];
    else if (k === '--tier') a.tier = String(argv[++i] || '').toUpperCase();
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--prune') a.prune = true;
    else if (k === '--self-test') a.selfTest = true;
  }
  return a;
}

const walk = (dir, out = [], base = dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_REL.has(relative(base, p).split(sep).join('/'))) walk(p, out, base); }
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
    rmSync(join(root, 'docs', 'methodology'), { recursive: true, force: true });
  }
  return { dryRun: false, vars, log, manifest };
}

function selfTest() {
  const tmp = join(ROOT, '.init-selftest');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  for (const name of readdirSync(ROOT)) if (!['.git', 'node_modules', '.init-selftest', '.scratch'].includes(name)) cpSync(join(ROOT, name), join(tmp, name), { recursive: true });
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
    const docsTop = readdirSync(join(tmp, 'docs')).filter((n) => !n.includes('.')).sort().join(',');
    if (docsTop !== 'queue,records,requirements,specs') fails.push(`docs/ 폴더 고정 위반: ${docsTop}`);
    try { run({ name: 'x', tier: 'Q', dryRun: true }, tmp); fails.push('잘못된 tier 통과'); } catch { /* 기대: 거부 */ }
  } catch (e) { fails.push(`예외: ${e.message}`); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? `self-test FAIL: ${fails.join(' · ')}` : 'self-test OK (적용·치환·템플릿 원본 보존·core 해시·prune·docs 고정·거부)');
  process.exit(fails.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) selfTest();
  else {
    if (!opts.name) { console.error('사용: node init.mjs --name <프로젝트명> [--tier S|M|L] [--dry-run] [--prune]'); process.exit(2); }
    const r = run(opts);
    if (r.dryRun) { console.log(`[dry-run] tier=${opts.tier}`); for (const l of r.plan) console.log('  ' + l); }
    else { const c = r.log.reduce((m, l) => ((m[l.status] = (m[l.status] || 0) + 1), m), {}); console.log(`적용 완료 tier=${opts.tier} · ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · ')} · 코어 ${Object.keys(r.manifest.core).length}파일 해시 → .harness/init-manifest.json`); }
  }
}
