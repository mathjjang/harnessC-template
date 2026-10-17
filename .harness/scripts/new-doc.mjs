#!/usr/bin/env node
// new-doc.mjs — 기록 생성기 (.harness/HARNESS.md §3). 템플릿 복사·ID 채번(date-slug)·귀속 머리·manifest·세션 로그를 한 동작으로.
// 사용: node .harness/scripts/new-doc.mjs <종류> <slug> "<제목>" [--agent "<에이전트(모델)>"] [--profile lite|standard|full] [--ref <role>|--root <경로>]
//   종류: fdr adr rfc plan inc retro ho(→ docs/records) · pg qa hr bl(→ docs/queue) · spec(→ docs/specs) · runbook(→ rules/runbooks) · mtg dec(→ 협업 저장소, --ref collab)
//       node .harness/scripts/new-doc.mjs reply <HO-ID> --agent "<에이전트(모델)>" [--result]   핸드오프 응답(NN-<에이전트>.md) · 결과(result.md)
// 폴더는 늘지 않는다 — 종류는 ID 접두가 말한다. --self-test: 임시 루트에서 전 종류 생성 후 ID·치환·충돌(-2)·거부 확인.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findReference } from './lib/refs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');
const REC = 'docs/records';

const KINDS = {
  fdr: { dir: REC, prefix: 'FDR' },
  adr: { dir: REC, prefix: 'ADR', tpl: 'ADR-template.md' },
  rfc: { dir: REC, prefix: 'RFC', tpl: 'RFC-template.md', folder: 'rfc.md' },
  plan: { dir: REC, prefix: 'PLAN', tpl: 'PLAN-template.md' },
  inc: { dir: REC, prefix: 'INC', tpl: 'INC-template.md' },
  retro: { dir: REC, prefix: 'RETRO', tpl: 'RETRO-template.md' },
  ho: { dir: REC, prefix: 'HO', tplDir: 'HO', evidence: true },
  pg: { dir: 'docs/queue', prefix: 'PG', tpl: 'PG-template.md' },
  qa: { dir: 'docs/queue', prefix: 'QA', tpl: 'QUEUE-template.md', source: 'qa' },
  hr: { dir: 'docs/queue', prefix: 'HR', tpl: 'QUEUE-template.md', source: 'human-run' },
  bl: { dir: 'docs/queue', prefix: 'BL', tpl: 'QUEUE-template.md', source: 'backlog' },
  runbook: { dir: 'rules/runbooks', prefix: 'RB', tpl: 'runbook-template.md' },
  spec: { dir: 'docs/specs', prefix: 'SPEC', tpl: 'spec-template.md', capability: true },
  mtg: { dir: 'meetings', prefix: 'MTG', tplDir: 'MTG', ref: true },
  dec: { dir: 'decisions', prefix: 'DEC', tpl: 'DEC-template.md', ref: true },
};

const today = () => new Date().toISOString().slice(2, 10).replace(/-/g, '');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const fill = (text, vars) => text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

function allocate(root, k, slug) {
  const base = `${k.prefix}-${today()}-${slug}`;
  const dir = join(root, k.dir);
  mkdirSync(dir, { recursive: true });
  const taken = new Set(readdirSync(dir).map((f) => f.replace(/\.md$/, '')));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return { id, collided: id !== base };
}
function copyDir(src, out, vars) {
  cpSync(src, out, { recursive: true });
  for (const f of readdirSync(out)) if (/\.(md|yaml)$/.test(f)) writeFileSync(join(out, f), fill(readFileSync(join(out, f), 'utf8'), vars));
}

