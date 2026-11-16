#!/usr/bin/env node
// harness-status.mjs — 세션 시작 컨텍스트 카드 (.harness/HARNESS.md §1 라우터). SessionStart 훅이 부른다.
// 출력은 짧게(≤ 300 토큰). 활성 기록·큐·협업·규칙 예산·다음 ID 형식만. 상세는 각 파일로.
// 세션 시작에 base 브랜치(harness.yaml work.base · 기본 main)를 origin에서 받는다 — fast-forward만. 로컬 커밋이 있거나 갈라졌거나 로컬 변경이 겹치면 받지 않고 경고 한 줄.
//   다른 개발자가 병합한 기록 · 규칙 · 요구를 모른 채 시작하지 않게(ADR-261116-session-sync-base). 네트워크 없음 · 인증 실패 · 시간 초과(5초)는 한 줄 알리고 넘어간다. HARNESS_NO_FETCH=1이면 하지 않는다.
// --self-test: 빈 저장소 모형에서 출력이 나오는지 · base 받기(받음 · 앞섬 · 갈라짐 · 겹침 · origin 없음 · 다른 브랜치)를 확인.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReferences, refPath } from './lib/refs.mjs';
import { listRecords, recordDir } from './lib/records.mjs';

const ROOT = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const records = (root) => listRecords(root);

