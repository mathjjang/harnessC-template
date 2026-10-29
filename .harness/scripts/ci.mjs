#!/usr/bin/env node
// ci.mjs — 서버 쪽 게이트 (GitHub Actions `.github/workflows/harness.yml`이 부른다 · 로컬에서도 같은 결과). pre-commit은 우회될 수 있으므로(--no-verify · 훅 미설정 · 다른 런타임) PR에서 다시 묻는다.
//
//   node .harness/scripts/ci.mjs [--base <브랜치>] [--head <브랜치>]     (Actions: HARNESS_CI_BASE=github.base_ref · HARNESS_CI_HEAD=github.head_ref)
//
// 언제나: ① lint ② build-index --check ③ harness-build --check ④ (템플릿 저장소면) 코어 전 self-test
// PR일 때(head가 있으면): ⑤ 브랜치=기록 · scope — check-branch-record 판정을 PR 변경 파일 전체에 ⑥ 임시 파일 ⑦ 리뷰 판정 — fdr/*·plan/* PR은
//   그 기록의 리뷰 판정이 `통과`(또는 `조건부` + 조건)여야 하고, risk high면 사람 사인오프가 있어야 병합 가능. 리뷰어는 구현자와 달라야 한다(리뷰어 칸 ≠ 작성 머리).
//   ⑧ 판정 뒤 제품 코드 — 판정이 마지막으로 바뀐 커밋에 제품 경로가 섞였거나, 그 뒤 커밋이 제품 경로를 바꾸면 판정 무효(다시 리뷰). 런타임과 무관한 하한:
//   Claude Code의 리뷰어 쓰기 차단(guard-role-write)이 없는 Codex·Gemini에서도 「리뷰어가 고치고 통과」는 병합되지 않는다.
// 검사하지 않는 것: 리뷰 내용의 타당성 — 판정이 기록됐는지·누가 했는지까지만. --self-test: 판정 파싱·PR 판정을 픽스처로.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, fdrScope, NON_PRODUCT } from './check-branch-record.mjs';
import { isClutter } from './check-clutter.mjs';
import { recordDir } from './lib/records.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const yamlScalar = (t, k) => ((t.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
const frontmatter = (t) => (t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';

/** 리뷰 칸 해석 — 파일 원문(standard 06-review.md · lite fdr.md)에서 판정 줄·리뷰어 */
function parseReview(raw, std) {
  const text = std ? raw : ((raw.split(/^## 5\. Review[^\n]*$/m)[1] || '').split(/^## /m)[0]);
  const verdictLine = text.split('\n').find((l) => /^\s*-\s*(판정[:：]\s*)?(통과|재작업|조건부)/.test(l) && !/통과\s*\|/.test(l)) || '';
  const reviewer = ((text.match(/리뷰어\(모델\)[:：]\s*([^·\n]*)/) || [])[1] || '').trim();
  return { text, verdictLine, reviewer };
}

/** 리뷰 판정 읽기 — standard 06-review.md §1 · lite fdr.md §5. 양식 그대로(「통과 | 재작업 …」)면 미기입 */
export function reviewOf(dir) {
  const std = existsSync(join(dir, '06-review.md'));
  const { text, verdictLine, reviewer } = parseReview(rd(join(dir, std ? '06-review.md' : 'fdr.md')), std);
  const head = std ? rd(join(dir, 'manifest.yaml')) : frontmatter(rd(join(dir, 'fdr.md')));
  const verdict = (verdictLine.match(/(통과|재작업|조건부)/) || [])[1] || '';
  const author = ((rd(join(dir, std ? '01-spec.md' : 'fdr.md')).match(/작성[:：]\s*([^·\n]+)/) || [])[1] || '').trim();
  const signoff = ((text.match(/사인오프[^:：\n]*[:：]\s*([^\n]*)/) || [])[1] || '').trim();   // "사인오프(risk high): …" 꼴도
  const condition = ((verdictLine.match(/조건[:：]\s*([^)\n]+)/) || [])[1] || '').trim();
  return { verdict, reviewer, author, signoff, condition, risk: yamlScalar(head, 'risk') || 'low', status: yamlScalar(head, 'status') };
}

/** ⑧ 판정 뒤 제품 코드 — commits: 오래된 것부터 [{ sha, files }] · showAt(sha, 경로) → 그 커밋의 파일 원문. 판정(판정 줄·리뷰어)이 마지막으로 바뀐 커밋이 기준 */
export function afterVerdict(commits, reviewPath, std, showAt) {
  let key = ''; let at = -1;
  commits.forEach((c, i) => { if (!c.files.includes(reviewPath)) return; const r = parseReview(showAt(c.sha, reviewPath) || '', std); const k = r.verdictLine && r.reviewer ? `${r.verdictLine}|${r.reviewer}` : ''; if (k !== key) { key = k; at = k ? i : -1; } });
  if (at < 0) return [];
  const product = (fs) => fs.filter((f) => !NON_PRODUCT.test(f)); const p = [];
  const mixed = product(commits[at].files); if (mixed.length) p.push(`리뷰: 판정과 제품 코드를 한 커밋(${commits[at].sha.slice(0, 7)})에 섞었다: ${mixed.slice(0, 3).join(', ')} — 판정 커밋에는 리뷰 기록만`);
  const later = commits.slice(at + 1).filter((c) => product(c.files).length);
  if (later.length) p.push(`리뷰: 판정 뒤에 제품 코드가 바뀌었다(${later.slice(0, 3).map((c) => c.sha.slice(0, 7)).join(', ')}) — 판정 무효, 리뷰어(다른 세션)가 다시 판정`);
  return p;
}

/** PR 판정 — 반환 [문제] */
export function prProblems(root, { base, head, changed, commits = null, showAt = null }) {
  const p = [];
  const scopeId = (head.match(/^fdr\/([A-Z]+-\d{6}-[a-z0-9-]+)$/) || [])[1];
  for (const x of judge({ branch: head, base, staged: changed, scope: scopeId ? fdrScope(root, scopeId) : [], finishing: false })) p.push(`브랜치·scope: ${x}`);
  for (const f of changed.filter((f) => isClutter(f))) p.push(`임시 파일: ${f} — .scratch/ 또는 evidence/로`);
  const m = head.match(/^(fdr|plan)\/([A-Z]+-\d{6}-[a-z0-9-]+)$/);
  if (m) {
    const id = m[2]; const dir = join(root, recordDir(id), id);
    if (!existsSync(dir)) return [...p, `리뷰: 기록 폴더가 없다 — ${recordDir(id)}/${id}`];
    const r = reviewOf(dir);
    if (!r.verdict) p.push(`리뷰: ${id} 판정 없음 — 리뷰어(다른 세션)가 ${existsSync(join(dir, '06-review.md')) ? '06-review.md §1' : 'fdr.md §5'}에 통과·재작업·조건부를 적은 뒤 병합`);
    else if (r.verdict === '재작업') p.push(`리뷰: ${id} 판정 재작업 — 고친 뒤 다시 리뷰`);
    else if (r.verdict === '조건부' && !r.condition) p.push(`리뷰: ${id} 조건부인데 조건이 없다 — "조건부(조건: …)"`);
    if (r.verdict && !r.reviewer) p.push(`리뷰: ${id} 리뷰어(모델) 칸이 비었다`);
    if (r.verdict && r.reviewer && r.author && r.reviewer === r.author) p.push(`리뷰: ${id} 리뷰어(${r.reviewer})가 작성자와 같다 — 고친 쪽은 자기 검증자가 될 수 없다`);
    if (r.risk === 'high' && !/\S/.test(r.signoff.replace(/[()（）]/g, ''))) p.push(`리뷰: ${id} risk high — 사람 사인오프(이름·날짜)가 없다`);
    if (r.verdict && commits && showAt) { const std = existsSync(join(dir, '06-review.md')); p.push(...afterVerdict(commits, `${recordDir(id)}/${id}/${std ? '06-review.md' : 'fdr.md'}`, std, showAt)); }
  }
  return p;
}

/** 판정 뒤 제품 코드(⑧)는 커밋 순서로 본다 — ranges 중 처음 되는 범위의 { commits(오래된 것부터 [{sha, files}]), showAt }. CI(PR)와 work.mjs finish(ff)가 같이 쓴다 */
export function commitHistory(root, ranges) {
  const lg = ranges.map((r) => sh(`git log --reverse --format=%x01%H --name-only "${r}"`, root)).find((x) => x.ok);
  const commits = lg ? lg.out.split('\x01').filter((s) => s.trim()).map((s) => { const [sha, ...fs] = s.trim().split('\n'); return { sha: sha.trim(), files: fs.map((f) => f.trim()).filter(Boolean) }; }) : null;
  const showAt = (sha, path) => { const r = sh(`git show "${sha}:${path}"`, root); return r.ok ? r.out : ''; };
  return { commits, showAt };
}

function sh(cmd, cwd = ROOT) { try { return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' ? undefined : '/bin/bash' }).trim() }; } catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; } }

export function run(root = ROOT, { base = '', head = '' } = {}) {
  const results = [];
  const step = (name, r) => { results.push({ name, ...r }); console.log(`${r.ok ? '✔' : '✘'} ${name}${r.ok ? '' : '\n  ' + r.out.split('\n').slice(0, 12).join('\n  ')}`); };
  const node = `"${process.execPath}"`;
  step('lint', sh(`${node} .harness/scripts/lint.mjs`, root));
  step('생성 인덱스 최신', sh(`${node} .harness/scripts/build-index.mjs --check`, root));
  step('런타임 입구 최신', sh(`${node} .harness/scripts/harness-build.mjs --check`, root));
  if (existsSync(join(root, 'init.mjs'))) {   // 템플릿 저장소 — 코어 전 self-test
    const fails = [];
    for (const f of [join(root, 'init.mjs'), ...['.harness/scripts', '.harness/scripts/lib'].flatMap((d) => readdirSync(join(root, d)).filter((n) => n.endsWith('.mjs')).map((n) => join(root, d, n))), ...readdirSync(join(root, '.claude', 'hooks')).filter((n) => /^guard-.*\.mjs$/.test(n)).map((n) => join(root, '.claude', 'hooks', n))]) {
      if (/ci\.mjs$/.test(f)) continue;
      const r = sh(`${node} "${f}" --self-test`, root); if (!r.ok) fails.push(`${f.replace(root, '').replace(/\\/g, '/')}: ${r.out.split('\n').pop()}`);
    }
    step('코어 self-test', { ok: !fails.length, out: fails.join('\n') });
  }
  if (head) {
    const b = base || 'main';
    let changed = [];
    const d = sh(`git diff --name-only --diff-filter=ACMR "origin/${b}...HEAD"`, root); const d2 = d.ok ? d : sh(`git diff --name-only --diff-filter=ACMR "${b}...HEAD"`, root);
    if (!d2.ok) step('PR 변경 파일', d2); else {
      changed = d2.out.split('\n').filter(Boolean);
      const p = prProblems(root, { base: b, head, changed, ...commitHistory(root, [`origin/${b}..HEAD`, `${b}..HEAD`]) }); step(`PR 판정 (${head} → ${b} · 파일 ${changed.length})`, { ok: !p.length, out: p.join('\n') }); }
  }
  const failed = results.filter((r) => !r.ok);
  if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## harness\n\n${results.map((r) => `- ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : `\n\n\`\`\`\n${r.out.slice(0, 3000)}\n\`\`\``}`).join('\n')}\n`); } catch { /* */ } }
  return { ok: !failed.length, results };
}

const IS_MAIN = process.argv[1] && /ci\.mjs$/.test(process.argv[1]);
if (IS_MAIN && process.argv.includes('--self-test')) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const t = mkdtempSync(join(tmpdir(), 'ci-st-')); const fails = [];
  const w = (p, s) => { mkdirSync(dirname(join(t, p)), { recursive: true }); writeFileSync(join(t, p), s); };
  const lite = (id, { risk = 'low', verdict = '통과 | 재작업 | 조건부', reviewer = '', author = 'dev(a)', signoff = '' } = {}) => w(`docs/features/${id}/fdr.md`, `---\nid: ${id}\nstatus: shipped\nrisk: ${risk}\nscope: [src/a/**]\n---\n\n# ${id}\n\n- 작성: ${author} · 2026-01-01\n\n## 4. Test\n\n## 5. Review (접점 ②)\n\n- 리뷰어(모델): ${reviewer}\n- 판정: ${verdict}\n- 사람 사인오프(risk high): ${signoff}\n\n## 세션 로그\n`);
  try {
    const PR = (id, changed = [`src/a/x.ts`, `docs/features/${id}/fdr.md`]) => prProblems(t, { base: 'main', head: `fdr/${id}`, changed });
    lite('FDR-260101-blank'); if (!PR('FDR-260101-blank').some((x) => /판정 없음/.test(x))) fails.push('양식 그대로 = 판정 없음');
    lite('FDR-260101-ok', { verdict: '통과', reviewer: 'reviewer(b)' }); if (PR('FDR-260101-ok').length) fails.push('통과 오탐: ' + PR('FDR-260101-ok').join(' | '));
    lite('FDR-260101-rework', { verdict: '재작업', reviewer: 'reviewer(b)' }); if (!PR('FDR-260101-rework').some((x) => /재작업/.test(x))) fails.push('재작업 미차단');
    lite('FDR-260101-self', { verdict: '통과', reviewer: 'dev(a)' }); if (!PR('FDR-260101-self').some((x) => /자기 검증자/.test(x))) fails.push('자기 리뷰 미차단');
    lite('FDR-260101-high', { verdict: '통과', reviewer: 'reviewer(b)', risk: 'high' }); if (!PR('FDR-260101-high').some((x) => /사인오프/.test(x))) fails.push('high 사인오프 미차단');
    lite('FDR-260101-high2', { verdict: '통과', reviewer: 'reviewer(b)', risk: 'high', signoff: '김 · 2026-01-02' }); if (PR('FDR-260101-high2').length) fails.push('high 사인오프 오탐');
    lite('FDR-260101-cond', { verdict: '조건부', reviewer: 'reviewer(b)' }); if (!PR('FDR-260101-cond').some((x) => /조건이 없다/.test(x))) fails.push('조건 없는 조건부');
    if (!PR('FDR-260101-ok', ['src/b/out.ts']).some((x) => /scope 밖/.test(x))) fails.push('scope 밖 미차단');
    if (!PR('FDR-260101-ok', ['src/a/.tmp-probe.mjs']).some((x) => /임시 파일/.test(x))) fails.push('임시 파일 미차단');
    if (!prProblems(t, { base: 'main', head: 'feature/x', changed: ['src/a.ts'] }).some((x) => /기록 ID 형식/.test(x))) fails.push('기록 아닌 브랜치 미차단');
    if (prProblems(t, { base: 'main', head: 'rfc/RFC-260101-q', changed: ['src/any.ts'] }).some((x) => /리뷰/.test(x))) fails.push('rfc PR에 리뷰 요구');
    // standard 06-review.md
    w('docs/features/FDR-260101-std/manifest.yaml', 'id: FDR-260101-std\nrisk: medium\nscope: [src/a/**]\n'); w('docs/features/FDR-260101-std/01-spec.md', '- 작성: dev(a) · 2026-01-01\n');
    w('docs/features/FDR-260101-std/06-review.md', '# r\n\n- 리뷰어(모델): reviewer(b) · 일자: 2026-01-02\n\n## 1. 판정\n\n- 통과 | 재작업(재개 Stage: ) | 조건부(조건: )\n');
    if (!PR('FDR-260101-std').some((x) => /06-review\.md §1/.test(x))) fails.push('standard 양식 = 판정 없음');
    w('docs/features/FDR-260101-std/06-review.md', '# r\n\n- 리뷰어(모델): reviewer(b) · 일자: 2026-01-02\n\n## 1. 판정\n\n- 조건부(조건: 로그 레벨 낮춤 후속 FDR)\n');
    if (PR('FDR-260101-std').length) fails.push('standard 조건부(조건 있음) 오탐: ' + PR('FDR-260101-std').join(' | '));
    // ⑧ 판정 뒤 제품 코드 — 커밋 순서를 픽스처로. sha 첫 글자 v = 판정이 적힌 원문, a = 양식 그대로
    const RP = 'docs/features/FDR-260101-ok/fdr.md'; const judged = readFileSync(join(t, RP), 'utf8'); const blank = judged.replace('- 판정: 통과', '- 판정: 통과 | 재작업 | 조건부');
    const showAt = (sha) => (sha[0] === 'v' ? judged : blank);
    const PRc = (commits) => prProblems(t, { base: 'main', head: 'fdr/FDR-260101-ok', changed: ['src/a/x.ts', RP], commits, showAt });
    const c = (sha, ...files) => ({ sha, files });
    if (PRc([c('a1', 'src/a/x.ts', RP), c('v1', RP)]).length) fails.push('판정 전 코드 오탐: ' + PRc([c('a1', 'src/a/x.ts', RP), c('v1', RP)]).join(' | '));
    if (!PRc([c('v1', RP), c('a2', 'src/a/x.ts')]).some((x) => /판정 뒤/.test(x))) fails.push('판정 뒤 코드 미차단');
    if (!PRc([c('v1', RP, 'src/a/x.ts')]).some((x) => /섞었다/.test(x))) fails.push('판정·코드 한 커밋 미차단');
    if (PRc([c('v1', RP), c('a3', 'docs/features/FDR-260101-ok/evidence/r.txt')]).length) fails.push('판정 뒤 기록만 오탐');
    if (PRc([c('v1', RP), c('a4', RP), c('a5', 'src/a/x.ts'), c('v2', RP)]).length) fails.push('재판정 뒤 오탐');
  } catch (e) { fails.push('예외: ' + e.message); }
  rmSync(t, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (리뷰 판정: 미기입·통과·재작업·자기 리뷰·high 사인오프 2·조건부 · standard 2 · scope 밖 · 임시 파일 · 기록 아닌 브랜치 · rfc 면제 · 판정 뒤 코드 5)');
  process.exit(fails.length ? 1 : 0);
}
if (IS_MAIN && !process.argv.includes('--self-test')) {
  const a = process.argv.slice(2); const opt = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
  const r = run(ROOT, { base: opt('--base') || process.env.HARNESS_CI_BASE || '', head: opt('--head') || process.env.HARNESS_CI_HEAD || '' });
  console.log(r.ok ? '\nharness CI OK' : `\nharness CI 실패 ${r.results.filter((x) => !x.ok).length}건`);
  process.exit(r.ok ? 0 : 1);
}
