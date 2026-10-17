#!/usr/bin/env node
// setup.mjs — 프로젝트 설정을 질문으로 정한다 (.harness/runbooks/init.md). 티어는 고르는 것이 아니라 답에서 나오는 요약이다.
//
//   node .harness/scripts/setup.mjs --interactive [--reconfigure] [--no-actions] [--remote] [--agent "<이름>"]   사람 — 터미널에서 묻는다
//   node .harness/scripts/setup.mjs --answers <answers.json> [--reconfigure] …                                   에이전트 — 자기 런타임의 질문 도구로 물은 답을 파일로
//   node .harness/scripts/setup.mjs --show                                                                        지금 설정과 그 근거(setup 블록)
// 처음 적용은 init.mjs가 이것을 부른다(--interactive · --answers). 조건이 바뀌면(사람이 늘었다 · 외부 발주처가 생겼다) --reconfigure.
// 하는 일: ① 답 → 설정 판정(derive) ② harness.yaml 값 갱신 + 「# 근거: Qn …」 주석 + setup 블록(답 원문) ③ 티어 L로 오르면 FDR-full 양식을 upstream에서
//          ④ 첫 ADR `ADR-<날짜>-project-setup`(재설정이면 개정 이력) ⑤ 후속 동작 — 화면을 개발자가 직접 만들면 목업 저장소 embedded 생성,
//          기획·디자인이 따로면 --remote일 때만 GitHub 저장소 생성(바깥에 만드는 일이라 명시 동의), 외부 조직이면 협업 저장소 절차 안내.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const today = () => new Date().toISOString().slice(0, 10);

/** 질문 — required는 반드시 묻고, 나머지는 기본값을 보여 준 뒤 한 번에 확인받는다 */
export const QUESTIONS = [
  { key: 'name', q: 'Q1. 프로젝트 이름(영문 소문자·숫자·하이픈)', type: 'text', required: true },
  { key: 'concurrent', q: 'Q2. 동시에 구현하는 사람·에이전트 세션은 몇인가? (리뷰어 제외)', type: 'number', required: true, def: 1 },
  { key: 'ui', q: 'Q4. 화면이 있는가? 목업은 누가 만드나? (none=화면 없음 · self=개발자가 직접 · separate=기획·디자인이 따로)', type: 'choice', choices: ['none', 'self', 'separate'], required: true, def: 'self' },
  { key: 'duration_months', q: 'Q3a. 예상 기간(개월)', type: 'number', def: 3 },
  { key: 'scale', q: 'Q3b. 기능 규모 (small=FDR 10개 미만 · medium=10~50 · large=50 이상·다플랫폼·레거시 전환)', type: 'choice', choices: ['small', 'medium', 'large'], def: 'small' },
  { key: 'external', q: 'Q5. 외부 조직(발주처·협력사)과 같이 보는 문서가 있는가?', type: 'bool', def: false },
  { key: 'signoff', q: 'Q6. 결제·개인정보·의료·공공 납품처럼 사람 사인오프가 필요한 영역이 있는가?', type: 'bool', def: false },
  { key: 'visibility', q: 'Q7. GitHub 저장소 공개 여부', type: 'choice', choices: ['private', 'public'], def: 'private' },
];
export const defaults = () => Object.fromEntries(QUESTIONS.filter((q) => 'def' in q).map((q) => [q.key, q.def]));

/** 답 정규화·검증 — 반환 { answers, problems } */
export function normalize(raw) {
  const a = { ...defaults(), ...raw }; const p = [];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(a.name || ''))) p.push(`name: 영문 소문자·숫자·하이픈 — ${a.name}`);
  a.concurrent = Number(a.concurrent); if (!Number.isInteger(a.concurrent) || a.concurrent < 1) p.push(`concurrent: 1 이상 정수 — ${raw.concurrent}`);
  a.duration_months = Number(a.duration_months); if (!(a.duration_months > 0)) p.push(`duration_months: 양수 — ${raw.duration_months}`);
  for (const q of QUESTIONS.filter((x) => x.type === 'choice')) if (!q.choices.includes(a[q.key])) p.push(`${q.key}: ${q.choices.join('|')} — ${a[q.key]}`);
  for (const k of ['external', 'signoff']) a[k] = a[k] === true || /^(true|y|yes|예|네|1)$/i.test(String(a[k]));
  return { answers: a, problems: p };
}

