---
id: RB-handoff
trigger: 다른 세션·다른 회사 에이전트(Codex·Gemini·Cursor 등)에게 리뷰·검증·조사를 맡기거나, 그런 요청을 받았을 때
evidence: docs/handoffs/<HO-ID>/evidence/
pack: 코어
---

# 핸드오프 — 에이전트 간 주고받기

> 왜 파일인가: 채팅·세션 간 메시지는 휘발하고, 다른 회사 에이전트와는 아예 통로가 없다. 사람이 한 줄로 전달하고 내용은 파일이 들고 간다. git이 "누가·무엇을·왜·어떤 판정 기준으로" 넘겼는지 증언한다.
> 원칙: 날짜형 ID(번호 충돌 없음) · 다른 회사 에이전트도 받는 쪽이 될 수 있다 · 차례마다 새 파일(남의 글에 이어 쓰지 않음) · 받는 쪽의 쓰기 허용 경로를 요청서에 적는다.

## 폴더

```
docs/handoffs/HO-<YYMMDD>-<slug>/
  request.md         보낸 쪽 — 요청·왜·범위·완료 조건·기준 커밋·쓰기 허용·상태
  01-codex.md        받는 쪽 응답 (차례마다 새 파일 · NN-<에이전트>)
  02-claude.md       보낸 쪽 재판정 (동의/반박)
  03-codex.md        재반박 …
  result.md          보낸 쪽 — 항목별 수용·반박·보류와 기록 링크 → 상태 closed
  evidence/          재현 코드·원문 출력 (남길 것만)
```

## 보내는 쪽

1. `node .harness/scripts/new-doc.mjs ho <slug> "<제목>" --agent "<자기(모델)>"`
2. `request.md`를 채운다. 반드시: **받는 쪽**, **완료 조건**(무엇을 어떻게 재서 무엇이 나오면 끝인지), **범위 밖**. 미커밋 변경이 있으면 먼저 커밋한다.
3. `request.md`를 커밋하고, **그 커밋의 sha**를 기준 커밋 줄에 적어 한 번 더 커밋한다(`git rev-parse HEAD`).
4. 사람에게 아래 **전달 문구**를 준다.
5. 응답이 오면 새 파일로 재판정(`reply <HO-ID>`)하거나 바로 `reply <HO-ID> --result`로 종결. 수용 항목이 규칙·구조를 바꾸면 ADR로 가고 `result.md`에는 링크만. `request.md` 상태를 `closed`로 바꾸고 폴더째 커밋.

## 받는 쪽 (어느 회사 에이전트든)

1. `AGENTS.md`와 `rules/product.md`를 읽는다(Claude·Gemini는 자동).
2. `request.md` 상태를 `taken`, 맡은 쪽에 `<에이전트(모델)> · 날짜`.
3. 기준 커밋을 확인한다. `git diff <기준> HEAD --stat`이 `docs/handoffs/HO-…`뿐이면 **이 작업 트리에서 그대로 본다**. 코드·규칙이 달라졌을 때만 `git worktree add --detach .scratch/<HO-ID> <기준>`을 만들고, 응답을 마치면 `git worktree remove .scratch/<HO-ID>`로 지운다(저장소 전체 사본이라 무겁다).
4. 응답: `node .harness/scripts/new-doc.mjs reply <HO-ID> --agent "<자기(모델)>"` → 생긴 파일에만 쓴다. 결론 먼저, 항목마다 근거(파일:라인·명령·원문)·등급·완료/미검증/건너뜀.
5. 쓰기 허용 밖(제품 코드·규칙·남의 응답)은 고치지 않는다. 고쳐야 하면 응답에 제안으로 적는다.
6. 상태를 `answered`. 커밋·push는 하지 않는다(보낸 쪽이 result와 함께).

## 전달 문구 (사람이 붙여 넣는 한 줄)

| 받는 쪽 | 붙여 넣을 문장 |
|---|---|
| Codex (CLI·IDE) | `AGENTS.md를 따르고 docs/handoffs/<HO-ID>/request.md를 처리해. 응답은 reply 생성기로 만든 새 파일에만.` |
| Gemini CLI | 같은 문장. `GEMINI.md`가 AGENTS.md·제품 불변을 import한다 |
| 다른 Claude 세션 | 같은 문장, 또는 보낸 세션이 SendMessage로 HO ID만 알린다 |
| 웹 채팅(파일 접근 없음) | `request.md` 본문을 붙여 넣고, 받은 답을 사람이 `reply`로 만든 파일에 붙인다. 이때 머리 `작성:`은 그 채팅 모델 |

## 판정이 갈릴 때

- 차례는 최대 3번(요청→응답→재판정→재반박)까지. 그 뒤에도 갈리면 `result.md`에 양쪽 근거를 표로 두고 **사람이 선택**한다(선택지 질문).
- 모델이 다르다는 것은 독립성의 보조 수단이지 충분조건이 아니다. 판정 근거는 원문·재현으로만.
- 리뷰를 받는 쪽이 제품 코드를 고치게 하지 않는다. 지적과 제안만 받고 적용은 보낸 쪽(또는 FDR 구현자)이 한다.

## 하지 않는 것

- `.scratch/`에 응답을 남기고 끝내기(14일 뒤 지워진다). 재현용 worktree를 남겨 두기.
- 상대 문서 끝에 절을 덧붙여 대화하기(누가 무엇을 썼는지 섞인다).
- 사람만 정할 정책을 핸드오프로 넘기기 — 그것은 PG(`docs/queue/PG-…`)다.
