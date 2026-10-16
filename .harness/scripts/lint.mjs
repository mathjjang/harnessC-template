#!/usr/bin/env node
// lint.mjs — 하네스 린트 (rules/HARNESS.md §1·§3·§8·§9). pre-commit·세션 시작·CI에서 부른다. 종료코드 1 = 위반.
// 검사: ① UTF-8 BOM ② 규칙 파일이 참조하는 스크립트가 .harness/catalog.yaml에 active인가 ③ 상시 규칙 예산
//       ④ 규칙 파일 간 중복 문장(정규화 후 16자 이상 동일) ⑤ 기록 머리 귀속(작성:) ⑥ 생성물 수동 편집 표식
//       ⑦ .harness/scripts/*.mjs 카탈로그 등재 ⑧ 중첩 참조 저장소(references)는 gitignore·미추적
//       ⑨ human-run 큐의 axis가 rules/human-only.yaml에 등록돼 있는가 (§5) ⑩ closed FDR에 스펙 병합 흔적·RUN 증거(outputs/evidence/<ID>/runs)가 있는가 (§4·§6)
//       ⑪ 핸드오프(docs/handoffs/HO-…/request.md)의 상태가 open|taken|answered|closed 중 하나인가 (§11)
// 검사하지 않는 것: 증거의 내용이 맞는지, 리뷰 판정이 타당한지 — 형식·존재·연결만 본다. "lint OK"는 그 범위의 통과다.
// --self-test: 위반 표본에서 각 검사가 실제로 잡히는지 확인.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { parseReferences } from './lib/refs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULE_FILES = ['rules/HARNESS.md', 'rules/product.md', 'AGENTS.md', 'CLAUDE.md'];
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();