export function create(root, kind, slug, title, { agent = '(모델 미확인)', profile, target } = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error(`종류는 ${Object.keys(KINDS).join('|')}: ${kind}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`slug는 영문 소문자·숫자·하이픈: ${slug}`);
  const tpl = join(root, '.harness', 'templates');
  if (k.ref) {
    if (!target) throw new Error(`${kind}는 협업 저장소에 만든다 — --ref collab (harness.yaml references role: collab) 또는 --root <경로>`);
    if (!existsSync(target)) throw new Error(`협업 저장소 체크아웃 없음: ${target}`);
  }
  const base = k.ref ? target : root;
  const date = new Date().toISOString().slice(0, 10);
  if (k.capability) {
    const out = join(root, k.dir, slug);
    if (existsSync(join(out, 'spec.md'))) throw new Error(`이미 있음: ${out}`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'spec.md'), fill(readFileSync(join(tpl, k.tpl), 'utf8'), { ID: slug, SLUG: slug, TITLE: title, DATE: date, AGENT: agent }));
    return { id: slug, path: out, collided: false };
  }
  const { id, collided } = allocate(base, k, slug);
  const vars = { ID: id, SLUG: slug, TITLE: title, DATE: date, AGENT: agent, SOURCE: k.source || '' };
  if (kind === 'fdr') {
    const hy = existsSync(join(root, 'harness.yaml')) ? readFileSync(join(root, 'harness.yaml'), 'utf8') : '';
    const prof = profile || ({ S: 'lite', M: 'standard', L: 'full' }[yamlScalar(hy, 'tier') || 'M'] || 'standard');
    if (!['lite', 'standard', 'full'].includes(prof)) throw new Error(`--profile은 lite|standard|full: ${prof}`);
    const out = join(root, k.dir, id);
    if (prof === 'lite') {
      mkdirSync(join(out, 'evidence'), { recursive: true });
      writeFileSync(join(out, 'fdr.md'), fill(readFileSync(join(tpl, 'FDR-lite-template.md'), 'utf8'), vars));
      return { id, path: out, collided, profile: prof };
    }
    const src = join(tpl, prof === 'full' ? 'FDR-full' : 'FDR-standard');
    if (!existsSync(src)) throw new Error(`템플릿 없음: ${src} (티어 L 오버레이 필요)`);
    copyDir(src, out, vars);
    mkdirSync(join(out, 'evidence', 'runs'), { recursive: true });
    writeFileSync(join(out, 'session-log.md'), `# ${id} 세션 로그\n\n| 날짜 | 에이전트 | 완료 | 가설 | 미결 | 재개점 |\n|---|---|---|---|---|---|\n| ${date} | ${agent} | 생성 | - | - | 재개점: Stage 1 spec 작성 |\n`);
    return { id, path: out, collided, profile: prof };
  }
  if (k.tplDir) { const out = join(base, k.dir, id); copyDir(join(tpl, k.tplDir), out, vars); if (k.evidence) mkdirSync(join(out, 'evidence'), { recursive: true }); return { id, path: out, collided }; }
  if (k.folder) { const out = join(base, k.dir, id); mkdirSync(join(out, 'evidence'), { recursive: true }); writeFileSync(join(out, k.folder), fill(readFileSync(join(tpl, k.tpl), 'utf8'), vars)); return { id, path: out, collided }; }
  const out = join(base, k.dir, `${id}.md`);
  writeFileSync(out, fill(readFileSync(join(tpl, k.tpl), 'utf8'), vars));
  return { id, path: out, collided };
}

/** 핸드오프 응답: docs/records/<HO-ID>/NN-<에이전트>.md (NN = 기존 응답 수 + 1). --result면 result.md. 남의 파일은 고치지 않으므로 항상 새 파일. */
export function reply(root, hoId, { agent = '(모델 미확인)', result = false } = {}) {
  const dir = join(root, REC, hoId);
  if (!/^HO-/.test(hoId) || !existsSync(join(dir, 'request.md'))) throw new Error(`핸드오프 없음: ${REC}/${hoId}/request.md`);
  const date = new Date().toISOString().slice(0, 10);
  const tpl = join(root, '.harness', 'templates');
  if (result) {
    const out = join(dir, 'result.md');
    if (existsSync(out)) throw new Error(`이미 있음: ${out}`);
    writeFileSync(out, fill(readFileSync(join(tpl, 'HO-result.md'), 'utf8'), { ID: hoId, DATE: date, AGENT: agent }));
    return { id: hoId, path: out };
  }
  const nn = String(readdirSync(dir).filter((f) => /^\d{2}-/.test(f)).length + 1).padStart(2, '0');
  const who = (String(agent).toLowerCase().match(/[a-z0-9]+/) || ['agent'])[0];
  const out = join(dir, `${nn}-${who}.md`);
  writeFileSync(out, fill(readFileSync(join(tpl, 'HO-reply.md'), 'utf8'), { ID: hoId, NN: nn, DATE: date, AGENT: agent }));
  return { id: `${hoId}/${nn}-${who}`, path: out };
}

