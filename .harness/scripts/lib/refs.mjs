// refs.mjs — harness.yaml `references:` 파서 (new-doc · harness-status · guard-reference가 공유).
// 지원 형식: 한 줄 흐름 매핑만.  - { path: ../x, role: collab, trust: external, mode: read-write, writable: [a/, b/], ask_words: [원가] }
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

export const yamlScalar = (text, key) => ((text.match(new RegExp(`^\\s*${key}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim();

export function parseReferences(hy) {
  const m = String(hy || '').match(/^references:[^\n]*\n((?:[ \t]+-[^\n]*\n?)*)/m);
  if (!m || !m[1]) return [];
  const out = [];
  for (const line of m[1].split('\n')) {
    const body = (line.match(/^\s*-\s*\{(.*)\}\s*(#.*)?$/) || [])[1];
    if (!body) continue;
    const o = {};
    for (const kv of body.matchAll(/([a-z_]+):\s*(\[[^\]]*\]|[^,}]+)/g)) {
      const v = kv[2].trim();
      o[kv[1]] = v.startsWith('[') ? v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : v.replace(/^["']|["']$/g, '');
    }
    if (o.path) out.push(o);
  }
  return out;
}

export function findReference(hy, role) { return parseReferences(hy).find((r) => r.role === role) || null; }

/** 주 작업 트리 루트 — worktree(.worktrees/<ID>) 안에서도 형제 체크아웃(../x)은 주 트리 기준이다. git 밖이면 root 그대로 */
export function mainRoot(root) {
  try {
    const q = (a) => resolve(execSync(`git rev-parse --path-format=absolute ${a}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    if (q('--show-toplevel').toLowerCase() !== resolve(root).toLowerCase()) return root;   // root가 저장소 루트가 아니다(다른 저장소 안의 임시 폴더 등) — 건드리지 않는다
    const gitDir = q('--git-dir'), common = q('--git-common-dir');
    return gitDir === common ? root : dirname(common);                                    // linked worktree일 때만 주 트리로
  } catch { return root; }
}
/** 참조 저장소의 절대 경로. embedded(개발 저장소 안에 추적되는 폴더)는 작업 트리마다 있으므로 현재 root 기준, 그 밖(형제·중첩 체크아웃)은 주 트리 기준 */
export function refPath(root, ref) { return resolve(String(ref.embedded) === 'true' ? root : mainRoot(root), ref.path); }

if (process.argv[1] && /refs\.mjs$/.test(process.argv[1]) && process.argv.includes('--self-test')) {
  const sample = 'tier: S\nreferences:                 # 설명\n  - { path: ../collab, role: collab, trust: external, mode: read-write, writable: [meetings/, decisions/], ask_words: [원가, 공수] }\n  - { path: ../ro, mode: read-only, pin: abc }\nhuman_only: x\n';
  const r = parseReferences(sample);
  let ok = r.length === 2 && r[0].role === 'collab' && r[0].writable.length === 2 && r[0].ask_words[1] === '공수' && r[1].pin === 'abc' && parseReferences('references: []\n').length === 0;
  // worktree 안에서 형제 참조는 주 트리 기준 · embedded는 현재 트리 기준
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const t = mkdtempSync(join(tmpdir(), 'refs-')); const g = (c, cwd = join(t, 'dev')) => execSync(`git ${c}`, { cwd, stdio: 'ignore' });
  let wt = '';
  try {
    execSync('git init -q -b main dev', { cwd: t, stdio: 'ignore' }); writeFileSync(join(t, 'dev', 'a'), 'a'); g('add -A'); g('-c user.email=t@t -c user.name=t commit -q -m i'); g(`worktree add -q -b w "${join(t, 'dev', '.worktrees', 'X')}"`); wt = join(t, 'dev', '.worktrees', 'X');
    const sib = refPath(wt, { path: '../mk' }), emb = refPath(wt, { path: 'mockups', embedded: 'true' });
    const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();   // Windows는 TEMP/Temp처럼 대소문자가 섞여 돌아온다
    if (!same(sib, join(t, 'mk')) || !same(emb, join(wt, 'mockups')) || !same(refPath(join(t, 'dev'), { path: '../mk' }), join(t, 'mk')) || !same(mainRoot(t), t)) ok = false;
  } catch (e) { ok = false; console.error(e.message); }
  try { if (wt) g(`worktree remove --force "${wt}"`); } catch { /* */ } rmSync(t, { recursive: true, force: true });
  console.log(ok ? 'self-test OK (references 2건 파싱 · worktree 안 형제 참조는 주 트리 기준 · embedded는 현재 트리)' : 'self-test FAIL ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
}
