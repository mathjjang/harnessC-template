#!/usr/bin/env node
// lint.mjs — 하네스 린트 (.harness/HARNESS.md §1·§3·§8·§9·§11). pre-commit·세션 시작·CI에서 부른다. 종료코드 1 = 위반.
// 검사: ① UTF-8 BOM ② 규칙 파일이 참조하는 스크립트가 .harness/catalog.yaml에 active인가 ③ 상시 규칙 예산
//       ④ 규칙 파일 간 중복 문장(정규화 후 16자 이상 동일) ⑤ 기록 머리 귀속(작성:) ⑥ 생성물 수동 편집 표식
//       ⑦ .harness/scripts/*.mjs 카탈로그 등재 ⑧ 중첩 참조 저장소(references)는 gitignore·미추적
//       ⑨ human-run 큐(HR-)의 axis가 rules/human-only.yaml에 등록돼 있는가 ⑩ closed FDR에 스펙 병합 흔적·RUN 증거가 있는가
//       ⑪ 핸드오프(HO-)의 상태가 open|taken|answered|closed이고 closed면 result.md가 있는가
//       ⑫ 코어(모든 프로젝트 동일 부분)가 init-manifest의 해시와 같은가 — 다르면 템플릿에서 고치고 sync-core
//       ⑬ docs/·rules/ 아래 폴더가 고정 목록 밖으로 늘지 않았는가
//       ⑭ 활성 FDR끼리 scope(제품 경로)가 겹치지 않는가 ⑮ 닫힌 기록에 브랜치·worktree가 남지 않았는가
//       ⑯ 확정 목업(mockup/)이 있는 FDR이 shipped·closed면 같은 rev의 대조 기록·상태 전수·초과 등재·캡처 해시가 맞는가 (mockup-diff.mjs checkMockup)
//       ⑰ 개발 저장소 안에 둔 목업 저장소(references role: mockup, embedded: true)의 자체 게이트(scripts/validate.mjs)가 통과하는가 — embedded는 ⑧(gitignore) 대상이 아니다
// 검사하지 않는 것: 증거의 내용이 맞는지, 리뷰 판정이 타당한지 — 형식·존재·연결만 본다. "lint OK"는 그 범위의 통과다.
// --self-test: 위반 표본에서 각 검사가 실제로 잡히는지 확인.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { parseReferences } from './lib/refs.mjs';
import { hashCore } from './lib/core-files.mjs';
import { DOCS_DIRS, listRecords } from './lib/records.mjs';
import { checkMockup } from './mockup-diff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULE_FILES = ['.harness/HARNESS.md', 'rules/product.md', 'AGENTS.md', 'CLAUDE.md'];
const DOCS_ALLOW = [...DOCS_DIRS];
const RULES_ALLOW = ['product.md', 'human-only.yaml', 'runbooks', 'domain', 'README.md'];
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const frontmatter = (text) => (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
const mdStatus = (t) => (t.match(/^- 상태:\s*(\S+)/m) || [])[1] || '';

function walk(dir, out = []) { if (!existsSync(dir)) return out; for (const e of readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.git'].includes(e.name)) continue; const p = join(dir, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; }
/** 기록의 본문 파일: 단일 .md 또는 폴더의 대표 파일 */
function recordMain(p) {
  if (!statSync(p).isDirectory()) return p;
  for (const f of ['manifest.yaml', 'fdr.md', 'rfc.md', 'request.md', 'brief.md', 'retro.md', '01-spec.md']) if (existsSync(join(p, f))) return join(p, f);
  return null;
}

export function lint(root) {
  const problems = [];
  // ① BOM
  for (const f of walk(root).filter((f) => /\.(md|yaml|yml|json|mjs)$/.test(f))) {
    const b = readFileSync(f); if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) problems.push(`BOM: ${relative(root, f)}`);
  }
  // ② 도구 참조 vs 카탈로그
  const catalog = rd(join(root, '.harness', 'catalog.yaml'));
  const active = new Set([...catalog.matchAll(/^\s*-\s*name:\s*(\S+)[\s\S]*?status:\s*(\S+)/gm)].filter((m) => m[2] === 'active').map((m) => m[1]));
  const ruleText = RULE_FILES.map((f) => rd(join(root, f))).join('\n') + ['.claude/rules', '.harness/runbooks', 'rules/runbooks'].flatMap((d) => walk(join(root, d))).map((f) => rd(f)).join('\n');
  // 코어 도구(.harness/scripts/…)는 카탈로그 active여야 하고, 프로젝트 도구(루트 scripts/…)는 파일이 실재하면 된다(프로젝트 소유 — 카탈로그는 코어 사본)
  for (const m of ruleText.matchAll(/(?:(\.harness\/)|(?<![\w./-]))scripts\/([a-z0-9-]+\.mjs)/g)) {   // mockups/scripts/… 처럼 다른 폴더 아래 scripts/는 대상 아님
    const core = Boolean(m[1]); const name = m[2];
    if (core ? !active.has(name) : !(existsSync(join(root, 'scripts', name)) || active.has(name))) problems.push(core ? `카탈로그에 active가 아닌 도구 참조: .harness/scripts/${name}` : `규칙이 참조하는 프로젝트 도구가 없다: scripts/${name}`);
  }
  // ③ 예산
  const budget = Number(yamlScalar(rd(join(root, 'harness.yaml')), 'always_on_kb') || 25);
  const kb = RULE_FILES.reduce((s, f) => s + (existsSync(join(root, f)) ? statSync(join(root, f)).size : 0), 0) / 1024;
  if (kb > budget) problems.push(`상시 규칙 ${kb.toFixed(1)}KB > 예산 ${budget}KB`);
  // ④ 중복 문장
  const seen = new Map();
  for (const f of RULE_FILES) for (const line of rd(join(root, f)).split('\n')) {
    const n = line.replace(/[`*_#>|\-\s]/g, '');
    if (n.length < 16 || /^\|?-+/.test(line)) continue;
    if (seen.has(n) && seen.get(n) !== f) problems.push(`중복 문장 ${seen.get(n)} ↔ ${f}: ${line.trim().slice(0, 40)}…`);
    seen.set(n, f);
  }
  // ⑤ 귀속 — 기록 전부 (자리는 lib/records.mjs)
  const records = listRecords(root);
  for (const r of records) { const m = recordMain(r.path); if (!m) problems.push(`기록 본문 없음: ${r.dir}/${r.name}`); else if (!/작성[:：]/.test(rd(m).slice(0, 800))) problems.push(`귀속 머리 없음: ${relative(root, m).split(sep).join("/")}`); }
  // ⑥ 생성물 표식
  for (const f of walk(join(root, 'docs')).filter((f) => /\.generated\.md$/.test(f))) if (!/생성물|generated/i.test(rd(f).slice(0, 300))) problems.push(`생성물 표식 없음: ${relative(root, f)}`);
  // ⑦ 스크립트 카탈로그 등재
  const sdir = join(root, '.harness', 'scripts');
  if (existsSync(sdir)) for (const f of readdirSync(sdir)) if (f.endsWith('.mjs') && !active.has(f)) problems.push(`카탈로그 미등재 스크립트: .harness/scripts/${f} — 임시면 .scratch/, 영구면 .harness/catalog.yaml 등재`);
  // ⑧ 중첩 참조 저장소
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let isGit = false; try { git('rev-parse --show-toplevel'); isGit = true; } catch { /* git 밖 */ }
  if (isGit) for (const r of parseReferences(rd(join(root, 'harness.yaml')))) {
    if (String(r.embedded) === 'true') continue;   // 개발 저장소 안에 두기로 한 참조(목업 embedded) — 추적이 정상
    const rel = relative(root, resolve(root, r.path));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    try { git(`check-ignore -q -- "${rel}"`); } catch { problems.push(`참조 저장소 ${r.path}가 .gitignore에 없다 — 중첩 체크아웃은 개발 저장소가 추적하면 안 된다`); }
    try { if (git(`ls-files -- "${rel}"`).trim()) problems.push(`참조 저장소 ${r.path}의 파일이 개발 저장소에 추적되고 있다 — git rm --cached`); } catch { /* */ }
  }
  // ⑨ human-run 큐(HR-)의 axis
  const axes = new Set([...rd(join(root, 'rules', 'human-only.yaml')).matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]));
  const qdir = join(root, 'docs', 'queue');
  if (existsSync(qdir)) for (const f of readdirSync(qdir).filter((f) => /^HR-.*\.md$/.test(f))) {
    const axis = yamlScalar(frontmatter(rd(join(qdir, f))), 'axis');
    if (!axis) problems.push(`human-run 큐에 axis 없음: docs/queue/${f} — rules/human-only.yaml 축 ID 필수`);
    else if (!axes.has(axis)) problems.push(`human-run 큐의 axis(${axis})가 rules/human-only.yaml에 없다: docs/queue/${f} — 등록(REP) 또는 에이전트가 한다`);
  }
  // ⑩ closed FDR — 스펙 병합 흔적 + RUN 증거
  for (const r of records.filter((r) => /^FDR-/.test(r.name) && statSync(r.path).isDirectory())) {
    const dir = r.path; const n = r.name;
    const isStd = existsSync(join(dir, 'manifest.yaml'));
    const head = isStd ? rd(join(dir, 'manifest.yaml')) : frontmatter(rd(join(dir, 'fdr.md')));
    if (yamlScalar(head, 'status') !== 'closed') continue;
    const id = yamlScalar(head, 'id') || n;
    const cap = yamlScalar(head, 'capability').replace(/^(null|~)$/, '');
    const spec = cap ? rd(join(root, 'docs', 'specs', cap, 'spec.md')) : '';
    if (!cap || !spec) problems.push(`closed FDR ${id}: capability와 docs/specs/<capability>/spec.md가 없다 — 병합 없이 closed 불가`);
    else if (!spec.includes(id)) problems.push(`closed FDR ${id}: docs/specs/${cap}/spec.md에 병합 흔적(${id}) 없음`);
    let hasRun;
    if (isStd) hasRun = walk(join(dir, 'evidence', 'runs')).some((f) => !/\.gitkeep$/.test(f));
    else { const sec = (rd(join(dir, 'fdr.md')).split(/^## 4\. Test[^\n]*$/m)[1] || '').split(/^## /m)[0]; hasRun = sec.split('\n').filter((l) => /^\|/.test(l) && !/^\|[-| ]+\|$/.test(l)).length >= 2; }
    if (!hasRun) problems.push(`closed FDR ${id}: RUN 증거 없음(${isStd ? 'evidence/runs/ 비어 있음' : '§4 Test 표에 행 없음'}) — 미검증 상태로 closed 불가`);
  }
  // ⑪ 핸드오프 상태
  for (const r of records.filter((r) => /^HO-/.test(r.name))) {
    const n = r.name; const req = rd(join(r.path, 'request.md')); const st = mdStatus(req);
    if (!req) problems.push(`핸드오프 ${n}: request.md 없음`);
    else if (!['open', 'taken', 'answered', 'closed'].includes(st)) problems.push(`핸드오프 ${n}: 상태(${st || '없음'})는 open|taken|answered|closed`);
    else if (st === 'closed' && !existsSync(join(r.path, 'result.md'))) problems.push(`핸드오프 ${n}: closed인데 result.md 없음`);
  }
  // ⑫ 코어 무결성 — init-manifest.json core 해시 (템플릿 저장소 자체에는 manifest가 없으므로 건너뜀)
  const mp = join(root, '.harness', 'init-manifest.json');
  if (existsSync(mp)) { try { const m = JSON.parse(rd(mp)); if (m.core) { const now = hashCore(root); for (const f of new Set([...Object.keys(m.core), ...Object.keys(now)])) if (m.core[f] !== now[f]) problems.push(`코어 파일이 템플릿 사본과 다르다: ${f} — 템플릿에서 고치고 node .harness/scripts/sync-core.mjs --from <템플릿>`); } } catch { problems.push('init-manifest.json 파싱 실패'); } }
  // ⑬ 고정 폴더
  const ddir = join(root, 'docs');
  if (existsSync(ddir)) for (const e of readdirSync(ddir, { withFileTypes: true })) if (e.isDirectory() && !DOCS_ALLOW.includes(e.name)) problems.push(`docs/${e.name}/ — docs/ 폴더는 ${DOCS_DIRS.join('·')}뿐이다. 기록은 자기 자리에, 도메인 자료는 specs/ 파일로`);
  const rl = join(root, 'rules');
  if (existsSync(rl)) for (const n of readdirSync(rl)) if (!RULES_ALLOW.includes(n)) problems.push(`rules/${n} — rules/는 ${RULES_ALLOW.slice(0, 4).join('·')}뿐이다. 방법론은 .harness/`);
  // ⑭ 활성 FDR끼리 scope 겹침 — 같은 제품 경로를 두 FDR이 동시에 고치면 덮어쓴다(V2 2026-07-30·08-18). 생성·린트 시점에 알린다
  const liveFdrs = [];
  for (const r of records.filter((r) => /^FDR-/.test(r.name) && statSync(r.path).isDirectory())) {
    const n = r.name; const head = rd(join(r.path, 'manifest.yaml')) || frontmatter(rd(join(r.path, 'fdr.md')));
    if (/^(closed|abandoned)$/.test(yamlScalar(head, 'status'))) continue;
    const m = head.match(/^scope:\s*\[([^\]]*)\]/m);
    liveFdrs.push({ id: n, scope: m ? m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [] });
  }
  const stem = (g) => g.replace(/\/?\*+.*$/, '').replace(/\/$/, '');
  for (let i = 0; i < liveFdrs.length; i++) for (let j = i + 1; j < liveFdrs.length; j++) for (const a of liveFdrs[i].scope) for (const b of liveFdrs[j].scope) {
    const sa = stem(a), sb = stem(b);
    if (sa === sb || sa.startsWith(sb + '/') || sb.startsWith(sa + '/')) problems.push(`scope 겹침: ${liveFdrs[i].id}(${a}) ↔ ${liveFdrs[j].id}(${b}) — 같은 경로를 두 FDR이 동시에 고치지 않는다. 공유 변경은 별도 lite FDR로 먼저 병합`);
  }
  // ⑰ embedded 목업 저장소(references role: mockup, embedded: true)의 자체 게이트를 대신 돈다 — 그 폴더의 scripts/validate.mjs
  for (const r of parseReferences(rd(join(root, 'harness.yaml')))) {
    if (r.role !== 'mockup' || String(r.embedded) !== 'true') continue;
    const v = join(root, r.path, 'scripts', 'validate.mjs');
    if (!existsSync(v)) { problems.push(`목업 게이트 없음: ${r.path}/scripts/validate.mjs — embedded 목업은 harnessC-mockup-template 뼈대여야 한다`); continue; }
    try { execSync(`"${process.execPath}" "${v}"`, { cwd: join(root, r.path), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { problems.push(`목업 게이트(${r.path}) 위반: ${String(e.stdout || e.message).trim().split('\n').slice(0, 6).join(' | ')}`); }
  }
  // ⑯ 목업 대조 완료 게이트 — mockup/이 있는 FDR만. 작업 중엔 형식(미커버·유령·전 상태 excluded), shipped·closed면 산출물까지
  for (const r of records.filter((r) => /^FDR-/.test(r.name) && statSync(r.path).isDirectory())) for (const p of checkMockup(root, r.path)) problems.push(`목업 대조 ${r.name}: ${p}`);
  // ⑮ 닫힌 기록에 브랜치·worktree가 남아 있으면 위반 — 수명은 work.mjs finish/gc가 닫는다
  if (isGit) {
    const branches = new Set(git('branch --list "fdr/*" "rfc/*" "ho/*" "mtg/*" "plan/*" "inc/*" "retro/*"').split('\n').map((s) => s.replace(/^\*?\s*/, '')).filter(Boolean));
    const wtDir = ((rd(join(root, 'harness.yaml')).match(/^work:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '').match(/^\s*dir:\s*(\S+)/m)?.[1] || '.worktrees';
    for (const r of records) {
      const n = r.name; const main = recordMain(r.path); const t = main ? rd(main) : '';
      const st = yamlScalar(t, 'status') || mdStatus(t);
      if (!/^(closed|abandoned|concluded)$/i.test(st)) continue;
      const id = n.replace(/\.md$/, ''); const b = `${id.split('-')[0].toLowerCase()}/${id}`;
      if (branches.has(b)) problems.push(`${id}는 ${st}인데 브랜치 ${b}가 남아 있다 — node .harness/scripts/work.mjs gc --apply`);
      if (existsSync(join(root, wtDir, id))) problems.push(`${id}는 ${st}인데 worktree ${wtDir}/${id}가 남아 있다 — work.mjs finish 또는 gc --apply`);
    }
  }
  return problems;
}

if (process.argv.includes('--self-test')) {
  const tmp = join(HERE, '..', '.lint-selftest'); rmSync(tmp, { recursive: true, force: true });
  for (const d of ['.harness', 'rules', 'docs/decisions', 'docs/features', 'docs/handoffs', 'docs/records', 'docs/queue', 'docs/specs/cap', 'docs/extra', 'rules/packs']) mkdirSync(join(tmp, d), { recursive: true });
  writeFileSync(join(tmp, 'harness.yaml'), 'budgets:\n  always_on_kb: 1\nreferences:\n  - { path: mockups, role: mockup, mode: read-write, embedded: true }\n');
  // ⑰ 부정: embedded 목업 게이트가 실패(exit 1) — ⑧은 embedded를 건너뛴다(gitignore 요구 없음)
  mkdirSync(join(tmp, 'mockups', 'scripts'), { recursive: true }); writeFileSync(join(tmp, 'mockups', 'scripts', 'validate.mjs'), 'console.log("목업 검사 위반 1건: m/x: 확정본과 다르다"); process.exit(1);\n');
  writeFileSync(join(tmp, '.harness', 'HARNESS.md'), '﻿규칙 본문. node .harness/scripts/ghost.mjs 를 돌린다.\n이 문장은 두 파일에 똑같이 들어가 중복이 된다 예시\n' + 'x'.repeat(1500));
  writeFileSync(join(tmp, 'AGENTS.md'), '이 문장은 두 파일에 똑같이 들어가 중복이 된다 예시\n프로젝트 도구 node scripts/missing-tool.mjs · node scripts/ok-tool.mjs · 목업 node mockups/scripts/validate.mjs\n');
  // ② 프로젝트 도구: 루트 scripts/에 있으면 통과, 없으면 위반 · 다른 폴더 아래 scripts/는 대상 아님
  mkdirSync(join(tmp, 'scripts'), { recursive: true }); writeFileSync(join(tmp, 'scripts', 'ok-tool.mjs'), '');
  writeFileSync(join(tmp, '.harness', 'catalog.yaml'), 'tools:\n  - name: ghost.mjs\n    status: planned\n');
  writeFileSync(join(tmp, 'docs', 'decisions', 'ADR-000000-x.md'), '# 머리에 귀속 없음\n');
  writeFileSync(join(tmp, 'docs', 'records', 'INC-000000-x.md'), '# 머리에 귀속 없음(records)\n');
  writeFileSync(join(tmp, 'docs', 'X.generated.md'), '# 표식 없음\n');
  writeFileSync(join(tmp, 'rules', 'human-only.yaml'), 'axes:\n  - id: external-account\n');
  writeFileSync(join(tmp, 'docs', 'queue', 'HR-000000-x.md'), '---\nid: HR-000000-x\naxis: real-device\n---\n');
  // ⑩ 부정: lite closed(스펙 없음·RUN 없음) · std closed(스펙 병합됨·RUN 없음) / 양성: ok
  mkdirSync(join(tmp, 'docs', 'features', 'FDR-000000-lite'), { recursive: true }); mkdirSync(join(tmp, 'docs', 'features', 'FDR-000000-std', 'evidence', 'runs'), { recursive: true }); mkdirSync(join(tmp, 'docs', 'features', 'FDR-000000-ok', 'evidence', 'runs'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'features', 'FDR-000000-lite', 'fdr.md'), '---\nid: FDR-000000-lite\nstatus: closed\ncapability:\n---\n- 작성: t\n## 4. Test\n\n| AC | 계층 | 명령 | RUN | 판정 |\n|---|---|---|---|---|\n\n## 5. Review\n');
  writeFileSync(join(tmp, 'docs', 'features', 'FDR-000000-std', 'manifest.yaml'), 'id: FDR-000000-std\nstatus: closed\ncapability: cap\n작성: t\n');
  writeFileSync(join(tmp, 'docs', 'features', 'FDR-000000-ok', 'manifest.yaml'), 'id: FDR-000000-ok\nstatus: closed\ncapability: cap\n작성: t\n');
  writeFileSync(join(tmp, 'docs', 'features', 'FDR-000000-ok', 'evidence', 'runs', 'unit.out'), 'exit 0\n');
  // ⑭ 부정: 활성 FDR 둘의 scope가 겹침 / 양성: 서로소
  for (const [id, sc] of [['FDR-000000-a', 'src/customs/**'], ['FDR-000000-b', 'src/customs/api/*'], ['FDR-000000-c', 'src/report/**']]) { mkdirSync(join(tmp, 'docs', 'features', id), { recursive: true }); writeFileSync(join(tmp, 'docs', 'features', id, 'fdr.md'), `---\nid: ${id}\nstatus: in-progress\nscope: [${sc}]\n---\n- 작성: t\n`); }
  writeFileSync(join(tmp, 'docs', 'specs', 'cap', 'spec.md'), '# cap\n병합: FDR-000000-std · FDR-000000-ok\n');
  // ⑯ 부정: 확정 목업이 있는 shipped FDR에 대조 기록 없음 / 양성: in-progress는 형식만
  for (const [id, st] of [['FDR-000000-mock', 'shipped'], ['FDR-000000-mockwip', 'in-progress']]) { mkdirSync(join(tmp, 'docs', 'features', id, 'mockup'), { recursive: true }); writeFileSync(join(tmp, 'docs', 'features', id, 'fdr.md'), `---\nid: ${id}\nstatus: ${st}\n---\n- 작성: t\n`); writeFileSync(join(tmp, 'docs', 'features', id, 'mockup', 'rev.yaml'), 'rev: 1\nfiles:\n  01-a.html: ' + 'a'.repeat(64) + '\n'); writeFileSync(join(tmp, 'docs', 'features', id, 'mockup', 'diff-scenarios.json'), '[{"state":"01-a.html","path":"/"}]'); }
  // ⑪ 부정: 상태 오기 · closed인데 result 없음 / 양성: answered
  for (const [id, st] of [['HO-000000-bad', 'done'], ['HO-000000-noresult', 'closed'], ['HO-000000-ok', 'answered']]) { mkdirSync(join(tmp, 'docs', 'handoffs', id), { recursive: true }); writeFileSync(join(tmp, 'docs', 'handoffs', id, 'request.md'), `# ${id}\n\n- 상태: ${st}\n- 작성: test · 2026-01-01\n`); }
  // ⑫ 부정: manifest 해시와 다른 코어 파일
  writeFileSync(join(tmp, '.harness', 'init-manifest.json'), JSON.stringify({ core: { '.harness/HARNESS.md': 'deadbeef' } }));
  const p = lint(tmp); rmSync(tmp, { recursive: true, force: true });
  const want = ['BOM', '카탈로그', '예산', '중복 문장', '귀속 머리 없음: docs/decisions/ADR-000000-x.md', '귀속 머리 없음: docs/records/INC-000000-x.md', '생성물 표식', 'axis(real-device)', 'closed FDR FDR-000000-lite: capability', 'closed FDR FDR-000000-lite: RUN', 'closed FDR FDR-000000-std: RUN', 'HO-000000-bad: 상태(done)', 'HO-000000-noresult: closed인데', '코어 파일이 템플릿 사본과 다르다: .harness/HARNESS.md', 'docs/extra/', 'rules/packs', 'scope 겹침: FDR-000000-a(src/customs/**) ↔ FDR-000000-b', '목업 대조 FDR-000000-mock: shipped인데 rev 1의 대조 기록이 없다', '목업 게이트(mockups) 위반: 목업 검사 위반 1건', '프로젝트 도구가 없다: scripts/missing-tool.mjs'];
  const miss = want.filter((w) => !p.some((x) => x.includes(w)));
  const falsePos = p.filter((x) => x.includes('FDR-000000-ok') || x.includes('HO-000000-ok') || x.includes('FDR-000000-mockwip') || /scope 겹침.*FDR-000000-c/.test(x) || /참조 저장소 mockups/.test(x) || /ok-tool|validate\.mjs/.test(x));
  console.log(miss.length || falsePos.length ? `self-test FAIL (미검출: ${miss.join(', ')} · 오탐: ${falsePos.join(', ')})\n` + p.join('\n') : `self-test OK (${want.length}종 검출 · 양성 대조 4건 · 기록 자리 3곳 · 프로젝트 도구)`);
  process.exit(miss.length || falsePos.length ? 1 : 0);
}
const root = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(HERE, '..', '..');
const p = lint(root);
if (p.length) { console.log('harness lint 위반 ' + p.length + '건:\n- ' + p.join('\n- ')); process.exit(1); }
console.log('harness lint OK');
