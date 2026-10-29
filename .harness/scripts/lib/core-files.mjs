// core-files.mjs — "모든 프로젝트에서 동일한" 코어 파일 목록과 해시 (init · sync-core · lint ⑫가 공유).
// 여기 든 경로는 템플릿의 사본이다. 프로젝트에서 고치면 lint ⑫가 막는다 — 고치려면 템플릿에서 고치고 sync-core로 내려받는다.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const CORE_PATHS = [
  '.harness/HARNESS.md', '.harness/README.md', '.harness/LICENSE', '.harness/catalog.yaml', '.harness/runbooks', '.harness/scripts', '.harness/templates',
  '.claude/settings.json', '.claude/hooks', '.claude/agents', '.claude/rules',
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md',
  '.github/workflows/harness.yml',   // 서버 쪽 게이트 — 프로젝트의 다른 워크플로는 건드리지 않는다(파일 하나만)
  // .claude/skills · .agents/skills · .gemini/commands 는 코어가 아니다 — 런북(코어·프로젝트·embedded 목업)에서 harness-build가 만드는 생성물. 정본인 .harness/runbooks 가 해시된다
];
export const CORE_EXCLUDE = /(^|\/)(init-manifest\.json|tiers\/|node_modules\/|\.gitkeep$)/;

export const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** 어떤 템플릿(또는 프로젝트) 사본이 선언한 CORE_PATHS — 그 사본의 이 파일에서 읽는다. sync-core가 **새 버전의 목록**으로 복사해야 새로 코어가 된 파일이 한 번에 내려온다(옛 목록이면 다음 동기화에야 온다). 못 읽으면 이 모듈의 목록 */
export function corePathsOf(root) {
  const p = join(root, '.harness', 'scripts', 'lib', 'core-files.mjs'); if (!existsSync(p)) return CORE_PATHS;
  const m = readFileSync(p, 'utf8').match(/export const CORE_PATHS = \[([\s\S]*?)\];/); if (!m) return CORE_PATHS;
  const list = [...m[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return list.length ? list : CORE_PATHS;
}

export function coreFiles(root, paths = CORE_PATHS) {
  const out = [];
  const walk = (p) => { for (const e of readdirSync(p, { withFileTypes: true })) { const f = join(p, e.name); e.isDirectory() ? walk(f) : out.push(f); } };
  for (const rel of paths) { const p = join(root, rel); if (!existsSync(p)) continue; statSync(p).isDirectory() ? walk(p) : out.push(p); }
  return out.map((f) => relative(root, f).split(sep).join('/')).filter((f) => !CORE_EXCLUDE.test(f)).sort();
}

/** { 'path': sha256 } — LF 정규화(.gitattributes와 무관하게 결정적) */
export function hashCore(root, paths = CORE_PATHS) {
  const h = {};
  for (const f of coreFiles(root, paths)) h[f] = sha(readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'));
  return h;
}