/** 답 → 설정. 각 값에 근거(어느 답 때문인가)를 붙인다 */
export function derive(a) {
  const why = {};
  let tier = 'S'; const tierWhy = [];
  if (a.scale === 'large' || a.concurrent >= 5 || (a.external && a.signoff)) { tier = 'L'; tierWhy.push(a.scale === 'large' ? 'Q3b 규모 large' : a.concurrent >= 5 ? `Q2 동시 구현 ${a.concurrent}` : 'Q5 외부 조직 + Q6 사인오프'); }
  else if (a.scale === 'medium' || a.concurrent >= 2 || a.duration_months > 3 || a.external) { tier = 'M'; tierWhy.push([a.scale === 'medium' && 'Q3b 규모 medium', a.concurrent >= 2 && `Q2 동시 구현 ${a.concurrent}`, a.duration_months > 3 && `Q3a 기간 ${a.duration_months}개월`, a.external && 'Q5 외부 조직'].filter(Boolean).join(' · ')); }
  else tierWhy.push(`Q2 동시 구현 ${a.concurrent} · Q3 ${a.duration_months}개월·${a.scale}`);
  why.tier = tierWhy.join(' · ');
  const profile = { S: 'lite', M: 'standard', L: 'full' }[tier];
  const merge = a.concurrent >= 2 ? 'pr' : 'ff'; why.merge = `Q2 동시 구현 ${a.concurrent}${merge === 'pr' ? ' — 리뷰 판정을 병합 조건으로' : ' — 혼자면 게이트 후 바로 병합'}`;
  const reviews = a.concurrent >= 5 ? 2 : a.concurrent >= 2 ? 1 : 0; why.reviews = `Q2 동시 구현 ${a.concurrent}`;
  const gate_mode = a.signoff ? 'strict' : tier === 'L' ? 'strict' : 'standard'; why.gate_mode = a.signoff ? 'Q6 사인오프 영역' : tier === 'L' ? `티어 L(${why.tier})` : '기본';
  const human_touchpoints = a.signoff ? ['spec', 'review', 'signoff'] : ['spec', 'review']; why.human_touchpoints = a.signoff ? 'Q6 사인오프 영역' : '기본(사람 2접점)';
  const always_on_kb = { S: 18, M: 25, L: 40 }[tier]; why.always_on_kb = `티어 ${tier}`;
  const warnings = [];
  if (merge === 'pr' && a.visibility === 'private') warnings.push('Q7 비공개 + PR 모드 — GitHub Free 비공개 저장소는 브랜치 보호를 쓸 수 없다. CI(harness)는 실패를 표시하지만 병합을 막지 못한다(공개 또는 Team/Pro)');
  const actions = [];
  if (a.ui === 'self') actions.push({ kind: 'mockup-embedded', cmd: 'node .harness/scripts/mockup-diff.mjs init embedded', why: 'Q4 개발자가 직접 목업' });
  if (a.ui === 'separate') actions.push({ kind: 'mockup-separate', cmd: 'node .harness/scripts/mockup-diff.mjs init separate', why: 'Q4 기획·디자인이 따로 — 별도 GitHub 저장소', remote: true });
  if (a.external) actions.push({ kind: 'collab', cmd: '.harness/runbooks/collab.md — 협업 저장소 뼈대(.harness/templates/collab-skeleton/)로 비공개 저장소를 만들고 harness.yaml references에 role: collab 등록', why: 'Q5 외부 조직' });
  if (merge === 'pr') actions.push({ kind: 'protect', cmd: 'node .harness/scripts/work.mjs protect', why: `Q2 동시 구현 ${a.concurrent} — main 보호(필수 검사 harness · 필수 승인 ${reviews})`, remote: true });
  return { tier, profile, merge, reviews, gate_mode, human_touchpoints, always_on_kb, why, warnings, actions };
}

