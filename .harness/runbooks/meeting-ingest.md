---
id: RB-meeting-ingest
trigger: 외부 조직과의 회의가 끝났을 때 — "회의록 반영", "회의 결과 정리", "미팅 끝났어"
evidence: (협업 저장소) meetings/MTG-<ID>/minutes.md · decisions/DEC-…
pack: 코어
entry: meeting-ingest
summary: 회의록 반영 — 협업 저장소 minutes.md를 읽어 질문 답 갱신·DEC 생성·개발 저장소 큐/REQ/ADR 후속을 만든다. "회의록 반영", "회의 결과 정리", "미팅 끝났어" 요청 시.
args: "<MTG-ID>"
---

# 회의록 반영

1. **읽기**: `meetings/<MTG-ID>/minutes.md`. 없으면 사용자가 준 메모로 먼저 회의록을 채우고(결정·답변·액션·논의 분리) 양측 확인 체크박스는 비워 둔다.
2. **질문 갱신**: `questions/open-questions.md` 답·상태(`answered`) · 출처 `<MTG-ID>`.
3. **DEC 승격**: 범위·비용·일정·책임을 바꾸는 결정마다 `node .harness/scripts/new-doc.mjs dec <slug> "<제목>" --ref collab` → 상태 `proposed`, 출처 `<MTG-ID>`. 회의록 결정 표에는 DEC 링크만.
4. **개발 저장소 후속** (협업 저장소를 인용하되 복사하지 않는다):
   - 요구사항 변경 → `docs/requirements/` 갱신 또는 PG(큐 `sync: <MTG-ID>`).
   - 되돌리기 비싼 기술 결정이 유발되면 ADR 초안, `관련:`에 `DEC-…`.
   - 내부 판단(이 결정의 원가·공수 영향)은 개발 저장소 `docs/requirements/open-questions.md`의 권고 열이나 ADR에.
5. **액션 아이템**: 우리 몫은 `docs/queue/HR-…` 또는 backlog로, 기한·담당 포함.
6. 보고: 결정 n건(DEC 링크) · 답변된 질문 n · 우리 액션 n · 상대 액션 n · 사람이 확인할 것(DEC agreed 처리).
