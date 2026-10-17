# {{PROJECT_NAME}} — 협업 저장소

{{OUR_ORG}}와 {{THEIR_ORG}}가 같이 보는 저장소입니다. 회의 안건·회의록·합의 결정·질문·요구사항·제출물이 여기 있습니다. 코드는 없습니다.

## 어디에 무엇이

| 폴더 | 내용 | 누가 쓰나 |
|---|---|---|
| `meetings/MTG-<날짜>-<주제>/` | `agenda.md`(회의 전) · `minutes.md`(회의 후, 양측 확인) | {{OUR_ORG}} 작성, 양측 확인 |
| `decisions/DEC-<날짜>-<주제>.md` | 범위·비용·일정·책임을 바꾸는 **합의** 결정. `proposed` → 양측 확인 → `agreed` | 제안은 누구나, 합의는 양측 |
| `questions/open-questions.md` | 서로 묻는 것과 답 | 양측 |
| `requirements/` | 요구사항 정본 (계약 확정 후) | 양측 |
| `sources/` | 상대가 제공한 원본 자료 (수정하지 않음, `manifest.json`에 해시) | {{THEIR_ORG}} 제공 |
| `deliverables/` | 제출물·보고서 초안·검수 문서 | {{OUR_ORG}} |

## 사용법 (git을 몰라도 됩니다)

- GitHub 웹에서 파일을 열어 연필 아이콘으로 고치고 "Commit changes"를 누르면 됩니다.
- 질문이 있으면 `questions/open-questions.md`에 줄을 추가하거나 Issues에 올려 주세요.
- 회의록은 회의 다음 날까지 올립니다. 내용이 다르면 바로 고쳐 주세요 — 고친 내용은 문서 아래 개정 이력에 남깁니다.
