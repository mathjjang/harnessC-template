---
id: RB-meeting-prep
trigger: 외부 조직과의 회의를 준비할 때 — "회의 준비", "안건 정리", "미팅 자료"
evidence: (협업 저장소) meetings/MTG-<ID>/
pack: 코어
entry: meeting-prep
summary: 외부 조직과의 회의 안건 생성 — 미답 질문·큐·진행 FDR에서 안건을 모아 협업 저장소 meetings/MTG-…/agenda.md를 만든다. "회의 준비", "안건 정리", "미팅 자료" 요청 시.
args: "<slug> \"<회의 제목>\""
---

# 회의 준비 (협업 저장소에 안건 작성)

1. **대상 확인**: `harness.yaml references`에서 `role: collab` 항목. 체크아웃이 없으면 중단하고 경로를 보고한다.
2. **생성**: `node .harness/scripts/new-doc.mjs mtg <slug> "<제목>" --ref collab` → `meetings/MTG-<날짜>-<slug>/{agenda.md,minutes.md}`.
3. **안건 수집** (이 순서로, 각 항목에 출처 한 줄):
   - `questions/open-questions.md`의 `open` 질문 — 답이 없으면 막히는 것을 위로.
   - 개발 저장소 큐 `docs/queue/PG-`·`HR-`에서 `owner`가 상대 조직인 것.
   - 진행 중 FDR의 `human` 게이트·검수 일정.
   - 직전 회의록 액션 아이템 중 미완료.
4. **바라는 결과**를 안건마다 단정문으로(예: "외주비 공급가액 확정"). 결과가 없는 안건은 "공유"로 표시.
5. **쓰지 않는 것**: 원가·공수·내부 판단·개발 저장소 경로와 ID. 훅이 막지만 애초에 넣지 않는다. 옵션 비교가 필요하면 상대에게 보여도 되는 형태(범위·가격)로만.
6. 상대에게 사전 공유할 것은 `사전 공유 자료`에 링크. 보고는 안건 표 + "확인이 필요한 질문"만 짧게.
