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
import { judge, fdrScope, NON_PRODUCT, nonProductOf, templateRep } from './check-branch-record.mjs';
import { isClutter } from './check-clutter.mjs';
import { recordDir } from './lib/records.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const yamlScalar = (t, k) => ((t.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
const frontmatter = (t) => (t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';

/** 리뷰어 칸의 서브에이전트 표지 — 양식의 정해진 꼴은 「reviewer 서브에이전트 (<모델>)」. 띄어 쓴 꼴·영문(sub-agent·subagent)도 같은 표지로 본다 */
export const SUBAGENT = /서브\s*에이전트|sub-?agent/i;
/** 표지를 찾는 자리 — 리뷰어 줄을 ·로 나눈 조각 중 첫 조각(이름)과 「라벨:」로 시작하지 않는 조각. 「· 일자: …」「· 메모: 서브에이전트 아님」 같은 메모 조각은 보지 않는다(오탐). 「reviewer · 서브에이전트 (m)」은 그대로 잡는다 */
export const markerPart = (line) => line.split('·').filter((seg, i) => i === 0 || !/^\s*[^\s:：]+\s*[:：]/.test(seg)).join('·');
/** 글이 있는지 — 공백·보이지 않는 문자만 든 값은 빈 값과 같다(증거 파일·사인오프 칸). 지우는 것: 유니코드 Default_Ignorable_Code_Point(영폭, 한글 채움 U+3164·U+115F·U+1160·U+FFA0 포함) · 제어 Cc(NUL 등) · 서식 Cf · 사용 영역 Co · 점자 공백 U+2800.
 *  짝 없는 서로게이트(Cs)는 파일을 UTF-8로 읽을 때 U+FFFD로 바뀌어 여기 닿지 않는다. U+FFFD는 보이는 글자라 지우지 않는다 */
export const hasText = (t) => /\S/u.test(t.replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\p{Co}\u2800]/gu, ''));

