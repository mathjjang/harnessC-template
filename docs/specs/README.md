# docs/specs — 현재 동작의 정본

- capability 하나 = 폴더 하나 (`<slug>/spec.md`). 생성: `node .harness/scripts/new-doc.mjs spec <slug> "<제목>"`.
- FDR `01-spec`은 델타(ADDED/MODIFIED/REMOVED)로 쓰고, close 시 여기 병합된다(v0.1: 손 병합 + `last_merge` 갱신. `fdr-close.mjs`는 planned).
- 시나리오 형식: WHEN/THEN · 단언 등급 A/B/C · 계층 · 근거 RUN. C 단독은 통과가 아니다.
- `index.md`는 생성물(`node .harness/scripts/build-index.mjs`).
