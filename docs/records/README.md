# docs/records — 모든 기록 (역사 · 고치지 않는다)

`<TYPE>-<YYMMDD>-<slug>`. 이름순 정렬이 곧 종류별 묶음이다. 종류별 목록은 `../INDEX.generated.md`.

| 접두 | 종류 | 형태 |
|---|---|---|
| `ADR-` | 되돌리기 비싼 결정 (REP) | 파일 |
| `RFC-` | 결정·구현 전 탐구 | 폴더 `rfc.md` + `evidence/` |
| `PLAN-` | 큰 요청의 분해 | 파일 |
| `FDR-` | 기능 개발 기록 | 폴더 — lite `fdr.md` / standard `01-spec…07-close` + `manifest.yaml` + `evidence/runs/` |
| `HO-` | 다른 에이전트와 주고받기 | 폴더 `request.md` · `NN-<에이전트>.md` · `result.md` + `evidence/` |
| `MTG-` | 회의 내부 자료 (브리프·결과보고서·전사) — 공유본은 협업 저장소 같은 ID | 폴더 |
| `INC-` | 사고 | 파일 |
| `RETRO-` | 방법론 회고 → 템플릿 REP 제안 | 파일 |

생성은 `node .harness/scripts/new-doc.mjs <adr|rfc|plan|fdr|ho|inc|retro> <slug> "<제목>"`. 손 복사 금지.