/** 리뷰 칸 해석 — 파일 원문(standard 06-review.md · lite fdr.md)에서 판정 줄·리뷰어 */
function parseReview(raw, std) {
  const text = std ? raw : ((raw.split(/^## 5\. Review[^\n]*$/m)[1] || '').split(/^## /m)[0]);
  const verdictLine = text.split('\n').find((l) => /^\s*-\s*(판정[:：]\s*)?(통과|재작업|조건부)/.test(l) && !/통과\s*\|/.test(l)) || '';
  const reviewerLine = ((text.match(/리뷰어\(모델\)[:：][^\S\n]*([^\n]*)/) || [])[1] || '').trim();   // 줄 끝을 넘지 않는다 — 칸이 비면 다음 줄을 리뷰어로 읽지 않게
  const reviewer = reviewerLine.split('·')[0].trim();
  return { text, verdictLine, reviewer, reviewerLine };
}

/** 리뷰 판정 읽기 — standard 06-review.md §1 · lite fdr.md §5. 양식 그대로(「통과 | 재작업 …」)면 미기입 */
export function reviewOf(dir) {
  const std = existsSync(join(dir, '06-review.md'));
  const { text, verdictLine, reviewer, reviewerLine } = parseReview(rd(join(dir, std ? '06-review.md' : 'fdr.md')), std);
  const head = std ? rd(join(dir, 'manifest.yaml')) : frontmatter(rd(join(dir, 'fdr.md')));
  const verdict = (verdictLine.match(/(통과|재작업|조건부)/) || [])[1] || '';
  const author = ((rd(join(dir, std ? '01-spec.md' : 'fdr.md')).match(/작성[:：]\s*([^·\n]+)/) || [])[1] || '').trim();
  const signoff = ((text.match(/사인오프[^:：\n]*[:：]\s*([^\n]*)/) || [])[1] || '').trim();   // "사인오프(risk high): …" 꼴도
  const condition = ((verdictLine.match(/조건[:：]\s*([^)\n]+)/) || [])[1] || '').trim();
  return { verdict, reviewer, reviewerLine, author, signoff, condition, risk: (yamlScalar(head, 'risk') || 'low').toLowerCase(), status: yamlScalar(head, 'status') };
}

/** ⑧ 판정 뒤 제품 코드 — commits: 오래된 것부터 [{ sha, files, added }](added: 그 커밋이 새로 만든 경로) · showAt(sha, 경로) → 그 커밋의 파일 원문. 판정(판정 줄·리뷰어)이 마지막으로 바뀐 커밋이 기준. np: 제품 경로가 아닌지(nonProductOf) */
export function afterVerdict(commits, reviewPath, std, showAt, roundDir = '', np = NON_PRODUCT) {
  let key = ''; let at = -1;
  commits.forEach((c, i) => { if (!c.files.includes(reviewPath)) return; const r = parseReview(showAt(c.sha, reviewPath) || '', std); const k = r.verdictLine && r.reviewer ? `${r.verdictLine}|${r.reviewer}` : ''; if (k !== key) { key = k; at = k ? i : -1; } });
  if (at < 0) return [];
  const product = (fs) => fs.filter((f) => !np.test(f)); const p = [];
  const mixed = product(commits[at].files); if (mixed.length) p.push(`리뷰: 판정과 제품 코드를 한 커밋(${commits[at].sha.slice(0, 7)})에 섞었다: ${mixed.slice(0, 3).join(', ')} — 판정 커밋에는 리뷰 기록만`);
  const later = commits.slice(at + 1).filter((c) => product(c.files).length);
  if (later.length) p.push(`리뷰: 판정 뒤에 제품 코드가 바뀌었다(${later.slice(0, 3).map((c) => c.sha.slice(0, 7)).join(', ')}) — 판정 무효, 리뷰어(다른 세션 또는 리뷰 서브에이전트)가 다시 판정`);
  if (roundDir) {   // 리뷰 서브에이전트 재판정 — 마지막 제품 코드 커밋 뒤에 새 report 경로가 있어야 한다. 판정 줄만 다시 쓴 재판정을 막는다
    const isReport = (f) => f.startsWith(roundDir + '/') && /^report(-[a-z0-9-]+)?\.md$/i.test(f.slice(roundDir.length + 1));
    let last = -1; commits.forEach((c, i) => { if (i <= at && product(c.files).length) last = i; });
    if (last >= 0) {
      // 새 경로 = base에도, 마지막 제품 코드 커밋까지에도 없던 report. PR 안에서 그 경로를 처음 건드린 커밋이 추가(A)여야 base에 없던 것이다 — 처음이 수정·삭제면 base에 있던 옛 report
      const seen = new Set(commits.slice(0, last + 1).flatMap((c) => c.files.filter(isReport))); let fresh = false;
      for (const c of commits.slice(last + 1)) for (const f of c.files.filter(isReport)) { if (!seen.has(f) && (c.added || []).includes(f)) fresh = true; seen.add(f); }
      if (!fresh) p.push(`리뷰: 서브에이전트 판정에 마지막 제품 코드 커밋(${commits[last].sha.slice(0, 7)}) 뒤의 새 라운드 보고가 없다 — 새 brief-r<N>.md·report-r<N>.md를 남기고 다시 판정`);
    }
  }
  return p;
}

/** PR 판정 — 반환 [문제]. 제품 경로 판정은 nonProductOf(root)(코어 루트 파일 + harness.yaml work.root_files) */
export function prProblems(root, { base, head, changed, deleted = [], commits = null, showAt = null }) {
  const p = []; const np = nonProductOf(root);
  const scopeId = (head.match(/^fdr\/([A-Z]+-\d{6}-[a-z0-9-]+)$/) || [])[1];
  // 템플릿 저장소의 규칙 변경(REP, HARNESS §9 rep/<slug>) — 기록 ID가 없다. 승인은 PR 리뷰·병합. 면제 조건은 pre-commit과 같다(check-branch-record templateRep)
  if (!templateRep(root, head, changed, np)) for (const x of judge({ branch: head, base, staged: changed, scope: scopeId ? fdrScope(root, scopeId) : [], finishing: false, np })) p.push(`브랜치·scope: ${x}`);
  for (const f of changed.filter((f) => !deleted.includes(f) && isClutter(f))) p.push(`임시 파일: ${f} — .scratch/ 또는 evidence/로`);
  return [...p, ...reviewProblems(root, { head, commits, showAt, np })];
}

/** 리뷰 판정(⑦·⑧) — fdr/*·plan/* 브랜치만, 반환 [「리뷰:」 문제]. 변경 파일 목록은 쓰지 않는다(⑧은 커밋 이력으로 본다). CI(prProblems)와 work.mjs finish(ff)가 같이 쓴다 */
export function reviewProblems(root, { head, commits = null, showAt = null, np = nonProductOf(root) }) {
  const p = [];
  const m = head.match(/^(fdr|plan)\/([A-Z]+-\d{6}-[a-z0-9-]+)$/);
  if (m) {
    const id = m[2]; const dir = join(root, recordDir(id), id);
    if (!existsSync(dir)) return [`리뷰: 기록 폴더가 없다 — ${recordDir(id)}/${id}`];
    const r = reviewOf(dir);
    if (!r.verdict) p.push(`리뷰: ${id} 판정 없음 — 리뷰어(다른 세션 또는 리뷰 서브에이전트)가 ${existsSync(join(dir, '06-review.md')) ? '06-review.md §1' : 'fdr.md §5'}에 통과·재작업·조건부를 적은 뒤 병합`);
    else if (r.verdict === '재작업') p.push(`리뷰: ${id} 판정 재작업 — 고친 뒤 다시 리뷰`);
    else if (r.verdict === '조건부' && !r.condition) p.push(`리뷰: ${id} 조건부인데 조건이 없다 — "조건부(조건: …)"`);
    if (r.verdict && !r.reviewer) p.push(`리뷰: ${id} 리뷰어(모델) 칸이 비었다`);
    if (r.verdict && r.reviewer && r.author && r.reviewer === r.author) p.push(`리뷰: ${id} 리뷰어(${r.reviewer})가 작성자와 같다 — 고친 쪽은 자기 검증자가 될 수 없다`);
    const sub = Boolean(r.verdict) && SUBAGENT.test(markerPart(r.reviewerLine));
    if (sub) {   // 리뷰 서브에이전트(HARNESS §5) — low·medium만, 라운드마다 지시문·보고 원문 짝. 표지는 리뷰어 칸의 자기 신고(표지 없이 쓴 것은 못 잡는다 — catalog)
      if (r.risk === 'high') p.push(`리뷰: ${id} risk high는 리뷰 서브에이전트를 리뷰어로 인정하지 않는다 — 다른 세션 리뷰 + 사람 사인오프`);
      const ev = join(dir, 'evidence', 'review');
      const files = existsSync(ev) ? readdirSync(ev, { withFileTypes: true }).filter((e) => e.isFile() && hasText(readFileSync(join(ev, e.name), 'utf8'))).map((e) => e.name) : [];   // 빈 파일·공백·보이지 않는 문자(hasText)만인 파일·폴더는 세지 않는다
      const rounds = (k) => new Set(files.map((f) => { const m = f.match(new RegExp(`^${k}(-[a-z0-9-]+)?\\.md$`, 'i')); return m ? (m[1] || '').toLowerCase() : null; }).filter((x) => x !== null));   // brief.md ↔ report.md · brief-r2.md ↔ report-r2.md(꼬리 대소문자 무시)
      const b = rounds('brief'); const rp = rounds('report');
      if (!b.size || !rp.size) p.push(`리뷰: ${id} 리뷰어가 서브에이전트인데 evidence/review/에 지시문(brief*.md)·보고 원문(report*.md)이 없다(빈 파일·폴더는 세지 않는다)`);
      else { const odd = [...[...b].filter((x) => !rp.has(x)).map((x) => `brief${x}.md`), ...[...rp].filter((x) => !b.has(x)).map((x) => `report${x}.md`)]; if (odd.length) p.push(`리뷰: ${id} 서브에이전트 리뷰의 라운드 짝이 맞지 않는다 — ${odd.join(', ')}의 짝이 없다(라운드마다 brief-<꼬리>.md · report-<꼬리>.md)`); }
    }
    if (r.risk === 'high' && !hasText(r.signoff.replace(/[()（）]/g, ''))) p.push(`리뷰: ${id} risk high — 사람 사인오프(이름·날짜)가 없다`);
    if (r.verdict && commits && showAt) { const std = existsSync(join(dir, '06-review.md')); p.push(...afterVerdict(commits, `${recordDir(id)}/${id}/${std ? '06-review.md' : 'fdr.md'}`, std, showAt, sub ? `${recordDir(id)}/${id}/evidence/review` : '', np)); }
  }
  return p;
}

/** 판정 뒤 제품 코드(⑧)는 커밋 순서로 본다 — ranges 중 처음 되는 범위의 { commits(오래된 것부터 [{sha, files, added}] — added는 그 커밋이 새로 만든 경로), showAt }. CI(PR)와 work.mjs finish(ff)가 같이 쓴다 */
export function commitHistory(root, ranges) {
  const lg = ranges.map((r) => sh(`git -c core.quotepath=false log --reverse --no-renames --format=%x01%H --name-status "${r}"`, root)).find((x) => x.ok);
  const commits = lg ? lg.out.split('\x01').filter((s) => s.trim()).map((s) => { const [sha, ...ls] = s.trim().split('\n'); const st = ls.map((l) => l.trim().match(/^([A-Z])[0-9]*\t(.+)$/)).filter(Boolean); return { sha: sha.trim(), files: st.map((x) => x[2]), added: st.filter((x) => x[1] === 'A').map((x) => x[2]) }; }) : null;
  const showAt = (sha, path) => { const r = sh(`git show "${sha}:${path}"`, root); return r.ok ? r.out : ''; };
  return { commits, showAt };
}

/** PR 변경 경로 — 삭제와 이동 전 경로까지(--no-renames: 이동은 삭제+추가). 제품 경로 판정(⑤ 브랜치·scope · ⑧ · rep/ 면제)은 전부, 임시 파일(⑥)은 삭제를 뺀 것만. CI와 work.mjs finish(ff)가 같이 쓴다 */
export function changedFiles(root, range) {
  const all = sh(`git -c core.quotepath=false diff --name-only --no-renames "${range}"`, root); if (!all.ok) return all;
  const del = sh(`git -c core.quotepath=false diff --name-only --no-renames --diff-filter=D "${range}"`, root);
  return { ok: true, changed: all.out.split('\n').filter(Boolean), deleted: del.ok ? del.out.split('\n').filter(Boolean) : [] };
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
    const d = changedFiles(root, `origin/${b}...HEAD`); const d2 = d.ok ? d : changedFiles(root, `${b}...HEAD`);
    if (!d2.ok) step('PR 변경 파일', d2); else {
      changed = d2.changed;
      const p = prProblems(root, { base: b, head, changed, deleted: d2.deleted, ...commitHistory(root, [`origin/${b}..HEAD`, `${b}..HEAD`]) }); step(`PR 판정 (${head} → ${b} · 파일 ${changed.length})`, { ok: !p.length, out: p.join('\n') }); }
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
    w('harness.yaml', 'work:\n  base: main\n  root_files: [pyproject.toml, src/b/out.ts]\n');   // 루트 파일 확장(프로젝트) — 코어 기본 + pyproject.toml. 하위 경로(src/b/out.ts)는 버려져야 한다 — 아래 scope 밖·판정 뒤 시험이 그대로 잡는다
    const PR = (id, changed = [`src/a/x.ts`, `docs/features/${id}/fdr.md`]) => prProblems(t, { base: 'main', head: `fdr/${id}`, changed });
    lite('FDR-260101-blank'); if (!PR('FDR-260101-blank').some((x) => /판정 없음/.test(x))) fails.push('양식 그대로 = 판정 없음');
    lite('FDR-260101-ok', { verdict: '통과', reviewer: 'reviewer(b)' }); if (PR('FDR-260101-ok').length) fails.push('통과 오탐: ' + PR('FDR-260101-ok').join(' | '));
    lite('FDR-260101-rework', { verdict: '재작업', reviewer: 'reviewer(b)' }); if (!PR('FDR-260101-rework').some((x) => /재작업/.test(x))) fails.push('재작업 미차단');
    lite('FDR-260101-self', { verdict: '통과', reviewer: 'dev(a)' }); if (!PR('FDR-260101-self').some((x) => /자기 검증자/.test(x))) fails.push('자기 리뷰 미차단');
    lite('FDR-260101-high', { verdict: '통과', reviewer: 'reviewer(b)', risk: 'high' }); if (!PR('FDR-260101-high').some((x) => /사인오프/.test(x))) fails.push('high 사인오프 미차단');
    lite('FDR-260101-high2', { verdict: '통과', reviewer: 'reviewer(b)', risk: 'high', signoff: '김 · 2026-01-02' }); if (PR('FDR-260101-high2').length) fails.push('high 사인오프 오탐');
    for (const [k, so] of [['z', '​⁠'], ['n', '\u0000 \u0001'], ['h', '(ㅤ)']]) { lite(`FDR-260101-highi${k}`, { verdict: '통과', reviewer: 'reviewer(b)', risk: 'high', signoff: so }); if (!PR(`FDR-260101-highi${k}`).some((x) => /사인오프/.test(x))) fails.push(`보이지 않는 문자만인 사인오프 미차단(${[...so].map((x) => 'U+' + x.codePointAt(0).toString(16).toUpperCase()).join(' ')})`); }
    lite('FDR-260101-cond', { verdict: '조건부', reviewer: 'reviewer(b)' }); if (!PR('FDR-260101-cond').some((x) => /조건이 없다/.test(x))) fails.push('조건 없는 조건부');
    // 리뷰 서브에이전트 — 증거 짝·risk high 거부
    const NOEV = (id) => PR(id).some((x) => /서브에이전트인데/.test(x)); const SUBEV = (id, f, s = 'x') => w(`docs/features/${id}/evidence/review/${f}`, s);
    lite('FDR-260101-sub', { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); if (!NOEV('FDR-260101-sub')) fails.push('서브에이전트 증거 없음 미차단');
    SUBEV('FDR-260101-sub', 'brief.md'); if (!NOEV('FDR-260101-sub')) fails.push('서브에이전트 보고 원문 없음 미차단');
    lite('FDR-260101-subr', { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); SUBEV('FDR-260101-subr', 'report.md'); if (!NOEV('FDR-260101-subr')) fails.push('서브에이전트 지시문 없음 미차단');
    SUBEV('FDR-260101-sub', 'report.md'); if (PR('FDR-260101-sub').length) fails.push('서브에이전트 증거 짝 오탐: ' + PR('FDR-260101-sub').join(' | '));
    SUBEV('FDR-260101-sub', 'brief-r2.md'); if (!PR('FDR-260101-sub').some((x) => /라운드 짝/.test(x))) fails.push('라운드 r2 보고 없음 미차단');
    SUBEV('FDR-260101-sub', 'report-r2.md'); if (PR('FDR-260101-sub').length) fails.push('라운드 짝 오탐: ' + PR('FDR-260101-sub').join(' | '));
    lite('FDR-260101-sube', { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); SUBEV('FDR-260101-sube', 'brief.md', ''); SUBEV('FDR-260101-sube', 'report.md'); if (!NOEV('FDR-260101-sube')) fails.push('빈 파일을 증거로 셈');
    lite('FDR-260101-subd', { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); SUBEV('FDR-260101-subd', 'brief.md'); SUBEV('FDR-260101-subd', 'report.md/x.txt'); if (!NOEV('FDR-260101-subd')) fails.push('폴더를 증거로 셈');
    for (const [k, rv] of [['a', 'reviewer · 서브에이전트 (m)'], ['b', 'reviewer sub-agent (m)'], ['c', 'reviewer 서브 에이전트 (m)']]) { lite(`FDR-260101-subv${k}`, { verdict: '통과', reviewer: rv }); if (!NOEV(`FDR-260101-subv${k}`)) fails.push(`표지 변형 미탐지: ${rv}`); }
    lite('FDR-260101-subcap', { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)', risk: 'High', signoff: '김 · 2026-01-02' }); SUBEV('FDR-260101-subcap', 'brief.md'); SUBEV('FDR-260101-subcap', 'report.md'); if (!PR('FDR-260101-subcap').some((x) => /risk high는 리뷰 서브에이전트/.test(x))) fails.push('risk High(대문자) 미차단');
    lite('FDR-260101-empty', { verdict: '통과', reviewer: '' }); if (!PR('FDR-260101-empty').some((x) => /칸이 비었다/.test(x))) fails.push('리뷰어 빈칸이 다음 줄을 읽음');
    w('docs/features/FDR-260101-substd/manifest.yaml', 'id: FDR-260101-substd\nrisk: medium\nscope: [src/a/**]\n'); w('docs/features/FDR-260101-substd/01-spec.md', '- 작성: dev(a) · 2026-01-01\n');
    w('docs/features/FDR-260101-substd/06-review.md', '# r\n\n- 리뷰어(모델): reviewer 서브에이전트 (m) · 일자: 2026-01-02\n\n## 1. 판정\n\n- 통과\n');
    if (!NOEV('FDR-260101-substd')) fails.push('standard 서브에이전트 증거 없음 미차단');
    SUBEV('FDR-260101-substd', 'brief.md'); SUBEV('FDR-260101-substd', 'report.md'); if (PR('FDR-260101-substd').length) fails.push('standard 서브에이전트 짝 오탐: ' + PR('FDR-260101-substd').join(' | '));
    if (!prProblems(t, { base: 'main', head: 'rep/x', changed: ['.harness/HARNESS.md'] }).some((x) => /기록 ID 형식/.test(x))) fails.push('템플릿 아닌 저장소의 rep/ 브랜치 미차단');
    w('init.mjs', '//'); w('.harness/tiers/S/harness.yaml', 'x');
    if (prProblems(t, { base: 'main', head: 'rep/x', changed: ['.harness/HARNESS.md', 'init.mjs', '.harness/tiers/S/harness.yaml'] }).length) fails.push('템플릿 REP 브랜치 오탐');
    if (!prProblems(t, { base: 'main', head: 'rep/x', changed: ['.harness/HARNESS.md', 'src/a/x.ts'] }).some((x) => /기록 ID 형식/.test(x))) fails.push('init.mjs·tiers가 있어도 rep/ 브랜치의 제품 코드 미차단');
    if (!prProblems(t, { base: 'main', head: 'rep/Bad_Slug', changed: ['.harness/HARNESS.md'] }).some((x) => /기록 ID 형식/.test(x))) fails.push('rep/ 슬러그 형식 밖 미차단');
    // M1 — 루트 파일은 코어 기본 목록 + work.root_files만 제품 경로가 아니다(package.json·main.py는 제품)
    if (!prProblems(t, { base: 'main', head: 'rep/x', changed: ['.harness/HARNESS.md', 'package.json'] }).some((x) => /기록 ID 형식/.test(x))) fails.push('rep/ 브랜치의 루트 제품 파일 미차단');
    if (prProblems(t, { base: 'main', head: 'rep/x', changed: ['README.md', 'harness.yaml', 'pyproject.toml'] }).length) fails.push('rep/ 브랜치의 코어·확장 루트 파일 오탐');
    rmSync(join(t, '.harness', 'tiers'), { recursive: true, force: true });   // 보조 표지 하나씩 — 둘 다 있어야 면제
    if (!prProblems(t, { base: 'main', head: 'rep/x', changed: ['.harness/HARNESS.md'] }).some((x) => /기록 ID 형식/.test(x))) fails.push('init.mjs만 있는 저장소의 rep/ 브랜치 미차단');
    rmSync(join(t, 'init.mjs')); w('.harness/tiers/S/harness.yaml', 'x');
    if (!prProblems(t, { base: 'main', head: 'rep/x', changed: ['.harness/HARNESS.md'] }).some((x) => /기록 ID 형식/.test(x))) fails.push('tiers만 있는 저장소의 rep/ 브랜치 미차단');
    rmSync(join(t, '.harness', 'tiers'), { recursive: true, force: true });
    // N3 — 리뷰어 줄 메모 조각의 표지는 보지 않는다 · D5 — 영폭 문자만 든 파일은 증거가 아니다
    lite('FDR-260101-subn', { verdict: '통과', reviewer: 'codex (다른 세션) · 메모: 서브에이전트 아님' }); if (PR('FDR-260101-subn').length) fails.push('메모 속 표지 오탐: ' + PR('FDR-260101-subn').join(' | '));
    lite('FDR-260101-subz', { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); SUBEV('FDR-260101-subz', 'brief.md', '\u200B\u200C\u2060\uFEFF\n'); SUBEV('FDR-260101-subz', 'report.md'); if (!NOEV('FDR-260101-subz')) fails.push('영폭 문자만인 파일을 증거로 셈');
    for (const [k, ch] of [['h', '\u3164'], ['p', '\u2800']]) { lite(`FDR-260101-subf${k}`, { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); SUBEV(`FDR-260101-subf${k}`, 'brief.md', ch.repeat(3) + '\n'); SUBEV(`FDR-260101-subf${k}`, 'report.md'); if (!NOEV(`FDR-260101-subf${k}`)) fails.push(`채움 문자(U+${ch.codePointAt(0).toString(16).toUpperCase()})만인 파일을 증거로 셈`); }
    lite('FDR-260101-subw', { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); SUBEV('FDR-260101-subw', 'brief.md', ' \n\t\n'); SUBEV('FDR-260101-subw', 'report.md'); if (!NOEV('FDR-260101-subw')) fails.push('공백만인 파일을 증거로 셈');
    lite('FDR-260101-subu', { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); SUBEV('FDR-260101-subu', 'brief-R2.md'); SUBEV('FDR-260101-subu', 'report-r2.md'); if (PR('FDR-260101-subu').length) fails.push('꼬리 대소문자 짝 오탐: ' + PR('FDR-260101-subu').join(' | '));
    lite('FDR-260101-subhi', { verdict: '통과', reviewer: 'reviewer subagent (m)', risk: 'high', signoff: '김 · 2026-01-02' }); w('docs/features/FDR-260101-subhi/evidence/review/brief-r1.md', 'b'); w('docs/features/FDR-260101-subhi/evidence/review/report-r1.md', 'r');
    if (!PR('FDR-260101-subhi').some((x) => /risk high는 리뷰 서브에이전트/.test(x))) fails.push('high 서브에이전트 미차단');
    if (!PR('FDR-260101-ok', ['src/b/out.ts']).some((x) => /scope 밖/.test(x))) fails.push('scope 밖 미차단');
    if (!PR('FDR-260101-ok', ['main.py']).some((x) => /scope 밖/.test(x))) fails.push('scope 밖 루트 제품 파일 미차단');
    if (PR('FDR-260101-ok', ['pyproject.toml', 'AGENTS.md']).length) fails.push('work.root_files·코어 루트 파일 오탐: ' + PR('FDR-260101-ok', ['pyproject.toml', 'AGENTS.md']).join(' | '));
    // N2 — 제어(Cc)·서식(Cf)·사용 영역(Co) 문자만인 파일도 증거가 아니다
    for (const [k, s] of [['c', '\u0000\u0001\u007F\u0085'], ['f', '؀￹\u{13430}'], ['o', '\u{F0000}']]) { lite(`FDR-260101-subc${k}`, { verdict: '통과', reviewer: 'reviewer 서브에이전트 (m)' }); SUBEV(`FDR-260101-subc${k}`, 'brief.md', s + '\n'); SUBEV(`FDR-260101-subc${k}`, 'report.md'); if (!NOEV(`FDR-260101-subc${k}`)) fails.push(`${{ c: '제어', f: '서식', o: '사용 영역' }[k]} 문자만인 파일을 증거로 셈`); }
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
    const c = (sha, ...files) => ({ sha, files: files.map((x) => x.replace(/^[+]/, '')), added: files.filter((x) => x.startsWith('+')).map((x) => x.slice(1)) });   // '+경로' = 그 커밋이 새로 만든 경로(A)
    if (PRc([c('a1', 'src/a/x.ts', RP), c('v1', RP)]).length) fails.push('판정 전 코드 오탐: ' + PRc([c('a1', 'src/a/x.ts', RP), c('v1', RP)]).join(' | '));
    if (!PRc([c('v1', RP), c('a2', 'src/a/x.ts')]).some((x) => /판정 뒤/.test(x))) fails.push('판정 뒤 코드 미차단');
    if (!PRc([c('v1', RP, 'src/a/x.ts')]).some((x) => /섞었다/.test(x))) fails.push('판정·코드 한 커밋 미차단');
    if (PRc([c('v1', RP), c('a3', 'docs/features/FDR-260101-ok/evidence/r.txt')]).length) fails.push('판정 뒤 기록만 오탐');
    if (!PRc([c('v1', RP), c('a3', 'package.json')]).some((x) => /판정 뒤/.test(x))) fails.push('판정 뒤 루트 제품 파일 미차단');
    if (!PRc([c('v1', RP), c('a3', 'harness.yaml', 'src/b/out.ts')]).some((x) => /판정 뒤/.test(x))) fails.push('work.root_files에 넣은 하위 경로가 판정 뒤 검사에서 빠짐');
    if (PRc([c('v1', RP), c('a3', 'pyproject.toml', 'README.md')]).length) fails.push('판정 뒤 코어·확장 루트 파일 오탐');
    if (PRc([c('v1', RP), c('a4', RP), c('a5', 'src/a/x.ts'), c('v2', RP)]).length) fails.push('재판정 뒤 오탐');
    // #7 서브에이전트 재판정 — 마지막 제품 코드 커밋 뒤에 새 report 경로. sha 첫 글자 w = 다시 쓴 판정 줄
    const SP = 'docs/features/FDR-260101-sub/fdr.md'; const EVD = 'docs/features/FDR-260101-sub/evidence/review'; const sj = readFileSync(join(t, SP), 'utf8');
    const sShow = (sha) => (sha[0] === 'v' ? sj : sha[0] === 'w' ? sj.replace('- 판정: 통과', '- 판정: 통과 (재판정)') : sj.replace('- 판정: 통과', '- 판정: 통과 | 재작업 | 조건부'));
    const PRs = (commits) => prProblems(t, { base: 'main', head: 'fdr/FDR-260101-sub', changed: ['src/a/x.ts', SP], commits, showAt: sShow });
    const NR = (commits) => PRs(commits).some((x) => /새 라운드 보고가 없다/.test(x));
    { const first = [c('a1', 'src/a/x.ts'), c('v1', SP, `+${EVD}/brief.md`, `+${EVD}/report.md`)]; if (PRs(first).length) fails.push('서브에이전트 첫 판정 오탐: ' + PRs(first).join(' | ')); }
    if (!NR([c('a0', `+${EVD}/brief.md`, `+${EVD}/report.md`), c('v1', SP), c('a2', 'src/a/x.ts'), c('w2', SP)])) fails.push('새 라운드 없는 재판정 미차단');
    if (!NR([c('a0', `+${EVD}/brief.md`, `+${EVD}/report.md`), c('v1', SP), c('a2', 'src/a/x.ts'), c('a3', `${EVD}/report.md`), c('w2', SP)])) fails.push('옛 report를 고친 재판정 미차단');
    if (PRs([c('a0', `+${EVD}/brief.md`, `+${EVD}/report.md`), c('v1', SP), c('a2', 'src/a/x.ts'), c('a3', `+${EVD}/brief-r2.md`, `+${EVD}/report-r2.md`), c('w2', SP)]).length) fails.push('새 라운드 재판정 오탐');
    // L3 — base에 이미 있던 report(PR 안에서 처음 건드린 것이 수정)는 새 라운드가 아니다 · report가 아닌 .md(brief-r2.md)만 새로 둔 것도 새 라운드가 아니다
    if (!NR([c('v1', SP), c('a2', 'src/a/x.ts'), c('a3', `${EVD}/report-r2.md`), c('w2', SP)])) fails.push('base에 있던 report를 고친 재판정 미차단');
    if (!NR([c('a0', `+${EVD}/brief.md`, `+${EVD}/report.md`), c('v1', SP), c('a2', 'src/a/x.ts'), c('a3', `+${EVD}/brief-r2.md`), c('w2', SP)])) fails.push('brief만 새로 둔 재판정 미차단');
    if (!NR([c('v1', SP), c('a2', 'src/a/x.ts'), c('a3', `${EVD}/report-r2.md`), c('a4', `+${EVD}/report-r2.md`), c('w2', SP)])) fails.push('base의 report를 지웠다 다시 둔 재판정 미차단');
    if (PRs([c('v1', SP), c('a2', 'src/a/x.ts'), c('a3', `+${EVD}/brief-r3.md`, `+${EVD}/report-r3.md`), c('w2', SP)]).length) fails.push('base에 report가 있는 FDR의 새 라운드 오탐');
    // D4 — 삭제·이동 전 경로도 changed(제품 경로 판정), 임시 파일 검사는 삭제 제외 · 커밋 이력도 --no-renames
    const g = mkdtempSync(join(tmpdir(), 'ci-git-')); const gx = (cmd) => execSync(`git -c user.name=t -c user.email=t@t ${cmd}`, { cwd: g, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    try {
      gx('init -q -b main'); mkdirSync(join(g, 'src'), { recursive: true }); mkdirSync(join(g, 'docs'), { recursive: true });
      writeFileSync(join(g, 'src', 'a.ts'), 'a\n'); writeFileSync(join(g, 'src', 'b.ts'), 'b\nb\nb\n'); writeFileSync(join(g, 'docs', '.tmp-probe.mjs'), 'x\n'); writeFileSync(join(g, 'docs', 'x.md'), 'x\n'); writeFileSync(join(g, 'init.mjs'), '//\n'); mkdirSync(join(g, '.harness', 'tiers', 'S'), { recursive: true }); writeFileSync(join(g, '.harness', 'tiers', 'S', 'h.yaml'), 'x\n');
      gx('add -A'); gx('commit -q -m base'); gx('switch -q -c rep/x'); gx('rm -q src/a.ts docs/.tmp-probe.mjs'); gx('mv src/b.ts docs/b.md'); writeFileSync(join(g, 'docs', 'x.md'), 'x2\n'); gx('add docs/x.md'); gx('commit -q -m move');
      const cf = changedFiles(g, 'main...HEAD');
      for (const f of ['src/a.ts', 'src/b.ts', 'docs/b.md']) if (!cf.ok || !cf.changed.includes(f)) fails.push(`삭제·이동 경로 누락: ${f} (${cf.ok ? cf.changed.join(',') : cf.out})`);
      const gp = prProblems(g, { base: 'main', head: 'rep/x', changed: cf.changed || [], deleted: cf.deleted || [] });
      if (!gp.some((x) => /기록 ID 형식/.test(x))) fails.push('rep/ 브랜치의 제품 파일 삭제·이동 미차단');
      if (gp.some((x) => /임시 파일/.test(x))) fails.push('임시 파일 삭제를 임시 파일로 셈');
      const hist = commitHistory(g, ['main..HEAD']);
      if (!(hist.commits || []).some((x) => x.files.includes('src/b.ts'))) fails.push('커밋 이력에 이동 전 경로 누락');
      if (!(hist.commits || []).some((x) => x.added.includes('docs/b.md') && !x.added.includes('src/a.ts') && x.files.includes('src/a.ts') && !x.added.includes('docs/x.md') && x.files.includes('docs/x.md'))) fails.push('커밋 이력의 추가(A) 경로 판별 틀림(삭제·수정은 추가가 아니다): ' + JSON.stringify(hist.commits));
    } finally { rmSync(g, { recursive: true, force: true }); }
  } catch (e) { fails.push('예외: ' + e.message); }
  rmSync(t, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (리뷰 판정: 미기입·통과·재작업·자기 리뷰·high 사인오프 2·보이지 않는 사인오프 3·조건부 · 서브에이전트 25(짝·라운드·빈 파일·공백 파일·영폭 파일·채움 문자 2(U+3164·U+2800)·제어·서식·사용 영역 문자 3·폴더·꼬리 대소문자·표지 변형 3·메모 속 표지·High·standard 2) · 리뷰어 빈칸 · 템플릿 REP 브랜치 8(제품 코드 차단·슬러그·보조 표지 2·루트 파일 2) · standard 2 · scope 밖 3(루트 파일 2) · 임시 파일 · 기록 아닌 브랜치 · rfc 면제 · 판정 뒤 코드 8(루트 파일 2·root_files 하위 경로 1) · 서브에이전트 재판정 새 라운드 8(base의 report 3·brief만 1) · 삭제·이동 경로 git 5(추가 판별))');
  process.exit(fails.length ? 1 : 0);
}
if (IS_MAIN && !process.argv.includes('--self-test')) {
  const a = process.argv.slice(2); const opt = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
  const r = run(ROOT, { base: opt('--base') || process.env.HARNESS_CI_BASE || '', head: opt('--head') || process.env.HARNESS_CI_HEAD || '' });
  console.log(r.ok ? '\nharness CI OK' : `\nharness CI 실패 ${r.results.filter((x) => !x.ok).length}건`);
  process.exit(r.ok ? 0 : 1);
}
