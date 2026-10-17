#!/usr/bin/env node
// check-branch-record.mjs — pre-commit 게이트. 브랜치 이름(<type>/<ID>)과 스테이징된 경로를 대조한다.
//   main(base)       : 제품 경로(src app tests lib packages tools …)를 직접 커밋하지 않는다 — work.mjs finish(HARNESS_WORK_FINISH=1)의 병합만 통과. 문서·규칙은 허용
//   fdr/<ID>         : 제품 경로는 그 FDR의 scope: glob 안에서만. scope가 비어 있으면 제품 경로 거부(먼저 선언). 다른 기록(docs/<자리>/<다른 ID>) 거부
//   rfc/<ID>         : spike — 제품 경로 자유. 다른 기록 거부 (이 브랜치는 main에 병합되지 않으므로 코드가 새지 않는다)
//   ho/ mtg/ inc/    : 자기 기록 폴더만
//   plan/<ID>        : 통합 브랜치 — FDR 병합을 받는 자리. 직접 커밋은 자기 기록과 병합 커밋만
// 기록 자리는 lib/records.mjs(ADR→docs/decisions · RFC→research · FDR→features · HO→handoffs · 그 밖→records)
// 선언은 없다 — 브랜치 이름이 곧 기록이다. 우회 플래그 없음. 자기 검사: --self-test
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORD_PATH_RE, recordDir, recordRel } from './lib/records.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NON_PRODUCT = /^(docs|rules|mockups|\.harness|\.claude|\.agents|\.gemini|\.github|\.scratch|\.worktrees|collab)\/|^[^/]+$/;   // 문서·규칙·목업(embedded)·장치(런타임 입구 포함)·루트 파일은 제품 경로가 아니다
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '(?:/.*)?$');

export function fdrScope(root, id) {
  const dir = join(root, recordDir(id), id);
  const head = existsSync(join(dir, 'manifest.yaml')) ? readFileSync(join(dir, 'manifest.yaml'), 'utf8') : existsSync(join(dir, 'fdr.md')) ? readFileSync(join(dir, 'fdr.md'), 'utf8') : '';
  const m = head.match(/^scope:\s*\[([^\]]*)\]/m);
  return m ? m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
}

/** 반환 [] = 통과, 문자열[] = 거부 사유 */
export function judge({ branch, base = 'main', staged, scope = [], finishing = false }) {
  const problems = [];
  const product = staged.filter((p) => !NON_PRODUCT.test(p));
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
  ];
  let fail = 0;
  for (const [inp, want] of cases) { const got = judge(inp).length; if ((got > 0) !== (want > 0)) { fail++; console.error('FAIL', JSON.stringify(inp), judge(inp)); } }
  const re = globRe('src/customs/**'); if (!re.test('src/customs/a/b.ts') || re.test('src/other/a.ts')) { fail++; console.error('FAIL glob'); }
  console.log(fail ? `self-test FAIL (${fail})` : `self-test OK (브랜치·경로 ${cases.length}건 · glob)`);
  process.exit(fail ? 1 : 0);
}

const g = (c) => execSync(`git ${c}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
let branch = ''; try { branch = g('branch --show-current'); } catch { process.exit(0); }
if (!branch) process.exit(0);   // detached — 병합·리베이스 중간 상태는 판정하지 않는다
const staged = g('diff --cached --name-only --diff-filter=ACMR').split('\n').filter(Boolean);
const hy = existsSync(join(ROOT, 'harness.yaml')) ? readFileSync(join(ROOT, 'harness.yaml'), 'utf8') : '';
const base = ((hy.match(/^work:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '').match(/^\s*base:\s*(\S+)/m)?.[1] || 'main';
const id = (branch.match(/^fdr\/([A-Z]+-\d{6}-[a-z0-9-]+)$/) || [])[1];
const problems = judge({ branch, base, staged, scope: id ? fdrScope(ROOT, id) : [], finishing: process.env.HARNESS_WORK_FINISH === '1' });
if (problems.length) { console.log('[check-branch-record] ' + problems.join('\n[check-branch-record] ')); process.exit(1); }
}
