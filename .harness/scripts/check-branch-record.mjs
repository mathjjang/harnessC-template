#!/usr/bin/env node
// check-branch-record.mjs — pre-commit 게이트. 브랜치 이름(<type>/<ID>)과 스테이징된 경로를 대조한다.
//   main(base)       : 제품 경로(src app tests lib packages tools …)를 직접 커밋하지 않는다 — work.mjs finish(HARNESS_WORK_FINISH=1)의 병합만 통과. 문서·규칙은 허용
//   fdr/<ID>         : 제품 경로는 그 FDR의 scope: glob 안에서만. scope가 비어 있으면 제품 경로 거부(먼저 선언). 다른 기록(docs/<자리>/<다른 ID>) 거부
//   rfc/<ID>         : spike — 제품 경로 자유. 다른 기록 거부 (이 브랜치는 main에 병합되지 않으므로 코드가 새지 않는다)
//   ho/ mtg/ inc/    : 자기 기록 폴더만
//   plan/<ID>        : 통합 브랜치 — FDR 병합을 받는 자리. 직접 커밋은 자기 기록과 병합 커밋만
//   rep/<slug>       : 템플릿 저장소의 규칙 변경(HARNESS §9) — 스테이징에 제품 경로가 없을 때만 통과(ci.mjs와 같은 조건 templateRep)
// 제품 경로가 아닌 것(nonProductOf): 문서·규칙·목업·장치 폴더와, 루트 파일 중 코어 기본 목록(CORE_ROOT_FILES) + harness.yaml work.root_files(프로젝트 확장 · 등재는 ADR). 그 밖의 루트 파일(package.json·main.py …)은 제품 경로다
// 기록 자리는 lib/records.mjs(ADR→docs/decisions · RFC→research · FDR→features · HO→handoffs · 그 밖→records)
// 선언은 없다 — 브랜치 이름이 곧 기록이다. 우회 플래그 없음. 자기 검사: --self-test
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORD_PATH_RE, recordDir, recordRel } from './lib/records.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NON_PRODUCT_DIR = /^(docs|rules|mockups|\.harness|\.claude|\.agents|\.gemini|\.github|\.scratch|\.worktrees|collab)\//;   // 문서·규칙·목업(embedded)·장치(런타임 입구 포함)
/** 제품이 아닌 루트 파일 — 코어 기본은 템플릿 루트의 규칙·설정 파일. 프로젝트의 루트 설정 파일(.editorconfig·.mcp.json …)은 harness.yaml work.root_files에 */
export const CORE_ROOT_FILES = ['.gitattributes', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'LICENSE', 'README.md', 'harness.yaml', 'init.mjs'];
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const workBlock = (root) => (rd(join(root, 'harness.yaml')).match(/^work:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '';
/** harness.yaml work.root_files: [a, b] — 제품이 아닌 루트 파일(프로젝트 확장) */
export const rootFiles = (root) => { const m = workBlock(root).match(/^\s*root_files:\s*\[([^\]]*)\]/m); return m ? m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : []; };
/** 제품 경로가 아닌지 — { test(경로) }. extra: 더 허용할 루트 파일 */
export const nonProduct = (extra = []) => { const files = new Set([...CORE_ROOT_FILES, ...extra]); return { test: (p) => NON_PRODUCT_DIR.test(p) || files.has(p) }; };
/** 코어 기본만(프로젝트 확장 없음). 프로젝트 판정은 nonProductOf(root) */
export const NON_PRODUCT = nonProduct();
export const nonProductOf = (root) => nonProduct(rootFiles(root));
/** 템플릿 저장소의 REP 브랜치(HARNESS §9 rep/<slug>) — 브랜치=기록 검사 면제. init.mjs·.harness/tiers는 보조 표지(prune 안 한 프로젝트에도 남는다)이고 실질 방어는 바뀐 경로에 제품 경로가 없다는 것(main 직접 커밋 허용 범위와 같다). ci(PR 전체)·pre-commit(스테이징)이 같이 쓴다 */
export const templateRep = (root, branch, paths, np = nonProductOf(root)) => existsSync(join(root, 'init.mjs')) && existsSync(join(root, '.harness', 'tiers')) && /^rep\/[a-z0-9-]+$/.test(branch) && paths.every((f) => np.test(f));
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '(?:/.*)?$');