function walk(dir, out = []) { if (!existsSync(dir)) return out; for (const e of readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.git'].includes(e.name)) continue; const p = join(dir, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; }

export function lint(root) {
  const problems = [];
  // ① BOM
  for (const f of walk(root).filter((f) => /\.(md|yaml|yml|json|mjs)$/.test(f))) {
    const b = readFileSync(f); if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) problems.push(`BOM: ${relative(root, f)}`);
  }
  // ② 도구 참조 vs 카탈로그
  const catalog = rd(join(root, '.harness', 'catalog.yaml'));
  const active = new Set([...catalog.matchAll(/^\s*-\s*name:\s*(\S+)[\s\S]*?status:\s*(\S+)/gm)].filter((m) => m[2] === 'active').map((m) => m[1]));
  const ruleText = RULE_FILES.map((f) => rd(join(root, f))).join('\n') + walk(join(root, '.claude', 'rules')).map((f) => rd(f)).join('\n') + walk(join(root, 'docs', 'runbooks')).map((f) => rd(f)).join('\n');
  for (const m of ruleText.matchAll(/scripts\/([a-z0-9-]+\.mjs)/g)) if (!active.has(m[1])) problems.push(`카탈로그에 active가 아닌 도구 참조: .harness/scripts/${m[1]}`);
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
  // ⑤ 귀속
  for (const dir of ['docs/decisions', 'docs/research', 'docs/incidents', 'docs/plans', 'docs/handoffs']) for (const f of walk(join(root, dir)).filter((f) => f.endsWith('.md') && !/README|\.gitkeep/.test(f))) {
    if (!/작성[:：]/.test(rd(f).slice(0, 600))) problems.push(`귀속 머리 없음: ${relative(root, f)}`);
  }
  // ⑦ .harness/scripts/*.mjs 는 카탈로그 등재 필수 (프로브가 눌러앉는 것을 막는다)
  const sdir = join(root, '.harness', 'scripts');
  if (existsSync(sdir)) for (const f of readdirSync(sdir)) if (f.endsWith('.mjs') && !active.has(f)) problems.push(`카탈로그 미등재 스크립트: .harness/scripts/${f} — 임시면 .scratch/, 영구면 .harness/catalog.yaml 등재`);
  // ⑥ 생성물 표식
  for (const f of walk(join(root, 'docs')).filter((f) => /\.generated\.md$/.test(f))) if (!/생성물|generated/i.test(rd(f).slice(0, 300))) problems.push(`생성물 표식 없음: ${relative(root, f)}`);
  // ⑧ 참조 저장소가 이 저장소 안에 중첩돼 있으면 gitignore·미추적이어야 한다 (git 결합 금지 — submodule도 추적도 아님)
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let isGit = false; try { git('rev-parse --show-toplevel'); isGit = true; } catch { /* git 밖 */ }
  if (isGit) for (const r of parseReferences(rd(join(root, 'harness.yaml')))) {
    const rel = relative(root, resolve(root, r.path));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    try { git(`check-ignore -q -- "${rel}"`); } catch { problems.push(`참조 저장소 ${r.path}가 .gitignore에 없다 — 중첩 체크아웃은 개발 저장소가 추적하면 안 된다`); }
    try { if (git(`ls-files -- "${rel}"`).trim()) problems.push(`참조 저장소 ${r.path}의 파일이 개발 저장소에 추적되고 있다 — git rm --cached`); } catch { /* */ }
  }
  // ⑨ human-run 큐 항목의 axis는 rules/human-only.yaml 등록 축만 (rules/HARNESS.md §5 — 기본값은 "에이전트가 한다")
  const axes = new Set([...rd(join(root, 'rules/human-only.yaml')).matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]));
  const frontmatter = (text) => (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  for (const f of walk(join(root, 'docs', 'queue', 'human-run')).filter((f) => f.endsWith('.md') && !/README/.test(f))) {
    const axis = yamlScalar(frontmatter(rd(f)), 'axis');
    if (!axis) problems.push(`human-run 큐에 axis 없음: ${relative(root, f)} — rules/human-only.yaml 축 ID 필수`);
    else if (!axes.has(axis)) problems.push(`human-run 큐의 axis(${axis})가 rules/human-only.yaml에 없다: ${relative(root, f)} — 등록(REP) 또는 에이전트가 한다`);
  }
  // ⑩ closed FDR은 스펙 병합 흔적(docs/specs/<capability>/spec.md에 FDR ID)과 RUN 증거가 있어야 한다 (§4 "병합 없이 closed 불가" · §6 "미검증은 통과 아님")
  const fdir = join(root, 'docs', 'features');
  if (existsSync(fdir)) for (const e of readdirSync(fdir, { withFileTypes: true })) {
    if (/README|\.gitkeep/.test(e.name)) continue;
    const isDir = e.isDirectory();
    const head = isDir ? rd(join(fdir, e.name, 'manifest.yaml')) : frontmatter(rd(join(fdir, e.name)));
    if (yamlScalar(head, 'status') !== 'closed') continue;
    const id = yamlScalar(head, 'id') || e.name.replace(/\.md$/, '');
    const cap = yamlScalar(head, 'capability').replace(/^(null|~)$/, '');
    const spec = cap ? rd(join(root, 'docs', 'specs', cap, 'spec.md')) : '';
    if (!cap || !spec) problems.push(`closed FDR ${id}: capability와 docs/specs/<capability>/spec.md가 없다 — 병합 없이 closed 불가 (shipped로 두거나 병합)`);
    else if (!spec.includes(id)) problems.push(`closed FDR ${id}: docs/specs/${cap}/spec.md에 병합 흔적(${id}) 없음`);
    let hasRun;
    if (isDir) hasRun = walk(join(root, 'outputs', 'evidence', id, 'runs')).some((f) => !/\.gitkeep$/.test(f));
    else { const sec = (rd(join(fdir, e.name)).split(/^## 4\. Test[^\n]*$/m)[1] || '').split(/^## /m)[0]; hasRun = sec.split('\n').filter((l) => /^\|/.test(l) && !/^\|[-| ]+\|$/.test(l)).length >= 2; }
    if (!hasRun) problems.push(`closed FDR ${id}: RUN 증거 없음(${isDir ? `outputs/evidence/${id}/runs/ 비어 있음` : '§4 Test 표에 행 없음'}) — 미검증 상태로 closed 불가`);
  }
  // ⑪ 핸드오프 상태
  const hdir = join(root, 'docs', 'handoffs');
  if (existsSync(hdir)) for (const e of readdirSync(hdir, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^HO-/.test(e.name)) continue;
    const req = rd(join(hdir, e.name, 'request.md'));
    const st = (req.match(/^- 상태:\s*(\S+)/m) || [])[1];
    if (!req) problems.push(`핸드오프 ${e.name}: request.md 없음`);
    else if (!['open', 'taken', 'answered', 'closed'].includes(st)) problems.push(`핸드오프 ${e.name}: 상태(${st || '없음'})는 open|taken|answered|closed`);
    else if (st === 'closed' && !existsSync(join(hdir, e.name, 'result.md'))) problems.push(`핸드오프 ${e.name}: closed인데 result.md 없음`);
  }
  return problems;
}

if (process.argv.includes('--self-test')) {
  const tmp = join(HERE, '..', '.lint-selftest'); rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'docs', 'decisions'), { recursive: true }); mkdirSync(join(tmp, '.harness'), { recursive: true }); mkdirSync(join(tmp, 'rules'), { recursive: true });
  writeFileSync(join(tmp, 'harness.yaml'), 'budgets:\n  always_on_kb: 1\n');
  writeFileSync(join(tmp, 'rules/HARNESS.md'), '﻿규칙 본문. node .harness/scripts/ghost.mjs 를 돌린다.\n이 문장은 두 파일에 똑같이 들어가 중복이 된다 예시\n' + 'x'.repeat(1500));
  writeFileSync(join(tmp, 'AGENTS.md'), '이 문장은 두 파일에 똑같이 들어가 중복이 된다 예시\n');
  writeFileSync(join(tmp, '.harness', 'catalog.yaml'), 'tools:\n  - name: ghost.mjs\n    status: planned\n');
  writeFileSync(join(tmp, 'docs', 'decisions', 'ADR-x.md'), '# 머리에 귀속 없음\n');
  writeFileSync(join(tmp, 'docs', 'X.generated.md'), '# 표식 없음\n');
  // ⑨⑩ 부정 모형: 미등록 axis의 human-run · 스펙 병합·RUN 없는 closed FDR(lite) · RUN 없는 closed FDR(standard, 스펙은 병합됨)
  mkdirSync(join(tmp, 'docs', 'queue', 'human-run'), { recursive: true }); mkdirSync(join(tmp, 'docs', 'features', 'FDR-000000-std'), { recursive: true }); mkdirSync(join(tmp, 'outputs', 'evidence', 'FDR-000000-std', 'runs'), { recursive: true }); mkdirSync(join(tmp, 'docs', 'specs', 'cap'), { recursive: true });
  writeFileSync(join(tmp, 'rules/human-only.yaml'), 'axes:\n  - id: external-account\n');
  writeFileSync(join(tmp, 'docs', 'queue', 'human-run', 'HR-000000-x.md'), '---\nid: HR-000000-x\naxis: real-device\n---\n');
  writeFileSync(join(tmp, 'docs', 'features', 'FDR-000000-lite.md'), '---\nid: FDR-000000-lite\nstatus: closed\ncapability:\n---\n## 4. Test\n\n| AC | 계층 | 명령 | RUN | 판정 |\n|---|---|---|---|---|\n\n## 5. Review\n');
  writeFileSync(join(tmp, 'docs', 'features', 'FDR-000000-std', 'manifest.yaml'), 'id: FDR-000000-std\nstatus: closed\ncapability: cap\n');
  writeFileSync(join(tmp, 'docs', 'specs', 'cap', 'spec.md'), '# cap\n병합: FDR-000000-std\n');
  // 양성 대조: 스펙 병합·RUN 있는 closed는 잡히지 않아야 한다
  mkdirSync(join(tmp, 'docs', 'features', 'FDR-000000-ok'), { recursive: true }); mkdirSync(join(tmp, 'outputs', 'evidence', 'FDR-000000-ok', 'runs'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'features', 'FDR-000000-ok', 'manifest.yaml'), 'id: FDR-000000-ok\nstatus: closed\ncapability: cap\n');
  writeFileSync(join(tmp, 'outputs', 'evidence', 'FDR-000000-ok', 'runs', 'unit.out'), 'exit 0\n');
  // ⑪ 부정 모형: 상태 오기 · closed인데 result 없음 / 양성: answered
  for (const [id, st] of [['HO-000000-bad', 'done'], ['HO-000000-noresult', 'closed'], ['HO-000000-ok', 'answered']]) { mkdirSync(join(tmp, 'docs', 'handoffs', id), { recursive: true }); writeFileSync(join(tmp, 'docs', 'handoffs', id, 'request.md'), `# ${id}\n\n- 상태: ${st}\n- 작성: test · 2026-01-01\n`); }
  writeFileSync(join(tmp, 'docs', 'specs', 'cap', 'spec.md'), '# cap\n병합: FDR-000000-std · FDR-000000-ok\n');
  const p = lint(tmp); rmSync(tmp, { recursive: true, force: true });
  const want = ['BOM', '카탈로그', '예산', '중복 문장', '귀속', '생성물 표식', 'axis(real-device)', 'closed FDR FDR-000000-lite: capability', 'closed FDR FDR-000000-lite: RUN', 'closed FDR FDR-000000-std: RUN', 'HO-000000-bad: 상태(done)', 'HO-000000-noresult: closed인데'];
  const miss = want.filter((w) => !p.some((x) => x.includes(w)));
  const falsePos = p.filter((x) => x.includes('FDR-000000-ok') || x.includes('HO-000000-ok'));
  console.log(miss.length || falsePos.length ? `self-test FAIL (미검출: ${miss.join(', ')} · 오탐: ${falsePos.join(', ')})\n` + p.join('\n') : 'self-test OK (12종 검출 · 양성 대조 2건)');
  process.exit(miss.length || falsePos.length ? 1 : 0);
}
const root = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(HERE, '..', '..');
const p = lint(root);
if (p.length) { console.log('harness lint 위반 ' + p.length + '건:\n- ' + p.join('\n- ')); process.exit(1); }
console.log('harness lint OK');