// 라이브러리로 import될 때(work.mjs promote 등)는 CLI·self-test를 돌리지 않는다
const IS_MAIN = Boolean(process.argv[1]) && /new-doc\.mjs$/.test(process.argv[1]);
if (IS_MAIN && process.argv.includes('--self-test')) {
  const tmp = join(HERE, '..', '.newdoc-selftest');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  cpSync(join(DEFAULT_ROOT, '.harness', 'templates'), join(tmp, '.harness', 'templates'), { recursive: true });
  writeFileSync(join(tmp, 'harness.yaml'), 'tier: M\n');
  const fails = [];
  const noVars = (p) => /\{\{(ID|TITLE|DATE|SOURCE)\}\}/.test(readFileSync(p, 'utf8'));
  try {
    for (const kind of ['adr', 'plan', 'inc', 'retro', 'pg', 'qa', 'hr', 'bl', 'runbook']) {
      const r = create(tmp, kind, 'sample', '제목', { agent: 'test' });
      if (!existsSync(r.path) || noVars(r.path)) fails.push(`${kind} 미생성/치환 누락`);
      const want = { pg: 'docs/queue', qa: 'docs/queue', hr: 'docs/queue', bl: 'docs/queue', runbook: 'rules/runbooks' }[kind] || REC;
      if (!r.path.replace(/\\/g, '/').includes(`/${want}/`)) fails.push(`${kind} 자리 오류: ${r.path}`);
    }
    const rfc = create(tmp, 'rfc', 'q', '탐구', { agent: 'test' });
    if (!existsSync(join(rfc.path, 'rfc.md')) || !existsSync(join(rfc.path, 'evidence'))) fails.push('rfc 폴더(rfc.md+evidence) 아님');
    const f1 = create(tmp, 'fdr', 'sample', '제목', { agent: 'test' });
    if (!existsSync(join(f1.path, 'manifest.yaml')) || !existsSync(join(f1.path, 'evidence', 'runs'))) fails.push('fdr standard manifest/evidence 없음');
    const f2 = create(tmp, 'fdr', 'sample', '제목', { agent: 'test' });
    if (!f2.collided || !/-2$/.test(f2.id)) fails.push('같은 날 같은 slug -2 미부여');
    const lite = create(tmp, 'fdr', 'lite-one', '제목', { agent: 'test', profile: 'lite' });
    if (!existsSync(join(lite.path, 'fdr.md')) || !existsSync(join(lite.path, 'evidence'))) fails.push('lite 폴더(fdr.md+evidence) 아님');
    const sp = create(tmp, 'spec', 'cap-one', '역량', { agent: 'test' });
    if (!existsSync(join(sp.path, 'spec.md'))) fails.push('spec 미생성');
    try { create(tmp, 'adr', 'Bad Slug', 'x'); fails.push('잘못된 slug 통과'); } catch { /* 기대 */ }
    try { create(tmp, 'fdr', 'bad-prof', 'x', { profile: 'llm' }); fails.push('미정의 profile 통과'); } catch { /* 기대 */ }
    const collab = join(tmp, 'collab'); mkdirSync(collab, { recursive: true });
    try { create(tmp, 'mtg', 'kick', '회의', { agent: 'test' }); fails.push('mtg가 target 없이 통과'); } catch { /* 기대 */ }
    const m = create(tmp, 'mtg', 'kick', '회의', { agent: 'test', target: collab });
    if (!existsSync(join(m.path, 'agenda.md')) || !existsSync(join(m.path, 'minutes.md')) || noVars(join(m.path, 'minutes.md'))) fails.push('mtg 폴더 미생성/치환 누락');
    const d = create(tmp, 'dec', 'budget', '예산', { agent: 'test', target: collab });
    if (!d.path.startsWith(join(collab, 'decisions')) || noVars(d.path)) fails.push('dec 미생성/치환 누락');
    const h = create(tmp, 'ho', 'review', '리뷰 요청', { agent: 'Claude Code (test)' });
    const req = join(h.path, 'request.md');
    if (!/^HO-\d{6}-review$/.test(h.id) || !/^- 상태: open$/m.test(readFileSync(req, 'utf8')) || noVars(req) || !existsSync(join(h.path, 'evidence'))) fails.push('ho 미생성/치환 누락');
    const r1 = reply(tmp, h.id, { agent: 'Codex (GPT-6)' }); const r2 = reply(tmp, h.id, { agent: 'Claude Code (test)' });
    if (!r1.path.endsWith('01-codex.md') || !r2.path.endsWith('02-claude.md') || /\{\{NN\}\}/.test(readFileSync(r1.path, 'utf8'))) fails.push('reply 채번/치환 오류');
    if (!existsSync(reply(tmp, h.id, { agent: 'x', result: true }).path)) fails.push('result 미생성');
    try { reply(tmp, h.id, { result: true }); fails.push('result 중복 생성 통과'); } catch { /* 기대 */ }
    try { reply(tmp, 'HO-000000-none', {}); fails.push('없는 HO 통과'); } catch { /* 기대 */ }
    const top = readdirSync(join(tmp, 'docs')).sort().join(',');
    if (top !== 'queue,records,specs') fails.push(`docs/ 폴더가 늘었다: ${top}`);
  } catch (e) { fails.push('예외: ' + e.message); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : `self-test OK (${Object.keys(KINDS).length}종 생성·치환·충돌·거부·핸드오프 응답·docs 폴더 불변)`);
  process.exit(fails.length ? 1 : 0);
}

