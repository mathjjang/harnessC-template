#!/usr/bin/env node
// harness-build.mjs — 런타임별 입구 생성 (.harness/HARNESS.md 원칙 10 "규칙 정본 하나, 하네스별 파일은 생성물" · ADR-261017-entry-generation).
// 정본은 런북(.harness/runbooks/*.md 코어 · rules/runbooks/*.md 프로젝트)이다. 머리말에 `entry: <이름>`이 있는 런북마다 세 런타임의 입구를 만든다:
//   .claude/skills/<이름>/SKILL.md   Claude Code 스킬      ·  .agents/skills/<이름>/SKILL.md   Codex 등 Agent Skills 표준  ·  .gemini/commands/<이름>.toml   Gemini CLI 커맨드
// 입구는 포인터다 — 절차 본문을 복사하지 않고 "런북을 읽고 따르라"만 담는다(한 정본·이중 기재 없음). 런북이 사라지면 그 입구도 지운다(생성물 표식이 있는 것만).
// 사용: node .harness/scripts/harness-build.mjs [--check]   --check: 디스크의 입구가 생성 결과와 다르면 종료코드 1 (pre-commit)
// --self-test: 임시 루트에서 생성·갱신·고아 제거·check를 확인.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReferences } from './lib/refs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 런북 자리: 코어 · 프로젝트 · 개발 저장소 안에 둔 목업 저장소(references role: mockup, embedded: true)의 runbooks/ */
const runbookDirs = (root) => ['.harness/runbooks', 'rules/runbooks', ...parseReferences(rd(join(root, 'harness.yaml'))).filter((r) => r.role === 'mockup' && String(r.embedded) === 'true').map((r) => `${r.path.replace(/\/$/, '')}/runbooks`)];
const MARK = '생성물: node .harness/scripts/harness-build.mjs';
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const fm = (t) => { const b = (t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || ''; const o = {}; for (const m of b.matchAll(/^([a-z_]+):\s*(.*)$/gm)) o[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1'); return o; };
const title = (t) => (t.match(/^#\s+(.+)$/m) || [])[1] || '';
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** entry가 있는 런북 목록 [{ name, file, summary, args, title }] */
export function entries(root) {
  const out = [];
  for (const dir of runbookDirs(root)) {
    const d = join(root, dir); if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((n) => n.endsWith('.md')).sort()) {
      const t = rd(join(d, f)); const h = fm(t);
      if (!h.entry) continue;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(h.entry)) throw new Error(`${dir}/${f}: entry는 영문 소문자·숫자·하이픈 (${h.entry})`);
      if (out.some((e) => e.name === h.entry)) throw new Error(`entry 중복: ${h.entry} (${dir}/${f})`);
      out.push({ name: h.entry, file: `${dir}/${f}`, summary: h.summary || h.trigger || '', args: h.args || '', title: title(t) || h.entry });
    }
  }
  return out;
}

/** 생성할 파일 { 상대경로: 내용 } */
export function render(root) {
  const files = {};
  for (const e of entries(root)) {
    const skill = `---\nname: ${e.name}\ndescription: ${e.summary}\n${e.args ? `argument-hint: "${esc(e.args)}"\n` : ''}---\n<!-- ${MARK} · 손으로 편집하지 않는다 — 정본은 ${e.file} -->\n\n# ${e.title}\n\n절차 정본은 \`${e.file}\`이다. 그 파일을 읽고 그대로 따른다. 입력: $ARGUMENTS\n`;
    files[`.claude/skills/${e.name}/SKILL.md`] = skill;
    files[`.agents/skills/${e.name}/SKILL.md`] = skill;
    files[`.gemini/commands/${e.name}.toml`] = `# ${MARK} · 손으로 편집하지 않는다 — 정본은 ${e.file}\ndescription = "${esc(e.summary)}"\nprompt = """\n절차 정본은 ${e.file} 이다. 그 파일을 읽고 그대로 따른다. 입력: {{args}}\n"""\n`;
  }
  return files;
}

/** 디스크의 생성물(표식 있는 것) 목록 — 고아 제거·check용 */
function generatedOnDisk(root) {
  const out = [];
  for (const [dir, rx] of [['.claude/skills', /SKILL\.md$/], ['.agents/skills', /SKILL\.md$/], ['.gemini/commands', /\.toml$/]]) {
    const d = join(root, dir); if (!existsSync(d)) continue;
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = n.isDirectory() ? join(d, n.name, 'SKILL.md') : join(d, n.name);
      if (rx.test(p) && existsSync(p) && rd(p).includes(MARK)) out.push(`${dir}/${n.isDirectory() ? n.name + '/SKILL.md' : n.name}`);
    }
  }
  return out;
}

export function build(root, { check = false } = {}) {
  const want = render(root); const have = generatedOnDisk(root);
  const changed = [], removed = [];
  for (const [rel, body] of Object.entries(want)) if (rd(join(root, rel)).replace(/\r\n/g, '\n') !== body) changed.push(rel);
  for (const rel of have) if (!(rel in want)) removed.push(rel);
  if (!check) {
    for (const rel of changed) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), want[rel]); }
    for (const rel of removed) { rmSync(join(root, rel), { force: true }); const d = dirname(join(root, rel)); if (/skills[\\/][^\\/]+$/.test(d) && existsSync(d) && !readdirSync(d).length) rmSync(d, { recursive: true }); }
  }
  return { entries: Object.keys(want).length / 3, changed, removed };
}

