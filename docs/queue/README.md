# docs/queue — 사람이 결정·실행해야 할 것 (한 스키마, 한 폴더)

| 접두 | 무엇 | 생성 |
|---|---|---|
| `PG-` | 정의되지 않은 기대값(정책 공백) | `new-doc.mjs pg <slug> "<질문>"` |
| `QA-` | 사람이 써보다 발견한 결함·기획수정 요청 — 원재료(캡처·증상·되어야 할 모습)만, 분류는 에이전트가. 리뷰어≠수정자 | `new-doc.mjs qa …` |
| `HR-` | 에이전트가 못 하는 검증 요청 — 머리말 `axis:`는 `rules/human-only.yaml` 축만(lint ⑨) | `new-doc.mjs hr …` |
| `BL-` | 지금 하면 안 되는 것 (사실·왜·해소 조건·하지 말 것) | `new-doc.mjs bl …` |

머리말 공통 스키마: `id · source · severity · blocking · owner · due · state(open|decided|closed) · decision · sync`.
집계는 `INDEX.generated.md`(`node .harness/scripts/build-index.mjs`). 결정 전에는 어느 정본도 고치지 않는다. HR은 환경별 세션으로 묶어 처리한다.
