#!/usr/bin/env node
// guard-role-write.mjs — PreToolUse 훅 (Bash · Write|Edit). 리뷰어·테스터의 쓰기를 **경로**로 판정한다 (.harness/HARNESS.md §5 "리뷰어·테스터는 제품 코드를 고치지 않는다").
//
//   사용: node .claude/hooks/guard-role-write.mjs --role reviewer|tester   (에이전트 정의 frontmatter hooks)
//   허용: 역할의 산출 경로만 — reviewer: FDR 파일(lite)·06-review.md·session-log·evidence/·docs/queue/ · tester: FDR 파일(lite)·evidence/·docs/queue/ · 둘 다 .scratch/·저장소 밖(scratchpad)
//   거부: 그 밖의 저장소 안 경로로 향하는 리다이렉션·tee·touch·mkdir·cp·mv·rm·sed -i, 그리고 git 커밋·히스토리·의존성 변경(FORBIDDEN_RE)
//   한계: 변수 전개·프로그램 내부 쓰기(node -e)는 잡지 않는다. 문자열 패턴 차단(옛 reviewer 정규식)을 대체한다 — ADR-261016-enforcement-alignment
// 자기 검사: node .claude/hooks/guard-role-write.mjs --self-test
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { writeTargets, destructiveTargets, FORBIDDEN_RE } from '../../.harness/scripts/lib/write-targets.mjs';

const R = 'docs\\/records\\/';
const COMMON = [/^\.scratch\//, /^docs\/queue\//, new RegExp(`^${R}FDR-[^/]+/fdr\\.md$`), new RegExp(`^${R}[^/]+/session-log\\.md$`), new RegExp(`^${R}[^/]+/evidence/`), new RegExp(`^${R}HO-[^/]+/(\\d{2}-[a-z0-9]+|result)\\.md$`)];
const ALLOW = {
  reviewer: [...COMMON, new RegExp(`^${R}FDR-[^/]+/06-review\\.md$`)],
  tester: [...COMMON],
};
const norm = (p) => String(p).replace(/^\/([a-zA-Z])\/(.*)$/, (m, d, r) => `${d.toUpperCase()}:/${r}`);

/** 반환 null = 허용, 문자열 = 거부 사유 */
export function judge(role, tool, input, { root, cwd, scratchpad }) {
  const allow = ALLOW[role];
  if (!allow) return null;
  const inside = (p) => {
    const abs = isAbsolute(norm(p)) ? norm(p) : resolve(cwd || root, norm(p));
    const rel = relative(root, abs);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;                    // 저장소 밖(scratchpad 포함)
    if (scratchpad && !relative(scratchpad, abs).startsWith('..')) return null;
    return rel.split(sep).join('/');
  };
  const check = (p, verb) => { const rel = inside(p); return rel === null || allow.some((re) => re.test(rel)) ? null : `${role}는 ${verb} ${rel}에 쓰지 않는다 — 산출은 ${role === 'reviewer' ? '06-review.md(또는 lite FDR §5)·evidence/·docs/queue/' : 'evidence/·docs/queue/·lite FDR §4'}에만`; };
  if (tool === 'Bash') {
    const cmd = String(input.command || '');
    if (FORBIDDEN_RE.test(cmd)) return `${role}는 커밋·히스토리·의존성 목록을 바꾸지 않는다 — 발견은 기록으로 구현자에게`;
    for (const t of writeTargets(cmd)) { const r = check(t, '리다이렉션/복사로'); if (r) return r; }
    for (const t of destructiveTargets(cmd)) { const r = check(t, 'rm/sed -i/mv로'); if (r) return r; }
    return null;
  }
  if (/^(Write|Edit|NotebookEdit)$/.test(tool)) return check(input.file_path || input.notebook_path || '', '편집으로');
  return null;
}

if (process.argv.includes('--self-test')) {
  const root = resolve('/repo');
  const ctx = { root, cwd: root, scratchpad: resolve('/tmp/sp') };
  const cases = [
    ['reviewer', 'Bash', 'cat > docs/records/FDR-1/06-review.md <<EOF', null],
    ['reviewer', 'Bash', 'cat > docs/records/FDR-261016-x/fdr.md <<EOF', null],
    ['reviewer', 'Bash', 'echo x > src/app.ts', 'deny'],
    ['reviewer', 'Bash', 'echo x>src/app.ts', 'deny'],
    ['reviewer', 'Bash', 'sed -i s/a/b/ src/app.ts', 'deny'],
    ['reviewer', 'Bash', 'rm -rf dist', 'deny'],
    ['reviewer', 'Bash', 'git commit -m x', 'deny'],
    ['reviewer', 'Bash', 'git status && node .harness/scripts/lint.mjs', null],
    ['reviewer', 'Bash', 'node x.mjs > /tmp/sp/out.txt', null],
    ['reviewer', 'Bash', 'echo x > docs/records/FDR-1/03-impl.md', 'deny'],
    ['tester', 'Bash', 'npm test > docs/records/FDR-1/evidence/runs/unit.out', null],
    ['tester', 'Bash', 'node r.mjs > docs/records/HO-261016-x/evidence/r.json', null],
    ['reviewer', 'Bash', 'cat > docs/records/HO-261016-x/02-claude.md <<EOF', null],
    ['reviewer', 'Bash', 'echo x > docs/records/HO-261016-x/request.md', 'deny'],
    ['reviewer', 'Bash', 'echo x > docs/records/ADR-261016-x.md', 'deny'],
    ['tester', 'Bash', 'echo x > docs/records/FDR-1/06-review.md', 'deny'],
    ['tester', 'Bash', 'npm install lodash', 'deny'],
    ['tester', 'Bash', 'npm install', null],
    ['tester', 'Bash', 'cat > docs/queue/QA-261016-x.md <<EOF', null],
    ['tester', 'Write', { file_path: '/repo/src/a.ts' }, 'deny'],
    ['tester', 'Write', { file_path: '/repo/docs/records/FDR-1/evidence/runs/x.out' }, null],
    ['developer', 'Bash', 'echo x > src/app.ts', null],
  ];
  let fail = 0;
  for (const [role, tool, inp, want] of cases) {
    const got = judge(role, tool, typeof inp === 'string' ? { command: inp } : inp, ctx) ? 'deny' : null;
    if (got !== want) { fail++; console.error(`FAIL ${role} ${tool} ${JSON.stringify(inp)}: want ${want} got ${got}`); }
  }
  console.log(fail ? `self-test FAIL (${fail})` : `self-test OK (역할·경로 ${cases.length}건)`);
  process.exit(fail ? 1 : 0);
}

const role = process.argv.includes('--role') ? process.argv[process.argv.indexOf('--role') + 1] : (process.env.HARNESS_ROLE || '');
if (!role) process.exit(0);
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* */ }
let input = {}; try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }
const cwd = input.cwd || process.cwd();
let root = cwd; try { root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* git 밖 */ }
const reason = judge(role, input.tool_name || '', input.tool_input || {}, { root, cwd, scratchpad: input.scratchpad_dir || process.env.CLAUDE_SCRATCHPAD_DIR || '' });
if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[guard-role-write] ${reason}` } }));
process.exit(0);
