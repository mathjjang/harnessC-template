#!/usr/bin/env node
// work.mjs — 기록 하나 = 브랜치 하나 = worktree 하나 (ADR-261017-work-isolation · RFC-261017-concurrent-work).
//
//   start   <ID> [--base <ref>]            기록(docs/<자리>/<ID> — lib/records.mjs)이 있어야 한다. 브랜치 <type>/<ID> + .worktrees/<ID> 생성, 로컬 재료 링크, setup 실행
//   finish  <ID>                           worktree가 깨끗하면: rfc·ho·mtg → 기록 폴더만 main에 반입(코드는 병합 안 함) · fdr·plan → 게이트 통과 후 ff 병합(work.merge=ff) 또는 PR 안내(pr). 그 뒤 worktree·브랜치 제거
//   promote <RFC-ID> <slug> "<제목>"        RFC를 FDR로 승격: FDR 생성 → main에서 fdr 브랜치·worktree → rfc 브랜치를 squash 재기반(커밋 1개). 승격 전에 RFC를 finish해 기록을 main에 두는 것이 순서다
//   list                                   열린 worktree와 기록 상태
//   gc [--apply]                           기록이 닫혔거나 PR이 병합된(gh) worktree·브랜치 정리(깨끗한 것만)
//   protect [--reviews N] [--dry-run]      원격 기본 브랜치 보호 — 필수 검사 harness · 필수 승인(티어 기본 S0·M1·L2) · 직접/force push·삭제 금지 (gh api)
//   pr-body <ID>                           PR 본문(기록에서 생성)을 출력
// merge: pr 이면 finish가 base 위로 rebase → push → gh pr create(있으면 본문 갱신). 리뷰 판정·scope는 CI(.harness/scripts/ci.mjs)가 PR에서 다시 묻는다.
//
// 자리: harness.yaml work: { dir: .worktrees, base: main, merge: ff|pr, link: [.env.local …], setup: "pnpm install" }
// 브랜치 이름은 ID에서 나온다 — 선언이 없다(V2 COMMIT_BRANCH의 교훈). main에는 제품 코드를 직접 커밋하지 않는다(check-branch-record).
// --self-test: 임시 git 저장소에서 start→finish(rfc 기록만 반입)→promote(squash)→finish(ff)→gc 를 끝까지 돈다.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, linkSync, symlinkSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RECORD_DIRS, recordDir, recordRel } from './lib/records.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

export function config(root) {
  const hy = rd(join(root, 'harness.yaml'));
  const block = (hy.match(/^work:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '';
  const v = (k, d) => { const m = block.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : d; };
  const list = (k) => { const m = block.match(new RegExp(`^\\s*${k}:\\s*\\[([^\\]]*)\\]`, 'm')); return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []; };
  return { dir: v('dir', '.worktrees'), base: v('base', 'main'), merge: v('merge', 'ff'), link: list('link'), setup: v('setup', '') };
}
export const branchOf = (id) => `${id.split('-')[0].toLowerCase()}/${id}`;
export function record(root, id) {
  const dir = join(root, recordDir(id), id); const file = join(root, recordDir(id), `${id}.md`);
  const main = existsSync(dir) ? ['manifest.yaml', 'fdr.md', 'rfc.md', 'request.md', 'brief.md'].map((f) => join(dir, f)).find(existsSync) : existsSync(file) ? file : null;
  if (!main) return null;
  const t = rd(main);
  const status = yamlScalar(t, 'status') || (t.match(/^- 상태:\s*(\S+)/m) || [])[1] || '';
  return { id, type: id.split('-')[0], path: existsSync(dir) ? dir : file, main, status, closed: /^(closed|abandoned|concluded)$/i.test(status) };
}
const git = (root, cmd, opts = {}) => execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'pipe'], env: { ...process.env, ...(opts.env || {}) } }).trim();
const branchExists = (root, b) => git(root, `branch --list "${b}"`).length > 0;
const clean = (dir) => git(dir, 'status --porcelain --untracked-files=all') === '';

