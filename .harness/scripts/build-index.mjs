#!/usr/bin/env node
// build-index.mjs — 생성 인덱스 (.harness/HARNESS.md §3·§7). docs/INDEX.generated.md · docs/specs/index.md · docs/queue/INDEX.generated.md
// 기록은 종류별 자리(lib/records.mjs — decisions·research·features·handoffs·records)에 있다 — 이 인덱스가 한 곳에 모아 보여 준다. 증거(각 기록의 evidence/)도 여기서 모아 본다.
// 정본은 각 파일의 머리말. 이 산출물은 손으로 고치지 않는다. --check: 추적하는 생성물(lib/generated-index.mjs TRACKED)이 디스크와 다르면 종료코드 1.
// 두 *.generated.md는 로컬 전용(.gitignore) — 브랜치마다 같은 줄을 고쳐 병합 충돌을 부르던 원인이라 커밋하지 않는다(REP local-generated-index). 만들기는 셋 다.
// 머리 줄에 날짜를 쓰지 않는다 — 내용이 같으면 파일도 같다.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { listRecords } from './lib/records.mjs';
import { LOCAL_INDEXES, TRACKED_INDEXES, localIndexProblems } from './lib/generated-index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(HERE, '..', '..');
const KINDS = [['ADR', '결정'], ['RFC', '탐구'], ['PLAN', '분해'], ['FDR', '기능'], ['HO', '핸드오프'], ['MTG', '회의(내부)'], ['INC', '사고'], ['RETRO', '회고']];
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const scalar = (t, k) => ((t.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();
const title = (t) => (t.match(/^#\s+(.+)$/m) || [])[1] || '';
const HEAD = (name) => `<!-- 생성물: node .harness/scripts/build-index.mjs · 손으로 편집하지 않는다 -->\n# ${name}\n\n`;

function list(dir, rx) { const d = join(ROOT, dir); if (!existsSync(d)) return []; return readdirSync(d, { withFileTypes: true }).filter((e) => rx.test(e.name)).map((e) => ({ name: e.name, dir: e.isDirectory(), path: join(d, e.name) })); }
function mainText(i) { if (!i.dir) return rd(i.path); for (const f of ['manifest.yaml', 'fdr.md', 'rfc.md', 'request.md', 'brief.md', 'retro.md', '01-spec.md']) { const t = rd(join(i.path, f)); if (t) return t; } return ''; }
function countFiles(d) { let n = 0; for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) n += countFiles(join(d, e.name)); else if (e.name !== '.gitkeep') n++; } return n; }

function mainIndex() {
  let out = HEAD('기록 카탈로그');
  const all = listRecords(ROOT).map((r) => ({ name: r.name, rel: r.dir, dir: !r.name.endsWith('.md'), path: r.path }));
  for (const [prefix, label] of KINDS) {
    const items = all.filter((i) => i.name.startsWith(prefix + '-'));
    if (!items.length) continue;
    out += `## ${prefix} — ${label} (${items.length})\n\n`;
    for (const i of items) {
      const t = mainText(i);
      const st = scalar(t, 'status') || scalar(t, 'state') || ((t.match(/^- 상태:\s*(\S+)/m) || [])[1] || '');
      out += `- [${i.name.replace(/\.md$/, '')}](${i.rel}/${i.name}) — ${(scalar(t, 'title') || title(t)).replace(/^"|"$/g, '').slice(0, 80)}${st ? ` · ${st}` : ''}\n`;
    }
    out += '\n';
  }
  const other = all.filter((i) => !KINDS.some(([p]) => i.name.startsWith(p + '-')));
  if (other.length) out += `## 기타 (${other.length})\n\n` + other.map((i) => `- ${i.name}`).join('\n') + '\n\n';
  const rbs = [...list('.harness/runbooks', /\.md$/).map((i) => ['코어', i]), ...list('rules/runbooks', /\.md$/).map((i) => ['프로젝트', i])];
  if (rbs.length) { out += `## runbook (${rbs.length})\n\n`; for (const [k, i] of rbs) out += `- [${i.name.replace(/\.md$/, '')}](${k === '코어' ? '.harness' : 'rules'}/runbooks/${i.name}) — ${k} · ${scalar(rd(i.path), 'trigger').slice(0, 70)}\n`; out += '\n'; }
  const ev = all.filter((i) => i.dir && existsSync(join(i.path, 'evidence')) && countFiles(join(i.path, 'evidence')) > 0);
  out += `## 증거 — 기록별 evidence/ 모아 보기 (${ev.length})\n\n`;
  for (const i of ev) out += `- [${i.name}](${i.rel}/${i.name}/evidence/) — 파일 ${countFiles(join(i.path, 'evidence'))}\n`;
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

const BUILDERS = { 'docs/INDEX.generated.md': mainIndex, 'docs/specs/index.md': specsIndex, 'docs/queue/INDEX.generated.md': queueIndex };
const targets = [...LOCAL_INDEXES, ...(process.argv.includes('--local') ? [] : TRACKED_INDEXES)].map((rel) => [rel, BUILDERS[rel]]);   // --local: 로컬 전용만(세션 시작 카드 — 추적 파일을 건드려 작업 트리를 더럽히지 않게)
const strip = (s) => s.replace(/^(<!--[^\n]*?) · \d{4}-\d{2}-\d{2} ·/, '$1 ·');   // 옛 머리 줄(날짜 있음)과도 같게 본다 — sync 직후 --check가 날짜만으로 실패하지 않게. 첫 줄 주석 안만

if (process.argv.includes('--self-test')) {
  // 임시 git 저장소: 셋을 만든다 · 머리에 날짜 없음 · --check는 추적 생성물만 본다 · 로컬 인덱스 추적·미등재를 잡는다(lint ⑳과 같은 함수)
  const tmp = join(HERE, '..', '.build-index-selftest'); rmSync(tmp, { recursive: true, force: true });
  for (const d of ['docs/features/FDR-260101-a', 'docs/queue', 'docs/specs/cap']) mkdirSync(join(tmp, d), { recursive: true });
  writeFileSync(join(tmp, 'docs/features/FDR-260101-a/fdr.md'), '---\nid: FDR-260101-a\nstatus: draft\n---\n# FDR-260101-a · 가\n');
  writeFileSync(join(tmp, 'docs/queue/BL-260101-b.md'), '---\nid: BL-260101-b\nstate: open\n---\n# 나\n');
  writeFileSync(join(tmp, 'docs/specs/cap/spec.md'), '# cap\n### Requirement: x\n');
  writeFileSync(join(tmp, 'docs/specs/cond.md'), '# 조건 · 2026-01-02 · 문서\n');   // 생성 본문에 " · 날짜 ·"가 든다 — 날짜 지우기가 첫 줄 밖을 건드리면 옛 머리 줄 비교가 틀린다
  const run = (a = '') => { try { execSync(`"${process.execPath}" "${join(HERE, 'build-index.mjs')}" --root "${tmp}" ${a}`, { stdio: 'ignore' }); return 0; } catch (e) { return e.status ?? 1; } };
  const g = (c) => execSync(`git ${c}`, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const fails = [];
  try {
    g('init -q -b main'); g('config user.email t@t'); g('config user.name t');
    if (run() !== 0 || ![...LOCAL_INDEXES, ...TRACKED_INDEXES].every((r) => existsSync(join(tmp, r)))) fails.push('생성 셋');
    if (/\d{4}-\d{2}-\d{2}/.test(rd(join(tmp, 'docs/INDEX.generated.md')).split('\n')[0])) fails.push('머리 줄에 날짜');
    if (run('--check') !== 0) fails.push('--check: 막 만든 직후 실패');
    writeFileSync(join(tmp, 'docs/INDEX.generated.md'), '낡음\n'); writeFileSync(join(tmp, 'docs/queue/INDEX.generated.md'), '낡음\n');
    if (run('--check') !== 0) fails.push('--check: 로컬 인덱스가 낡았다고 실패(추적 생성물만 봐야)');
    const sp = join(tmp, 'docs/specs/index.md'); const fresh = rd(sp);
    writeFileSync(sp, fresh.replace(' · 손으로', ' · 2026-01-01 · 손으로'));
    if (run('--check') !== 0) fails.push('--check: 옛 날짜 머리 줄만 다른데 실패(본문에 날짜가 든 조건 문서 제목이 있다)');
    writeFileSync(sp, fresh.replace('2026-01-02', '2026-01-03'));
    if (run('--check') !== 1) fails.push('--check: 본문 날짜가 달라졌는데 통과(첫 줄 밖을 지웠다)');
    writeFileSync(sp, fresh + '손댐\n');
    if (run('--check') !== 1) fails.push('--check: 추적 생성물(specs/index.md)이 낡았는데 통과');
    rmSync(join(tmp, 'docs/INDEX.generated.md')); writeFileSync(sp, '손댐\n');
    if (run('--local') !== 0 || !existsSync(join(tmp, 'docs/INDEX.generated.md')) || rd(sp) !== '손댐\n') fails.push('--local: 로컬만 만들고 추적 생성물은 그대로여야');
    run();
    g('add -A');   // .gitignore 없음 → 로컬 인덱스가 추적된다
    const p1 = localIndexProblems(tmp);
    if (!LOCAL_INDEXES.every((r) => p1.some((x) => x.includes(r) && x.includes('추적')) && p1.some((x) => x.includes(r) && x.includes('.gitignore에 없다')))) fails.push('추적·미등재 미검출: ' + JSON.stringify(p1));
    writeFileSync(join(tmp, '.gitignore'), LOCAL_INDEXES.join('\n') + '\n');
    const p2 = localIndexProblems(tmp);
    if (!p2.length || p2.some((x) => x.includes('.gitignore에 없다'))) fails.push('등재 뒤에도 추적은 잡아야/미등재는 아님: ' + JSON.stringify(p2));
    g(`rm -q --cached -- ${LOCAL_INDEXES.join(' ')}`); g('add -A');
    const p3 = localIndexProblems(tmp);
    if (p3.length) fails.push('옮긴 뒤 오탐: ' + JSON.stringify(p3));
    if (!LOCAL_INDEXES.every((r) => existsSync(join(tmp, r)))) fails.push('rm --cached가 파일을 지움');
  } catch (e) { fails.push('예외: ' + e.message); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL\n- ' + fails.join('\n- ') : `self-test OK (생성 3 · 날짜 없음 · --check 추적 ${TRACKED_INDEXES.length}개만·첫 줄 날짜만 무시 · --local · 로컬 ${LOCAL_INDEXES.length}개 추적·미등재 검출)`);
  process.exit(fails.length ? 1 : 0);
}

let stale = 0;
for (const [rel, fn] of targets) {
  const p = join(ROOT, rel); const next = fn();
  if (process.argv.includes('--check')) { if (TRACKED_INDEXES.includes(rel) && strip(rd(p)) !== strip(next)) { console.log('낡은 생성물: ' + rel); stale++; } }
  else if (existsSync(dirname(p))) writeFileSync(p, next);
}
if (process.argv.includes('--check')) process.exit(stale ? 1 : 0);
console.log('생성: ' + targets.map((t) => t[0]).join(' · ') + ` (커밋: ${TRACKED_INDEXES.join(' · ')} — 나머지는 로컬 전용)`);
