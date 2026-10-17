// upstream.mjs — 템플릿 출처 해석 (sync-core · mockup-diff init · harness-status가 공유). 사유 — 판정은 호출자가 한다.
// 출처 표기: <로컬 경로> | <git 주소>[@<태그·브랜치>] | <owner>/<repo>[@<ref>] (GitHub) | gh:<owner>/<repo>[@<ref>]
// harness.yaml `upstream:` — repo · ref(릴리스 태그) · mockup_repo · mockup_ref. 인자 없는 sync-core가 repo@ref를 받는다.
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function readUpstream(root) {
  const hy = existsSync(join(root, 'harness.yaml')) ? readFileSync(join(root, 'harness.yaml'), 'utf8') : '';
  const block = (hy.match(/^upstream:[^\n]*\n((?:[ \t]+.*\n?)*)/m) || [])[1] || '';
  const v = (k) => ((block.match(new RegExp(`^\\s*${k}:\\s*([^#\\n]*?)\\s*(#.*)?$`, 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
  return { repo: v('repo'), ref: v('ref'), mockup_repo: v('mockup_repo'), mockup_ref: v('mockup_ref') };
}

/** 표기 → { kind: 'path'|'git', path?, url?, ref? } */
export function parseSource(spec, { cwd = process.cwd() } = {}) {
  if (!spec) throw new Error('출처가 없다 — --from <경로|주소@태그> 또는 harness.yaml upstream.repo/ref');
  const local = resolve(cwd, spec);
  if (existsSync(local)) return { kind: 'path', path: local };
  let s = String(spec).trim(), ref = '';
  const at = s.lastIndexOf('@'); if (at > 0 && !/^git@[^:]*$/.test(s.slice(0, at)) && !s.slice(at).includes('/')) { ref = s.slice(at + 1); s = s.slice(0, at); }
  if (/^gh:/.test(s)) s = s.slice(3);
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = `https://github.com/${s}`;
  if (!/^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(s)) throw new Error(`출처를 해석할 수 없다: ${spec} — 로컬 경로가 없고 git 주소도 아니다`);
  return { kind: 'git', url: s, ref };
}

/** 출처를 읽을 수 있는 폴더로 — git이면 임시 폴더에 shallow clone. 반환 { dir, label, sha, cleanup() } */
export function fetchSource(spec, opts = {}) {
  const src = parseSource(spec, opts);
  if (src.kind === 'path') { let sha = ''; try { sha = execSync('git rev-parse HEAD', { cwd: src.path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* git 아님 */ } return { dir: src.path, label: src.path, sha, cleanup() {} }; }
  const dir = mkdtempSync(join(tmpdir(), 'harness-upstream-'));
  try { execSync(`git clone -q --depth 1 ${src.ref ? `--branch "${src.ref}" ` : ''}"${src.url}" "${dir}"`, { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { rmSync(dir, { recursive: true, force: true }); throw new Error(`clone 실패: ${src.url}${src.ref ? '@' + src.ref : ''} — ${String(e.stderr || e.message).trim().split('\n').pop()}`); }
  const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, label: `${src.url}@${src.ref || 'HEAD'}`, sha, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
}

/** 원격의 릴리스 태그(vX.Y.Z) 중 가장 높은 것 — 없거나 원격이 아니면 '' */
export function latestTag(spec, opts = {}) {
  const src = parseSource(spec, opts); const url = src.kind === 'path' ? src.path : src.url;
  let out = ''; try { out = execSync(`git ls-remote --tags --refs "${url}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
  const tags = [...out.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gm)].map((m) => m[1]);
  return tags.sort((a, b) => cmpVer(a, b)).pop() || '';
}
export const cmpVer = (a, b) => { const p = (x) => String(x).replace(/^v/, '').split('.').map(Number); const [x, y] = [p(a), p(b)]; for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

if (process.argv[1] && /upstream\.mjs$/.test(process.argv[1]) && process.argv.includes('--self-test')) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const fails = [];
  const t = mkdtempSync(join(tmpdir(), 'upstream-st-'));
  try {
    const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${m}: ${JSON.stringify(a)}`); };
    eq(parseSource('mathjjang/harnessC-template@v0.3.3', { cwd: t }), { kind: 'git', url: 'https://github.com/mathjjang/harnessC-template', ref: 'v0.3.3' }, 'owner/repo@tag');
    eq(parseSource('gh:o/r', { cwd: t }), { kind: 'git', url: 'https://github.com/o/r', ref: '' }, 'gh:');
    eq(parseSource('https://github.com/o/r.git@main', { cwd: t }), { kind: 'git', url: 'https://github.com/o/r.git', ref: 'main' }, 'https@ref');
    eq(parseSource('git@github.com:o/r.git', { cwd: t }), { kind: 'git', url: 'git@github.com:o/r.git', ref: '' }, 'ssh 주소의 @는 ref가 아니다');
    eq(parseSource(t, { cwd: t }).kind, 'path', '로컬 경로');
    try { parseSource('no-such-thing', { cwd: t }); fails.push('해석 불가 통과'); } catch { /* 기대 */ }
    if (cmpVer('v0.10.0', 'v0.9.9') <= 0 || cmpVer('v1.0.0', 'v1.0.0') !== 0) fails.push('cmpVer');
    // 로컬 "원격"(file://) — 태그 둘, fetch는 지정 태그를 받고 latestTag는 높은 쪽
    const g = (c, cwd) => execSync(`git -c user.email=t@t -c user.name=t ${c}`, { cwd, stdio: 'ignore' });
    const r = join(t, 'remote'); mkdirSync(r); g('init -q -b main', r);
    writeFileSync(join(r, 'f'), 'one'); g('add -A', r); g('commit -q -m 1', r); g('tag v0.9.0', r);
    writeFileSync(join(r, 'f'), 'two'); g('commit -qam 2', r); g('tag v0.10.0', r);
    const url = 'file:///' + r.replace(/\\/g, '/');
    const f = fetchSource(`${url}@v0.9.0`, { cwd: t }); if (readFileSync(join(f.dir, 'f'), 'utf8') !== 'one' || !/@v0\.9\.0$/.test(f.label) || f.sha.length !== 40) fails.push('fetch 태그'); f.cleanup(); if (existsSync(f.dir)) fails.push('cleanup');
    if (latestTag(url, { cwd: t }) !== 'v0.10.0') fails.push('latestTag: ' + latestTag(url, { cwd: t }));
    try { fetchSource(`${url}@v9.9.9`, { cwd: t }); fails.push('없는 태그 통과'); } catch { /* 기대 */ }
    const hy = join(t, 'proj'); mkdirSync(hy); writeFileSync(join(hy, 'harness.yaml'), 'upstream:\n  repo: https://github.com/a/b\n  ref: v1.2.3   # 태그\n  mockup_repo: a/m\n  mockup_ref: v0.2.0\nmetrics:\n  enabled: true\n');
    eq(readUpstream(hy), { repo: 'https://github.com/a/b', ref: 'v1.2.3', mockup_repo: 'a/m', mockup_ref: 'v0.2.0' }, 'readUpstream');
  } catch (e) { fails.push('예외: ' + e.message); }
  rmSync(t, { recursive: true, force: true });
  console.log(fails.length ? 'self-test FAIL: ' + fails.join(' · ') : 'self-test OK (출처 표기 6 · 태그 clone · 최신 태그 · 없는 태그 거부 · upstream 설정)');
  process.exit(fails.length ? 1 : 0);
}