function activeFdrs(root) {
  const out = [];
  for (const r of records(root).filter((r) => r.name.startsWith('FDR-'))) {
    const n = r.name; const base = r.path;
    const head = rd(join(base, 'manifest.yaml')) || rd(join(base, 'fdr.md')) || rd(base);
    const status = yamlScalar(head, 'status') || '?';
    if (['closed', 'abandoned'].includes(status)) continue;
    const resume = ((rd(join(base, 'session-log.md')) || rd(join(base, 'fdr.md')).split(/^## 세션 로그[^\n]*$/m)[1] || '').match(/재개점[:：]\s*(.+)/g) || []).pop() || '';   // lite는 본문 안 표에서
    out.push({ id: n.replace(/\.md$/, ''), status, stage: yamlScalar(head, 'current_stage'), resume: resume.replace(/재개점[:：]\s*/, '').slice(0, 60) });
  }
  return out;
}
function queueLine(root) {
  const q = join(root, 'docs', 'queue');
  const parts = [];
  if (existsSync(q)) for (const k of ['PG', 'QA', 'HR', 'BL']) {
    let open = 0, blocking = 0;
    for (const f of readdirSync(q).filter((f) => f.startsWith(k + '-') && f.endsWith('.md'))) { const t = rd(join(q, f)); if (!/^state:\s*(decided|closed|done)/m.test(t)) { open++; if (/^blocking:\s*true/m.test(t)) blocking++; } }
    parts.push(`${k} ${open}${blocking ? `(차단 ${blocking})` : ''}`);
  }
  const ho = {};
  for (const r of records(root).filter((r) => r.name.startsWith('HO-'))) { const s = (rd(join(r.path, 'request.md')).match(/^- 상태:\s*(\S+)/m) || [])[1] || '?'; if (s !== 'closed') ho[s] = (ho[s] || 0) + 1; }
  if (Object.keys(ho).length) parts.push(`핸드오프 ${Object.entries(ho).map(([s, n]) => `${s} ${n}`).join('/')}`);
  return parts.length ? `큐: ${parts.join(' · ')}` : '큐: 비어 있음';
}
function collabLines(root, hy) {
  return parseReferences(hy).filter((r) => r.role === 'collab').map((r) => {
    const p = refPath(root, r);
    if (!existsSync(p)) return `협업: ${r.path} (체크아웃 없음 — clone 필요)`;
    const mt = join(p, 'meetings');
    const last = existsSync(mt) ? readdirSync(mt).filter((f) => /^MTG-/.test(f)).sort().pop() : undefined;
    const confirmed = last && /\[x\]\s*우리/i.test(rd(join(mt, last, 'minutes.md')));
    const open = (rd(join(p, 'questions', 'open-questions.md')).match(/\|\s*open\s*\|/g) || []).length;
    const dd = join(p, 'decisions');
    const proposed = existsSync(dd) ? readdirSync(dd).filter((f) => /^DEC-/.test(f) && /^- 상태:\s*proposed/m.test(rd(join(dd, f)))).length : 0;
    return `협업: ${r.path} · 최근 회의 ${last || '없음'}${last && !confirmed ? '(회의록 미확인)' : ''} · 미답 질문 ${open} · 미합의 DEC ${proposed}`;
  });
}
function mockupLines(root, hy) {
  return parseReferences(hy).filter((r) => r.role === 'mockup').map((r) => {
    const p = refPath(root, r);
    if (!existsSync(p)) return `목업: ${r.path} (체크아웃 없음 — clone 필요)`;
    const base = join(p, 'screens'); const st = { confirmed: 0, ready: 0, draft: 0, reopened: 0 };
    if (existsSync(base)) for (const m of readdirSync(base, { withFileTypes: true })) { if (!m.isDirectory() || m.name.startsWith('_')) continue; for (const s of readdirSync(join(base, m.name))) { const v = yamlScalar(rd(join(base, m.name, s, 'rev.yaml')), 'visual_status'); if (v in st) st[v]++; } }
    const qa = join(p, 'qa'); const open = existsSync(qa) ? readdirSync(qa).filter((n) => /^QA-/.test(n) && /^state:\s*(open|reopened)/m.test(rd(join(qa, n, 'report.md')))).length : 0;
    return `목업: ${r.path} · 확정 ${st.confirmed} · 확정 대기 ${st.ready} · 초안 ${st.draft}${st.reopened ? ` · 재개 ${st.reopened}` : ''}${open ? ` · QA 열림 ${open}` : ''}`;
  });
}
function alwaysOnKb(root) {
  let bytes = 0;
  for (const f of ['.harness/HARNESS.md', 'rules/product.md', 'AGENTS.md', 'CLAUDE.md']) if (existsSync(join(root, f))) bytes += statSync(join(root, f)).size;
  const rules = join(root, '.claude', 'rules');
  if (existsSync(rules)) for (const f of readdirSync(rules)) if (f.endsWith('.md')) { const t = rd(join(rules, f)); if (!/^paths:/m.test(t.split('---')[1] || '')) bytes += t.length; }
  return Math.round(bytes / 1024);
}

function card(root) {
  const hy = rd(join(root, 'harness.yaml'));
  const budget = Number(yamlScalar(hy, 'always_on_kb') || 25);
  const kb = alwaysOnKb(root);
  const fdrs = activeFdrs(root);
  const today = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const lines = [];
  lines.push(`harnessC ${yamlScalar(hy, 'harness') || '?'} · tier ${yamlScalar(hy, 'tier') || '?'} · 규칙 ${kb}KB/${budget}KB${kb > budget ? ' ⚠초과' : ''}`);
  lines.push(fdrs.length ? `활성 FDR ${fdrs.length}: ` + fdrs.slice(0, 5).map((f) => `${f.id}(${f.status}${f.stage ? ' s' + f.stage : ''})${f.resume ? ' 재개점: ' + f.resume : ''}`).join(' · ') : '활성 FDR 없음');
  lines.push(queueLine(root));
  lines.push(...collabLines(root, hy));
  lines.push(...mockupLines(root, hy));
  const wtDir = ((hy.match(/^work:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '').match(/^\s*dir:\s*(\S+)/m)?.[1] || '.worktrees';
  const wts = existsSync(join(root, wtDir)) ? readdirSync(join(root, wtDir)).filter((n) => existsSync(join(root, wtDir, n, '.git'))) : [];
  if (wts.length) { const stale = wts.filter((n) => { const h = rd(join(root, recordDir(n), n, 'manifest.yaml')) || rd(join(root, recordDir(n), n, 'fdr.md')) || rd(join(root, recordDir(n), n, 'rfc.md')); return /^(closed|abandoned|concluded)$/i.test(yamlScalar(h, 'status') || (h.match(/^- 상태:\s*(\S+)/m) || [])[1] || ''); }); lines.push(`worktree ${wts.length}: ${wts.join(' · ')}${stale.length ? ` ⚠ 닫힌 기록 ${stale.length} → work.mjs gc --apply` : ''}`); }
  try { lines.push(execSync('node .harness/scripts/check-clutter.mjs --report', { cwd: root, encoding: 'utf8' }).trim()); } catch { lines.push('잡동사니: (check-clutter 없음)'); }
  lines.push(`새 ID <TYPE>-${today}-<slug> (node .harness/scripts/new-doc.mjs) · 기록 docs/{decisions,research,features,handoffs,records} · 스펙 docs/specs/index.md · 규칙 .harness/HARNESS.md`);
  return lines.join('\n');
}

/** base를 origin에서 받는다(ff만). 카드에 넣을 한 줄 또는 ''(git 아님 · origin 없음 · 끔). 저장소 상태는 ff 말고 바꾸지 않는다 */
export function syncBase(root, { timeout = 5000 } = {}) {
  if (process.env.HARNESS_NO_FETCH === '1') return '';
  const hy = rd(join(root, 'harness.yaml'));
  const base = ((hy.match(/^work:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '').match(/^\s*base:\s*([^\s#]+)/m)?.[1] || 'main';
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };
  const g = (c, t = 3000) => execSync(`git ${c}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: t, env }).trim();
  try { g('rev-parse --is-inside-work-tree'); g('remote get-url origin'); } catch { return ''; }
  try { g(`fetch -q origin ${base}`, timeout); }
  catch (e) { return `원격: origin/${base}를 받지 못함(${e.signal === 'SIGTERM' || /ETIMEDOUT/.test(String(e.code)) ? '시간 초과' : '네트워크 · 인증'}) — 최신이 아닐 수 있다. git pull 뒤 시작`; }
  let behind = 0, ahead = 0;
  try { [behind, ahead] = g(`rev-list --left-right --count origin/${base}...${base}`).split(/\s+/).map(Number); } catch { return ''; }
  let head = ''; try { head = g('symbolic-ref -q --short HEAD'); } catch { /* detached */ }
  if (!behind && !ahead) return '';
  if (behind && ahead) return `⚠ 원격: ${base}가 origin과 갈라짐(뒤 ${behind} · 앞 ${ahead}) — 받지 않았다. 병합 · 푸시를 정리한 뒤 시작`;
  if (ahead) return `원격: ${base}가 origin보다 ${ahead} 앞 — 푸시 안 됨`;
  if (head !== base) return `⚠ 원격: ${base}가 origin보다 ${behind} 뒤 — 지금 브랜치(${head || 'detached'})라 받지 않았다. 새 작업은 최신 origin/${base}에서`;
  try { g(`merge --ff-only -q origin/${base}`, 15000); return `원격: ${base} ← origin ${behind}개 받음(ff)`; }
  catch { return `⚠ 원격: ${base}가 origin보다 ${behind} 뒤 — 받지 못함(로컬 변경이 겹침). 로컬 변경을 정리하고 git pull 뒤 시작`; }
}

/** 로컬 전용 생성 인덱스만 다시 만든다(build-index --local) — 추적 생성물(specs/index.md)은 건드리지 않는다. 실패해도 카드는 낸다 */
export function refreshLocalIndexes(root) { try { const bi = join(root, '.harness', 'scripts', 'build-index.mjs'); if (existsSync(bi)) execSync(`"${process.execPath}" "${bi}" --root "${root}" --local`, { stdio: 'ignore', timeout: 20000 }); } catch { /* */ } }

if (process.argv.includes('--self-test')) {
  const out = card(ROOT);
  const n = out.split('\n').length;
  let ok = /harnessC/.test(out) && n >= 5 && n <= 8;
  // 세션 시작이 로컬 인덱스를 만든다(--local — 추적 생성물은 그대로): 스크립트 사본을 둔 모형 저장소에서
  const { mkdirSync, rmSync, writeFileSync, copyFileSync } = await import('node:fs');
  const t = join(ROOT, '.harness', '.status-selftest'); rmSync(t, { recursive: true, force: true });
  for (const d of ['.harness/scripts/lib', 'docs/queue', 'docs/specs']) mkdirSync(join(t, d), { recursive: true });
  for (const f of ['build-index.mjs', 'lib/records.mjs', 'lib/generated-index.mjs']) copyFileSync(join(ROOT, '.harness', 'scripts', f), join(t, '.harness', 'scripts', f));
  writeFileSync(join(t, 'docs', 'specs', 'index.md'), '손댐\n'); refreshLocalIndexes(t);
  const made = existsSync(join(t, 'docs', 'INDEX.generated.md')) && existsSync(join(t, 'docs', 'queue', 'INDEX.generated.md')) && readFileSync(join(t, 'docs', 'specs', 'index.md'), 'utf8') === '손댐\n';
  rmSync(t, { recursive: true, force: true }); if (!made) ok = false;
  // base 받기 — 맨 저장소(origin) · 내 복제 · 남의 복제로
  const sfail = [];
  { const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
    const w = mkdtempSync(join(tmpdir(), 'status-sync-')); const x = (c, cwd) => execSync(`git -c user.name=t -c user.email=t@t -c init.defaultBranch=main ${c}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
    const commit = (cwd, f, s) => { writeFileSync(join(cwd, f), s); x(`add ${f}`, cwd); x(`commit -q -m ${f}`, cwd); };
    try {
      const o = join(w, 'o.git'); const me = join(w, 'me'); const you = join(w, 'you');
      x(`init -q --bare "${o}"`, w); x(`clone -q "${o}" me`, w); writeFileSync(join(me, 'harness.yaml'), 'work:\n  base: main\n'); x('add harness.yaml', me); x('commit -q -m init', me); x('push -q origin main', me); x(`clone -q "${o}" you`, w);
      const was = process.env.HARNESS_NO_FETCH; delete process.env.HARNESS_NO_FETCH;
      if (syncBase(me) !== '') sfail.push('최신인데 줄을 냈다');
      commit(you, 'a.md', 'a\n'); x('push -q origin main', you);
      writeFileSync(join(me, 'loose.txt'), '안 겹치는 미추적\n');
      const r1 = syncBase(me); if (!/1개 받음/.test(r1) || !existsSync(join(me, 'a.md')) || !existsSync(join(me, 'loose.txt'))) sfail.push('ff 받기: ' + r1);
      commit(me, 'b.md', 'b\n'); if (!/1 앞/.test(syncBase(me))) sfail.push('앞섬');
      commit(you, 'c.md', 'c\n'); x('push -q origin main', you); const head = x('rev-parse HEAD', me);
      if (!/갈라짐/.test(syncBase(me)) || x('rev-parse HEAD', me) !== head) sfail.push('갈라짐인데 바꿈');
      x('reset -q --hard origin/main~1', me); x('fetch -q origin', me); writeFileSync(join(me, 'c.md'), '내 미커밋\n');
      const r4 = syncBase(me); if (!/겹침/.test(r4) || readFileSync(join(me, 'c.md'), 'utf8') !== '내 미커밋\n') sfail.push('겹침: ' + r4);
      rmSync(join(me, 'c.md')); x('checkout -q -b fdr/x', me); if (!/지금 브랜치\(fdr\/x\)/.test(syncBase(me))) sfail.push('다른 브랜치');
      x('remote remove origin', me); if (syncBase(me) !== '') sfail.push('origin 없음');
      process.env.HARNESS_NO_FETCH = '1'; x(`remote add origin "${o}"`, me); if (syncBase(me) !== '') sfail.push('끔');
      if (was === undefined) delete process.env.HARNESS_NO_FETCH; else process.env.HARNESS_NO_FETCH = was;
    } catch (e) { sfail.push('예외: ' + e.message.split('\n')[0]); }
    rmSync(w, { recursive: true, force: true }); }
  if (sfail.length) ok = false;
  console.log(ok ? `self-test OK (카드 ${n}줄 · 로컬 인덱스 생성·추적 생성물 그대로 · base 받기 7(최신·ff·앞섬·갈라짐·겹침·다른 브랜치·origin 없음·끔))` : 'self-test FAIL\n' + out + (made ? '' : '\n로컬 인덱스 미생성 또는 추적 생성물을 고침') + (sfail.length ? '\nbase 받기: ' + sfail.join(' · ') : ''));
  process.exit(ok ? 0 : 1);
}
// base를 먼저 받는다(카드가 받은 뒤 상태를 보이게). 로컬 전용 생성 인덱스(docs/INDEX.generated.md 등 — git에 없다)를 세션마다 새로 만든다. 실패해도 카드는 낸다
const synced = syncBase(ROOT);
refreshLocalIndexes(ROOT);
console.log((synced ? synced + '\n' : '') + card(ROOT));
