# docs/queue — 사람이 결정·실행해야 할 것의 단일 스키마

| 출처 | 폴더 | 무엇 | ID |
|---|---|---|---|
| pg | `pg/` | 정의되지 않은 기대값(정책 공백) | PG-YYMMDD-slug |
| qa | `qa/` | 사람이 써보다 발견한 결함·기획수정 요청 | QA-YYMMDD-slug |
| human-run | `human-run/` | 에이전트가 못 하는 검증 요청 (`human-only.yaml` 축만) | HR-YYMMDD-slug |
| backlog | `backlog/` | 지금 하면 안 되는 것 (해소 조건 포함) | BL-YYMMDD-slug |

머리말 공통 스키마: `id · source · severity · blocking · owner · due · state(open|decided|closed) · decision · sync`.
집계는 `INDEX.generated.md`(`node scripts/build-index.mjs`). 결정 전에는 어느 정본도 고치지 않는다. human-run은 환경별 세션으로 묶어 처리한다.