function ensureIgnored(root, dir) {
  const gi = join(root, '.gitignore');
  const t = rd(gi);
  if (t.split('\n').some((l) => l.trim() === `${dir}/` || l.trim() === `/${dir}/` || l.trim() === dir)) return;
  appendFileSync(gi, `${t.endsWith('\n') || !t ? '' : '\n'}${dir}/\n`);
  try { git(root, 'add -- .gitignore'); git(root, `commit -q -m "${dir}/ gitignore 등재 (work.mjs)" -- .gitignore`, { env: { HARNESS_WORK_FINISH: '1' }, quiet: true }); } catch { /* 커밋 불가 환경이면 작업 트리 변경으로 남긴다 */ }
}
function linkMaterials(root, wt, items) {
  for (const rel of items) {
    const src = join(root, rel); const dst = join(wt, rel);
    if (!existsSync(src) || existsSync(dst)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    if (statSync(src).isDirectory()) symlinkSync(src, dst, 'junction'); else linkSync(src, dst);
  }
}

/** 빌드 도구가 .worktrees/ 안으로 들어가지 않게 ignore 설정에 등재한다 (.gitignore를 읽지 않는 도구들 — tsc·eslint·prettier). 바꾼 파일 목록을 돌려준다 */
export function ensureToolIgnores(root, dir) {
  const changed = [];
  const ts = join(root, 'tsconfig.json');
  if (existsSync(ts)) { try { const j = JSON.parse(rd(ts)); const ex = Array.isArray(j.exclude) ? j.exclude : []; if (!ex.some((e) => e.includes(dir))) { j.exclude = [...ex, dir]; writeFileSync(ts, JSON.stringify(j, null, 2) + '\n'); changed.push('tsconfig.json'); } } catch { /* JSON 아님(주석 포함) — 손으로 */ } }
  for (const f of ['.eslintignore', '.prettierignore', '.dockerignore']) { const p = join(root, f); if (existsSync(p) && !rd(p).split('\n').some((l) => l.trim().replace(/^\//, '').replace(/\/$/, '') === dir)) { appendFileSync(p, `${rd(p).endsWith('\n') ? '' : '\n'}${dir}/\n`); changed.push(f); } }
  return changed;
}

export function start(root, id, { base } = {}) {
  const r = record(root, id);
  if (!r) throw new Error(`기록이 없다: ${recordRel(id)} — 먼저 node .harness/scripts/new-doc.mjs로 만든다`);
  if (r.closed) throw new Error(`${id}는 ${r.status} — 닫힌 기록은 열지 않는다`);
  const c = config(root);
  ensureIgnored(root, c.dir);
  const ign = ensureToolIgnores(root, c.dir);
  if (ign.length) { try { git(root, `add -- ${ign.join(' ')}`); git(root, `commit -q -m "${c.dir}/ 를 빌드 도구 ignore에 등재 (work.mjs: ${ign.join(', ')})" -- ${ign.join(' ')}`, { env: { HARNESS_WORK_FINISH: '1' }, quiet: true }); } catch { /* 작업 트리 변경으로 남긴다 */ } }
  const wt = join(root, c.dir, id);
  if (existsSync(wt)) throw new Error(`이미 열려 있다: ${relative(root, wt)}`);
  const branch = branchOf(id);
  mkdirSync(join(root, c.dir), { recursive: true });
  if (branchExists(root, branch)) git(root, `worktree add "${wt}" "${branch}"`, { quiet: true });
  else git(root, `worktree add -b "${branch}" "${wt}" "${base || c.base}"`, { quiet: true });
  linkMaterials(root, wt, c.link);
  if (c.setup) execSync(c.setup, { cwd: wt, stdio: 'inherit' });
  return { id, branch, path: wt };
}

/** PR 본문 — FDR에서 만든다(정본은 FDR · 본문은 요약과 링크). scope · AC · 시험(RUN) · 목업 대조 · 리뷰 판정 */
export function prBody(root, id) {
  const r = record(root, id); if (!r) return `${id}`;
  const dir = r.path; const lite = existsSync(join(dir, 'fdr.md')); const t = rd(r.main);
  const head = lite ? ((t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '') : rd(join(dir, 'manifest.yaml'));
  const title = (yamlScalar(head, 'title') || (t.match(/^#\s+[^·\n]*·\s*(.+)$/m) || [])[1] || '').replace(/^"|"$/g, '');
  const scope = (head.match(/^scope:\s*\[([^\]]*)\]/m) || [])[1] || '';
  const body = lite ? t : ['01-spec.md', '04-unit.md', '05-integration.md'].map((f) => rd(join(dir, f))).join('\n');
  const ac = [...body.matchAll(/^\s*-\s*(AC-\d+[^\n]*)$/gm)].map((m) => m[1]).filter((l) => !/…/.test(l));
  const rows = [...body.matchAll(/^\|\s*AC-[^\n]*\|$/gm)].map((m) => m[0]);
  const rev = (() => { const p = lite ? (t.split(/^## 5\. Review[^\n]*$/m)[1] || '').split(/^## /m)[0] : rd(join(dir, '06-review.md')); const v = p.split('\n').find((l) => /^\s*-\s*(판정[:：]\s*)?(통과|재작업|조건부)/.test(l) && !/통과\s*\|/.test(l)); return v ? v.replace(/^\s*-\s*/, '') : '미기입 — 리뷰어(다른 세션) 판정 전에는 CI가 병합을 막는다'; })();
  const mk = (() => { const d = join(dir, 'evidence', 'mockup-diff'); if (!existsSync(d)) return ''; const revs = readdirSync(d).filter((n) => /^rev\d+$/.test(n)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))); const last = revs.pop(); if (!last) return ''; try { const j = JSON.parse(rd(join(d, last, 'results.json'))); return `목업 대조 ${last}: 실행 ${j.summary.run} · 통과 ${j.summary.pass} · 초과 ${j.summary.fail} · 오류 ${j.summary.error} · 제외 ${j.summary.excluded}`; } catch { return ''; } })();
  const rel = relative(root, dir).split(sep).join('/');
  return [`## ${id}${title ? ` · ${title}` : ''}`, '', `- 기록(정본): \`${rel}/\` · 상태 ${r.status || '?'} · risk ${yamlScalar(head, 'risk') || '?'}`, `- scope: \`${scope || '(없음)'}\``, '', '### AC', ...(ac.length ? ac.map((a) => `- ${a}`) : ['- (기록에 AC 없음)']), '', '### 시험 (RUN — 원문은 기록의 evidence/)', ...(rows.length ? ['| AC | … |', '|---|---|', ...rows] : ['- (시험 표에 행 없음 — 미검증)']), ...(mk ? ['', `- ${mk}`] : []), '', '### 리뷰', `- ${rev}`, '', '_이 본문은 `work.mjs finish`가 기록에서 생성한다 — 고칠 것은 기록이다._'].join('\n');
}
/** gh로 PR을 열거나(없으면) 본문을 갱신한다(있으면). gh가 없으면 안내만 */
export function openPr(root, id, { branch, base, gh = true } = {}) {
  const wt = join(root, config(root).dir, id);
  const body = prBody(existsSync(wt) ? wt : root, id);   // 본문은 브랜치(worktree)의 기록에서 — main에는 아직 없는 시험·리뷰가 거기 있다
  const tmp = join(root, '.git', `PR_BODY_${id}.md`); writeFileSync(tmp, body);
  if (!gh) return { note: `PR 본문 생성(${relative(root, tmp)}) — gh 없이 실행`, body };
  try { execSync('gh --version', { stdio: 'ignore' }); } catch { return { note: `gh가 없다 — GitHub에서 PR을 연다: ${branch} → ${base} (본문: .git/PR_BODY_${id}.md)`, body }; }
  const r = record(root, id); const title = `${id}${r ? ` · ${((rd(r.main).match(/^#\s+[^·\n]*·\s*(.+)$/m) || [])[1] || '').trim()}` : ''}`;
  try {
    const url = execSync(`gh pr view "${branch}" --json url,state -q "select(.state==\\"OPEN\\") | .url"`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (url) { execSync(`gh pr edit "${branch}" --body-file "${tmp}"`, { cwd: root, stdio: 'ignore' }); return { note: `PR 본문 갱신 ${url}`, body, url }; }
  } catch { /* 없음 */ }
  try { const url = execSync(`gh pr create --base "${base}" --head "${branch}" --title "${title.replace(/"/g, "'")}" --body-file "${tmp}"`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop(); return { note: `PR 생성 ${url}`, body, url }; }
  catch (e) { return { note: `PR 생성 실패(${String(e.stderr || e.message).trim().split('\n').pop()}) — GitHub에서 연다: ${branch} → ${base}`, body }; }
}

/** 브랜치(worktree)의 FDR 기록을 draft|in-progress → shipped로 올리고 커밋한다(이미 shipped·closed면 그대로) */
export function markShipped(wt, id) {
  if (!/^FDR-/.test(id)) return false;
  const r = record(wt, id); if (!r || !/^(draft|in-progress)$/.test(r.status)) return false;
  const f = existsSync(join(r.path, 'manifest.yaml')) ? join(r.path, 'manifest.yaml') : join(r.path, 'fdr.md');
  writeFileSync(f, rd(f).replace(/^status:\s*(draft|in-progress)\b/m, 'status: shipped').replace(/^updated:.*$/m, `updated: ${new Date().toISOString().slice(0, 10)}`));
  const rel = relative(wt, f).split(sep).join('/');
  git(wt, `add -- "${rel}"`); git(wt, `commit -q -m "${id} shipped (work.mjs finish)" -- "${rel}"`, { env: { HARNESS_WORK_FINISH: '1' }, quiet: true });
  return true;
}

export function finish(root, id, { gates = true, gh = true } = {}) {
  const c = config(root);
  const r = record(root, id) || { id, type: id.split('-')[0] };
  const branch = branchOf(id);
  const wt = join(root, c.dir, id);
  if (!existsSync(wt)) throw new Error(`열린 worktree가 없다: ${relative(root, wt)}`);
  if (!clean(wt)) throw new Error(`worktree에 미커밋 변경이 있다 — 커밋하거나 버린 뒤 finish`);
  if (git(root, 'branch --show-current') !== c.base) throw new Error(`본 트리가 ${c.base}가 아니다: ${git(root, 'branch --show-current')}`);
  if (!clean(root)) throw new Error(`본 트리에 미커밋 변경이 있다 — 병합 전에 정리`);
  const env = { HARNESS_WORK_FINISH: '1' };
  let merged = 'none';
  if (['FDR', 'PLAN'].includes(r.type)) {
    markShipped(wt, id);   // 병합되면 main에서 이 기록은 shipped — 활성 FDR로 남아 scope 겹침(lint ⑭)·카드에 걸리지 않게. ff면 곧바로, pr이면 병합될 때 main에 닿는다
    // rebase 먼저 — lint가 main의 최신 기록(다른 FDR의 shipped 등)을 보고 판정해야 한다
    try { git(wt, `rebase "${c.base}"`, { quiet: true }); } catch { try { git(wt, 'rebase --abort', { quiet: true }); } catch { /* */ } throw new Error(`${c.base} 위로 rebase 충돌 — worktree ${relative(root, wt)}에서 풀고 다시 finish`); }
    if (gates) execSync('node .harness/scripts/lint.mjs', { cwd: wt, stdio: 'inherit' });
    if (c.merge === 'pr') {
      git(root, `push -u --force-with-lease origin "${branch}"`, { quiet: true });   // 자기 기록 브랜치만 — rebase 뒤 재push
      const pr = openPr(root, id, { branch, base: c.base, gh });
      return { id, branch, merged: 'pr', note: `${pr.note} · CI(harness)가 리뷰 판정까지 묻는다 — 리뷰어가 판정을 쓰면 커밋 후 다시 finish(PR 본문 갱신) · 병합 뒤 node .harness/scripts/work.mjs gc --apply` };
    }
    git(root, `merge --ff-only "${branch}"`, { env, quiet: true });
    merged = 'ff';
  } else {
    // rfc·ho·mtg·inc·retro: 기록 폴더만 main에. 코드(spike)는 병합하지 않는다 — 결론의 증거이지 제품이 아니다
    const relRec = existsSync(join(root, recordDir(id), id)) || git(root, `ls-tree -d "${branch}" -- "${recordRel(id)}"`) ? recordRel(id) : `${recordRel(id)}.md`;
    git(root, `checkout "${branch}" -- "${relRec}"`, { quiet: true });
    try { git(root, `commit -q -m "${id} 기록 반입 (${branch} — 코드는 병합하지 않음)" -- "${relRec}"`, { env, quiet: true }); merged = 'records-only'; } catch { merged = 'records-unchanged'; }
  }
  git(root, `worktree remove "${wt}"`, { quiet: true });
  git(root, `branch -D "${branch}"`, { quiet: true });
  return { id, branch, merged };
}

export async function promote(root, rfcId, slug, title, { agent = '(모델 미확인)' } = {}) {
  const r = record(root, rfcId);
  if (!r || r.type !== 'RFC') throw new Error(`RFC가 아니다: ${rfcId}`);
  const rfcBranch = branchOf(rfcId);
  if (!branchExists(root, rfcBranch)) throw new Error(`spike 브랜치가 없다: ${rfcBranch} (promote는 finish 전에 — 기록 반입은 finish, 코드 승격은 promote)`);
  const { create } = await import('./new-doc.mjs');
  const fdr = create(root, 'fdr', slug, title, { agent });
  for (const f of ['fdr.md', 'manifest.yaml']) { const p = join(fdr.path, f); if (existsSync(p)) writeFileSync(p, rd(p).replace(/^source_rfc:.*$/m, `source_rfc: ${rfcId}`)); }
  git(root, `add -- "${relative(root, fdr.path).replace(/\\/g, '/')}"`);
  git(root, `commit -q -m "${fdr.id} 생성 — ${rfcId} 승격" -- "${relative(root, fdr.path).replace(/\\/g, '/')}"`, { env: { HARNESS_WORK_FINISH: '1' }, quiet: true });
  const w = start(root, fdr.id);
  try { git(w.path, `merge --squash "${rfcBranch}"`, { quiet: true }); } catch { throw new Error(`squash 병합 충돌 — ${relative(root, w.path)}에서 풀고 커밋`); }
  // RFC 기록 폴더 자체는 main에 이미 있거나 finish가 반입한다 — spike 커밋에 섞여 들어온 RFC 폴더 변경은 되돌린다
  try { git(w.path, `reset -q HEAD -- "${recordRel(rfcId)}"`, { quiet: true }); git(w.path, `checkout -- "${recordRel(rfcId)}"`, { quiet: true }); } catch { /* 변경 없음 */ }
  git(w.path, `commit -q -m "${fdr.id}: ${rfcId} spike 재기반 (squash)" --allow-empty`, { env: { HARNESS_WORK_FINISH: '1' }, quiet: true });
  return { fdr: fdr.id, branch: w.branch, path: w.path, from: rfcBranch };
}

export function list(root) {
  const c = config(root); const d = join(root, c.dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((n) => existsSync(join(d, n, '.git'))).map((n) => { const r = record(root, n); return { id: n, status: r ? r.status : '(기록 없음)', closed: r ? r.closed : true, dirty: !clean(join(d, n)) }; });
}
/**
 * 원격 기본 브랜치 보호(gh api) — 직접 push 금지 · 필수 검사 harness(.github/workflows/harness.yml) · 필수 승인 N(티어 기본 S 0 · M 1 · L 2) · force-push·삭제 금지.
 * GitHub Free의 비공개 저장소는 보호 규칙을 쓸 수 없다(403) — 그때도 CI 실패 표시는 남지만 병합을 막지는 못한다고 알린다.
 */
export function protect(root, { reviews, dryRun = false } = {}) {
  const c = config(root); const tier = yamlScalar(rd(join(root, 'harness.yaml')), 'tier') || 'M';
  const n = reviews ?? ({ S: 0, M: 1, L: 2 }[tier] ?? 1);
  const rule = { required_status_checks: { strict: true, contexts: ['harness'] }, enforce_admins: false, required_pull_request_reviews: n ? { required_approving_review_count: n, dismiss_stale_reviews: true } : null, restrictions: null, allow_force_pushes: false, allow_deletions: false };
  if (dryRun) return { base: c.base, rule, applied: false };
  const f = join(root, '.git', 'BRANCH_PROTECTION.json'); writeFileSync(f, JSON.stringify(rule));
  try { execSync(`gh api -X PUT "repos/{owner}/{repo}/branches/${c.base}/protection" --input "${f}"`, { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] }); return { base: c.base, rule, applied: true }; }
  catch (e) { const msg = String(e.stderr || e.message); if (/403|Upgrade to GitHub Pro|not available/i.test(msg)) throw new Error(`보호 규칙을 쓸 수 없다(GitHub Free의 비공개 저장소) — CI(harness)는 PR에 실패를 표시하지만 병합을 막지는 못한다. 저장소를 공개하거나 Team/Pro로 올린 뒤 다시 protect`); throw new Error(`gh api 실패: ${msg.trim().split('\n').pop()}`); }
}
/** 원격에서 병합된 PR의 head 브랜치 집합 — gh가 없으면 빈 집합(기록 상태로만 판정) */
export function mergedPrBranches(root) {
  try { const out = execSync('gh pr list --state merged --limit 200 --json headRefName -q ".[].headRefName"', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean)); } catch { return new Set(); }
}
export function gc(root, { apply = false, merged = mergedPrBranches(root) } = {}) {
  const c = config(root);
  const out = [];
  for (const w of list(root).map((x) => (merged.has(branchOf(x.id)) ? { ...x, closed: true, status: `${x.status} · PR 병합됨` } : x))) if (w.closed) { if (w.dirty) out.push({ ...w, action: 'skip(dirty)' }); else { if (apply) { git(root, `worktree remove "${join(root, c.dir, w.id)}"`, { quiet: true }); if (branchExists(root, branchOf(w.id))) git(root, `branch -D "${branchOf(w.id)}"`, { quiet: true }); } out.push({ ...w, action: apply ? 'removed' : 'would-remove' }); } }
  for (const b of git(root, 'branch --list "fdr/*" "rfc/*" "ho/*" "plan/*" "mtg/*"').split('\n').map((s) => s.replace(/^\*?\s*/, '')).filter(Boolean)) {
    const id = b.split('/')[1]; const r = record(root, id);
    if ((!r || r.closed || merged.has(b)) && !existsSync(join(root, c.dir, id))) { if (apply) git(root, `branch -D "${b}"`, { quiet: true }); out.push({ id, status: r ? r.status : '(기록 없음)', action: apply ? 'branch-deleted' : 'would-delete-branch' }); }
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  const tmp = join(HERE, '..', '.work-selftest'); rmSync(tmp, { recursive: true, force: true });
  const RFC_DIR = RECORD_DIRS.RFC, FDR_DIR = RECORD_DIRS.FDR;
  mkdirSync(join(tmp, RFC_DIR), { recursive: true }); mkdirSync(join(tmp, '.harness', 'scripts'), { recursive: true });
  for (const f of ['new-doc.mjs', 'lib/refs.mjs', 'lib/records.mjs', 'lib/upstream.mjs']) { mkdirSync(dirname(join(tmp, '.harness', 'scripts', f)), { recursive: true }); writeFileSync(join(tmp, '.harness', 'scripts', f), readFileSync(join(HERE, f))); }
  execSync(`xcopy /E /I /Q "${join(DEFAULT_ROOT, '.harness', 'templates')}" "${join(tmp, '.harness', 'templates')}" >nul 2>&1 || cp -r "${join(DEFAULT_ROOT, '.harness', 'templates')}" "${join(tmp, '.harness', 'templates')}"`, { shell: true, stdio: 'ignore' });
  writeFileSync(join(tmp, 'harness.yaml'), 'tier: S\nwork:   # 머리 줄 주석도 허용\n  dir: .worktrees\n  base: main\n  merge: ff\n  link: [.env.local]\n');
  writeFileSync(join(tmp, '.env.local'), 'SECRET=1\n'); writeFileSync(join(tmp, '.gitignore'), '.env.local\n');
  writeFileSync(join(tmp, 'tsconfig.json'), '{ "compilerOptions": {}, "exclude": ["node_modules"] }\n'); writeFileSync(join(tmp, '.eslintignore'), 'dist/\n');
  mkdirSync(join(tmp, RFC_DIR, 'RFC-260101-spike'), { recursive: true }); writeFileSync(join(tmp, RFC_DIR, 'RFC-260101-spike', 'rfc.md'), '# RFC\n\n- 상태: Open\n- 작성: t\n');
  const g = (c, cwd = tmp) => execSync(`git ${c}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g('init -q -b main'); g('config user.email t@t'); g('config user.name t'); g('config core.autocrlf false'); g('add -A'); g('commit -q -m init');
  const fails = [];
  try {
    const w = start(tmp, 'RFC-260101-spike');
    if (!existsSync(join(w.path, '.git')) || w.branch !== 'rfc/RFC-260101-spike') fails.push('start: worktree/브랜치');
    if (!existsSync(join(w.path, '.env.local'))) fails.push('start: 로컬 재료 링크');
    if (!/\.worktrees\//.test(rd(join(tmp, '.gitignore')))) fails.push('start: gitignore');
    if (!JSON.parse(rd(join(tmp, 'tsconfig.json'))).exclude.includes('.worktrees') || !/\.worktrees\//.test(rd(join(tmp, '.eslintignore')))) fails.push('start: 빌드 도구 ignore 등재');
    if (!clean(tmp)) fails.push('start: ignore 등재가 커밋되지 않음');
    try { start(tmp, 'FDR-000000-none'); fails.push('없는 기록 통과'); } catch { /* 기대 */ }
    mkdirSync(join(w.path, 'src'), { recursive: true }); writeFileSync(join(w.path, 'src', 'spike.ts'), 'export const x = 1;\n');
    writeFileSync(join(w.path, RFC_DIR, 'RFC-260101-spike', 'rfc.md'), '# RFC\n\n- 상태: Concluded\n- 작성: t\n결론: 된다\n');
    g('add -A', w.path); g('commit -q -m spike', w.path);
    const p = await promote(tmp, 'RFC-260101-spike', 'feature', '기능', { agent: 't' });
    if (!existsSync(join(p.path, 'src', 'spike.ts'))) fails.push('promote: spike 코드 재기반');
    if (!/source_rfc: RFC-260101-spike/.test(rd(join(p.path, FDR_DIR, p.fdr, 'fdr.md')))) fails.push('promote: source_rfc');
    if (!existsSync(join(tmp, FDR_DIR, p.fdr))) fails.push('promote: FDR 자리(docs/features) 아님');
    if (g('log --oneline main..HEAD', p.path).split('\n').length !== 1) fails.push('promote: squash 1커밋 아님');
    const f1 = finish(tmp, 'RFC-260101-spike', { gates: false });
    if (f1.merged !== 'records-only' || existsSync(join(tmp, 'src', 'spike.ts')) || !/Concluded/.test(rd(join(tmp, RFC_DIR, 'RFC-260101-spike', 'rfc.md')))) fails.push(`finish(rfc): 기록만 반입이어야 함 (${f1.merged})`);
    if (g('branch --list rfc/RFC-260101-spike')) fails.push('finish: rfc 브랜치 잔존');
    const f2 = finish(tmp, p.fdr, { gates: false });
    if (f2.merged !== 'ff' || !existsSync(join(tmp, 'src', 'spike.ts'))) fails.push(`finish(fdr): ff 병합 (${f2.merged})`);
    if (!/^status: shipped/m.test(rd(join(tmp, FDR_DIR, p.fdr, 'fdr.md')))) fails.push('finish(fdr): 병합된 기록이 shipped가 아니다');
    if (existsSync(join(tmp, '.worktrees', p.fdr))) fails.push('finish: worktree 잔존');
    const w2 = start(tmp, p.fdr); writeFileSync(join(w2.path, 'src', 'b.ts'), 'b'); g('add -A', w2.path); g('commit -q -m b', w2.path);
    writeFileSync(join(tmp, FDR_DIR, p.fdr, 'fdr.md'), rd(join(tmp, FDR_DIR, p.fdr, 'fdr.md')).replace(/^status:.*$/m, 'status: closed')); g('add -A'); g('commit -q -m close');
    const gcr = gc(tmp); if (!gcr.some((x) => x.id === p.fdr && x.action === 'would-remove')) fails.push('gc: 닫힌 기록의 worktree 미검출');
    gc(tmp, { apply: true, merged: new Set() }); if (existsSync(join(tmp, '.worktrees', p.fdr)) || g('branch --list fdr/*')) fails.push('gc --apply 미정리');
    // PR 모드 — 원격(bare)에 push · PR 본문(기록에서) · 병합된 PR은 gc가 정리 · 보호 규칙(dry)
    const bare = join(tmp, '..', '.work-selftest-remote.git'); rmSync(bare, { recursive: true, force: true }); execSync(`git init -q --bare "${bare}"`, { stdio: 'ignore' });
    g(`remote add origin "${bare}"`); g('push -q -u origin main');
    writeFileSync(join(tmp, 'harness.yaml'), 'tier: M\nwork:   # 머리 줄 주석\n  dir: .worktrees\n  base: main\n  merge: pr\n'); g('commit -qam pr-mode');
    const { create } = await import(pathToFileURL(join(tmp, '.harness', 'scripts', 'new-doc.mjs')).href);
    const f3 = create(tmp, 'fdr', 'pr-one', 'PR 하나', { agent: 't', profile: 'lite' });
    writeFileSync(join(f3.path, 'fdr.md'), rd(join(f3.path, 'fdr.md')).replace(/^scope: \[\].*$/m, 'scope: [src/**]').replace('- AC-1 … (출처 REQ-…)', '- AC-1 목록이 보인다 (출처 REQ-1)')); g('add -A'); g('commit -q -m f3');
    const w3 = start(tmp, f3.id); writeFileSync(join(w3.path, 'src', 'c.ts'), 'c');
    const wf = join(w3.path, relative(tmp, f3.path), 'fdr.md'); writeFileSync(wf, rd(wf).replace(/(\| AC \| 계층 \| 실행 명령 \| RUN\/결과 원문 \| 판정 \|\n\|---\|---\|---\|---\|---\|\n)/, '$1| AC-1 | unit | `t` | `ok` | 통과 |\n'));   // 시험 결과는 브랜치에만
    g('add -A', w3.path); g('commit -q -m c', w3.path);
    const f4 = finish(tmp, f3.id, { gates: false, gh: false });
    if (f4.merged !== 'pr' || !execSync(`git --git-dir="${bare}" branch --list "fdr/${f3.id}"`, { encoding: 'utf8' }).trim()) fails.push(`finish(pr): 원격 push (${f4.merged})`);
    const body = rd(join(tmp, '.git', `PR_BODY_${f3.id}.md`)); if (!/AC-1 목록이 보인다/.test(body) || !/scope: `src\/\*\*`/.test(body) || !/미기입/.test(body) || !/\| AC-1 \| unit \|/.test(body)) fails.push('PR 본문(브랜치의 시험 행 포함):\n' + body);
    if (!existsSync(join(tmp, '.worktrees', f3.id))) fails.push('finish(pr): worktree는 병합 전까지 남아야');
    if (!/status: shipped/.test(execSync(`git --git-dir="${bare}" show "fdr/${f3.id}:${relative(tmp, f3.path).split(sep).join('/')}/fdr.md"`, { encoding: 'utf8' }))) fails.push('finish(pr): push된 브랜치의 기록이 shipped가 아니다');
    if (/^status: shipped/m.test(rd(join(f3.path, 'fdr.md')))) fails.push('finish(pr): 병합 전인데 main 기록이 shipped');
    if (gc(tmp, { merged: new Set() }).some((x) => x.id === f3.id)) fails.push('gc: 병합 전 PR 브랜치를 지우려 함');
    gc(tmp, { apply: true, merged: new Set([`fdr/${f3.id}`]) }); if (existsSync(join(tmp, '.worktrees', f3.id)) || g(`branch --list "fdr/${f3.id}"`)) fails.push('gc: 병합된 PR 미정리');
    const pr = protect(tmp, { dryRun: true }); if (pr.rule.required_pull_request_reviews.required_approving_review_count !== 1 || pr.rule.required_status_checks.contexts[0] !== 'harness') fails.push('protect(M) 규칙');
    rmSync(bare, { recursive: true, force: true });
  } catch (e) { fails.push('예외: ' + e.message); }
  try { for (const w of (g('worktree list --porcelain').match(/^worktree (.+)$/gm) || []).slice(1)) g(`worktree remove --force "${w.slice(9)}"`); } catch { /* */ }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (start·링크·도구 ignore·promote squash·finish rfc 기록만·finish fdr ff·gc · PR 모드: push·본문·병합 PR 정리·protect)');
  process.exit(fails.length ? 1 : 0);
}

const [cmd, a, b, c] = process.argv.slice(2);
const opt = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : undefined);
try {
  if (cmd === 'start') { const r = start(DEFAULT_ROOT, a, { base: opt('--base') }); console.log(`${r.id} → ${r.branch} @ ${relative(DEFAULT_ROOT, r.path)}  (cd 해서 작업 · 끝나면 work.mjs finish ${r.id})`); }
  else if (cmd === 'finish') { const r = finish(DEFAULT_ROOT, a); console.log(`${r.id}: ${r.merged}${r.note ? ' — ' + r.note : ''} · worktree·브랜치 ${r.merged === 'pr' ? '유지' : '제거'}`); }
  else if (cmd === 'promote') { const r = await promote(DEFAULT_ROOT, a, b, c, { agent: opt('--agent') || process.env.HARNESS_AGENT || '(모델 미확인)' }); console.log(`${r.from} → ${r.fdr} (${r.branch} @ ${relative(DEFAULT_ROOT, r.path)}) — spike 커밋 1개로 재기반. 스펙 델타·테스트를 붙여 finish`); }
  else if (cmd === 'list') { const l = list(DEFAULT_ROOT); console.log(l.length ? l.map((w) => `${w.id}  ${w.status}${w.dirty ? '  (미커밋)' : ''}${w.closed ? '  ← 닫힘: gc 대상' : ''}`).join('\n') : '열린 worktree 없음'); }
  else if (cmd === 'protect') { const n = process.argv.includes('--reviews') ? Number(opt('--reviews')) : undefined; const r = protect(DEFAULT_ROOT, { reviews: n, dryRun: process.argv.includes('--dry-run') }); console.log(`${r.applied ? '보호 적용' : '[dry-run] 보호 규칙'} ${r.base}: 필수 검사 harness · 필수 승인 ${r.rule.required_pull_request_reviews ? r.rule.required_pull_request_reviews.required_approving_review_count : 0} · 직접 push·force-push·삭제 금지`); }
  else if (cmd === 'pr-body') { console.log(prBody(DEFAULT_ROOT, a)); }
  else if (cmd === 'gc') { const r = gc(DEFAULT_ROOT, { apply: process.argv.includes('--apply') }); console.log(r.length ? r.map((x) => `${x.id}  ${x.status}  ${x.action}`).join('\n') : '정리할 것 없음'); }
  else { console.error('사용: node .harness/scripts/work.mjs start <ID> [--base <ref>] | finish <ID> | promote <RFC-ID> <slug> "<제목>" | protect [--reviews N] [--dry-run] | pr-body <ID> | list | gc [--apply]'); process.exit(2); }
} catch (e) { console.error(e.message); process.exit(1); }
