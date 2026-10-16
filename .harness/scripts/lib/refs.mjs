// refs.mjs — harness.yaml `references:` 파서 (new-doc · harness-status · guard-reference가 공유).
// 지원 형식: 한 줄 흐름 매핑만.  - { path: ../x, role: collab, trust: external, mode: read-write, writable: [a/, b/], ask_words: [원가] }
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

if (process.argv[1] && /refs\.mjs$/.test(process.argv[1]) && process.argv.includes('--self-test')) {
  const sample = 'tier: S\nreferences:                 # 설명\n  - { path: ../collab, role: collab, trust: external, mode: read-write, writable: [meetings/, decisions/], ask_words: [원가, 공수] }\n  - { path: ../ro, mode: read-only, pin: abc }\nhuman_only: x\n';
  const r = parseReferences(sample);
  const ok = r.length === 2 && r[0].role === 'collab' && r[0].writable.length === 2 && r[0].ask_words[1] === '공수' && r[1].pin === 'abc' && parseReferences('references: []\n').length === 0;
  console.log(ok ? 'self-test OK (references 2건 파싱)' : 'self-test FAIL ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
}