export function fdrScope(root, id) {
  const dir = join(root, recordDir(id), id);
  const head = existsSync(join(dir, 'manifest.yaml')) ? readFileSync(join(dir, 'manifest.yaml'), 'utf8') : existsSync(join(dir, 'fdr.md')) ? readFileSync(join(dir, 'fdr.md'), 'utf8') : '';
  const m = head.match(/^scope:\s*\[([^\]]*)\]/m);
  return m ? m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
}

/** 반환 [] = 통과, 문자열[] = 거부 사유 */
export function judge({ branch, base = 'main', staged, scope = [], finishing = false, np = NON_PRODUCT }) {
  const problems = [];
  const product = staged.filter((p) => !np.test(p));
  const m = branch.match(/^(fdr|rfc|ho|mtg|inc|retro|plan)\/([A-Z]+-\d{6}-[a-z0-9-]+)$/);
  if (branch === base || branch === 'main') {
    if (product.length && !finishing) problems.push(`${branch}에 제품 코드를 직접 커밋하지 않는다: ${product.slice(0, 3).join(', ')}${product.length > 3 ? ' …' : ''} — node .harness/scripts/work.mjs start <ID>로 브랜치를 열어 작업하고 finish로 병합`);
    return problems;
  }
  if (!m) return [`브랜치 이름이 기록 ID 형식이 아니다: ${branch} — <type>/<TYPE-YYMMDD-slug> (work.mjs start가 만든다)`];
  const [, type, id] = m;
  const other = staged.filter((p) => { const r = p.match(RECORD_PATH_RE); return r && r[2].replace(/\.md$/, '') !== id && !/\.generated\.md$/.test(p); });
  if (other.length && type !== 'plan') problems.push(`${branch}에서 다른 기록을 고치지 않는다: ${other.slice(0, 3).join(', ')} — 그 기록의 브랜치에서`);
  if (type === 'fdr' && product.length) {
    if (!scope.length) problems.push(`${id}의 scope:가 비어 있다 — fdr.md/manifest.yaml 머리말에 이 FDR이 고치는 제품 경로 glob을 선언한 뒤 커밋 (예: scope: [src/customs/**, src/config/weights.yaml])`);
    else { const res = scope.map(globRe); const out = product.filter((p) => !res.some((re) => re.test(p))); if (out.length) problems.push(`${id} scope 밖 제품 경로: ${out.slice(0, 3).join(', ')} — scope를 넓히거나(겹침은 lint ⑭) 공유 변경은 별도 lite FDR로 먼저`); }
  }
  if (['ho', 'mtg', 'inc', 'retro'].includes(type) && product.length) problems.push(`${branch}에는 제품 코드를 두지 않는다 — 재현물은 ${recordRel(id)}/evidence/`);
  if (type === 'plan' && product.length && !finishing) problems.push(`${branch}는 통합 브랜치다 — 제품 코드는 fdr/* 브랜치에서 만들어 병합한다`);
  return problems;
}

