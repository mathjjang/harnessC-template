---
paths:
  - "docs/**"
---

# docs/ 작업 규칙 (경로 범위 — docs/ 파일을 다룰 때만 로드)

- 기록(RFC·ADR·FDR·PLAN·PG·INC·HO)은 `node .harness/scripts/new-doc.mjs`로 만든다. 템플릿 손 복사 금지.
- 머리 `작성: <에이전트(모델)> · <날짜>`와 개정 이력 표를 유지한다. 모델명은 실행 환경이 명시한 것만.
- `*.generated.md`·`docs/specs/index.md`·`.harness/init-manifest.json`은 생성물. 고치려면 원천을 고치고 `node .harness/scripts/build-index.mjs`.
- 스펙(`docs/specs/`)은 현재 동작의 정본. 역사(FDR)는 고치지 않는다. 틀린 스펙은 lite FDR 한 장으로 고친다.
- 큐 항목의 머리말 스키마(id·source·severity·blocking·owner·due·state·decision·sync)를 바꾸지 않는다.
- 다른 저장소 문서를 복사하지 않는다. 링크한다.
