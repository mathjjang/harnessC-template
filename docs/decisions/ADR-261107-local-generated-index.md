# ADR-261107-local-generated-index: 생성 인덱스 두 개를 git에서 빼고 로컬에서만 만든다

- 상태: Proposed
- 작성: Claude Code (claude-opus-5-5) · 2026-11-07
- 강제 등급: gate — 집행 수단: `.harness/catalog.yaml` lint.mjs ⑳ (목록·검사 `lib/generated-index.mjs`) · build-index.mjs `--check`(추적 생성물만)
- 위험: low
- 선행 RFC: 없음
- 관련: automation BL-261107-harness-generated-index-conflicts (사용자 결정 2026-11-07 "git에서 빼기")
- 정책 소유: technical

> ADR은 되돌리기 비싼 결정에만 쓴다. 결정은 단정문으로. 대안이 비면 "정말 비교했나"를 의심한다.

## 1. Context (왜 지금)

- automation에서 11-03 이후 병합된 브랜치는 모두 `docs/INDEX.generated.md`를 고쳤다(26/26). `docs/queue/INDEX.generated.md`도 13건을 고쳤다. 기록 폴더 말고 겹친 파일은 이 둘뿐이다.
- 기록이 생기거나 상태가 바뀔 때마다 같은 목록 줄과 개수 줄(`## FDR — 기능 (N)`)이 바뀐다. 그래서 먼저 병합된 브랜치가 있으면 나머지 브랜치는 rebase하고 다시 만들어 커밋해야 한다. pre-commit과 CI의 `build-index --check`가 이를 강제한다.
- 머리 줄에도 생성 날짜를 썼다. `--check`는 날짜를 빼고 비교하지만 파일을 다시 만들면 그날 날짜가 들어간다. 그래서 날짜가 다른 두 브랜치는 첫 줄에서도 충돌했다.
- 동시 작업이 늘수록 병합 대기가 길어진다. #19는 PR을 연 뒤 병합까지 3시간 20분이 걸렸고 "main 위 rebase 뒤 인덱스 갱신" 커밋이 두 번 들어갔다.

## 2. Decision (무엇을 한다 / 하지 않는다)

- `docs/INDEX.generated.md`와 `docs/queue/INDEX.generated.md`는 **로컬 전용**으로 한다.
  - `.gitignore`에 넣고 커밋하지 않는다.
  - `build-index`와 세션 시작 카드(`harness-status`)가 만든다.
- `docs/specs/index.md`는 커밋을 유지한다. 스펙이 바뀔 때만 바뀌기 때문이다. `--check`는 이 파일만 본다.
- 세 파일 모두 머리 줄에 날짜를 쓰지 않는다. `--check`는 옛 날짜가 든 머리 줄도 같은 것으로 본다. 그래야 sync 직후 날짜 차이만으로 실패하지 않는다.
- lint ⑳: 로컬 인덱스가 git에 추적되거나 `.gitignore`에 없으면 위반이다. 위반 메시지에 옮기는 명령을 함께 보인다.
- `work.mjs finish`는 추적 생성물만 같이 커밋한다.
- 하지 않는 것:
  - 인덱스 내용이나 형식은 바꾸지 않는다.
  - merge driver를 쓰지 않는다. GitHub 병합 단추에서는 merge driver가 돌지 않아서 PR이 계속 충돌로 보인다.

## 3. Alternatives

| 대안 | 장점 | 탈락 사유 |
|---|---|---|
| 브랜치에서는 갱신하지 않고 병합 뒤 main에서만 다시 만든다 | GitHub 웹에서 인덱스가 보인다 | PR 모드에서 병합은 GitHub에서 일어나므로 main 커밋을 낼 주체(봇·로컬 gc)가 필요하다. 병합마다 커밋이 하나 더 생긴다. 사용자가 "git에서 빼기"를 골랐다 |
| 날짜 줄만 뺀다 | 변경이 가장 작다 | 같은 목록 줄과 개수 줄 충돌, rebase 뒤 다시 만드는 일이 그대로 남는다 |
| `.gitattributes` merge driver로 다시 만든다 | 커밋을 유지한다 | 로컬 merge에서만 돈다. GitHub PR mergeability에는 효과가 없다 |

## 4. Consequences (득실 · 후속 작업 · 되돌릴 때 비용)

- 득:
  - 기록 브랜치끼리 겹치는 파일이 없어진다. 기록 폴더는 브랜치마다 다르다.
  - 병합 순서를 맞출 필요가 없어진다.
- 실:
  - GitHub 웹에서는 두 인덱스를 볼 수 없다. 로컬에서 보거나 `build-index`로 만든다.
  - 세션 시작 카드가 파일을 조금 더 쓴다. 실패해도 카드는 나온다.
- 프로젝트 이행(sync-core 뒤 한 번):
  - `.gitignore`에 두 줄을 넣는다.
  - `git rm --cached -- docs/INDEX.generated.md docs/queue/INDEX.generated.md`를 실행한다. 파일은 남는다.
  - `node .harness/scripts/build-index.mjs`를 돌리고 커밋한다.
  - 하지 않으면 lint ⑳이 pre-commit과 CI를 막는다.
- 되돌릴 때: 새 ADR을 쓰고 `.gitignore`에서 두 줄을 뺀 뒤 두 파일을 다시 커밋한다. 비용은 낮다.
- 검증:
  - self-test 7개가 통과한다. build-index가 새로 임시 git 저장소에서 추적·미등재를 검출한다.
  - 변이 5종이 모두 FAIL로 잡힌다.
    - `--check`가 로컬 인덱스까지 본다.
    - 머리 줄에 날짜가 들어간다.
    - 추적 검사를 끈다.
    - 미등재 검사를 끈다.
    - finish가 로컬 인덱스를 커밋한다.
  - 환경 한계: 이 PC의 git 2.28은 `rev-parse --path-format`(2.31+)이 없다. 그래서 `lib/refs.mjs` self-test가 main(v0.4.5)에서도 실패한다. 이 REP와 무관하다.

## 개정 이력

| 날짜 | 에이전트(모델) | 수정 부위 | 요지 |
|---|---|---|---|
| 2026-11-07 | Claude Code (claude-opus-5-5) | 전체 | 최초 작성 |
