#!/usr/bin/env node
// harness-status.mjs — 세션 시작 컨텍스트 카드 (rules/HARNESS.md §1 라우터). SessionStart 훅이 부른다.
// 출력은 짧게(≤ 300 토큰). 활성 기록·큐·규칙 예산·다음 ID 형식만. 상세는 각 파일로.
// --self-test: 빈 저장소 모형에서 출력이 나오는지 확인.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReferences } from './lib/refs.mjs';

const ROOT = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();

function activeFdrs(root) {
  const dir = join(root, 'docs', 'features');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!/^FDR-/.test(e.name)) continue;
    const base = join(dir, e.name);
    const manifest = e.isDirectory() ? rd(join(base, 'manifest.yaml')) : rd(base);
    const status = yamlScalar(manifest, 'status') || '?';
    if (['closed', 'abandoned'].includes(status)) continue;
    const log = e.isDirectory() ? rd(join(base, 'session-log.md')) : '';
    const resume = (log.match(/재개점[:：]\s*(.+)/g) || []).pop() || '';
    out.push({ id: e.name.replace(/\.md$/, ''), status, stage: yamlScalar(manifest, 'current_stage'), resume: resume.replace(/재개점[:：]\s*/, '').slice(0, 60) });
  }
  return out;
}
function queueCounts(root) {
  const q = join(root, 'docs', 'queue');
  const c = {};
  if (!existsSync(q)) return c;
  for (const src of readdirSync(q, { withFileTypes: true })) {
    if (!src.isDirectory()) continue;
    const items = readdirSync(join(q, src.name)).filter((f) => f.endsWith('.md') && !f.startsWith('README'));
    let open = 0, blocking = 0;
    for (const f of items) { const t = rd(join(q, src.name, f)); if (!/^state:\s*(decided|closed|done)/m.test(t)) { open++; if (/^blocking:\s*true/m.test(t)) blocking++; } }
    c[src.name] = { open, blocking };
  }
  return c;
}
function collabLines(root, hy) {
  return parseReferences(hy).filter((r) => r.role === 'collab').map((r) => {
    const p = resolve(root, r.path);
    if (!existsSync(p)) return `협업: ${r.path} (체크아웃 없음 — 형제 폴더에 clone)`;
    const mt = join(p, 'meetings');
    const last = existsSync(mt) ? readdirSync(mt).filter((f) => /^MTG-/.test(f)).sort().pop() : undefined;
    const confirmed = last && /\[x\]\s*우리/i.test(rd(join(mt, last, 'minutes.md')));
    const open = (rd(join(p, 'questions', 'open-questions.md')).match(/\|\s*open\s*\|/g) || []).length;
    const dd = join(p, 'decisions');
    const proposed = existsSync(dd) ? readdirSync(dd).filter((f) => /^DEC-/.test(f) && /^- 상태:\s*proposed/m.test(rd(join(dd, f)))).length : 0;
    return `협업: ${r.path} · 최근 회의 ${last || '없음'}${last && !confirmed ? '(회의록 미확인)' : ''} · 미답 질문 ${open} · 미합의 DEC ${proposed}`;
  });
}
function handoffCounts(root) {
  const d = join(root, 'docs', 'handoffs');
  if (!existsSync(d)) return [];
  const c = {};
  for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && /^HO-/.test(e.name)) { const s = (rd(join(d, e.name, 'request.md')).match(/^- 상태:\s*(\S+)/m) || [])[1] || '?'; if (s !== 'closed') c[s] = (c[s] || 0) + 1; }
  return Object.entries(c);
}
function alwaysOnKb(root) {
  let bytes = 0;
  for (const f of ['rules/HARNESS.md', 'rules/product.md', 'AGENTS.md', 'CLAUDE.md']) if (existsSync(join(root, f))) bytes += statSync(join(root, f)).size;
  const rules = join(root, '.claude', 'rules');
  if (existsSync(rules)) for (const f of readdirSync(rules)) if (f.endsWith('.md')) { const t = rd(join(rules, f)); if (!/^paths:/m.test(t.split('---')[1] || '')) bytes += t.length; }
  return Math.round(bytes / 1024);
}

function card(root) {
  const hy = rd(join(root, 'harness.yaml'));
  const tier = yamlScalar(hy, 'tier') || '?';
  const packs = yamlScalar(hy, 'packs') || '[]';
  const budget = Number(yamlScalar(hy, 'always_on_kb') || 25);
  const kb = alwaysOnKb(root);
  const fdrs = activeFdrs(root);
  const q = queueCounts(root);
  const today = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const lines = [];
  lines.push(`harnessC ${yamlScalar(hy, 'harness') || '?'} · tier ${tier} · packs ${packs} · 규칙 ${kb}KB/${budget}KB${kb > budget ? ' ⚠초과' : ''}`);
  lines.push(fdrs.length ? `활성 FDR ${fdrs.length}: ` + fdrs.slice(0, 5).map((f) => `${f.id}(${f.status}${f.stage ? ' s' + f.stage : ''})${f.resume ? ' 재개점: ' + f.resume : ''}`).join(' · ') : '활성 FDR 없음');
  const qs = Object.entries(q).map(([k, v]) => `${k} ${v.open}${v.blocking ? `(차단 ${v.blocking})` : ''}`);
  const ho = handoffCounts(root);
  if (ho.length) qs.push(`핸드오프 ${ho.map(([s, n]) => `${s} ${n}`).join('/')}`);
  lines.push(qs.length ? `큐: ${qs.join(' · ')}` : '큐: 비어 있음');
  lines.push(...collabLines(root, hy));
  try { lines.push(execSync('node .harness/scripts/check-clutter.mjs --report', { cwd: root, encoding: 'utf8' }).trim()); } catch { lines.push('잡동사니: (check-clutter 없음)'); }
  lines.push(`새 ID 형식: <TYPE>-${today}-<slug> (node .harness/scripts/new-doc.mjs) · 스펙: docs/specs/index.md · 런북: docs/runbooks/`);
  return lines.join('\n');
}

if (process.argv.includes('--self-test')) {
  const out = card(ROOT);
  const n = out.split('\n').length;
  const ok = /harnessC/.test(out) && n >= 5 && n <= 7;
  console.log(ok ? `self-test OK (카드 ${n}줄)` : 'self-test FAIL\n' + out);
  process.exit(ok ? 0 : 1);
}
console.log(card(ROOT));
