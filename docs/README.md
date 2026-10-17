# docs/ — 이 프로젝트의 문서 (폴더 넷, 고정)

| 폴더 | 무엇 | 늘어나는 단위 |
|---|---|---|
| `requirements/` | 입력 — 접수(INTAKE)·brief·scope·REQ·open-questions | 파일 |
| `records/` | 과정(역사) — `<TYPE>-<YYMMDD>-<slug>` : ADR 결정 · RFC 탐구 · PLAN 분해 · FDR 기능 · HO 핸드오프 · MTG 회의(내부) · INC 사고 · RETRO 회고. 증거는 각 폴더의 `evidence/` | 파일 또는 폴더 |
| `specs/` | 현재 참인 것 — 제품 동작(capability 폴더) · 데이터 소스 조건·프롬프트 계약 등(파일) | 파일 |
| `queue/` | 열린 것 — `PG-` 정책 공백 · `QA-` 사람 발견 결함 · `HR-` 사람 실행 요청 · `BL-` 이월 | 파일 |

새 폴더는 만들 수 없다(훅·lint ⑬). 종류는 이름이 말하고, `INDEX.generated.md`가 종류별로 모아 보여 준다. 생성은 `node .harness/scripts/new-doc.mjs <종류> <slug> "<제목>"`.
