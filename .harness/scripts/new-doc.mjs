#!/usr/bin/env node
// new-doc.mjs — 기록 생성기 (rules/HARNESS.md §3). 템플릿 복사·ID 채번(date-slug)·귀속 머리·manifest·세션 로그를 한 동작으로.
// 사용: node .harness/scripts/new-doc.mjs <fdr|adr|rfc|plan|pg|inc|runbook|spec|mtg|dec|ho> <slug> "<제목>" [--agent "<에이전트(모델)>"] [--profile lite|standard|full] [--ref <role>|--root <경로>]
//       node .harness/scripts/new-doc.mjs reply <HO-ID> --agent "<에이전트(모델)>" [--result]   핸드오프 응답(NN-<에이전트>.md) · 결과(result.md)
//   mtg·dec는 협업 저장소(harness.yaml references role: collab)에 만든다 — `--ref collab`. 템플릿은 이 저장소 .harness/templates에서 읽는다.
// --self-test: 임시 루트에서 10종 생성 + 핸드오프 응답·결과 후 ID·머리·충돌(-2) 확인.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findReference } from './lib/refs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');

const KINDS = {
  mtg: { dir: 'meetings', prefix: 'MTG', tplDir: 'MTG', ref: true },
  dec: { dir: 'decisions', prefix: 'DEC', tpl: 'DEC-template.md', ref: true },
  fdr: { dir: 'docs/features', prefix: 'FDR' },
  adr: { dir: 'docs/decisions', prefix: 'ADR', tpl: 'ADR-template.md' },
  rfc: { dir: 'docs/research', prefix: 'RFC', tpl: 'RFC-template.md' },
  plan: { dir: 'docs/plans', prefix: 'PLAN', tpl: 'PLAN-template.md' },
  pg: { dir: 'docs/queue/pg', prefix: 'PG', tpl: 'PG-template.md' },
  inc: { dir: 'docs/incidents', prefix: 'INC', tpl: 'INC-template.md' },
  runbook: { dir: 'docs/runbooks', prefix: 'RB', tpl: 'runbook-template.md' },
  spec: { dir: 'docs/specs', prefix: 'SPEC', tpl: 'spec-template.md', folder: true },
  ho: { dir: 'docs/handoffs', prefix: 'HO', tplDir: 'HO' },
};

const today = () => new Date().toISOString().slice(2, 10).replace(/-/g, '');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();

function allocate(root, kind, slug) {
  const k = KINDS[kind];
  const base = `${k.prefix}-${today()}-${slug}`;
  const dir = join(root, k.dir);
  mkdirSync(dir, { recursive: true });
  const taken = new Set(readdirSync(dir).map((f) => f.replace(/\.md$/, '')));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return { id, collided: id !== base };
}

function fill(text, vars) { return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)); }

export function create(root, kind, slug, title, { agent = '(모델 미확인)', profile, target } = {}) {
  if (!KINDS[kind]) throw new Error(`종류는 ${Object.keys(KINDS).join('|')}: ${kind}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`slug는 영문 소문자·숫자·하이픈: ${slug}`);
  const k = KINDS[kind];
  const tpl = join(root, '.harness', 'templates');
  if (k.ref) {
    if (!target) throw new Error(`${kind}는 협업 저장소에 만든다 — --ref collab (harness.yaml references role: collab) 또는 --root <경로>`);
    if (!existsSync(target)) throw new Error(`협업 저장소 체크아웃 없음: ${target}`);
    const { id, collided } = allocate(target, kind, slug);
    const vars = { ID: id, SLUG: slug, TITLE: title, DATE: new Date().toISOString().slice(0, 10), AGENT: agent };
    if (k.tplDir) {
      const out = join(target, k.dir, id);
      cpSync(join(tpl, k.tplDir), out, { recursive: true });
      for (const f of readdirSync(out)) if (f.endsWith('.md')) writeFileSync(join(out, f), fill(readFileSync(join(out, f), 'utf8'), vars));
      return { id, path: out, collided };
    }
    const out = join(target, k.dir, `${id}.md`);
    writeFileSync(out, fill(readFileSync(join(tpl, k.tpl), 'utf8'), vars));
    return { id, path: out, collided };
  }
  const { id, collided } = allocate(root, kind, slug);
  const date = new Date().toISOString().slice(0, 10);
  const vars = { ID: id, SLUG: slug, TITLE: title, DATE: date, AGENT: agent };
  if (k.tplDir) {
    const out = join(root, k.dir, id);
    cpSync(join(tpl, k.tplDir), out, { recursive: true });
    for (const f of readdirSync(out)) if (f.endsWith('.md')) writeFileSync(join(out, f), fill(readFileSync(join(out, f), 'utf8'), vars));
    return { id, path: out, collided };
  }
  if (kind === 'fdr') {
    const hy = existsSync(join(root, 'harness.yaml')) ? readFileSync(join(root, 'harness.yaml'), 'utf8') : '';
    const tier = yamlScalar(hy, 'tier') || 'M';
    const prof = profile || ({ S: 'lite', M: 'standard', L: 'full' }[tier] || 'standard');
    if (!['lite', 'standard', 'full'].includes(prof)) throw new Error(`--profile은 lite|standard|full: ${prof} — 팩 프로파일(llm·data…)은 v0.1 생성기가 합성하지 않는다(ADR-261016-enforcement-alignment F04)`);
    if (prof === 'lite') {
      const out = join(root, k.dir, id);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'fdr.md'), fill(readFileSync(join(tpl, 'FDR-lite-template.md'), 'utf8'), vars));
      return { id, path: out, collided, profile: prof };
    }
    const src = join(tpl, prof === 'full' ? 'FDR-full' : 'FDR-standard');
    const out = join(root, k.dir, id);
    if (!existsSync(src)) throw new Error(`템플릿 없음: ${src} (티어 L 오버레이 필요)`);
    cpSync(src, out, { recursive: true });
    for (const f of readdirSync(out)) if (f.endsWith('.md') || f.endsWith('.yaml')) writeFileSync(join(out, f), fill(readFileSync(join(out, f), 'utf8'), vars));
    writeFileSync(join(out, 'session-log.md'), `# ${id} 세션 로그\n\n| 날짜 | 에이전트 | 완료 | 가설 | 미결 | 재개점 |\n|---|---|---|---|---|---|\n| ${date} | ${agent} | 생성 | - | - | 재개점: Stage 1 spec 작성 |\n`);
    return { id, path: out, collided, profile: prof };
  }
  if (k.folder) {
    const out = join(root, k.dir, slug);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'spec.md'), fill(readFileSync(join(tpl, k.tpl), 'utf8'), vars));
    return { id: slug, path: out, collided: false };
  }
  const out = join(root, k.dir, `${id}.md`);
  writeFileSync(out, fill(readFileSync(join(tpl, k.tpl), 'utf8'), vars));
  return { id, path: out, collided };
}

