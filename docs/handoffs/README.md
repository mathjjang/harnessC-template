# docs/handoffs — 에이전트 간 주고받기

다른 세션·다른 회사 에이전트(Codex·Gemini 등)에게 맡긴 일과 그 응답. 폴더 하나가 대화 하나다: `request.md` → `NN-<에이전트>.md` … → `result.md`.
생성: `node .harness/scripts/new-doc.mjs ho <slug> "<제목>"` · 응답: `… reply <HO-ID> --agent "<에이전트(모델)>"`. 절차: [`../runbooks/handoff.md`](../runbooks/handoff.md).
