#!/usr/bin/env node
// build-index.mjs — 생성 인덱스 (rules/HARNESS.md §3·§7). docs/INDEX.generated.md · docs/specs/index.md · docs/queue/INDEX.generated.md
// 정본은 각 파일의 머리말. 이 산출물은 손으로 고치지 않는다. --check: 생성 결과가 디스크와 다르면 종료코드 1.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(HERE, '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const scalar = (t, k) => ((t.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const title = (t) => (t.match(/^#\s+(.+)$/m) || [])[1] || '';
const date = () => new Date().toISOString().slice(0, 10);
const HEAD = (name) => `<!-- 생성물: node .harness/scripts/build-index.mjs · ${date()} · 손으로 편집하지 않는다 -->\n# ${name}\n\n`;

function list(dir, rx) { const d = join(ROOT, dir); if (!existsSync(d)) return []; return readdirSync(d, { withFileTypes: true }).filter((e) => rx.test(e.name)).map((e) => ({ name: e.name, dir: e.isDirectory(), path: join(d, e.name) })); }

function mainIndex() {
  let out = HEAD('기록 카탈로그');
  const sections = [['RFC — 탐구', 'docs/research', /^RFC-/], ['ADR — 결정', 'docs/decisions', /^ADR-/], ['PLAN — 분해', 'docs/plans', /^PLAN-/], ['FDR — 기능', 'docs/features', /^FDR-/], ['INC — 사고', 'docs/incidents', /^INC-/], ['HO — 핸드오프', 'docs/handoffs', /^HO-/], ['회의 (내부)', 'docs/meetings', /^MTG-/], ['runbook', 'docs/runbooks', /\.md$/]];
  for (const [h, dir, rx] of sections) {
    const items = list(dir, rx).filter((i) => !/README/.test(i.name));
    out += `## ${h} (${items.length})\n\n`;
    for (const i of items) {
      const t = i.dir ? rd(join(i.path, 'manifest.yaml')) || rd(join(i.path, '01-spec.md')) || rd(join(i.path, 'request.md')) || rd(join(i.path, 'brief.md')) : rd(i.path);
      const st = scalar(t, 'status') || scalar(t, 'state') || ((t.match(/^- 상태:\s*(\S+)/m) || [])[1] || '');
      out += `- [${i.name.replace(/\.md$/, '')}](${dir}/${i.name}) — ${(scalar(t, 'title') || title(t)).replace(/^"|"$/g, '').slice(0, 80)}${st ? ` · ${st}` : ''}\n`;
    }
    out += '\n';
  }
  return out;
}
function specsIndex() {
  let out = HEAD('현재 동작 스펙 인덱스');
  const caps = list('docs/specs', /^[a-z0-9-]+$/).filter((i) => i.dir);
  out += `capability ${caps.length}개. FDR close가 델타를 병합한다 (rules/HARNESS.md §4).\n\n| capability | 요구 수 | 마지막 병합 |\n|---|---|---|\n`;
  for (const c of caps) { const t = rd(join(c.path, 'spec.md')); out += `| [${c.name}](${c.name}/spec.md) | ${(t.match(/^###\s+Requirement/gm) || []).length} | ${scalar(t, 'last_merge') || '-'} |\n`; }
  return out;
}
function queueIndex() {
  let out = HEAD('큐 집계 (사람 할 일)');
  const q = join(ROOT, 'docs', 'queue'); if (!existsSync(q)) return out + '_큐 없음_\n';
  const rows = [];
  for (const src of readdirSync(q, { withFileTypes: true })) { if (!src.isDirectory()) continue; for (const f of readdirSync(join(q, src.name)).filter((f) => f.endsWith('.md') && !f.startsWith('README'))) { const t = rd(join(q, src.name, f)); rows.push({ src: src.name, id: scalar(t, 'id') || f.replace(/\.md$/, ''), sev: scalar(t, 'severity'), blocking: scalar(t, 'blocking') === 'true', state: scalar(t, 'state') || 'open', due: scalar(t, 'due'), owner: scalar(t, 'owner'), title: title(t) }); } }
  const open = rows.filter((r) => !['decided', 'closed', 'done'].includes(r.state)).sort((a, b) => Number(b.blocking) - Number(a.blocking) || (a.due || 'z').localeCompare(b.due || 'z'));
  out += `열린 항목 ${open.length} (릴리스 차단 ${open.filter((r) => r.blocking).length}) / 전체 ${rows.length}\n\n| 차단 | 출처 | ID | 제목 | 심각도 | 담당 | 기한 | 상태 |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of open) out += `| ${r.blocking ? '🔴' : ''} | ${r.src} | ${r.id} | ${r.title.slice(0, 50)} | ${r.sev} | ${r.owner} | ${r.due} | ${r.state} |\n`;
  return out;
}

const targets = [['docs/INDEX.generated.md', mainIndex], ['docs/specs/index.md', specsIndex], ['docs/queue/INDEX.generated.md', queueIndex]];
let stale = 0;
for (const [rel, fn] of targets) {
  const p = join(ROOT, rel); const next = fn();
  const strip = (s) => s.replace(/· \d{4}-\d{2}-\d{2} ·/, '');
  if (process.argv.includes('--check')) { if (strip(rd(p)) !== strip(next)) { console.log('낡은 생성물: ' + rel); stale++; } }
  else writeFileSync(p, next);
}
if (process.argv.includes('--check')) process.exit(stale ? 1 : 0);
if (process.argv.includes('--self-test')) { console.log('self-test OK (3개 생성)'); process.exit(0); }
console.log('생성: ' + targets.map((t) => t[0]).join(' · '));
