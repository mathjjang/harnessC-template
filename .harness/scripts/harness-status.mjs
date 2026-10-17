#!/usr/bin/env node
// harness-status.mjs — 세션 시작 컨텍스트 카드 (.harness/HARNESS.md §1 라우터). SessionStart 훅이 부른다.
// 출력은 짧게(≤ 300 토큰). 활성 기록·큐·협업·규칙 예산·다음 ID 형식만. 상세는 각 파일로.
// --self-test: 빈 저장소 모형에서 출력이 나오는지 확인.
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
  const wtDir = ((hy.match(/^work:\s*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '').match(/^\s*dir:\s*(\S+)/m)?.[1] || '.worktrees';
  const wts = existsSync(join(root, wtDir)) ? readdirSync(join(root, wtDir)).filter((n) => existsSync(join(root, wtDir, n, '.git'))) : [];
  if (wts.length) { const stale = wts.filter((n) => { const h = rd(join(root, recordDir(n), n, 'manifest.yaml')) || rd(join(root, recordDir(n), n, 'fdr.md')) || rd(join(root, recordDir(n), n, 'rfc.md')); return /^(closed|abandoned|concluded)$/i.test(yamlScalar(h, 'status') || (h.match(/^- 상태:\s*(\S+)/m) || [])[1] || ''); }); lines.push(`worktree ${wts.length}: ${wts.join(' · ')}${stale.length ? ` ⚠ 닫힌 기록 ${stale.length} → work.mjs gc --apply` : ''}`); }
  try { lines.push(execSync('node .harness/scripts/check-clutter.mjs --report', { cwd: root, encoding: 'utf8' }).trim()); } catch { lines.push('잡동사니: (check-clutter 없음)'); }
  lines.push(`새 ID <TYPE>-${today}-<slug> (node .harness/scripts/new-doc.mjs) · 기록 docs/{decisions,research,features,handoffs,records} · 스펙 docs/specs/index.md · 규칙 .harness/HARNESS.md`);
  return lines.join('\n');
}

if (process.argv.includes('--self-test')) {
  const out = card(ROOT);
  const n = out.split('\n').length;
  const ok = /harnessC/.test(out) && n >= 5 && n <= 8;
  console.log(ok ? `self-test OK (카드 ${n}줄)` : 'self-test FAIL\n' + out);
  process.exit(ok ? 0 : 1);
}
console.log(card(ROOT));
