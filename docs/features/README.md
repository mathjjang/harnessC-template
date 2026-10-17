# docs/features — 기능 개발 기록 (역사 · 고치지 않는다)

`FDR-<YYMMDD>-<slug>/` — lite `fdr.md` + `evidence/` 또는 standard `01-spec … 07-close` + `manifest.yaml` + `evidence/runs/`. 프로파일은 티어가 정한다(`.harness/HARNESS.md` §4). 상태 `draft → in-progress → shipped → closed`. closed는 `01-spec` 델타가 `../specs/`에 병합된 뒤에만(lint ⑩).

생성 `node .harness/scripts/new-doc.mjs fdr <slug> "<제목>"` → `work.mjs start <ID>`로 worktree를 연다. scope: 머리말이 커밋 게이트의 기준이다.

확정 목업이 있는 화면은 `mockup/`(승격 사본 + `rev.yaml` + `diff-scenarios.json`)과 `evidence/mockup-diff/rev<N>/`(대조 기록)가 생긴다 — `.harness/runbooks/mockup.md`.
