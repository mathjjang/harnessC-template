---
id: RB-collab
trigger: 발주사·협력사 등 다른 조직과 같이 보는 저장소(harness.yaml references role collab)를 만들거나, 회의 준비·회의록 반영·합의 결정(DEC)을 다룰 때
evidence: 협업 저장소 태그(baseline-v1 등) + SHA
pack: 코어
---

# 협업 저장소 — 다른 조직과 같이 보는 것

> 다른 조직과 **같이 보는** 저장소가 하나 더 있다. 개발 저장소는 그것을 읽고 지정 폴더에만 쓴다. 그 저장소는 개발 저장소를 모른다(원칙 14). 이 장치는 모든 프로젝트에서 같다 — 켜는 것은 `harness.yaml references`에 항목을 넣는 것뿐.

## 저장소 둘, 의존은 한 방향

| | 개발 저장소 (이 저장소) | 협업 저장소 (`references[role: collab]`) |
|---|---|---|
| 보는 사람 | 우리만 | 우리 + 상대 조직 |
| 담는 것 | 코드·FDR·ADR·RFC·원가·공수·내부 판단 | 회의 안건·회의록·합의 결정(DEC)·질문·요구사항 정본·상대 원본 자료·제출물 |
| 인용 | ADR·FDR이 `DEC-…`·`MTG-…`를 인용한다 | 개발 저장소의 어떤 경로·ID도 쓰지 않는다 — 훅이 거부 |
| 연결 | gitignore된 중첩(`./collab/`) 또는 형제 체크아웃 + `references` 등록. submodule 아님 | — |

## 규칙

1. 협업 저장소는 별도 git 저장소를 **중첩 체크아웃**(`./collab/`, `.gitignore` 등재 — 한 폴더에서 보인다) 또는 형제(`../<name>`)로 두고 `harness.yaml`에 `{ path, role: collab, trust: external, mode: read-write, writable: [...] }`로 등록한다. submodule·복사본 금지. 중첩이면 lint ⑧이 gitignore·미추적을 검사한다.
2. 쓰기는 `writable`에 든 폴더에만(기본 `meetings/ decisions/ questions/ deliverables/`). DEC는 우리가 **proposed**로 만들고 상대 확인으로 **agreed**가 된다.
3. 협업 저장소에 쓰는 내용에 개발 저장소 경로·기록 ID(`FDR-·ADR-·RFC-·PLAN-·PG-·INC-`)가 들어가면 훅(`guard-reference`)이 거부한다. 원가·공수 등 `ask_words`는 사람에게 묻는다.
4. 회의 전: `/meeting-prep` — 큐·미답 질문·진행 FDR에서 안건을 만들어 `meetings/MTG-<날짜>-<slug>/agenda.md`. 회의 후 24h 내: `/meeting-ingest` — `minutes.md`를 읽어 질문 답 반영·DEC 생성·필요하면 개발 저장소에 PG·ADR·REQ 갱신(큐 `sync` 필드에 MTG ID). 우리만 보는 브리프·결과보고서는 `docs/records/MTG-<같은 ID>/`.
5. DEC는 양측 합의 기록, ADR은 내부 기술 결정. 같은 사안이면 ADR이 DEC를 `관련:`에 적는다. DEC를 ADR로 복사하지 않는다(원칙 7).
6. 마일스톤(계약·중간검수·최종검수)마다 협업 저장소에 태그(`baseline-v1`·`acceptance-v1`). FDR evidence·완료보고서는 태그+SHA로 인용한다.
7. 요구사항 정본이 협업 저장소에 있으면 `harness.yaml requirements.mode: separate-repo`·`path: <collab>/requirements`.
8. 협업 저장소에도 최소 `AGENTS.md`(≤1KB)를 둔다: 언어·DEC 절차·"개발 저장소 내용을 쓰지 않는다". 상대가 쓰는 에이전트도 그 규칙을 본다.

## 협업 저장소 만들기

`.harness/templates/collab-skeleton/`을 새 저장소 루트에 복사하고 `{{PROJECT_NAME}}`·`{{OUR_ORG}}`·`{{THEIR_ORG}}`를 치환한다. 비공개 저장소 + 상대 담당자를 collaborator로. 개발 저장소에서는 `.gitignore`에 `/collab/`, `harness.yaml references`에 등록.
