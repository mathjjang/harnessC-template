#!/usr/bin/env node
// qa-intake.mjs — 목업 저장소(references role: mockup)의 검수 접수(qa/QA-…)를 개발 쪽에서 다룬다 (.harness/runbooks/qa.md · ADR-261017-qa-flow). V2 ADR-0134 QA 체계의 두 저장소판.
//
//   pull                                          유형 `오류`이고 open·reopened인 접수 건을 docs/queue/<같은 ID>.md 로 가져온다(sync: 원본 ID). 미정·기획수정·정책공백은 가져오지 않고 보여만 준다
//   reply  <ID> --state taken|resolved|verified [--commit <sha>] [--server <주소>] [--steps "<확인 절차>"] [--by "<에이전트(모델)>"]
//                                                 목업 저장소 qa/<ID>/resolution.md(개발 소유)에 진행을 적는다. verified는 수정자와 다른 세션(리뷰어)만 — by가 같으면 거부
//   status                                        접수 상태·유형 · resolution 상태 · 개발 큐 유무를 한 표로
// 원칙: 서로의 파일을 고치지 않는다 — report.md(기획)는 읽기만, resolution.md(개발)만 쓴다. 닫기는 기획(qa.mjs close). 기획수정 건은 개발이 가져가지 않는다(목업 rev+1·policy 개정이 먼저).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findReference } from './lib/refs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..');
const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const today = () => new Date().toISOString().slice(0, 10);
const fm = (t) => (t.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
const field = (t, k) => ((fm(t).match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1] || '').trim().replace(/^"(.*)"$/, '$1');
const title = (t) => (t.match(/^# [^·\n]+· (.+)$/m) || [])[1] || '';
const RES_STATES = ['taken', 'resolved', 'verified'];

function mockupRef(root) { const r = findReference(rd(join(root, 'harness.yaml')), 'mockup'); if (!r) throw new Error('harness.yaml references에 role: mockup 저장소가 없다 — node .harness/scripts/mockup-diff.mjs init separate|embedded'); const p = resolve(root, r.path); if (!existsSync(p)) throw new Error(`목업 저장소 체크아웃 없음: ${r.path}`); return { ...r, abs: p }; }
export function listIntake(root) {
  const ref = mockupRef(root); const d = join(ref.abs, 'qa');
  return (existsSync(d) ? readdirSync(d).filter((n) => /^QA-\d{6}-[a-z0-9-]+$/.test(n) && existsSync(join(d, n, 'report.md'))) : []).sort().map((id) => { const rep = rd(join(d, id, 'report.md')); const res = rd(join(d, id, 'resolution.md')); return { id, ref, path: join(d, id), state: field(rep, 'state'), type: field(rep, 'type'), screen: field(rep, 'screen'), title: title(rep), expected: (rep.split(/^## 되어야 할 모습[^\n]*$/m)[1] || '').split(/^## /m)[0].trim(), resState: field(res, 'state'), resBy: field(res, 'by'), queued: existsSync(join(root, 'docs', 'queue', `${id}.md`)) }; });
}
export function pull(root) {
  const out = { pulled: [], skipped: [] };
  for (const q of listIntake(root)) {
    if (q.queued) continue;
    if (q.type !== '오류' || !['open', 'reopened'].includes(q.state)) { if (q.state !== 'closed') out.skipped.push(`${q.id} (${q.type} · ${q.state})`); continue; }
    const qd = join(root, 'docs', 'queue'); mkdirSync(qd, { recursive: true });
    const tpl = rd(join(root, '.harness', 'templates', 'QUEUE-template.md')) || '---\nid: {{ID}}\nsource: {{SOURCE}}\nstate: open\nsync:\naffected: []\n---\n\n# {{TITLE}}\n\n- 작성: {{AGENT}} · {{DATE}}\n\n## 내용\n\n## 처리 기록\n';
    let t = tpl.replace(/\{\{ID\}\}/g, q.id).replace(/\{\{SOURCE\}\}/g, 'qa').replace(/\{\{TITLE\}\}/g, q.title || q.id).replace(/\{\{AGENT\}\}/g, 'qa-intake.mjs pull').replace(/\{\{DATE\}\}/g, today());
    t = t.replace(/^sync:.*$/m, `sync: ${q.id}`).replace(/^owner:.*$/m, 'owner: developer');
    t = t.replace(/## 내용\n[\s\S]*?## 처리 기록/, `## 내용\n\n- 원본(정본): \`${q.ref.path}/qa/${q.id}/report.md\` — 증상·캡처·재현 절차는 거기. 여기에는 복사하지 않는다(사본은 갈라진다)\n- 화면: ${q.screen || '(미지정)'}\n- 되어야 할 모습(보고자의 말): ${q.expected.replace(/\n+/g, ' ').slice(0, 300) || '(원본 참조)'}\n- 절차: \`.harness/runbooks/qa.md\` — 고치는 FDR의 scope 안에서. 완료 주장은 \`qa-intake.mjs reply ${q.id} --state resolved …\`, 검증은 리뷰어가 \`--state verified\`\n\n## 처리 기록\n\n| 날짜 | 상태 | 내용 |\n|---|---|---|\n| ${today()} | pulled | 목업 저장소에서 가져옴 |\n\n## 처리 기록`).replace(/\n## 처리 기록\n*$/, '\n');
    writeFileSync(join(qd, `${q.id}.md`), t); out.pulled.push(q.id);
  }
  return out;
}
export function reply(root, id, { state, commit = '', server = '', steps = '', by = '(모델 미확인)' } = {}) {
  if (!RES_STATES.includes(state)) throw new Error(`--state는 ${RES_STATES.join('|')}`);
  const q = listIntake(root).find((x) => x.id === id); if (!q) throw new Error(`접수 건이 없다: ${id}`);
  if (q.type !== '오류') throw new Error(`${id}는 ${q.type} 건 — 개발이 처리하지 않는다(기획수정은 목업 rev+1·policy 개정, 정책공백은 결정이 먼저)`);
  const p = join(q.path, 'resolution.md'); const prev = rd(p);
  const prevBy = field(prev, 'by'), prevState = field(prev, 'state');
  if (state === 'verified') { if (prevState !== 'resolved') throw new Error(`verified는 resolved 뒤에만 (지금 ${prevState || '없음'})`); if (!prevBy || prevBy === by) throw new Error(`고친 쪽(${prevBy || '?'})은 자기 검증자가 될 수 없다 — 리뷰어 세션에서 --by "<다른 에이전트(모델)>"`); }
  if (state === 'resolved' && (!commit || !steps)) throw new Error('resolved에는 --commit <수정 커밋> --steps "<리뷰어가 밟을 확인 절차 한 줄>"이 필요하다 (원인 한 줄 · 커밋 · 확인 절차 — V2 QA §6)');
  const keep = (k, v) => v || field(prev, k);
  const head = `---\nid: ${id}\nstate: ${state}\nby: "${state === 'verified' ? prevBy : by}"\nupdated: ${today()}\ncommit: ${keep('commit', commit)}\nserver: "${keep('server', server)}"\nverify_steps: "${keep('verify_steps', steps).replace(/"/g, '\\"')}"\nverified_by: "${state === 'verified' ? by : field(prev, 'verified_by')}"\n---\n`;
  const body = prev ? prev.replace(/^---[\s\S]*?---\n/, '') : `\n# ${id} · 개발 처리 기록 (개발 저장소 소유 — qa-intake.mjs reply가 쓴다)\n\n> 리뷰어가 재조사 없이 「고쳐졌다」를 확인할 수 있게: 원인 한 줄 · 커밋 · 확인 절차. 붙이지 않은 증적은 뺐다고 적는다.\n\n## 기록\n\n| 날짜 | 상태 | 누가 | 내용 |\n|---|---|---|---|\n`;
  const line = `| ${today()} | ${state} | ${by} | ${state === 'taken' ? '착수' : state === 'resolved' ? `커밋 ${commit}${server ? ` · 반영 ${server}` : ''} · 확인: ${steps}` : '리뷰어 재현 재시도 — 증상 사라짐 · 증적 정합 확인'} |\n`;
  writeFileSync(p, head + body + line);
  const qp = join(root, 'docs', 'queue', `${id}.md`);
  if (existsSync(qp)) { let t = rd(qp); t = t.replace(/(\| 날짜 \| 상태 \| 내용 \|\n\|---\|---\|---\|\n(?:\|[^\n]*\n)*)/, (m) => m + `| ${today()} | ${state} | ${by}${commit ? ` · ${commit}` : ''} |\n`); if (state === 'verified') t = t.replace(/^state:.*$/m, 'state: decided'); writeFileSync(qp, t); }
  return { id, state, path: p };
}
export function status(root) { return listIntake(root).map((q) => `${q.id.padEnd(28)} ${q.state.padEnd(9)} ${q.type.padEnd(10)} 개발:${(q.resState || '-').padEnd(9)} 큐:${q.queued ? 'Y' : '-'}  ${q.title}`); }

const IS_MAIN = process.argv[1] && /qa-intake\.mjs$/.test(process.argv[1]);
if (IS_MAIN && process.argv.includes('--self-test')) {
  const { rmSync } = await import('node:fs');
  const tmp = join(HERE, '..', '.qaintake-selftest'); rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'docs', 'queue'), { recursive: true }); mkdirSync(join(tmp, '.harness', 'templates'), { recursive: true });
  writeFileSync(join(tmp, '.harness', 'templates', 'QUEUE-template.md'), rd(join(DEFAULT_ROOT, '.harness', 'templates', 'QUEUE-template.md')));
  writeFileSync(join(tmp, 'harness.yaml'), 'references:\n  - { path: mockups, role: mockup, mode: read-write, embedded: true }\n');
  const rep = (id, type, state) => { mkdirSync(join(tmp, 'mockups', 'qa', id, 'intake'), { recursive: true }); writeFileSync(join(tmp, 'mockups', 'qa', id, 'report.md'), `---\nid: ${id}\nstate: ${state}\ntype: ${type}\nscreen: ds/list\nbasis: x\ncaptures: []\n---\n\n# ${id} · 제목 ${id}\n\n## 되어야 할 모습 ★\n\n> 저장돼야 한다\n\n## 분류 근거\n`); };
  rep('QA-260101-err', '오류', 'open'); rep('QA-260101-ui', '기획수정(UI)', 'open'); rep('QA-260101-undef', '미정', 'open'); rep('QA-260101-old', '오류', 'closed');
  const fails = [];
  try {
    const p = pull(tmp);
    if (p.pulled.join() !== 'QA-260101-err' || p.skipped.length !== 2) fails.push('pull: ' + JSON.stringify(p));
    const qf = rd(join(tmp, 'docs', 'queue', 'QA-260101-err.md')); if (!/^sync: QA-260101-err$/m.test(qf) || !/^source: qa/m.test(qf) || !/mockups\/qa\/QA-260101-err\/report\.md/.test(qf) || !/저장돼야 한다/.test(qf)) fails.push('큐 파일 내용:\n' + qf);
    if (pull(tmp).pulled.length) fails.push('pull 중복');
    try { reply(tmp, 'QA-260101-ui', { state: 'taken', by: 'dev' }); fails.push('기획수정 reply 통과'); } catch { /* 기대 */ }
    reply(tmp, 'QA-260101-err', { state: 'taken', by: 'dev' });
    try { reply(tmp, 'QA-260101-err', { state: 'resolved', by: 'dev' }); fails.push('commit·steps 없는 resolved 통과'); } catch { /* 기대 */ }
    try { reply(tmp, 'QA-260101-err', { state: 'verified', by: 'rev' }); fails.push('resolved 전 verified 통과'); } catch { /* 기대 */ }
    reply(tmp, 'QA-260101-err', { state: 'resolved', by: 'dev', commit: 'abc1234', steps: '로그인 후 저장 → 목록에 보임', server: 'https://t' });
    try { reply(tmp, 'QA-260101-err', { state: 'verified', by: 'dev' }); fails.push('자기 검증 통과'); } catch { /* 기대 */ }
    reply(tmp, 'QA-260101-err', { state: 'verified', by: 'reviewer' });
    const res = rd(join(tmp, 'mockups', 'qa', 'QA-260101-err', 'resolution.md'));
    if (!/^state: verified$/m.test(res) || !/^by: "dev"$/m.test(res) || !/^verified_by: "reviewer"$/m.test(res) || !/^commit: abc1234$/m.test(res) || (res.match(/^\| 20/gm) || []).length !== 3) fails.push('resolution.md:\n' + res);
    if (!/^state: decided$/m.test(rd(join(tmp, 'docs', 'queue', 'QA-260101-err.md')))) fails.push('큐 상태 decided');
    const st = status(tmp); if (st.length !== 4 || !st.some((l) => /QA-260101-err.*verified.*큐:Y/.test(l))) fails.push('status: ' + st.join('\n'));
  } catch (e) { fails.push('예외: ' + e.stack.split('\n').slice(0, 2).join(' ')); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (pull 오류만·중복 없음 · reply taken→resolved→verified · 거부 4(기획수정·증적 없음·순서·자기 검증) · 큐 동기 · status)');
  process.exit(fails.length ? 1 : 0);
}
if (IS_MAIN && !process.argv.includes('--self-test')) {
  const argv = process.argv.slice(2); const [cmd, a] = argv; const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  try {
    if (cmd === 'pull') { const r = pull(DEFAULT_ROOT); console.log(`가져옴 ${r.pulled.length}: ${r.pulled.join(' ') || '-'}\n보류(오류 아님·분류 대기) ${r.skipped.length}: ${r.skipped.join(' · ') || '-'}${r.pulled.length ? '\n다음: node .harness/scripts/build-index.mjs → 각 건을 FDR scope 안에서 고치고 reply --state resolved' : ''}`); }
    else if (cmd === 'reply') { const r = reply(DEFAULT_ROOT, a, { state: opt('--state'), commit: opt('--commit'), server: opt('--server'), steps: opt('--steps'), by: opt('--by') || process.env.HARNESS_AGENT }); console.log(`${r.id}: ${r.state} → ${r.path}${r.state === 'verified' ? '\n다음: 기획이 테스트 서버에서 확인 후 qa.mjs close' : r.state === 'resolved' ? '\n다음: 리뷰어(다른 세션)가 reply --state verified' : ''}`); }
    else if (cmd === 'status') { const s = status(DEFAULT_ROOT); console.log(s.length ? s.join('\n') : '접수 건 없음'); }
    else { console.error('사용: node .harness/scripts/qa-intake.mjs pull | reply <ID> --state taken|resolved|verified [--commit <sha>] [--server <주소>] [--steps "<확인 절차>"] [--by "<에이전트(모델)>"] | status'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
