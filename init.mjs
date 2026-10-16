#!/usr/bin/env node
// init.mjs — 하네스C 템플릿을 새 프로젝트에 적용한다 (결정론 복사 · {{VAR}} 치환 · sha256 매니페스트).
//
// 사용:  node init.mjs --name <프로젝트명> [--tier S|M|L] [--packs a,b] [--dry-run] [--prune]
//        node init.mjs --self-test
// 동작:  ① tiers/<T>/ 오버레이를 루트에 복사(오버레이는 덮어쓴다 — 저작된 변형이므로)
//        ② packs/<p>/tree/ 를 루트에 복사(기존 파일은 덮어쓰지 않는다 — 충돌 보고)
//        ③ 루트 텍스트 파일의 {{PROJECT_NAME}} {{DATE}} {{TIER}} 치환
//        ④ harness.yaml의 tier·packs·project 갱신
//        ⑤ docs/init-manifest.json 에 생성·치환 파일의 sha256 기록
//        ⑥ --prune 이면 템플릿 전용 폴더(tiers/, packs/의 비활성 팩, init.mjs)를 제거
// 원칙:  의존성 0 · 루트 밖 쓰기 금지 · 비파괴(오버레이 외 기존 파일 보존) · 같은 입력 → 같은 출력.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_EXT = /\.(md|yaml|yml|json|mjs|js|ts|txt|html|css)$/i;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tiers', 'packs']);

function parseArgs(argv) {
  const a = { tier: 'M', packs: [], name: null, dryRun: false, prune: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--name') a.name = argv[++i];
    else if (k === '--tier') a.tier = String(argv[++i] || '').toUpperCase();
    else if (k === '--packs') a.packs = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--prune') a.prune = true;
    else if (k === '--self-test') a.selfTest = true;
  }
  return a;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const walk = (dir, out = [], base = dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) || dir !== base) walk(join(dir, e.name), out, base); }
    else out.push(join(dir, e.name));
  }
  return out;
};
const inside = (root, p) => { const r = relative(root, p); return r && !r.startsWith('..') && !r.includes(`..${sep}`); };