if (IS_MAIN && !process.argv.includes('--self-test')) {
  const argv = process.argv.slice(2);
  const [kind, slug, title] = argv;
  const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const agent = opt('--agent') || process.env.HARNESS_AGENT || '(모델 미확인)';
  if (kind === 'reply') {
    try { const r = reply(DEFAULT_ROOT, slug, { agent, result: argv.includes('--result') }); console.log(`${r.id} → ${r.path}`); } catch (e) { console.error(e.message); process.exit(2); }
    process.exit(0);
  }
  if (!kind || !slug || !title) { console.error(`사용: node .harness/scripts/new-doc.mjs <${Object.keys(KINDS).join('|')}> <slug> "<제목>" [--agent "<에이전트(모델)>"] [--profile lite|standard|full] [--ref <role>|--root <경로>]\n     node .harness/scripts/new-doc.mjs reply <HO-ID> --agent "<에이전트(모델)>" [--result]`); process.exit(2); }
  let target = opt('--root') ? resolve(DEFAULT_ROOT, opt('--root')) : undefined;
  if (opt('--ref')) {
    const ref = findReference(existsSync(join(DEFAULT_ROOT, 'harness.yaml')) ? readFileSync(join(DEFAULT_ROOT, 'harness.yaml'), 'utf8') : '', opt('--ref'));
    if (!ref) { console.error(`harness.yaml references에 role: ${opt('--ref')} 항목이 없다`); process.exit(2); }
    target = resolve(DEFAULT_ROOT, ref.path);
  }
  let r;
  try { r = create(DEFAULT_ROOT, kind, slug, title, { agent, profile: opt('--profile'), target }); } catch (e) { console.error(e.message); process.exit(2); }
  console.log(`${r.id} → ${r.path}${r.collided ? '  ⚠ 같은 날 같은 슬러그가 있어 -2 부여 (같은 일을 둘이 시작했는지 확인)' : ''}`);
}
