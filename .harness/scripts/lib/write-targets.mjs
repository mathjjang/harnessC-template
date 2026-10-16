// write-targets.mjs — Bash 명령에서 쓰기 대상 경로를 보수적으로 뽑는다 (guard-scratch · guard-reference · guard-role-write 공유).
// 리다이렉션(>, >>, 2>) · tee · touch · mkdir · cp/mv 목적지 · PowerShell Out-File/Set-Content/New-Item.
// 못 잡는 것: 변수 전개 경로, 프로그램 내부 쓰기(node -e "fs.writeFileSync"), sed -i(별도 — destructiveTargets).

const TOK = `("[^"]+"|'[^']+'|[^\\s;&|()]+)`;
const unq = (s) => s.replace(/^["']|["']$/g, '');

export function writeTargets(cmd) {
  const out = [];
  const s = String(cmd || '');
  for (const m of s.matchAll(new RegExp(`(?<![<>])\\d?>>?\\s*(?!-)${TOK}`, 'g'))) out.push(unq(m[1]));                      // 리다이렉션은 구분자 없이도(echo x>f)
  for (const m of s.matchAll(new RegExp(`(?:^|[\\s;&|(])(?:tee(?:\\s+-a)?|touch|mkdir(?:\\s+-p)?|Out-File(?:\\s+-FilePath)?|Set-Content(?:\\s+-Path)?|New-Item(?:\\s+-Path)?)\\s+(?!-)${TOK}`, 'gi'))) out.push(unq(m[1]));
  for (const m of s.matchAll(new RegExp(`(?:^|[\\s;&|(])(?:cp|mv)(?:\\s+-\\S+)*\\s+(?:"[^"]+"|'[^']+'|[^\\s;&|()]+)\\s+${TOK}`, 'g'))) out.push(unq(m[1]));
  return out.filter((t) => !/^(\/dev\/null|nul|&\d|-)$/i.test(t));
}

/** 파괴적 편집(rm · sed -i · mv 원본)의 대상 — 역할 훅이 허용 구역 밖이면 거부한다. */
export function destructiveTargets(cmd) {
  const out = [];
  const s = String(cmd || '');
  for (const m of s.matchAll(/(?:^|[\s;&|(])(?:rm|sed\s+-i\S*(?:\s+-e)?\s+(?:"[^"]*"|'[^']*'|\S+))((?:\s+(?!-)(?:"[^"]+"|'[^']+'|[^\s;&|()]+))+)/g)) for (const t of m[1].trim().split(/\s+/)) out.push(unq(t));
  for (const m of s.matchAll(/(?:^|[\s;&|(])rm(?:\s+-\S+)+((?:\s+(?:"[^"]+"|'[^']+'|[^\s;&|()]+))+)/g)) for (const t of m[1].trim().split(/\s+/)) out.push(unq(t));
  for (const m of s.matchAll(new RegExp(`(?:^|[\\s;&|(])mv(?:\\s+-\\S+)*\\s+${TOK}\\s+(?:"[^"]+"|'[^']+'|[^\\s;&|()]+)`, 'g'))) out.push(unq(m[1]));
  return [...new Set(out)];
}

/** 역할 훅이 통째로 막는 명령 — 리뷰어·테스터는 커밋·히스토리·의존성 목록을 바꾸지 않는다. */
export const FORBIDDEN_RE = /(?:^|[\s;&|(])(?:git\s+(?:commit|push|checkout|switch|reset|rm|mv|rebase|merge|stash|cherry-pick|tag|branch\s+-[dDmM])|(?:npm|pnpm|yarn)\s+(?:i|install|add|uninstall|remove|rm)\s+(?!-)[^\s-])/;

if (process.argv[1] && /write-targets\.mjs$/.test(process.argv[1]) && process.argv.includes('--self-test')) {
  const w = writeTargets('node x.mjs > .tmp-out.log 2>&1; echo hi | tee -a app/build.log; cp a b.txt; mkdir -p .scratch/s; Out-File -FilePath C:\\x\\y.log; cat > docs/a.md <<EOF; echo x>src/b.ts');
  const d = destructiveTargets('rm -rf dist src/x.ts; sed -i s/a/b/ src/y.ts; mv src/z.ts src/w.ts');
  const okW = JSON.stringify([...w].sort()) === JSON.stringify(['.tmp-out.log', 'app/build.log', 'b.txt', '.scratch/s', 'C:\\x\\y.log', 'docs/a.md', 'src/b.ts'].sort());
  const okD = JSON.stringify([...d].sort()) === JSON.stringify(['dist', 'src/x.ts', 'src/y.ts', 'src/z.ts'].sort());
  const okF = FORBIDDEN_RE.test('git commit -m x') && FORBIDDEN_RE.test('npm install lodash') && !FORBIDDEN_RE.test('npm install') && !FORBIDDEN_RE.test('git status') && !FORBIDDEN_RE.test('node .harness/scripts/lint.mjs');
  console.log(okW && okD && okF ? 'self-test OK (쓰기 7 · 파괴 4 · 금지 5)' : `self-test FAIL w=${JSON.stringify(w)} d=${JSON.stringify(d)} f=${okF}`);
  process.exit(okW && okD && okF ? 0 : 1);
}
