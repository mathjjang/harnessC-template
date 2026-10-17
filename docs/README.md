# docs/ — 이 프로젝트의 문서 (폴더 여덟, 고정)

| 폴더 | 무엇 | 늘어나는 단위 |
|---|---|---|
| `requirements/` | 입력 — 접수(INTAKE)·brief·scope·REQ·open-questions | 파일 |
| `decisions/` | 결정(역사) — `ADR-<YYMMDD>-<slug>.md` 되돌리기 비싼 결정 | 파일 |
| `research/` | 탐구(역사) — `RFC-<YYMMDD>-<slug>/` `rfc.md` + `evidence/` | 폴더 |
| `features/` | 기능 개발 기록(역사) — `FDR-<YYMMDD>-<slug>/` lite `fdr.md` 또는 standard 7단계 + `evidence/` | 폴더 |
| `handoffs/` | 다른 에이전트와 주고받기(역사) — `HO-<YYMMDD>-<slug>/` `request.md` · 응답 · `evidence/` | 폴더 |
| `records/` | 그 밖의 과정(역사) — `PLAN-` 분해 · `MTG-` 회의(내부) · `INC-` 사고 · `RETRO-` 회고 | 파일 또는 폴더 |
| `specs/` | 현재 참인 것 — 제품 동작(capability 폴더) · 데이터 소스 조건·프롬프트 계약 등(파일) | 파일 |
| `queue/` | 열린 것 — `PG-` 정책 공백 · `QA-` 사람 발견 결함 · `HR-` 사람 실행 요청 · `BL-` 이월 | 파일 |

새 폴더는 만들 수 없다(훅·lint ⑬). 기록의 자리는 종류가 정하고(`.harness/scripts/lib/records.mjs`), `INDEX.generated.md`가 한 곳에 모아 보여 준다. 생성은 `node .harness/scripts/new-doc.mjs <종류> <slug> "<제목>"`.