/** harness.yaml에 반영 — 값과 「# 근거」 주석, setup 블록(답 원문). 다른 줄은 건드리지 않는다 */
export function applyConfig(root, a, d, { adrId = '' } = {}) {
  const p = join(root, 'harness.yaml'); let t = rd(p); if (!t) throw new Error('harness.yaml이 없다');
  const set = (re, line, label) => { if (!re.test(t)) throw new Error(`harness.yaml에 ${label} 줄이 없다 — 양식이 바뀌었으면 setup.mjs를 고친다`); t = t.replace(re, line); };
  const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));
  set(/^project:.*$/m, `project: "${a.name}"`, 'project');
  set(/^tier:.*$/m, pad(`tier: ${d.tier}`, 29) + `# 근거: ${d.why.tier} (setup.mjs · S 18KB lite · M 25KB standard · L 40KB full)`, 'tier');
  set(/^gate_mode:.*$/m, pad(`gate_mode: ${d.gate_mode}`, 29) + `# 근거: ${d.why.gate_mode} (fast | standard | strict)`, 'gate_mode');
  set(/^human_touchpoints:.*$/m, pad(`human_touchpoints: [${d.human_touchpoints.join(', ')}]`, 29) + `# 근거: ${d.why.human_touchpoints}`, 'human_touchpoints');
  set(/^  always_on_kb:.*$/m, pad(`  always_on_kb: ${d.always_on_kb}`, 29) + `# 근거: ${d.why.always_on_kb} — 규칙 파일 합계 상한`, 'always_on_kb');
  set(/^  merge:.*$/m, pad(`  merge: ${d.merge}`, 29) + `# 근거: ${d.why.merge}`, 'work.merge');
  const block = ['setup:                       # 프로젝트 설정 질문의 답 — setup.mjs --reconfigure가 기본값으로 다시 묻는다' + (adrId ? ` · 근거 기록 ${adrId}` : ''),
    `  concurrent: ${a.concurrent}`, `  duration_months: ${a.duration_months}`, `  scale: ${a.scale}`, `  ui: ${a.ui}`, `  external: ${a.external}`, `  signoff: ${a.signoff}`, `  visibility: ${a.visibility}`, `  answered: ${today()}`, ''].join('\n');
  t = /^setup:[^\n]*\n(?:[ \t]+.*\n?)*/m.test(t) ? t.replace(/^setup:[^\n]*\n(?:[ \t]+.*\n?)*\n?/m, block + '\n') : t.replace(/\n?$/, '\n\n' + block);
  writeFileSync(p, t);
  return p;
}
/** harness.yaml setup 블록 → 이전 답 */
export function readSetup(root) {
  const t = rd(join(root, 'harness.yaml')); const b = (t.match(/^setup:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '';
  const o = {}; for (const m of b.matchAll(/^\s+([a-z_]+):\s*(.*?)\s*$/gm)) o[m[1]] = m[2];
  const name = ((t.match(/^project:\s*"?([^"\n]*)"?/m) || [])[1] || '').trim();
  return Object.keys(o).length ? { name, ...o } : null;
}

/** 티어 L로 오르면 FDR-full 양식이 있어야 한다 — 템플릿의 tiers/에서, 없으면 upstream에서 */
export async function ensureTierTemplates(root, tier) {
  if (tier !== 'L' || existsSync(join(root, '.harness', 'templates', 'FDR-full'))) return null;
  const local = join(root, '.harness', 'tiers', 'L', '.harness', 'templates', 'FDR-full');
  let label;
  if (existsSync(local)) { cpSync(local, join(root, '.harness', 'templates', 'FDR-full'), { recursive: true }); label = 'tiers/L'; }
  else {
    const { readUpstream, fetchSource } = await import('./lib/upstream.mjs'); const up = readUpstream(root);
    if (!up.repo) throw new Error('티어 L의 FDR-full 양식이 없고 harness.yaml upstream도 없다');
    const s = fetchSource(`${up.repo}${up.ref ? '@' + up.ref : ''}`, { cwd: root });
    try { cpSync(join(s.dir, '.harness', 'tiers', 'L', '.harness', 'templates', 'FDR-full'), join(root, '.harness', 'templates', 'FDR-full'), { recursive: true }); } finally { s.cleanup(); }
    label = s.label;
  }
  // 코어에 정당하게 더해진 양식 — 코어 해시(manifest)를 갱신해야 lint ⑫가 "프로젝트가 코어를 고쳤다"로 보지 않는다
  const mp = join(root, '.harness', 'init-manifest.json');
  if (existsSync(mp)) { const { hashCore } = await import('./lib/core-files.mjs'); const m = JSON.parse(rd(mp)); m.core = hashCore(root); m.tier = 'L'; writeFileSync(mp, JSON.stringify(m, null, 2) + '\n'); }
  return label;
}

/** 첫 ADR(또는 재설정 개정) — 답·판정·근거·후속 동작 */
export async function writeAdr(root, a, d, { agent = '(모델 미확인)', previous = null } = {}) {
  const dec = join(root, 'docs', 'decisions'); mkdirSync(dec, { recursive: true });
  const existing = readdirSync(dec).find((f) => /^ADR-\d{6}-project-setup\.md$/.test(f));
  const rows = QUESTIONS.map((q) => `| ${q.q.split('.')[0]} | ${q.q.replace(/^Q[\w]+\.\s*/, '').replace(/\|/g, '/')} | ${a[q.key]}${previous && String(previous[q.key]) !== String(a[q.key]) && previous[q.key] !== undefined ? ` (이전 ${previous[q.key]})` : ''} |`).join('\n');
  const settings = [['tier', `${d.tier} (FDR 기본 프로파일 ${d.profile})`, d.why.tier], ['work.merge', d.merge, d.why.merge], ['필수 승인(protect)', String(d.reviews), d.why.reviews], ['gate_mode', d.gate_mode, d.why.gate_mode], ['human_touchpoints', d.human_touchpoints.join(', '), d.why.human_touchpoints], ['budgets.always_on_kb', String(d.always_on_kb), d.why.always_on_kb]].map((r) => `| ${r.join(' | ')} |`).join('\n');
  const acts = d.actions.length ? d.actions.map((x) => `- ${x.why}: \`${x.cmd}\`${x.done ? ` — ${x.done}` : x.remote ? ' — 바깥(GitHub)에 만드는 일이라 사람이 실행하거나 --remote' : ''}`).join('\n') : '- 없음';
  if (existing && previous) {
    const p = join(dec, existing); let t = rd(p);
    t = t.replace(/(## 개정 이력[\s\S]*?\n\|---\|---\|---\|---\|\n(?:\|[^\n]*\n)*)/, (m) => m + `| ${today()} | ${agent} | §2 | 재설정 — ${QUESTIONS.filter((q) => String(previous[q.key]) !== String(a[q.key]) && previous[q.key] !== undefined).map((q) => `${q.key} ${previous[q.key]}→${a[q.key]}`).join(' · ') || '답 변경 없음'} · 결과 tier ${d.tier} · merge ${d.merge} |\n`);
    t = t.replace(/## 2\. Decision[\s\S]*?(?=\n## 3\.)/, `## 2. Decision (무엇을 한다 / 하지 않는다)\n\n질문의 답 (${today()} 재설정)\n\n| # | 질문 | 답 |\n|---|---|---|\n${rows}\n\n판정 (\`node .harness/scripts/setup.mjs\` — 티어는 고른 것이 아니라 답의 요약)\n\n| 설정 | 값 | 근거 |\n|---|---|---|\n${settings}\n${d.warnings.length ? '\n주의\n\n' + d.warnings.map((w) => `- ${w}`).join('\n') + '\n' : ''}\n후속 동작\n\n${acts}\n`);
    writeFileSync(p, t); return { id: existing.replace(/\.md$/, ''), path: p, revised: true };
  }
  const { create } = await import(pathToFileURL(join(root, '.harness', 'scripts', 'new-doc.mjs')).href);
  const r = create(root, 'adr', 'project-setup', `프로젝트 설정 — ${a.name} (tier ${d.tier} · ${d.merge})`, { agent });
  writeFileSync(r.path, `# ${r.id}: 프로젝트 설정 — ${a.name} (tier ${d.tier} · ${d.merge})

- 상태: Accepted (프로젝트 시작 질문의 답 · ${today()})
- 작성: ${agent} · ${today()}
- 강제 등급: generate — 집행 수단: \`.harness/scripts/setup.mjs\`(harness.yaml 값·근거 주석·setup 블록) · 각 설정의 게이트(lint ③ 예산 · work.mjs merge · ci.mjs 리뷰 판정)
- 위험: low (설정값. 바뀌면 setup.mjs --reconfigure)
- 선행 RFC: 없음
- 관련: \`harness.yaml\` setup 블록 · \`.harness/runbooks/init.md\`
- 정책 소유: technical

> 이 프로젝트가 어떤 조건이라서 이렇게 설정됐는지의 기록이다. 조건이 바뀌면 \`node .harness/scripts/setup.mjs --interactive --reconfigure\` — 이 ADR에 개정 이력이 쌓인다.

## 1. Context (왜 지금)

프로젝트를 시작하며 하네스C 템플릿을 적용했다. 티어(S·M·L)를 인원·기간 같은 대리 지표로 고르지 않고, 실제 조건(동시 구현자 · 화면과 목업 담당 · 외부 조직 · 사인오프 영역)을 물어 설정 하나하나를 정했다.

## 2. Decision (무엇을 한다 / 하지 않는다)

질문의 답

| # | 질문 | 답 |
|---|---|---|
${rows}

판정 (\`node .harness/scripts/setup.mjs\` — 티어는 고른 것이 아니라 답의 요약)

| 설정 | 값 | 근거 |
|---|---|---|
${settings}
${d.warnings.length ? '\n주의\n\n' + d.warnings.map((w) => `- ${w}`).join('\n') + '\n' : ''}
후속 동작

${acts}

## 3. Alternatives

| 대안 | 장점 | 탈락 사유 |
|---|---|---|
| 티어만 골라 기본값 그대로 | 질문 없음 | 티어 경계(인원·기간)는 대리 지표다 — 혼자라도 외부 발주처가 있으면, 짧아도 동시 구현자가 여럿이면 기본값이 맞지 않는다 |

## 4. Consequences (득실 · 후속 작업 · 되돌릴 때 비용)

- 각 설정값 옆에 근거(어느 답)가 남는다 — \`harness.yaml\`에서 「# 근거:」를 보면 된다.
- 조건이 바뀌면 재설정한다. 바뀐 답과 결과가 아래 개정 이력에 쌓인다.

## 개정 이력

| 날짜 | 에이전트(모델) | 수정 부위 | 요지 |
|---|---|---|---|
| ${today()} | ${agent} | 전체 | 최초 작성 — 프로젝트 시작 질문 |
`);
  return { id: r.id, path: r.path, revised: false };
}

/** 후속 동작 실행 — 로컬 일은 하고, 바깥(GitHub)에 만드는 일은 remote일 때만 */
export function runActions(root, d, { remote = false, actions = true } = {}) {
  if (!actions) return d.actions;
  for (const x of d.actions) {
    try {
      if (x.kind === 'mockup-embedded' && !existsSync(join(root, 'mockups'))) { execSync(`"${process.execPath}" .harness/scripts/mockup-diff.mjs init embedded`, { cwd: root, stdio: 'ignore' }); x.done = '완료(mockups/)'; }
      else if (x.kind === 'mockup-separate' && remote) { execSync(`"${process.execPath}" .harness/scripts/mockup-diff.mjs init separate`, { cwd: root, stdio: 'ignore' }); x.done = '완료(별도 저장소)'; }
      else if (x.kind === 'protect' && remote) { execSync(`"${process.execPath}" .harness/scripts/work.mjs protect`, { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] }); x.done = '완료'; }
    } catch (e) { x.done = `실패 — ${String(e.stderr || e.message).trim().split('\n').pop().slice(0, 160)}`; }
  }
  return d.actions;
}

/** 전체 흐름 — 반환 { answers, derived, adr, tierSource } */
export async function setup(root, raw, { agent, reconfigure = false, remote = false, actions = true } = {}) {
  const previous = reconfigure ? readSetup(root) : null;
  if (reconfigure && !previous) throw new Error('재설정할 이전 답이 없다(harness.yaml setup 블록) — 처음이면 --reconfigure 없이');
  const { answers, problems } = normalize({ ...(previous || {}), ...raw });
  if (problems.length) throw new Error('답이 올바르지 않다:\n- ' + problems.join('\n- '));
  const d = derive(answers);
  const tierSource = await ensureTierTemplates(root, d.tier);
  applyConfig(root, answers, d);
  runActions(root, d, { remote, actions });
  const adr = await writeAdr(root, answers, d, { agent, previous });
  applyConfig(root, answers, d, { adrId: adr.id });
  const bi = join(root, '.harness', 'scripts', 'build-index.mjs'); if (existsSync(bi)) { try { execSync(`"${process.execPath}" "${bi}"`, { cwd: root, stdio: 'ignore' }); } catch { /* */ } }
  return { answers, derived: d, adr, tierSource };
}

/** 터미널 질문 — required는 하나씩, 나머지는 기본값을 보여 주고 한 번에 확인 */
/** 표준입력 줄 큐 — readline/promises는 질문 전에 도착한 줄(파이프 입력)을 버리므로 직접 모은다. 입력이 끝나면 빈 답(기본값) */
function lineReader() {
  const queue = []; const waiters = []; let closed = false;
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else queue.push(l); });
  rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
  return { question: (prompt) => { process.stdout.write(prompt); if (queue.length) { const l = queue.shift(); process.stdout.write(l + '\n'); return Promise.resolve(l); } if (closed) { process.stdout.write('\n'); return Promise.resolve(''); } return new Promise((r) => waiters.push((l) => { if (!process.stdin.isTTY) process.stdout.write(l + '\n'); r(l); })); }, close: () => rl.close() };
}
export async function ask(prev = {}, io) {
  const rl = io || lineReader();
  const base = { ...defaults(), ...prev }; const out = {};
  const one = async (q) => { const d = base[q.key]; for (;;) { const v = (await rl.question(`${q.q}${d !== undefined && d !== '' ? ` [${d}]` : ''}: `)).trim(); const val = v === '' ? d : v; const { problems } = normalize({ ...base, ...out, [q.key]: val, name: q.key === 'name' ? val : (out.name || base.name || 'x') }); if (!problems.some((p) => p.startsWith(q.key))) return val; console.log('  ' + problems.find((p) => p.startsWith(q.key))); } };
  for (const q of QUESTIONS.filter((x) => x.required)) out[q.key] = await one(q);
  const rest = QUESTIONS.filter((x) => !x.required);
  console.log('\n나머지는 기본값입니다:\n' + rest.map((q) => `  ${q.q.split('.')[0]} ${q.key} = ${base[q.key]}`).join('\n'));
  const ok = (await rl.question('그대로 갈까요? [Y/n]: ')).trim();
  if (/^n/i.test(ok)) for (const q of rest) out[q.key] = await one(q); else for (const q of rest) out[q.key] = base[q.key];
  if (!io) rl.close();
  return out;
}

const IS_MAIN = process.argv[1] && /setup\.mjs$/.test(process.argv[1]);
if (IS_MAIN && process.argv.includes('--self-test')) {
  const fails = []; const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const D = (raw) => derive(normalize({ name: 'p', ...raw }).answers);
  const eq = (got, want, m) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${m}: ${JSON.stringify(got)}`); };
  eq([D({ concurrent: 1 }).tier, D({ concurrent: 1 }).merge, D({ concurrent: 1 }).reviews], ['S', 'ff', 0], '혼자·짧게');
  eq([D({ concurrent: 3 }).tier, D({ concurrent: 3 }).merge, D({ concurrent: 3 }).reviews], ['M', 'pr', 1], '동시 3');
  eq([D({ concurrent: 1, duration_months: 6 }).tier, D({ concurrent: 1, duration_months: 6 }).merge], ['M', 'ff'], '혼자 6개월 = M이지만 ff');
  eq([D({ concurrent: 6 }).tier, D({ concurrent: 6 }).reviews, D({ concurrent: 6 }).gate_mode], ['L', 2, 'strict'], '동시 6');
  eq([D({ external: true, signoff: true }).tier, D({ external: true, signoff: true }).gate_mode, D({ external: true, signoff: true }).human_touchpoints.includes('signoff')], ['L', 'strict', true], '외부+사인오프');
  eq(D({ external: true }).tier, 'M', '혼자라도 외부 조직이면 M');
  eq(D({ concurrent: 2, visibility: 'private' }).warnings.length, 1, '비공개+PR 경고');
  eq(D({ ui: 'separate' }).actions.find((x) => x.kind === 'mockup-separate').remote, true, 'separate는 바깥 동작');
  eq(D({ ui: 'none' }).actions.some((x) => /mockup/.test(x.kind)), false, '화면 없음');
  if (!normalize({ name: 'Bad Name', concurrent: 0, ui: 'x' }).problems.length !== false || normalize({ name: 'Bad Name', concurrent: 0, ui: 'x' }).problems.length !== 3) fails.push('검증 3건');
  // 적용 — 템플릿 사본에서 처음 설정 → 재설정
  const t = mkdtempSync(join(tmpdir(), 'setup-st-'));
  try {
    for (const n of ['harness.yaml', '.harness']) cpSync(join(DEFAULT_ROOT, n), join(t, n), { recursive: true, filter: (s) => !/init-manifest\.json$|[\\/]\.[a-z-]+-selftest/.test(s) });
    mkdirSync(join(t, 'docs', 'decisions'), { recursive: true });
    const r1 = await setup(t, { name: 'shop', concurrent: 3, ui: 'none', duration_months: 4 }, { agent: 'setup(st)' });
    const y = rd(join(t, 'harness.yaml'));
    if (!/^tier: M\s+# 근거: .*Q2 동시 구현 3/m.test(y) || !/^  merge: pr\s+# 근거: Q2/m.test(y) || !/^setup:.*ADR-\d{6}-project-setup/m.test(y) || !/^  concurrent: 3$/m.test(y) || !/^project: "shop"$/m.test(y)) fails.push('harness.yaml:\n' + y.split('\n').filter((l) => /^(tier|project|setup)|merge:|concurrent/.test(l)).join('\n'));
    const adr = rd(r1.adr.path); if (!/\| Q2 \| .* \| 3 \|/.test(adr) || !/\| work\.merge \| pr \|/.test(adr) || !/비공개 \+ PR 모드/.test(adr)) fails.push('ADR 본문');
    const r2 = await setup(t, { concurrent: 1, duration_months: 2 }, { agent: 'setup(st)', reconfigure: true });
    const y2 = rd(join(t, 'harness.yaml')); const adr2 = rd(r2.adr.path);
    if (!r2.adr.revised || r2.adr.id !== r1.adr.id || !/^tier: S/m.test(y2) || !/^  merge: ff/m.test(y2) || !/재설정 — concurrent 3→1 · duration_months 4→2/.test(adr2) || !/\(이전 3\)/.test(adr2)) fails.push('재설정: ' + JSON.stringify(r2.adr) + '\n' + adr2.split('\n').filter((l) => /재설정|이전/.test(l)).join('\n'));
    if (readdirSync(join(t, 'docs', 'decisions')).filter((f) => /project-setup/.test(f)).length !== 1) fails.push('재설정이 ADR을 새로 만들었다');
    const r3 = await setup(t, { scale: 'large' }, { agent: 'setup(st)', reconfigure: true }); if (r3.derived.tier !== 'L' || !existsSync(join(t, '.harness', 'templates', 'FDR-full')) || !/^  always_on_kb: 40/m.test(rd(join(t, 'harness.yaml')))) fails.push(`L 승격: ${r3.derived.tier} · FDR-full ${existsSync(join(t, '.harness', 'templates', 'FDR-full'))}`);
    try { await setup(t, { concurrent: 'x' }, { reconfigure: true }); fails.push('잘못된 답 통과'); } catch { /* 기대 */ }
    // 파이프 입력(에이전트·스크립트) — 질문 전에 도착한 줄도 버리지 않는다: 이전 답이 기본값, Q2만 4로
    execSync(`"${process.execPath}" "${join(HERE, 'setup.mjs')}" --interactive --reconfigure --no-actions --root "${t}" --agent pipe`, { input: '\n4\n\n\n', stdio: ['pipe', 'ignore', 'pipe'] });
    if (!/^  concurrent: 4$/m.test(rd(join(t, 'harness.yaml')))) fails.push('파이프 입력 재설정');
    // 터미널 질문 — 가짜 입력
    const answersQ = ['', 'demo', '2', 'self', 'n', '5', 'medium', 'y', 'n', 'public'];
    const io = { question: async () => answersQ.shift() ?? '' };
    const got = await ask({}, io); const n2 = normalize(got);
    if (n2.problems.length || got.name !== 'demo' || Number(got.concurrent) !== 2 || got.ui !== 'self' || Number(got.duration_months) !== 5 || got.scale !== 'medium' || n2.answers.external !== true || got.visibility !== 'public') fails.push('ask: ' + JSON.stringify(got) + ' ' + n2.problems.join(','));
  } catch (e) { fails.push('예외: ' + e.stack.split('\n').slice(0, 2).join(' ')); }
  rmSync(t, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (판정 9 · 검증 · 처음 설정(harness.yaml 근거·setup 블록·ADR) · 재설정(같은 ADR 개정) · L 승격(FDR-full) · 터미널 질문)');
  process.exit(fails.length ? 1 : 0);
}
if (IS_MAIN && !process.argv.includes('--self-test')) {
  const a = process.argv.slice(2); const opt = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
  const root = opt('--root') ? resolve(opt('--root')) : DEFAULT_ROOT;
  try {
    if (a.includes('--show')) { const s = readSetup(root); if (!s) { console.log('setup 블록 없음 — 질문으로 정한 적이 없다'); process.exit(0); } const d = derive(normalize(s).answers); console.log(`답: ${JSON.stringify(s)}\n판정: tier ${d.tier} · merge ${d.merge} · 필수 승인 ${d.reviews} · gate ${d.gate_mode}${d.warnings.length ? '\n주의: ' + d.warnings.join(' / ') : ''}`); process.exit(0); }
    const reconfigure = a.includes('--reconfigure');
    let raw;
    if (opt('--answers')) raw = JSON.parse(rd(resolve(opt('--answers'))));
    else if (a.includes('--interactive')) raw = await ask(reconfigure ? readSetup(root) || {} : {});
    else { console.error('사용: node .harness/scripts/setup.mjs --interactive | --answers <answers.json> [--reconfigure] [--no-actions] [--remote] [--agent "<이름>"] | --show'); process.exit(2); }
    const r = await setup(root, raw, { agent: opt('--agent') || process.env.HARNESS_AGENT || '(모델 미확인)', reconfigure, remote: a.includes('--remote'), actions: !a.includes('--no-actions') });
    const d = r.derived;
    console.log(`\n설정: tier ${d.tier}(FDR ${d.profile}) · merge ${d.merge} · 필수 승인 ${d.reviews} · gate ${d.gate_mode} · 규칙 상한 ${d.always_on_kb}KB${r.tierSource ? ` · FDR-full ← ${r.tierSource}` : ''}`);
    for (const w of d.warnings) console.log(`주의: ${w}`);
    for (const x of d.actions) console.log(`후속: ${x.why} — ${x.done || (x.remote ? `사람이: ${x.cmd} (또는 --remote)` : x.cmd)}`);
    console.log(`기록: ${r.adr.id}${r.adr.revised ? ' (개정)' : ''} · harness.yaml 「# 근거」·setup 블록`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
