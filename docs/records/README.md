# docs/records — 그 밖의 기록 (역사 · 고치지 않는다)

`<TYPE>-<YYMMDD>-<slug>`. 자주 여는 네 종류는 자기 폴더에 있다 — ADR `../decisions/` · RFC `../research/` · FDR `../features/` · HO `../handoffs/`. 전체 목록은 `../INDEX.generated.md`.

| 접두 | 종류 | 형태 |
|---|---|---|
| `PLAN-` | 큰 요청의 분해 | 파일 |
| `MTG-` | 회의 내부 자료 (브리프·결과보고서·전사) — 공유본은 협업 저장소 같은 ID | 폴더 |
| `INC-` | 사고 | 파일 |
| `RETRO-` | 방법론 회고 → 템플릿 REP 제안 | 파일 |

생성은 `node .harness/scripts/new-doc.mjs <plan|inc|retro> <slug> "<제목>"` (mtg는 `--ref collab`). 손 복사 금지.