function copyTree(src, dst, { overwrite }, log) {
  if (!existsSync(src)) return;
  for (const f of walk(src, [], src)) {
    const rel = relative(src, f);
    const target = join(dst, rel);
    if (!inside(dst, target)) throw new Error(`경로 탈출 차단: ${rel}`);
    if (existsSync(target) && !overwrite) {
      const same = sha(readFileSync(target)) === sha(readFileSync(f));
      log.push({ path: rel.replaceAll(sep, '/'), status: same ? 'skip' : 'conflict' });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    cpSync(f, target);
    log.push({ path: rel.replaceAll(sep, '/'), status: existsSync(target) && overwrite ? 'overlay' : 'create' });
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

function updateHarnessYaml(root, { name, tier, packs }) {
  const p = join(root, 'harness.yaml');
  let y = readFileSync(p, 'utf8');
  y = y.replace(/^project:.*$/m, `project: "${name}"`)
       .replace(/^tier:.*$/m, `tier: ${tier}`)
       .replace(/^packs:.*$/m, `packs: [${packs.join(', ')}]`);
  writeFileSync(p, y);
}

export function run(opts, root = ROOT) {
  if (!['S', 'M', 'L'].includes(opts.tier)) throw new Error(`tier는 S|M|L: ${opts.tier}`);
  for (const p of opts.packs) if (!existsSync(join(root, 'packs', p, 'pack.yaml'))) throw new Error(`없는 팩: ${p}`);
  const log = [];
  const date = new Date().toISOString().slice(0, 10);
  const vars = { PROJECT_NAME: opts.name, DATE: date, TIER: opts.tier };
  if (opts.dryRun) {
    const plan = [];
    if (existsSync(join(root, 'tiers', opts.tier))) for (const f of walk(join(root, 'tiers', opts.tier), [], join(root, 'tiers', opts.tier))) plan.push(`overlay ${relative(join(root, 'tiers', opts.tier), f)}`);
    for (const p of opts.packs) if (existsSync(join(root, 'packs', p, 'tree'))) for (const f of walk(join(root, 'packs', p, 'tree'), [], join(root, 'packs', p, 'tree'))) plan.push(`pack:${p} ${relative(join(root, 'packs', p, 'tree'), f)}`);
    return { dryRun: true, vars, plan };
  }
  copyTree(join(root, 'tiers', opts.tier), root, { overwrite: true }, log);
  for (const p of opts.packs) copyTree(join(root, 'packs', p, 'tree'), root, { overwrite: false }, log);
  substituteAll(root, vars, log);
  updateHarnessYaml(root, opts);
  const files = [...new Set(log.filter((l) => l.status !== 'skip' && l.status !== 'conflict').map((l) => l.path))]
    .filter((p) => existsSync(join(root, p)))
    .map((p) => ({ path: p, sha256: sha(readFileSync(join(root, p))) }));
  const manifest = { schema: 'harnessC.init-manifest', version: 1, generatedBy: 'init.mjs (deterministic copy)', date, tier: opts.tier, packs: opts.packs, project: opts.name, files, conflicts: log.filter((l) => l.status === 'conflict').map((l) => l.path) };
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'init-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (opts.prune) {
    rmSync(join(root, 'tiers'), { recursive: true, force: true });
    for (const e of readdirSync(join(root, 'packs'), { withFileTypes: true })) if (e.isDirectory() && !opts.packs.includes(e.name)) rmSync(join(root, 'packs', e.name), { recursive: true, force: true });
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
  for (const name of readdirSync(ROOT)) if (!['.git', 'node_modules', '.init-selftest'].includes(name)) cpSync(join(ROOT, name), join(tmp, name), { recursive: true });
  const fails = [];
  try {
    const r = run({ name: 'selftest-proj', tier: 'S', packs: [], dryRun: false, prune: false }, tmp);
    if (!existsSync(join(tmp, 'docs', 'init-manifest.json'))) fails.push('manifest 없음');
    const y = readFileSync(join(tmp, 'harness.yaml'), 'utf8');
    if (!/^tier: S$/m.test(y)) fails.push('tier 미갱신');
    if (!/^project: "selftest-proj"$/m.test(y)) fails.push('project 미갱신');
    if (/\{\{PROJECT_NAME\}\}/.test(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8'))) fails.push('치환 누락');
    if (r.manifest.files.some((f) => f.sha256.length !== 64)) fails.push('sha 길이');
    try { run({ name: 'x', tier: 'Q', packs: [], dryRun: true, prune: false }, tmp); fails.push('잘못된 tier 통과'); } catch { /* 기대: 거부 */ }
    try { run({ name: 'x', tier: 'M', packs: ['no-such-pack'], dryRun: true, prune: false }, tmp); fails.push('없는 팩 통과'); } catch { /* 기대: 거부 */ }
  } catch (e) { fails.push(`예외: ${e.message}`); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? `self-test FAIL: ${fails.join(' · ')}` : 'self-test OK (적용·치환·manifest·거부 2건)');
  process.exit(fails.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) selfTest();
  else {
    if (!opts.name) { console.error('사용: node init.mjs --name <프로젝트명> [--tier S|M|L] [--packs a,b] [--dry-run] [--prune]'); process.exit(2); }
    const r = run(opts);
    if (r.dryRun) { console.log(`[dry-run] tier=${opts.tier} packs=${opts.packs.join(',') || '-'}`); for (const l of r.plan) console.log('  ' + l); }
    else {
      const c = r.log.reduce((m, l) => ((m[l.status] = (m[l.status] || 0) + 1), m), {});
      console.log(`적용 완료 tier=${opts.tier} packs=${opts.packs.join(',') || '-'} · ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · ')} · docs/init-manifest.json`);
      if (r.manifest.conflicts.length) console.log('충돌(보존됨): ' + r.manifest.conflicts.join(', '));
    }
  }
}
