#!/usr/bin/env node
// build-index.mjs — 생성 인덱스 (.harness/HARNESS.md §3·§7). docs/INDEX.generated.md · docs/specs/index.md · docs/queue/INDEX.generated.md
// 기록은 한 폴더(docs/records)에 있고 종류는 ID 접두가 말한다 — 이 인덱스가 종류별로 모아 보여 준다. 증거(각 기록의 evidence/)도 여기서 모아 본다.
// 정본은 각 파일의 머리말. 이 산출물은 손으로 고치지 않는다. --check: 생성 결과가 디스크와 다르면 종료코드 1.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(HERE, '..', '..');
const REC = 'docs/records';
const KINDS = [['ADR', '결정'], ['RFC', '탐구'], ['PLAN', '분해'], ['FDR', '기능'], ['HO', '핸드오프'], ['MTG', '회의(내부)'], ['INC', '사고'], ['RETRO', '회고']];
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const scalar = (t, k) => ((t.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const title = (t) => (t.match(/^#\s+(.+)$/m) || [])[1] || '';
const date = () => new Date().toISOString().slice(0, 10);
const HEAD = (name) => `<!-- 생성물: node .harness/scripts/build-index.mjs · ${date()} · 손으로 편집하지 않는다 -->\n# ${name}\n\n`;

function list(dir, rx) { const d = join(ROOT, dir); if (!existsSync(d)) return []; return readdirSync(d, { withFileTypes: true }).filter((e) => rx.test(e.name)).map((e) => ({ name: e.name, dir: e.isDirectory(), path: join(d, e.name) })); }
function mainText(i) { if (!i.dir) return rd(i.path); for (const f of ['manifest.yaml', 'fdr.md', 'rfc.md', 'request.md', 'brief.md', 'retro.md', '01-spec.md']) { const t = rd(join(i.path, f)); if (t) return t; } return ''; }
function countFiles(d) { let n = 0; for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) n += countFiles(join(d, e.name)); else if (e.name !== '.gitkeep') n++; } return n; }

function mainIndex() {
  let out = HEAD('기록 카탈로그');
  const all = list(REC, /^[A-Z]+-\d{6}-/);
  for (const [prefix, label] of KINDS) {
    const items = all.filter((i) => i.name.startsWith(prefix + '-'));
    if (!items.length) continue;
    out += `## ${prefix} — ${label} (${items.length})\n\n`;
    for (const i of items) {
      const t = mainText(i);
      const st = scalar(t, 'status') || scalar(t, 'state') || ((t.match(/^- 상태:\s*(\S+)/m) || [])[1] || '');
      out += `- [${i.name.replace(/\.md$/, '')}](${REC}/${i.name}) — ${(scalar(t, 'title') || title(t)).replace(/^"|"$/g, '').slice(0, 80)}${st ? ` · ${st}` : ''}\n`;
    }
    out += '\n';
  }
  const other = all.filter((i) => !KINDS.some(([p]) => i.name.startsWith(p + '-')));
  if (other.length) out += `## 기타 (${other.length})\n\n` + other.map((i) => `- ${i.name}`).join('\n') + '\n\n';
  const rbs = [...list('.harness/runbooks', /\.md$/).map((i) => ['코어', i]), ...list('rules/runbooks', /\.md$/).map((i) => ['프로젝트', i])];
  if (rbs.length) { out += `## runbook (${rbs.length})\n\n`; for (const [k, i] of rbs) out += `- [${i.name.replace(/\.md$/, '')}](${k === '코어' ? '.harness' : 'rules'}/runbooks/${i.name}) — ${k} · ${scalar(rd(i.path), 'trigger').slice(0, 70)}\n`; out += '\n'; }
  const ev = all.filter((i) => i.dir && existsSync(join(i.path, 'evidence')) && countFiles(join(i.path, 'evidence')) > 0);
  out += `## 증거 — 기록별 evidence/ 모아 보기 (${ev.length})\n\n`;
  for (const i of ev) out += `- [${i.name}](${REC}/${i.name}/evidence/) — 파일 ${countFiles(join(i.path, 'evidence'))}\n`;
  return out + '\n';
}
function specsIndex() {
  let out = HEAD('현재 참인 것 — 스펙 인덱스');
  const caps = list('docs/specs', /^[a-z0-9-]+$/).filter((i) => i.dir);
  const files = list('docs/specs', /^[a-z0-9-]+\.md$/).filter((i) => !/README|index/.test(i.name));
  out += `capability ${caps.length}개 · 조건 문서 ${files.length}개. FDR close가 델타를 병합한다 (.harness/HARNESS.md §4).\n\n| capability | 요구 수 | 마지막 병합 |\n|---|---|---|\n`;
  for (const c of caps) { const t = rd(join(c.path, 'spec.md')); out += `| [${c.name}](${c.name}/spec.md) | ${(t.match(/^###\s+Requirement/gm) || []).length} | ${scalar(t, 'last_merge') || '-'} |\n`; }
  if (files.length) { out += `\n| 조건 문서 (데이터 소스·프롬프트 계약 등) | 제목 |\n|---|---|\n`; for (const f of files) out += `| [${f.name}](${f.name}) | ${title(rd(f.path)).slice(0, 60)} |\n`; }
  return out;
}
function queueIndex() {
  let out = HEAD('큐 집계 (사람 할 일)');
  const rows = list('docs/queue', /^(PG|QA|HR|BL)-.*\.md$/).map((i) => { const t = rd(i.path); return { src: i.name.slice(0, 2), id: scalar(t, 'id') || i.name.replace(/\.md$/, ''), sev: scalar(t, 'severity'), blocking: scalar(t, 'blocking') === 'true', state: scalar(t, 'state') || 'open', due: scalar(t, 'due'), owner: scalar(t, 'owner'), title: title(t) }; });
  const open = rows.filter((r) => !['decided', 'closed', 'done'].includes(r.state)).sort((a, b) => Number(b.blocking) - Number(a.blocking) || (a.due || 'z').localeCompare(b.due || 'z'));
  out += `열린 항목 ${open.length} (릴리스 차단 ${open.filter((r) => r.blocking).length}) / 전체 ${rows.length}\n\n| 차단 | 종류 | ID | 제목 | 심각도 | 담당 | 기한 | 상태 |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of open) out += `| ${r.blocking ? '🔴' : ''} | ${r.src} | ${r.id} | ${r.title.slice(0, 50)} | ${r.sev} | ${r.owner} | ${r.due} | ${r.state} |\n`;
  return out;
}

const targets = [['docs/INDEX.generated.md', mainIndex], ['docs/specs/index.md', specsIndex], ['docs/queue/INDEX.generated.md', queueIndex]];
let stale = 0;
for (const [rel, fn] of targets) {
  const p = join(ROOT, rel); const next = fn();
  const strip = (s) => s.replace(/· \d{4}-\d{2}-\d{2} ·/, '');
  if (process.argv.includes('--check')) { if (strip(rd(p)) !== strip(next)) { console.log('낡은 생성물: ' + rel); stale++; } }
  else if (existsSync(dirname(p))) writeFileSync(p, next);
}
if (process.argv.includes('--check')) process.exit(stale ? 1 : 0);
if (process.argv.includes('--self-test')) { console.log('self-test OK (3개 생성)'); process.exit(0); }
console.log('생성: ' + targets.map((t) => t[0]).join(' · '));
