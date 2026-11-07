# ADR-261107-local-generated-index: 생성 인덱스 두 개를 git에서 빼고 로컬에서만 만든다

- 상태: Accepted
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
  - `build-index`와 세션 시작 카드(`harness-status` → `build-index --local`, 추적 파일은 건드리지 않는다)가 만든다.
- `docs/specs/index.md`는 커밋을 유지한다. 스펙이 바뀔 때만 바뀌기 때문이다. `--check`는 이 파일만 본다.
- 세 파일 모두 머리 줄에 날짜를 쓰지 않는다. `--check`는 옛 날짜가 든 머리 줄도 같은 것으로 본다. 그래야 sync 직후 날짜 차이만으로 실패하지 않는다.
- lint ⑳: 로컬 인덱스가 git에 추적되거나 `.gitignore`에 없으면 위반이다. 위반 메시지에 옮기는 명령을 함께 보인다.
- `work.mjs finish`는 추적 생성물만 같이 커밋한다.
- 전환기: 이행 전에 연 브랜치는 finish가 스스로 푼다.
  - 브랜치가 아직 추적하는 로컬 인덱스의 미커밋 변경은 버린다.
  - shipped 표시 때 추적 인덱스는 본 트리의 `build-index`로 만든다. 브랜치에 남은 옛 스크립트는 머리 줄에 날짜를 써서 main과 같은 줄에서 충돌한다.
  - rebase 충돌이 생성 인덱스뿐이면 스스로 풀고 계속한다.
    - 로컬 인덱스는 추적 해제 쪽으로 풀고 작업 파일도 지운다. build-index가 다시 만든다.
    - 추적 인덱스는 base 쪽을 택하고, rebase가 끝나면 다시 만들어 차이가 있으면 커밋한다.
    - 인덱스만 고친 커밋은 비어서 건너뛴다.
  - 다른 파일이 충돌하거나 rebase가 시작조차 못 하면, 예전처럼 rebase를 되돌리고 멈춘다.
  - `check-branch-record`의 `*.generated.md` 면제는 남긴다. 전환기 브랜치가 아직 이 파일을 커밋하기 때문이다.
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
  - `node .harness/scripts/build-index.mjs`를 돌리고 `docs/specs/index.md`(머리 줄 날짜가 빠진다)를 같은 커밋에 넣는다.
  - 열린 기록 브랜치는 손대지 않아도 된다. finish가 전환기 충돌을 푼다(§2).
  - 하지 않으면 lint ⑳이 pre-commit과 CI를 막는다.
- 되돌릴 때: 새 ADR을 쓰고 `.gitignore`에서 두 줄을 뺀 뒤 두 파일을 다시 커밋한다. 비용은 낮다.
- 검증 (26dd42c 기준):
  - 바꾼 스크립트 7개(build-index·lint·work·harness-status·ci·mockup-diff·check-branch-record)의 self-test가 통과한다.
  - 변이가 모두 FAIL로 잡힌다.
    - lib 안: `--check`가 로컬 인덱스까지 봄 · 머리 줄 날짜 · 추적 검사 끔 · 미등재 검사 끔 · 날짜 정규식 첫 줄 묶음 풂
    - 연결부: lint ⑳ 호출 삭제 · 카드의 로컬 인덱스 생성 끔 · 카드가 추적 파일도 씀
    - work: finish가 로컬 인덱스 커밋 · 로컬 인덱스 충돌 안 풂 · settle 끔 · 추적 인덱스 충돌 안 풂 · rebase 뒤 재생성 안 함
    - 작업 파일 지우기와 `~` 잔여 청소는 서로 보완한다. 하나만 끄면 통과하고, 둘 다 끄면 FAIL이다.
  - 리뷰 r2의 재현을 다시 돌렸다. 브랜치 쪽은 실제 v0.4.5 스크립트, main은 이행 뒤 이 버전이다. 결과는 `finish OK (ff)`, main 작업 트리는 깨끗하고 로컬 인덱스 추적은 0이다.
  - 리뷰: 새 문맥 리뷰 서브에이전트 2회. r1은 재작업(중1 이행 전 브랜치), r2는 조건부(중1' specs/index.md 머리 줄)였다. 두 결함 모두 이 커밋까지 코드로 고쳤다.
  - 환경 한계: 이 PC의 git 2.28은 `rev-parse --path-format`(2.31+)이 없다. 그래서 `lib/refs.mjs` self-test가 main(v0.4.5)에서도 실패한다. 이 REP와 무관하다.

## 개정 이력

| 날짜 | 에이전트(모델) | 수정 부위 | 요지 |
|---|---|---|---|
| 2026-11-07 | Claude Code (claude-opus-5-5) | 전체 | 최초 작성 |
| 2026-11-07 | Claude Code (claude-opus-5-5) | 상태 | Accepted — PR #5 병합(사용자 승인 2026-11-07) · 릴리스 v0.4.6 |
