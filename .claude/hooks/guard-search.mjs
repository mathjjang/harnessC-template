#!/usr/bin/env node
// guard-search.mjs — PreToolUse 훅 (Bash). 셸 검색이 worktree·임시 폴더로 들어가지 않게 **명령을 고쳐 준다** (ADR-261017-work-isolation).
//   rg · Claude Grep · VS Code는 .gitignore를 존중하지만 GNU grep -r / find 는 아니다 — 규칙 문장("rg를 써라") 대신 기계가 받는다.
//   grep -r|-R …  →  --exclude-dir=.worktrees --exclude-dir=.scratch --exclude-dir=node_modules --exclude-dir=.git 를 붙인다 (이미 있으면 그대로)
//   find <dir> …  →  <dir> 바로 뒤에 \( -path '*/.worktrees' -o -path '*/.scratch' -o -path '*/node_modules' -o -path '*/.git' \) -prune -o 를 붙이고 끝에 -print (이미 -prune이 있으면 그대로)
// 거부하지 않는다 — updatedInput으로 바꿔 실행시킨다. 자기 검사: --self-test
import { readFileSync } from 'node:fs';

const SKIP = ['.worktrees', '.scratch', 'node_modules', '.git'];

export function rewrite(cmd) {
  let out = String(cmd || '');
  // grep -r / -R (옵션 뭉치 -rn, -Rin 포함). 이미 --exclude-dir 이 있으면 손대지 않는다
  out = out.replace(/(^|[\s;&|(])(grep)(\s+(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive|--dereference-recursive)(?:\s+-[^\s]+)*)/g, (m, pre, g, opts) => (/--exclude-dir=/.test(out) ? m : `${pre}${g}${opts} ${SKIP.map((d) => `--exclude-dir=${d}`).join(' ')}`));
  // find <dir> … : -prune 이 이미 있으면 그대로
  out = out.replace(/(^|[\s;&|(])find\s+((?:"[^"]+"|'[^']+'|[^\s;&|()-][^\s;&|()]*)(?:\s+(?:"[^"]+"|'[^']+'|[^\s;&|()-][^\s;&|()]*))*)(\s|$)/g, (m, pre, dirs, tail) => {
    if (/-prune/.test(out)) return m;
    const rest = out.slice(out.indexOf(m) + m.length);
    const hasPrint = /-print|-exec|-delete|-ls|-print0/.test(rest);
    return `${pre}find ${dirs} \\( ${SKIP.map((d) => `-path '*/${d}'`).join(' -o ')} \\) -prune -o${tail}`.replace(/-o\s*$/, '-o ') + (hasPrint ? '' : '');
  });
  // find 에 -print 류가 없으면 -prune -o 뒤 식이 끝에서 -print 를 잃으므로 보강
  if (/\)\s-prune -o\s*$/.test(out)) out += '-print';
  else if (/\)\s-prune -o\s/.test(out) && !/-print|-exec|-delete|-ls/.test(out.slice(out.indexOf('-prune -o')))) out = out.replace(/(\)\s-prune -o\s[^;&|]*?)(\s*(?:[;&|]|$))/, '$1 -print$2');
  return out;
}

if (process.argv.includes('--self-test')) {
  const cases = [
    ['grep -rn "foo" .', /grep -rn --exclude-dir=\.worktrees --exclude-dir=\.scratch --exclude-dir=node_modules --exclude-dir=\.git "foo" \./],
    ['grep -Rin foo src', /--exclude-dir=\.worktrees/],
    ['grep -rn --exclude-dir=.worktrees foo .', /^grep -rn --exclude-dir=\.worktrees foo \.$/],
    ['grep foo file.txt', /^grep foo file\.txt$/],
    ['rg foo', /^rg foo$/],
    ['find . -name "*.mjs"', /^find \. \\\( -path '\*\/\.worktrees' -o -path '\*\/\.scratch' -o -path '\*\/node_modules' -o -path '\*\/\.git' \\\) -prune -o -name "\*\.mjs" -print$/],
    ['find docs -type f -print', /-prune -o -type f -print$/],
    ['find . -path ./.worktrees -prune -o -name x -print', /^find \. -path \.\/\.worktrees -prune -o -name x -print$/],
    ['ls -la | grep -r x .', /ls -la \| grep -r --exclude-dir=/],
    ['git status && grep -rl TODO src', /grep -rl --exclude-dir=\.worktrees .* TODO src/],
  ];
  let fail = 0;
  for (const [inp, re] of cases) { const got = rewrite(inp); if (!re.test(got)) { fail++; console.error(`FAIL ${inp}\n  → ${got}`); } }
  console.log(fail ? `self-test FAIL (${fail})` : `self-test OK (grep·find 재작성 ${cases.length}건)`);
  process.exit(fail ? 1 : 0);
}

let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch { /* */ }
let input = {}; try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }
if (input.tool_name !== 'Bash') process.exit(0);
const cmd = String((input.tool_input || {}).command || '');
const next = rewrite(cmd);
if (next !== cmd) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: '[guard-search] .worktrees/·.scratch/·node_modules 제외 추가', updatedInput: { ...input.tool_input, command: next } } }));
process.exit(0);