if (process.argv.includes('--self-test')) {
  const tmp = join(HERE, '..', '.build-selftest'); rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, '.harness', 'runbooks'), { recursive: true }); mkdirSync(join(tmp, 'rules', 'runbooks'), { recursive: true });
  writeFileSync(join(tmp, '.harness', 'runbooks', 'a.md'), '---\nid: RB-a\ntrigger: t\nentry: do-a\nsummary: A를 한다\nargs: "<x>"\n---\n\n# A 절차\n');
  writeFileSync(join(tmp, '.harness', 'runbooks', 'noentry.md'), '---\nid: RB-n\ntrigger: t\n---\n# 입구 없음\n');
  writeFileSync(join(tmp, 'rules', 'runbooks', 'p.md'), '---\nid: RB-p\ntrigger: t\nentry: proj-p\nsummary: 프로젝트 런북\n---\n# P\n');
  mkdirSync(join(tmp, '.claude', 'skills', 'hand'), { recursive: true }); writeFileSync(join(tmp, '.claude', 'skills', 'hand', 'SKILL.md'), '---\nname: hand\n---\n손으로 쓴 스킬\n');
  // embedded 목업 저장소의 런북도 입구가 생긴다
  writeFileSync(join(tmp, 'harness.yaml'), 'references:\n  - { path: mockups, role: mockup, mode: read-write, embedded: true }\n');
  mkdirSync(join(tmp, 'mockups', 'runbooks'), { recursive: true }); writeFileSync(join(tmp, 'mockups', 'runbooks', 'design-mockup.md'), '---\nid: RB-dm\ntrigger: t\nentry: design-mockup\nsummary: 목업 절차\n---\n# 목업\n');
  const fails = [];
  try {
    const r1 = build(tmp); if (r1.entries !== 3 || r1.changed.length !== 9) fails.push(`생성 (${r1.entries} · ${r1.changed.length})`);
    if (!/mockups\/runbooks\/design-mockup\.md/.test(rd(join(tmp, '.claude', 'skills', 'design-mockup', 'SKILL.md')))) fails.push('embedded 목업 런북 입구');
    const sk = rd(join(tmp, '.claude', 'skills', 'do-a', 'SKILL.md')); if (!/name: do-a/.test(sk) || !/argument-hint: "<x>"/.test(sk) || !/\.harness\/runbooks\/a\.md/.test(sk) || !/\$ARGUMENTS/.test(sk)) fails.push('claude 스킬 내용');
    if (!existsSync(join(tmp, '.agents', 'skills', 'proj-p', 'SKILL.md'))) fails.push('agents 스킬');
    const tm = rd(join(tmp, '.gemini', 'commands', 'do-a.toml')); if (!/description = "A를 한다"/.test(tm) || !/\{\{args\}\}/.test(tm)) fails.push('gemini toml');
    if (build(tmp, { check: true }).changed.length) fails.push('check: 갱신 직후 변경 있음');
    writeFileSync(join(tmp, '.harness', 'runbooks', 'a.md'), '---\nid: RB-a\ntrigger: t\nentry: do-a\nsummary: 바뀜\n---\n# A\n'); if (!build(tmp, { check: true }).changed.length) fails.push('check: 변경 미검출');
    build(tmp);
    rmSync(join(tmp, 'rules', 'runbooks', 'p.md')); const r3 = build(tmp); if (r3.removed.length !== 3 || existsSync(join(tmp, '.claude', 'skills', 'proj-p'))) fails.push('고아 제거');
    if (!existsSync(join(tmp, '.claude', 'skills', 'hand', 'SKILL.md'))) fails.push('손으로 쓴 스킬이 지워짐');
    writeFileSync(join(tmp, 'rules', 'runbooks', 'dup.md'), '---\nentry: do-a\n---\n# dup\n'); try { build(tmp); fails.push('entry 중복 통과'); } catch { /* 기대 */ }
  } catch (e) { fails.push('예외: ' + e.message); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (입구 3런타임 생성 · check · 갱신 · 고아 제거 · 수기 스킬 보존 · 중복 거부)');
  process.exit(fails.length ? 1 : 0);
}

const root = process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(HERE, '..', '..');
const r = build(root, { check: process.argv.includes('--check') });
if (process.argv.includes('--check')) { if (r.changed.length || r.removed.length) { console.log(`낡은 입구: ${[...r.changed, ...r.removed].join(', ')} — node .harness/scripts/harness-build.mjs`); process.exit(1); } console.log(`입구 최신 (런북 ${r.entries}개 × 3 런타임)`); }
else console.log(`입구 생성: 런북 ${r.entries}개 → .claude/skills · .agents/skills · .gemini/commands${r.changed.length ? ` (갱신 ${r.changed.length})` : ''}${r.removed.length ? ` (고아 제거 ${r.removed.length})` : ''}`);
