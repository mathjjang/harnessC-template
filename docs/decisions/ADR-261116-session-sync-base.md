# ADR-261116-session-sync-base: 세션 시작에 base를 origin에서 받는다 — ff만, 갈라짐·겹침은 경고

- 상태: Accepted
- 작성: Claude Code (claude-opus-5-5) · 담당 mathjjang · 2026-11-16
- 강제 등급: generate — 집행 수단: `.harness/catalog.yaml` harness-status.mjs(SessionStart 훅 — base를 받고 카드 첫 줄에 결과)
- 위험: low
- 선행 RFC: 없음
- 관련: HARNESS §11 · ADR-261116-record-human-owner(같은 날 — 개발자 둘 이상) · automation: 다른 개발자에게 "REQ-027 진행해"를 맡기려는데 그 PC의 main이 오래되면 요구 · 규칙 · 런북을 모른다(사용자 "당연히 적용해야 해")
- 정책 소유: technical

> ADR은 되돌리기 비싼 결정에만 쓴다. 결정은 단정문으로. 대안이 비면 "정말 비교했나"를 의심한다.

## 1. Context (왜 지금)

- 세션 시작 카드는 로컬 저장소만 읽는다. 원격(origin)을 보지 않는다.
- 개발자가 둘 이상이면 각자 PC의 base(main)는 다른 사람이 병합한 기록 · 요구 · 규칙 · 런북 · 코어 동기화를 모른다. 에이전트는 없는 요구를 찾거나, 옛 규칙으로 일하거나, 이미 된 일을 다시 하거나, 병합 때 충돌한다.
- "시작 전에 pull하라"는 사람이 읽어야 지켜지는 규칙이다.

## 2. Decision (무엇을 한다 / 하지 않는다)

- SessionStart 훅(`harness-status.mjs`)이 카드를 만들기 전에 `harness.yaml` `work.base`(기본 main)를 origin에서 받는다.
- **받는 것은 fast-forward만.** 지금 브랜치가 base이고, 로컬 base가 origin보다 뒤이기만 하면 `merge --ff-only`. 받은 결과를 카드 첫 줄에 적는다(`원격: main ← origin N개 받음(ff)`).
- **받지 않고 경고만** 하는 경우(저장소 상태를 바꾸지 않는다):
  - 갈라짐(로컬에도 커밋 · origin에도 커밋) — 정리한 뒤 시작.
  - 로컬 변경이 받을 변경과 겹침(ff 실패) — 로컬 변경을 정리한 뒤.
  - 지금 브랜치가 base가 아님(worktree 세션 · 다른 브랜치) — 새 작업은 최신 origin/base에서.
  - 원격을 못 받음(네트워크 · 인증 · 5초 초과) — 최신이 아닐 수 있다고 알린다.
- 로컬 base가 앞서기만 하면(푸시 안 됨) 그 사실을 한 줄 알린다.
- 인증 창을 띄우지 않는다(`GIT_TERMINAL_PROMPT=0` · `GCM_INTERACTIVE=never`). `HARNESS_NO_FETCH=1`이면 하지 않는다. git 저장소가 아니거나 origin이 없으면 아무 줄도 내지 않는다.
- SessionStart 훅 시간 상한 10초 → 30초(받기 5초 + ff 중 끊기지 않게).
- 하지 않는 것: rebase · stash · reset · 로컬 변경 덮기 · base 밖 브랜치 받기 · 푸시.

## 3. Alternatives

| 대안 | 장점 | 탈락 사유 |
|---|---|---|
| 규칙에 "시작 전 pull" 한 줄 | 코드 없음 | 사람이 읽어야 지켜진다 — 빠뜨리면 그대로 옛 main |
| fetch만 하고 뒤처짐을 경고 | 저장소를 바꾸지 않는다 | 경고를 읽고 pull하는 것이 또 사람(에이전트) 몫 — ff는 잃을 것이 없다 |
| `git pull`(병합 · rebase 포함) | 언제나 최신 | 갈라짐에서 병합 커밋 · 충돌을 세션 시작이 만든다 |
| 커밋 · 병합 게이트에서 뒤처짐 거부 | 강제력이 크다 | 이미 일을 한 뒤에 막는다 — 시작 전에 맞추는 것이 싸다 |

## 4. Consequences (득실 · 후속 작업 · 되돌릴 때 비용)

- 득: 세션은 거의 언제나 최신 base에서 시작한다. 못 받으면 이유가 카드 첫 줄에 있다.
- 실: 세션 시작에 네트워크 왕복(보통 1초 안 · 상한 5초). 에이전트가 모르는 사이 로컬 base가 바뀐다 — 결과를 카드에 적는 이유.
- 릴리스 노트: 설정 변경 없음 — sync-core만. 끄려면 `HARNESS_NO_FETCH=1`.
- 되돌릴 때: `syncBase` 호출을 빼고 훅 시간 상한을 되돌린다.

## 개정 이력

| 날짜 | 에이전트(모델) | 수정 부위 | 요지 |
|---|---|---|---|
| 2026-11-16 | Claude Code (claude-opus-5-5) · 담당 mathjjang | 전체 | 최초 작성 |