/** 스테이징된 경로 — 삭제·이동 전 경로까지(--no-renames: 이동은 삭제+추가). 제품 파일을 지우거나 docs/로 옮기는 것도 제품 변경이다(ci.mjs changedFiles와 같은 기준) */
export function stagedPaths(cwd) {
  return execSync('git -c core.quotepath=false diff --cached --name-only --no-renames', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
}

/** pre-commit 판정 — 반환 [거부 사유]. root의 harness.yaml(work.base·work.root_files)과 FDR scope를 읽는다 */
export function precommit(root, { branch, staged, finishing = false }) {
  const np = nonProductOf(root);
  if (templateRep(root, branch, staged, np)) return [];
  const base = workBlock(root).match(/^\s*base:\s*(\S+)/m)?.[1] || 'main';
  const id = (branch.match(/^fdr\/([A-Z]+-\d{6}-[a-z0-9-]+)$/) || [])[1];
  return judge({ branch, base, staged, scope: id ? fdrScope(root, id) : [], finishing, np });
}

const IS_MAIN = Boolean(process.argv[1]) && /check-branch-record\.mjs$/.test(process.argv[1]);
if (IS_MAIN) {
if (process.argv.includes('--self-test')) {
  const cases = [
    [{ branch: 'main', staged: ['docs/decisions/ADR-260101-x.md', 'rules/product.md'] }, 0],
    [{ branch: 'main', staged: ['src/a.ts'] }, 1],
    [{ branch: 'main', staged: ['.agents/skills/x/SKILL.md', '.gemini/commands/x.toml', '.claude/skills/x/SKILL.md'] }, 0],
    [{ branch: 'main', staged: ['mockups/screens/ds/list/01-default.html', 'mockups/screens/ds/list/rev.yaml'] }, 0],
    [{ branch: 'main', staged: ['src/a.ts'], finishing: true }, 0],
    [{ branch: 'fdr/FDR-260101-x', staged: ['src/customs/api.ts', 'docs/features/FDR-260101-x/fdr.md'], scope: ['src/customs/**'] }, 0],
    [{ branch: 'fdr/FDR-260101-x', staged: ['src/other/b.ts'], scope: ['src/customs/**'] }, 1],
    [{ branch: 'fdr/FDR-260101-x', staged: ['src/customs/api.ts'], scope: [] }, 1],
    [{ branch: 'fdr/FDR-260101-x', staged: ['docs/features/FDR-260101-y/fdr.md'], scope: ['src/**'] }, 1],
    [{ branch: 'fdr/FDR-260101-x', staged: ['docs/records/INC-260101-z.md'], scope: ['src/**'] }, 1],
    [{ branch: 'fdr/FDR-260101-x', staged: ['src/config/weights.yaml'], scope: ['src/config/*.yaml'] }, 0],
    [{ branch: 'rfc/RFC-260101-q', staged: ['src/anything/x.ts', 'docs/research/RFC-260101-q/rfc.md'] }, 0],
    [{ branch: 'rfc/RFC-260101-q', staged: ['docs/decisions/ADR-260101-z.md'] }, 1],
    [{ branch: 'ho/HO-260101-h', staged: ['src/x.ts'] }, 1],
    [{ branch: 'ho/HO-260101-h', staged: ['docs/handoffs/HO-260101-h/01-codex.md', 'docs/INDEX.generated.md'] }, 0],
    [{ branch: 'plan/PLAN-260101-p', staged: ['src/x.ts'] }, 1],
    [{ branch: 'plan/PLAN-260101-p', staged: ['docs/features/FDR-260101-x/fdr.md'] }, 0],
    [{ branch: 'feature/random', staged: ['docs/x.md'] }, 1],
    [{ branch: 'main', staged: ['README.md', 'harness.yaml', '.gitignore', 'AGENTS.md'] }, 0],
    [{ branch: 'main', staged: ['package.json'] }, 1],
    [{ branch: 'main', staged: ['main.py'] }, 1],
    [{ branch: 'ho/HO-260101-h', staged: ['main.py'] }, 1],
    [{ branch: 'fdr/FDR-260101-x', staged: ['package.json'], scope: ['src/customs/**'] }, 1],
  ];
  let fail = 0;
  for (const [inp, want] of cases) { const got = judge(inp).length; if ((got > 0) !== (want > 0)) { fail++; console.error('FAIL', JSON.stringify(inp), judge(inp)); } }
  const re = globRe('src/customs/**'); if (!re.test('src/customs/a/b.ts') || re.test('src/other/a.ts')) { fail++; console.error('FAIL glob'); }
  // 스테이징 경로 — 삭제·이동 전 경로까지(임시 git 저장소)
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const t = mkdtempSync(join(tmpdir(), 'cbr-st-')); const gx = (c) => execSync(`git -c user.name=t -c user.email=t@t ${c}`, { cwd: t, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  try {
    gx('init -q -b main'); mkdirSync(join(t, 'src')); mkdirSync(join(t, 'docs')); writeFileSync(join(t, 'src', 'a.ts'), 'a\n'); writeFileSync(join(t, 'src', 'b.ts'), 'b\nb\nb\n'); writeFileSync(join(t, 'docs', 'x.md'), 'x\n');
    gx('add -A'); gx('commit -q -m base'); gx('rm -q src/a.ts'); gx('mv src/b.ts docs/b.md');
    const sp = stagedPaths(t); for (const f of ['src/a.ts', 'src/b.ts', 'docs/b.md']) if (!sp.includes(f)) { fail++; console.error('FAIL 스테이징 경로 누락', f, sp); }
    if (!judge({ branch: 'main', staged: sp }).length) { fail++; console.error('FAIL main에서 제품 파일 삭제·이동 미차단'); }
    // pre-commit 판정(precommit) — 루트 파일 확장(work.root_files) · 템플릿 rep/ 면제(ci와 같은 조건)
    const P = (branch, staged) => precommit(t, { branch, staged }).length;
    writeFileSync(join(t, 'harness.yaml'), 'mockup:\n  root_files: [package.json]\n\nwork:\n  base: main\n  root_files: [pyproject.toml, ".editorconfig"]   # x\n');
    if (P('main', ['pyproject.toml', '.editorconfig']) || P('main', ['README.md'])) { fail++; console.error('FAIL work.root_files·코어 루트 파일 오탐'); }
    if (!P('main', ['package.json'])) { fail++; console.error('FAIL 다른 절의 root_files를 읽음(package.json 미차단)'); }
    if (!P('rep/x', ['.harness/HARNESS.md'])) { fail++; console.error('FAIL 템플릿 아닌 저장소의 rep/ 커밋 미차단'); }
    writeFileSync(join(t, 'init.mjs'), '//\n'); if (!P('rep/x', ['.harness/HARNESS.md'])) { fail++; console.error('FAIL init.mjs만 있는 저장소의 rep/ 커밋 미차단'); }
    mkdirSync(join(t, '.harness', 'tiers'), { recursive: true });
    if (P('rep/x', ['.harness/HARNESS.md', 'init.mjs', 'pyproject.toml'])) { fail++; console.error('FAIL 템플릿 rep/ 커밋 오탐', precommit(t, { branch: 'rep/x', staged: ['.harness/HARNESS.md'] })); }
    if (!P('rep/x', ['.harness/HARNESS.md', 'src/a.ts']) || !P('rep/x', ['package.json'])) { fail++; console.error('FAIL rep/ 커밋의 제품 경로(루트 package.json 포함) 미차단'); }
    if (!P('rep/Bad_Slug', ['.harness/HARNESS.md'])) { fail++; console.error('FAIL rep/ 슬러그 형식 밖 미차단'); }
    rmSync(join(t, 'init.mjs')); if (!P('rep/x', ['.harness/HARNESS.md'])) { fail++; console.error('FAIL tiers만 있는 저장소의 rep/ 커밋 미차단'); }
  } catch (e) { fail++; console.error('FAIL 예외', e.message); } finally { rmSync(t, { recursive: true, force: true }); }
  console.log(fail ? `self-test FAIL (${fail})` : `self-test OK (브랜치·경로 ${cases.length}건 · glob · 삭제·이동 스테이징 2 · pre-commit 루트 파일 확장 2 · rep/ 면제 6)`);
  process.exit(fail ? 1 : 0);
}

const g = (c) => execSync(`git ${c}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
let branch = ''; try { branch = g('branch --show-current'); } catch { process.exit(0); }
if (!branch) process.exit(0);   // detached — 병합·리베이스 중간 상태는 판정하지 않는다
const problems = precommit(ROOT, { branch, staged: stagedPaths(ROOT), finishing: process.env.HARNESS_WORK_FINISH === '1' });
if (problems.length) { console.log('[check-branch-record] ' + problems.join('\n[check-branch-record] ')); process.exit(1); }
}
