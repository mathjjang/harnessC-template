#!/usr/bin/env node
// work.mjs — 기록 하나 = 브랜치 하나 = worktree 하나.
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
// 브랜치 이름은 ID에서 나온다 — 따로 선언하지 않는다. main에는 제품 코드를 직접 커밋하지 않는다(check-branch-record).
// --self-test: 임시 git 저장소에서 start→finish(rfc 기록만 반입)→promote(squash)→finish(ff)→gc 를 끝까지 돈다.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, linkSync, symlinkSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RECORD_DIRS, recordDir, recordRel } from './lib/records.mjs';
import { LOCAL_INDEXES, TRACKED_INDEXES } from './lib/generated-index.mjs';
import { reviewProblems, commitHistory } from './ci.mjs';   // ff 병합 전 리뷰 조건 — PR 모드의 CI와 같은 판정(⑦·⑧)
import { parseWork, nonProductOfYaml } from './check-branch-record.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/** harness.yaml work 절 — pre-commit·ci·lint와 같은 해석(check-branch-record parseWork). 읽지 못한 줄이 있으면 멈춘다(lint ⑲와 같은 사유) — 그 키가 조용히 기본값(dir .worktrees·merge ff 등)으로 떨어지지 않게 */
export function config(root) {
  const w = parseWork(rd(join(root, 'harness.yaml')));
  if (w.errors.length) throw new Error(`harness.yaml work 절을 읽지 못했다 — 고친 뒤 다시(lint ⑲):\n- ${w.errors.join('\n- ')}`);
  const v = (k, d) => (Object.prototype.hasOwnProperty.call(w.values, k) ? w.values[k] : d);
  return { dir: v('dir', '.worktrees'), base: v('base', 'main'), merge: v('merge', 'ff'), link: w.lists.link || [], setup: v('setup', '') };
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
  const rev = (() => { const p = lite ? (t.split(/^## 5\. Review[^\n]*$/m)[1] || '').split(/^## /m)[0] : rd(join(dir, '06-review.md')); const v = p.split('\n').find((l) => /^\s*-\s*(판정[:：]\s*)?(통과|재작업|조건부)/.test(l) && !/통과\s*\|/.test(l)); return v ? v.replace(/^\s*-\s*/, '') : '미기입 — 리뷰어(다른 세션 또는 리뷰 서브에이전트) 판정 전에는 CI가 병합을 막는다'; })();
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
export function markShipped(wt, id, root = wt) {
  if (!/^FDR-/.test(id)) return false;
  const r = record(wt, id); if (!r || !/^(draft|in-progress)$/.test(r.status)) return false;
  const f = existsSync(join(r.path, 'manifest.yaml')) ? join(r.path, 'manifest.yaml') : join(r.path, 'fdr.md');
  writeFileSync(f, rd(f).replace(/^status:\s*(draft|in-progress)\b/m, 'status: shipped').replace(/^updated:.*$/m, `updated: ${new Date().toISOString().slice(0, 10)}`));
  const rel = relative(wt, f).split(sep).join('/');
  const paths = [rel];
  // 추적하는 생성물만 같이 커밋한다 — 두 *.generated.md는 로컬 전용(lib/generated-index.mjs · 커밋하면 브랜치끼리 충돌).
  // 본 트리(root)의 build-index로 만든다 — 이행 전 브랜치에 남은 옛 스크립트는 머리 줄에 날짜를 써 main과 같은 줄에서 충돌한다
  const bi = [root, wt].map((d) => join(d, '.harness', 'scripts', 'build-index.mjs')).find(existsSync);
  if (bi) { execSync(`"${process.execPath}" "${bi}" --root "${wt}"`, { cwd: wt, stdio: 'ignore' }); for (const g2 of TRACKED_INDEXES) if (existsSync(join(wt, g2))) paths.push(g2); }
  const q = paths.map((p) => `"${p}"`).join(' ');
  git(wt, `add -- ${q}`);
  try { git(wt, `commit -q -m "${id} shipped (work.mjs finish)" -- ${q}`, { env: { HARNESS_WORK_FINISH: '1' }, quiet: true }); }
  catch (e) {   // shipped의 조건(예: 목업 대조 기록 — lint ⑯)을 못 채웠다 — 되돌리고 무엇이 막았는지 그대로
    try { git(wt, `reset -q -- ${q}`); git(wt, `checkout -- ${q}`); } catch { /* */ }
    const why = `${e.stdout || ''}${e.stderr || ''}`.split('\n').filter((l) => /위반|- |거부|낡은/.test(l)).slice(0, 6).join('\n  ');
    throw new Error(`${id}를 shipped로 올릴 수 없다 — 병합 전에 채울 것:\n  ${why || e.message}\n(목업이 있는 FDR은 worktree에서 mockup-diff.mjs run → 기록 커밋 → finish)`);
  }
  return true;
}

/** 제품 경로 판정(np) — base 쪽 harness.yaml의 work.root_files. base에서 읽지 못하면(ref·파일 없음) 코어 기본만(막는 쪽) — 작업 트리(head) 것으로 대신하지 않는다 */
export function baseNp(wt, base) {
  let by = ''; try { by = execSync(`git show "${base}:harness.yaml"`, { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* 코어 기본만 */ }
  return nonProductOfYaml(by);
}

/** ff 병합 전 리뷰 조건 — PR 모드의 CI와 같은 판정(ci.mjs reviewProblems): 통과·조건부+조건 · 리뷰어≠작성자 · risk high 사인오프 · 판정 뒤 제품 코드 변경이면 판정 무효(⑧). 제품 경로는 CI처럼 base 쪽 harness.yaml의 work.root_files로 본다(브랜치가 스스로 등재한 루트 파일은 면제되지 않는다). 우회 플래그 없음 */
export function reviewGuard(wt, id, base) {
  const h = commitHistory(wt, [`${base}..HEAD`]); if (!h.commits) throw new Error(`${id} 커밋 이력을 읽지 못했다(${base}..HEAD)`);   // 브랜치·scope는 pre-commit이 커밋마다 봤다 — 여기서는 리뷰 판정만(변경 파일 목록이 필요 없다)
  const rv = reviewProblems(wt, { head: branchOf(id), ...h, np: baseNp(wt, base) });
  if (rv.length) throw new Error(`${id} 병합 불가 — 리뷰 조건을 못 채웠다(리뷰어는 다른 세션 또는 risk low·medium의 리뷰 서브에이전트):\n- ${rv.join('\n- ')}`);
}

/** 이행 전에 연 브랜치(REP local-generated-index): 브랜치가 아직 추적하는 로컬 생성 인덱스의 작업 트리 변경(세션 카드·markShipped가 다시 만든 것)은 버린다 — 커밋할 대상이 아니다 */
function settleLocalIndexes(wt) {
  const dirty = LOCAL_INDEXES.filter((r) => git(wt, `ls-files -- "${r}"`) && git(wt, `status --porcelain -- "${r}"`));
  if (dirty.length) git(wt, `checkout -- ${dirty.map((r) => `"${r}"`).join(' ')}`, { quiet: true });
}

/** base 위로 rebase. 생성 인덱스만 충돌하면 스스로 풀고 계속한다(REP local-generated-index 전환기):
 *  - 로컬 인덱스(base가 추적 해제 — modify/delete): 지우는 쪽으로
 *  - 추적 인덱스(specs/index.md — 생성물이라 어느 쪽도 정본이 아니다): base 쪽을 택하고, rebase가 끝나면 본 트리 build-index로 다시 만들어 차이가 있으면 커밋
 *  그 커밋이 인덱스만 고쳤으면 빈 커밋이 되어 건너뛴다. 다른 파일이 충돌하거나 rebase가 시작조차 못 하면 되돌리고 멈춘다(예전과 같다) */
function rebaseOnto(root, wt, base) {
  const env = { GIT_EDITOR: 'true' };
  const stop = () => { try { git(wt, 'rebase --abort', { quiet: true }); } catch { /* */ } return new Error(`${base} 위로 rebase 충돌 — worktree ${relative(root, wt)}에서 풀고 다시 finish`); };
  const inRebase = () => ['rebase-merge', 'rebase-apply'].some((d) => existsSync(resolve(wt, git(wt, `rev-parse --git-path ${d}`))));
  const list = (cmd) => git(wt, cmd).split('\n').filter(Boolean);
  const q = (fs) => fs.map((f) => `"${f}"`).join(' ');
  try { git(wt, `rebase "${base}"`, { quiet: true }); return; } catch { if (!inRebase()) throw stop(); }   // 시작 전 거부(덮어쓸 미추적 파일 등)는 충돌이 아니다 — 넘기지 않는다
  let regen = false;
  for (let i = 0; i < 1000 && inRebase(); i++) {
    const un = list('diff --name-only --diff-filter=U');
    if (un.some((f) => !LOCAL_INDEXES.includes(f) && !TRACKED_INDEXES.includes(f))) throw stop();
    const lo = un.filter((f) => LOCAL_INDEXES.includes(f)), tr = un.filter((f) => TRACKED_INDEXES.includes(f));
    if (lo.length) {   // 작업 파일까지 지운다 — 남겨 두면 다음 커밋의 충돌에서 git이 그 자리를 비켜 "<경로>~<sha> …"로 써 worktree가 더러워진다. 로컬 인덱스는 build-index가 다시 만든다
      git(wt, `rm -q -f -- ${q(lo)}`, { quiet: true });
      for (const f of lo) { const d = join(wt, dirname(f)); if (existsSync(d)) for (const n of readdirSync(d)) if (n.startsWith(basename(f) + '~')) rmSync(join(d, n), { force: true }); }
    }
    if (tr.length) { git(wt, `checkout --ours -- ${q(tr)}`, { quiet: true }); git(wt, `add -- ${q(tr)}`, { quiet: true }); regen = true; }   // rebase 중 ours = base
    try { git(wt, 'rebase --continue', { env, quiet: true }); }
    catch { if (!list('diff --name-only --diff-filter=U').length && !list('diff --cached --name-only').length) { try { git(wt, 'rebase --skip', { env, quiet: true }); } catch { /* 다음 커밋에서 또 멈췄다 — 되풀이 */ } } }
  }
  if (inRebase()) throw stop();
  if (regen) {   // base 쪽을 택한 추적 인덱스를 브랜치 기록 기준으로 다시 만든다
    const bi = [root, wt].map((d) => join(d, '.harness', 'scripts', 'build-index.mjs')).find(existsSync);
    if (bi) execSync(`"${process.execPath}" "${bi}" --root "${wt}"`, { cwd: wt, stdio: 'ignore' });
    const changed = TRACKED_INDEXES.filter((f) => existsSync(join(wt, f)) && git(wt, `status --porcelain -- "${f}"`));
    if (changed.length) git(wt, `commit -q -m "생성 인덱스 다시 만듦 — ${base} 위 rebase 뒤 (work.mjs finish)" -- ${q(changed)}`, { env: { HARNESS_WORK_FINISH: '1' }, quiet: true });
  }
}

export function finish(root, id, { gates = true, gh = true } = {}) {
  const c = config(root);
  const r = record(root, id) || { id, type: id.split('-')[0] };
  const branch = branchOf(id);
  const wt = join(root, c.dir, id);
  if (!existsSync(wt)) throw new Error(`열린 worktree가 없다: ${relative(root, wt)}`);
  settleLocalIndexes(wt);
  if (!clean(wt)) throw new Error(`worktree에 미커밋 변경이 있다 — 커밋하거나 버린 뒤 finish`);
  if (git(root, 'branch --show-current') !== c.base) throw new Error(`본 트리가 ${c.base}가 아니다: ${git(root, 'branch --show-current')}`);
  if (!clean(root)) throw new Error(`본 트리에 미커밋 변경이 있다 — 병합 전에 정리`);
  const env = { HARNESS_WORK_FINISH: '1' };
  let merged = 'none';
  if (['FDR', 'PLAN'].includes(r.type)) {
    markShipped(wt, id, root);   // 병합되면 main에서 이 기록은 shipped — 활성 FDR로 남아 scope 겹침(lint ⑭)·카드에 걸리지 않게. ff면 곧바로, pr이면 병합될 때 main에 닿는다
    // rebase 먼저 — lint가 main의 최신 기록(다른 FDR의 shipped 등)을 보고 판정해야 한다
    settleLocalIndexes(wt);   // markShipped의 build-index가 브랜치가 아직 추적하는 로컬 인덱스를 다시 썼다 — 버려야 rebase가 시작된다
    rebaseOnto(root, wt, c.base);
    if (gates) execSync('node .harness/scripts/lint.mjs', { cwd: wt, stdio: 'inherit' });
    if (gates && c.merge !== 'pr') reviewGuard(wt, id, c.base);   // ff(S)에도 PR과 같은 하한 — 혼자여도 검사는 다른 세션(또는 risk low·medium 리뷰 서브에이전트)이 한다
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
  // 닫힘은 main 체크아웃의 기록으로만 본다. start로 연 기록은 finish(PR 병합) 전까지 브랜치에만 있다 — main에 없다고 닫힘으로 보면 활성 worktree를 지운다
  return readdirSync(d).filter((n) => existsSync(join(d, n, '.git'))).map((n) => {
    const wt = join(d, n); const r = record(root, n); const rb = r ? null : record(wt, n);
    return { id: n, status: r ? r.status : rb ? `${rb.status} (기록이 브랜치에만)` : '(기록 없음)', closed: r ? r.closed : false, unknown: !r && !rb, dirty: !clean(wt) };
  });
}
const onBranch = (root, b, id) => { try { return git(root, `ls-tree --name-only "${b}" -- "${recordRel(id)}"`, { quiet: true }).length > 0; } catch { return false; } };
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
  for (const w of list(root).map((x) => (merged.has(branchOf(x.id)) ? { ...x, closed: true, status: `${x.status} · PR 병합됨` } : x))) if (!w.closed && w.unknown) out.push({ ...w, action: 'skip(기록 없음 — 손으로 확인)' }); else if (w.closed) { if (w.dirty) out.push({ ...w, action: 'skip(dirty)' }); else { if (apply) { git(root, `worktree remove "${join(root, c.dir, w.id)}"`, { quiet: true }); if (branchExists(root, branchOf(w.id))) git(root, `branch -D "${branchOf(w.id)}"`, { quiet: true }); } out.push({ ...w, action: apply ? 'removed' : 'would-remove' }); } }
  for (const b of git(root, 'branch --list "fdr/*" "rfc/*" "ho/*" "plan/*" "mtg/*"').split('\n').map((s) => s.replace(/^\*?\s*/, '')).filter(Boolean)) {
    const id = b.split('/')[1]; const r = record(root, id);
    if (existsSync(join(root, c.dir, id))) continue;   // worktree가 있는 브랜치는 위 고리가 판정한다
    if ((r && r.closed) || merged.has(b)) { if (apply) git(root, `branch -D "${b}"`, { quiet: true }); out.push({ id, status: r ? r.status : '(기록 없음) · PR 병합됨', action: apply ? 'branch-deleted' : 'would-delete-branch' }); }
    else if (!r) out.push({ id, status: onBranch(root, b, id) ? '(기록이 브랜치에만)' : '(기록 없음)', action: 'skip(main에 기록 없음 — 손으로 확인)' });   // 지우는 쪽을 기본으로 두지 않는다 — push 안 한 커밋은 reflog에만 남는다
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  const tmp = join(HERE, '..', '.work-selftest'); rmSync(tmp, { recursive: true, force: true });
  const RFC_DIR = RECORD_DIRS.RFC, FDR_DIR = RECORD_DIRS.FDR;
  mkdirSync(join(tmp, RFC_DIR), { recursive: true }); mkdirSync(join(tmp, '.harness', 'scripts'), { recursive: true });
  for (const f of ['new-doc.mjs', 'build-index.mjs', 'lib/refs.mjs', 'lib/records.mjs', 'lib/upstream.mjs', 'lib/generated-index.mjs']) { mkdirSync(dirname(join(tmp, '.harness', 'scripts', f)), { recursive: true }); writeFileSync(join(tmp, '.harness', 'scripts', f), readFileSync(join(HERE, f))); }
  execSync(`xcopy /E /I /Q "${join(DEFAULT_ROOT, '.harness', 'templates')}" "${join(tmp, '.harness', 'templates')}" >nul 2>&1 || cp -r "${join(DEFAULT_ROOT, '.harness', 'templates')}" "${join(tmp, '.harness', 'templates')}"`, { shell: true, stdio: 'ignore' });
  writeFileSync(join(tmp, 'harness.yaml'), 'tier: S\nwork:   # 머리 줄 주석도 허용\n  dir: .worktrees\n  base: main\n  merge: ff\n  link: [.env.local]\n');
  writeFileSync(join(tmp, '.env.local'), 'SECRET=1\n'); writeFileSync(join(tmp, '.gitignore'), ['.env.local', ...LOCAL_INDEXES].join('\n') + '\n');
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
    // r3 R3-4 — config는 parseWork와 같은 해석: CRLF·절 안 빈 줄에서도 base·merge를 읽는다(옛 정규식은 main·ff로 떨어졌다)
    { const cd = join(tmp, '.scratch', 'cfg'); mkdirSync(cd, { recursive: true }); writeFileSync(join(cd, 'harness.yaml'), 'work:\r\n  dir: wt\r\n\r\n  base: dev\r\n  merge: pr\r\n  link:\r\n    - .env.local\r\n'); const c = config(cd); if (c.base !== 'dev' || c.merge !== 'pr' || c.dir !== 'wt' || c.link.join() !== '.env.local' || c.setup !== '') fails.push('config: CRLF·빈 줄·블록 목록 해석 ' + JSON.stringify(c));
      writeFileSync(join(cd, 'harness.yaml'), 'work:\n  base: main\n   merge: pr\n'); try { config(cd); fails.push('config: 읽지 못한 줄(merge)을 기본값 ff로 넘김'); } catch (e) { if (!/work 절을 읽지 못했다/.test(e.message)) fails.push('config 거부 사유: ' + e.message); }
      rmSync(cd, { recursive: true, force: true }); }
    // ff에도 리뷰 하한 — 판정 없이 gates로 finish하면 거부, 판정(리뷰어≠작성자)을 적으면 통과. lint는 임시 저장소에서 못 돌므로 리뷰 검사만 보는 경로로
    const fdrMd = join(p.path, FDR_DIR, p.fdr, 'fdr.md');
    try { reviewGuard(p.path, p.fdr, "main"); fails.push('ff: 판정 없이 통과'); } catch (e) { if (!/판정 없음/.test(e.message)) fails.push('ff 리뷰 거부 사유: ' + e.message); }
    writeFileSync(fdrMd, rd(fdrMd).replace(/^## 5\. Review[^\n]*\n/m, (m) => `${m}\n- 리뷰어(모델): reviewer(b)\n- 판정: 통과\n`)); g('add -A', p.path); g('commit -q -m review', p.path);
    try { reviewGuard(p.path, p.fdr, "main"); } catch (e) { fails.push('ff: 판정 뒤에도 거부 — ' + e.message); }
    // ⑧ 판정 뒤 제품 코드가 바뀌면 판정 무효(ff도 PR과 같은 하한) · 다시 판정하면 통과
    writeFileSync(join(p.path, 'src', 'spike.ts'), 'export const x = 2;\n'); g('add -A', p.path); g('commit -q -m "after verdict"', p.path);
    try { reviewGuard(p.path, p.fdr, "main"); fails.push('ff: 판정 뒤 코드 변경 통과'); } catch (e) { if (!/판정 뒤에 제품 코드/.test(e.message)) fails.push('ff ⑧ 거부 사유: ' + e.message); }
    writeFileSync(fdrMd, rd(fdrMd).replace('- 판정: 통과\n', '- 판정: 통과 (재판정 2026-01-02 · spike.ts 재확인)\n')); g('add -A', p.path); g('commit -q -m review2', p.path);   // 재판정은 판정 줄 자체를 다시 쓴다 — 메모만 덧붙이면 판정이 바뀐 것이 아니다
    try { reviewGuard(p.path, p.fdr, "main"); } catch (e) { fails.push('ff: 재판정 뒤에도 거부 — ' + e.message); }
    // r3 R3-5 — 브랜치가 스스로 root_files에 등재한 루트 파일도 판정 뒤에 바꾸면 무효(base 쪽 root_files로 판정 — CI와 같다) · 다시 판정하면 통과
    writeFileSync(join(p.path, 'harness.yaml'), rd(join(p.path, 'harness.yaml')).replace('  link: [.env.local]\n', '  link: [.env.local]\n  root_files: [pyproject.toml]\n')); writeFileSync(join(p.path, 'pyproject.toml'), 'x\n'); g('add -A', p.path); g('commit -q -m "self-registered root file"', p.path);
    try { reviewGuard(p.path, p.fdr, "main"); fails.push('ff: 스스로 등재한 루트 파일의 판정 뒤 변경 통과'); } catch (e) { if (!/판정 뒤에 제품 코드/.test(e.message)) fails.push('ff ⑧(스스로 등재) 거부 사유: ' + e.message); }
    writeFileSync(fdrMd, rd(fdrMd).replace(/- 판정: 통과 \(재판정[^\n]*\n/, '- 판정: 통과 (재판정 2026-01-03 · pyproject.toml 재확인)\n')); g('add -A', p.path); g('commit -q -m review3', p.path);
    try { reviewGuard(p.path, p.fdr, "main"); } catch (e) { fails.push('ff: 세 번째 판정 뒤에도 거부 — ' + e.message); }
    // r4 R4-2 — base에서 harness.yaml을 못 읽으면 코어 기본만(작업 트리가 등재한 pyproject.toml도 제품) · 읽으면 base 것
    if (baseNp(p.path, 'no-such-ref').test('pyproject.toml') || !baseNp(p.path, 'no-such-ref').test('README.md')) fails.push('baseNp: base를 못 읽을 때 작업 트리 root_files를 씀');
    if (baseNp(p.path, 'HEAD').test('pyproject.toml') !== true) fails.push('baseNp: 그 ref의 harness.yaml을 읽지 않음');
    const f2 =finish(tmp, p.fdr, { gates: false });
    if (f2.merged !== 'ff' || !existsSync(join(tmp, 'src', 'spike.ts'))) fails.push(`finish(fdr): ff 병합 (${f2.merged})`);
    if (!/^status: shipped/m.test(rd(join(tmp, FDR_DIR, p.fdr, 'fdr.md')))) fails.push('finish(fdr): 병합된 기록이 shipped가 아니다');
    if (g('status --porcelain')) fails.push('finish(fdr): 병합 뒤 작업 트리가 깨끗하지 않다 — ' + g('status --porcelain'));
    if (LOCAL_INDEXES.some((r) => g(`ls-files -- "${r}"`))) fails.push('finish(fdr): 로컬 생성 인덱스를 커밋했다');
    if (existsSync(join(tmp, '.worktrees', p.fdr))) fails.push('finish: worktree 잔존');
    const w2 = start(tmp, p.fdr); writeFileSync(join(w2.path, 'src', 'b.ts'), 'b'); g('add -A', w2.path); g('commit -q -m b', w2.path);
    writeFileSync(join(tmp, FDR_DIR, p.fdr, 'fdr.md'), rd(join(tmp, FDR_DIR, p.fdr, 'fdr.md')).replace(/^status:.*$/m, 'status: closed')); g('add -A'); g('commit -q -m close');
    const gcr = gc(tmp); if (!gcr.some((x) => x.id === p.fdr && x.action === 'would-remove')) fails.push('gc: 닫힌 기록의 worktree 미검출');
    gc(tmp, { apply: true, merged: new Set() }); if (existsSync(join(tmp, '.worktrees', p.fdr)) || g('branch --list fdr/*')) fails.push('gc --apply 미정리');
    // automation BL-261104-harness-gc-branch-only-record — 기록이 브랜치에만 있는 활성 worktree(PR 병합 전)·main에도 브랜치에도 기록이 없는 것·worktree 없는 브랜치를 gc --apply가 지우지 않는다
    { const { create: mk } = await import(pathToFileURL(join(tmp, '.harness', 'scripts', 'new-doc.mjs')).href);
      const b1 = mk(tmp, 'fdr', 'branch-only', '브랜치에만', { agent: 't', profile: 'lite' }); g('add -A'); g('commit -q -m b1');
      const wb = start(tmp, b1.id); const rel = relative(tmp, b1.path).split(sep).join('/');
      g(`rm -rq "${rel}"`); g('commit -q -m "record only on branch"');   // main에는 없고 브랜치에만(start → finish 전과 같은 상태)
      const r1 = gc(tmp, { apply: true, merged: new Set() });
      if (!existsSync(wb.path) || !g(`branch --list "fdr/${b1.id}"`) || r1.some((x) => x.id === b1.id)) fails.push('gc: 기록이 브랜치에만 있는 활성 worktree를 지움 ' + JSON.stringify(r1));
      if (!/\(기록이 브랜치에만\)/.test((list(tmp).find((x) => x.id === b1.id) || {}).status || '')) fails.push('list: 브랜치에만 있는 기록 상태 미표시');
      g(`rm -rq "${rel}"`, wb.path); g('commit -q -m "no record anywhere"', wb.path);
      const r2 = gc(tmp, { apply: true, merged: new Set() });
      if (!existsSync(wb.path) || !r2.some((x) => x.id === b1.id && /^skip\(기록 없음/.test(x.action))) fails.push('gc: 기록이 어디에도 없는 worktree를 건너뛰지 않음 ' + JSON.stringify(r2));
      g(`worktree remove "${wb.path}"`);
      const r3 = gc(tmp, { apply: true, merged: new Set() });
      if (!g(`branch --list "fdr/${b1.id}"`) || !r3.some((x) => x.id === b1.id && /^skip\(main에 기록 없음/.test(x.action))) fails.push('gc: main에 기록 없는 브랜치를 지움 ' + JSON.stringify(r3));
      gc(tmp, { apply: true, merged: new Set([`fdr/${b1.id}`]) }); if (g(`branch --list "fdr/${b1.id}"`)) fails.push('gc: 병합된 PR 브랜치(main에 기록 없음) 미정리'); }
    // REP local-generated-index 전환기 — 인덱스를 추적하던 때 연 브랜치(인덱스만 고친 커밋 + 코드와 같이 고친 커밋)를, main이 추적 해제한 뒤 finish하면 스스로 풀고 ff
    { const { create: mk } = await import(pathToFileURL(join(tmp, '.harness', 'scripts', 'new-doc.mjs')).href);
      const t1 = mk(tmp, 'fdr', 'transition', '전환기', { agent: 't', profile: 'lite' });
      for (const d of ['queue', 'specs']) mkdirSync(join(tmp, 'docs', d), { recursive: true });   // build-index는 폴더가 있을 때만 쓴다
      const bix = () => execSync(`"${process.execPath}" "${join(tmp, '.harness', 'scripts', 'build-index.mjs')}"`, { cwd: tmp, stdio: 'ignore' });
      const dated = (p, d) => writeFileSync(p, rd(p).replace('build-index.mjs · 손으로', `build-index.mjs · ${d} · 손으로`));   // 옛 build-index의 머리 줄
      const SPI = join(tmp, TRACKED_INDEXES[0]);
      bix(); dated(SPI, '2026-01-01');
      g('add -A'); g(`add -f -- ${LOCAL_INDEXES.join(' ')}`); g('commit -q -m "옛 방식: 인덱스 추적 · 날짜 머리 줄"');
      const wt1 = start(tmp, t1.id);
      mkdirSync(join(wt1.path, 'docs', 'specs', 'cap2'), { recursive: true }); writeFileSync(join(wt1.path, 'docs', 'specs', 'cap2', 'spec.md'), '# cap2\n### Requirement: y\n');   // 브랜치가 스펙을 더했다 — rebase 뒤 base 쪽을 택한 추적 인덱스는 다시 만들어야 맞다
      execSync(`"${process.execPath}" "${join(tmp, '.harness', 'scripts', 'build-index.mjs')}" --root "${wt1.path}"`, { stdio: 'ignore' });
      dated(join(wt1.path, TRACKED_INDEXES[0]), '2026-01-05'); g('add -A', wt1.path);   // 브랜치 쪽 옛 build-index가 다른 날 다시 씀
      g('commit -qam "옛 build-index가 머리 줄 날짜를 바꿈"', wt1.path);
      writeFileSync(join(wt1.path, LOCAL_INDEXES[0]), rd(join(wt1.path, LOCAL_INDEXES[0])) + '브랜치 1\n'); g('commit -qam "인덱스만"', wt1.path);
      writeFileSync(join(wt1.path, LOCAL_INDEXES[1]), rd(join(wt1.path, LOCAL_INDEXES[1])) + '브랜치 2\n'); writeFileSync(join(wt1.path, 'src', 't.ts'), 't'); g('add -A', wt1.path); g('commit -q -m "코드 + 인덱스"', wt1.path);
      writeFileSync(join(wt1.path, LOCAL_INDEXES[0]), rd(join(wt1.path, LOCAL_INDEXES[0])) + '세션 카드가 다시 씀\n');   // 미커밋 — finish가 버려야
      bix(); g(`rm -q --cached -- ${LOCAL_INDEXES.join(' ')}`); g('add -A'); g('commit -q -m "이행: 로컬 인덱스 추적 해제 · 머리 줄 날짜 제거"');
      let ft; try { ft = finish(tmp, t1.id, { gates: false }); } catch (e) { fails.push('전환기 finish 거부: ' + e.message); }
      if (ft && (ft.merged !== 'ff' || !existsSync(join(tmp, 'src', 't.ts')))) fails.push('전환기: ff 병합·코드 반입 ' + JSON.stringify(ft));
      if (LOCAL_INDEXES.some((r) => g(`ls-files -- "${r}"`))) fails.push('전환기: 병합 뒤 main이 로컬 인덱스를 다시 추적');
      if (g('status --porcelain')) fails.push('전환기: 병합 뒤 작업 트리 ' + g('status --porcelain'));
      if (!/^status: shipped/m.test(rd(join(t1.path, 'fdr.md')))) fails.push('전환기: 기록이 shipped가 아니다');
      if (/\d{4}-\d{2}-\d{2}/.test(rd(SPI).split('\n')[0])) fails.push('전환기: 병합 뒤 specs/index.md 머리 줄에 날짜');
      try { execSync(`"${process.execPath}" "${join(tmp, '.harness', 'scripts', 'build-index.mjs')}" --check`, { cwd: tmp, stdio: 'ignore' }); } catch { fails.push('전환기: 병합 뒤 추적 인덱스가 낡았다(다시 만들지 않음)'); }
      // 다른 파일 충돌은 예전처럼 멈춘다(rebase 되돌림)
      const t2 = mk(tmp, 'fdr', 'conflict', '충돌', { agent: 't', profile: 'lite' }); g('add -A'); g('commit -q -m t2');
      const wt2 = start(tmp, t2.id); writeFileSync(join(wt2.path, 'src', 't.ts'), 'branch'); g('commit -qam b', wt2.path);
      writeFileSync(join(tmp, 'src', 't.ts'), 'main'); g('commit -qam m');
      try { finish(tmp, t2.id, { gates: false }); fails.push('전환기: 코드 충돌을 넘김'); } catch (e) { if (!/rebase 충돌/.test(e.message)) fails.push('코드 충돌 거부 사유: ' + e.message); }
      if (['rebase-merge', 'rebase-apply'].some((d) => existsSync(resolve(wt2.path, g(`rev-parse --git-path ${d}`, wt2.path))))) fails.push('전환기: 멈춘 뒤 rebase가 진행 중으로 남음');
      g(`worktree remove --force "${wt2.path}"`); g(`branch -D "fdr/${t2.id}"`); }
    // PR 모드 — 원격(bare)에 push · PR 본문(기록에서) · 병합된 PR은 gc가 정리 · 보호 규칙(dry)
    const bare = join(tmp, '..', '.work-selftest-remote.git'); rmSync(bare, { recursive: true, force: true }); execSync(`git init -q --bare "${bare}"`, { stdio: 'ignore' });
    g(`remote add origin "${bare}"`); g('push -q -u origin main');
    writeFileSync(join(tmp, 'harness.yaml'), 'tier: M\nwork:   # 머리 줄 주석\n  dir: .worktrees\n  base: main\n  merge: pr\n'); g('commit -qam pr-mode');
    const { create } = await import(pathToFileURL(join(tmp, '.harness', 'scripts', 'new-doc.mjs')).href);
    const f3 = create(tmp, 'fdr', 'pr-one', 'PR 하나', { agent: 't', profile: 'lite' });
    writeFileSync(join(f3.path, 'fdr.md'), rd(join(f3.path, 'fdr.md')).replace(/^scope: \[\].*$/m, 'scope: [src/**]').replace(/^- AC-1 … \(출처 [^)]*\)$/m, '- AC-1 목록이 보인다 (출처 REQ-1)')); g('add -A'); g('commit -q -m f3');
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
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (start·링크·도구 ignore·promote squash·finish rfc 기록만·config 해석(CRLF·빈 줄·블록 목록)·ff 리뷰 하한 6(⑧ 포함·스스로 등재한 루트 파일 2)·finish fdr ff·gc · PR 모드: push·본문·병합 PR 정리·protect)');
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
