# docs/specs — 지금 참인 것

| 형태 | 무엇 | 생성 |
|---|---|---|
| `<capability>/spec.md` | 제품의 현재 동작 — FDR `01-spec` 델타(ADDED/MODIFIED/REMOVED)가 close 시 병합된다(v0.1: 손 병합 + `last_merge` 갱신) | `new-doc.mjs spec <slug> "<제목>"` |
| `<name>.md` | 기능을 넘어 공유되는 조건 — 외부 데이터 소스(제공처·인증·쿼터·갱신 주기·스키마·실호출 기록·대체 경로) · LLM 프롬프트 계약(버전·입력/출력 스키마·금지·예산·평가 세트) 등 | 파일로 바로 |

- 시나리오 형식: WHEN/THEN · 단언 등급 A/B/C · 계층 · 근거 RUN. C 단독은 통과가 아니다.
- 규칙(`rules/`)은 "지켜야 할 것", 스펙은 "지금 그런 것". 역사(FDR)는 고치지 않는다. 틀린 스펙은 lite FDR 한 장으로 고친다.
- `index.md`는 생성물(`node .harness/scripts/build-index.mjs`).
