# docs/research — 탐구 (역사 · 고치지 않는다)

`RFC-<YYMMDD>-<slug>/` — `rfc.md` + `evidence/`. 접근법이 정해지지 않았거나 실현성을 모를 때 타임박스로 탐구한다. 상태 `Open → Concluded`. 결론이 결정이면 ADR, 기능이면 `work.mjs promote`로 FDR.

생성 `node .harness/scripts/new-doc.mjs rfc <slug> "<제목>"`. spike 코드는 `rfc/<ID>` 브랜치에만 — main에 병합되지 않는다(`.harness/runbooks/work.md`).