/** 핸드오프 응답: docs/handoffs/<HO-ID>/NN-<에이전트>.md (NN = 기존 응답 수 + 1). --result면 result.md. 남의 파일은 고치지 않으므로 항상 새 파일. */
export function reply(root, hoId, { agent = '(모델 미확인)', result = false } = {}) {
  const dir = join(root, 'docs', 'handoffs', hoId);
  if (!/^HO-/.test(hoId) || !existsSync(join(dir, 'request.md'))) throw new Error(`핸드오프 없음: docs/handoffs/${hoId}/request.md`);
  const date = new Date().toISOString().slice(0, 10);
  const tpl = join(root, '.harness', 'templates');
  if (result) {
    const out = join(dir, 'result.md');
    if (existsSync(out)) throw new Error(`이미 있음: ${out}`);
    writeFileSync(out, fill(readFileSync(join(tpl, 'HO-result.md'), 'utf8'), { ID: hoId, DATE: date, AGENT: agent }));
    return { id: hoId, path: out };
  }
  const n = readdirSync(dir).filter((f) => /^\d{2}-/.test(f)).length + 1;
  const nn = String(n).padStart(2, '0');
  const who = (String(agent).toLowerCase().match(/[a-z0-9]+/) || ['agent'])[0];
  const out = join(dir, `${nn}-${who}.md`);
  writeFileSync(out, fill(readFileSync(join(tpl, 'HO-reply.md'), 'utf8'), { ID: hoId, NN: nn, DATE: date, AGENT: agent }));
  return { id: `${hoId}/${nn}-${who}`, path: out };
}

