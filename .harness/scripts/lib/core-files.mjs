// core-files.mjs — "모든 프로젝트에서 동일한" 코어 파일 목록과 해시 (init · sync-core · lint ⑫가 공유).
// 여기 든 경로는 템플릿의 사본이다. 프로젝트에서 고치면 lint ⑫가 막는다 — 고치려면 템플릿에서 고치고 sync-core로 내려받는다.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const CORE_PATHS = [
  '.harness/HARNESS.md', '.harness/README.md', '.harness/catalog.yaml', '.harness/runbooks', '.harness/scripts', '.harness/templates',
  '.claude/settings.json', '.claude/hooks', '.claude/agents', '.claude/skills', '.claude/rules',
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md',
];
export const CORE_EXCLUDE = /(^|\/)(init-manifest\.json|tiers\/|node_modules\/|\.gitkeep$)/;

export const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export function coreFiles(root) {
  const out = [];
  const walk = (p) => { for (const e of readdirSync(p, { withFileTypes: true })) { const f = join(p, e.name); e.isDirectory() ? walk(f) : out.push(f); } };
  for (const rel of CORE_PATHS) { const p = join(root, rel); if (!existsSync(p)) continue; statSync(p).isDirectory() ? walk(p) : out.push(p); }
  return out.map((f) => relative(root, f).split(sep).join('/')).filter((f) => !CORE_EXCLUDE.test(f)).sort();
}

/** { 'path': sha256 } — LF 정규화(.gitattributes와 무관하게 결정적) */
export function hashCore(root) {
  const h = {};
  for (const f of coreFiles(root)) h[f] = sha(readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'));
  return h;
}
