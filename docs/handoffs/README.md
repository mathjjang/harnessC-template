# docs/handoffs — 다른 에이전트와 주고받기 (역사 · 고치지 않는다)

`HO-<YYMMDD>-<slug>/` — `request.md`(보내는 쪽) · `NN-<에이전트>.md`(받는 쪽 응답, 차례마다 새 파일) · `result.md` + `evidence/`. 상태 `open → taken → answered → closed`(lint ⑪). 남의 파일은 고치지 않는다.

생성 `node .harness/scripts/new-doc.mjs ho <slug> "<제목>"` · 응답 `new-doc.mjs reply <HO-ID> --agent "<자기(모델)>"`. 절차 `.harness/runbooks/handoff.md`.