if (process.argv.includes('--self-test')) {
  const tmp = join(HERE, '..', '.newdoc-selftest');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  cpSync(join(DEFAULT_ROOT, '.harness', 'templates'), join(tmp, '.harness', 'templates'), { recursive: true });
  writeFileSync(join(tmp, 'harness.yaml'), 'tier: M\n');
  const fails = [];
  try {
    for (const kind of ['adr', 'rfc', 'plan', 'pg', 'inc', 'runbook']) {
      const r = create(tmp, kind, 'sample', '제목', { agent: 'test' });
      if (!existsSync(r.path)) fails.push(`${kind} 미생성`);
      if (/\{\{(ID|TITLE|DATE)\}\}/.test(readFileSync(r.path, 'utf8'))) fails.push(`${kind} 치환 누락`);
    }
    const f1 = create(tmp, 'fdr', 'sample', '제목', { agent: 'test' });
    if (!existsSync(join(f1.path, 'manifest.yaml'))) fails.push('fdr standard manifest 없음');
    const f2 = create(tmp, 'fdr', 'sample', '제목', { agent: 'test' });
    if (!f2.collided || !/-2$/.test(f2.id)) fails.push('같은 날 같은 slug -2 미부여');
    const lite = create(tmp, 'fdr', 'lite-one', '제목', { agent: 'test', profile: 'lite' });
    if (!existsSync(join(lite.path, 'fdr.md'))) fails.push('lite 폴더(fdr.md) 아님');
    try { create(tmp, 'adr', 'Bad Slug', 'x'); fails.push('잘못된 slug 통과'); } catch { /* 기대 */ }
    try { create(tmp, 'fdr', 'bad-prof', 'x', { profile: 'llm' }); fails.push('미정의 profile 통과'); } catch { /* 기대 */ }
    const collab = join(tmp, 'collab'); mkdirSync(collab, { recursive: true });
    try { create(tmp, 'mtg', 'kick', '회의', { agent: 'test' }); fails.push('mtg가 target 없이 통과'); } catch { /* 기대 */ }
    const m = create(tmp, 'mtg', 'kick', '회의', { agent: 'test', target: collab });
    if (!existsSync(join(m.path, 'agenda.md')) || !existsSync(join(m.path, 'minutes.md')) || !/^MTG-\d{6}-kick$/.test(m.id)) fails.push('mtg 폴더 미생성');
    if (/\{\{ID\}\}/.test(readFileSync(join(m.path, 'minutes.md'), 'utf8'))) fails.push('mtg 치환 누락');
    const d = create(tmp, 'dec', 'budget', '예산', { agent: 'test', target: collab });
    if (!d.path.startsWith(join(collab, 'decisions')) || /\{\{TITLE\}\}/.test(readFileSync(d.path, 'utf8'))) fails.push('dec 미생성/치환 누락');
    const h = create(tmp, 'ho', 'review', '리뷰 요청', { agent: 'Claude Code (test)' });
    const req = readFileSync(join(h.path, 'request.md'), 'utf8');
    if (!/^HO-\d{6}-review$/.test(h.id) || !/^- 상태: open$/m.test(req) || /\{\{ID\}\}/.test(req)) fails.push('ho 미생성/치환 누락');
    const r1 = reply(tmp, h.id, { agent: 'Codex (GPT-6)' }); const r2 = reply(tmp, h.id, { agent: 'Claude Code (test)' });
    if (!r1.path.endsWith('01-codex.md') || !r2.path.endsWith('02-claude.md') || /\{\{NN\}\}/.test(readFileSync(r1.path, 'utf8'))) fails.push('reply 채번/치환 오류');
    const rs = reply(tmp, h.id, { agent: 'x', result: true });
    if (!existsSync(rs.path)) fails.push('result 미생성');
    try { reply(tmp, h.id, { result: true }); fails.push('result 중복 생성 통과'); } catch { /* 기대 */ }
    try { reply(tmp, 'HO-000000-none', {}); fails.push('없는 HO 통과'); } catch { /* 기대 */ }
  } catch (e) { fails.push('예외: ' + e.message); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (10종 생성·치환·충돌·거부·협업 저장소 대상·핸드오프 응답 채번·결과)');
  process.exit(fails.length ? 1 : 0);
}

const [kind, slug, title] = process.argv.slice(2);
const argv = process.argv.slice(2);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
if (kind === 'reply') {
  try { const r = reply(DEFAULT_ROOT, slug, { agent: opt('--agent') || process.env.HARNESS_AGENT || '(모델 미확인)', result: argv.includes('--result') }); console.log(`${r.id} → ${r.path}`); } catch (e) { console.error(e.message); process.exit(2); }
  process.exit(0);
}
if (!kind || !slug || !title) { console.error('사용: node .harness/scripts/new-doc.mjs <fdr|adr|rfc|plan|pg|inc|runbook|spec|mtg|dec|ho> <slug> "<제목>" [--agent "<에이전트(모델)>"] [--profile lite|standard|full] [--ref <role>|--root <경로>]\n     node .harness/scripts/new-doc.mjs reply <HO-ID> --agent "<에이전트(모델)>" [--result]'); process.exit(2); }
let target = opt('--root') ? resolve(DEFAULT_ROOT, opt('--root')) : undefined;
if (opt('--ref')) {
  const ref = findReference(existsSync(join(DEFAULT_ROOT, 'harness.yaml')) ? readFileSync(join(DEFAULT_ROOT, 'harness.yaml'), 'utf8') : '', opt('--ref'));
  if (!ref) { console.error(`harness.yaml references에 role: ${opt('--ref')} 항목이 없다`); process.exit(2); }
  target = resolve(DEFAULT_ROOT, ref.path);
}
let r;
try { r = create(DEFAULT_ROOT, kind, slug, title, { agent: opt('--agent') || process.env.HARNESS_AGENT || '(모델 미확인)', profile: opt('--profile'), target }); } catch (e) { console.error(e.message); process.exit(2); }
console.log(`${r.id} → ${r.path}${r.collided ? '  ⚠ 같은 날 같은 슬러그가 있어 -2 부여 (같은 일을 둘이 시작했는지 확인)' : ''}`);
