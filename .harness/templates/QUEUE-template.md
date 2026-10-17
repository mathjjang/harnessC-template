---
id: {{ID}}
source: {{SOURCE}}          # qa(사람 발견 결함) | human-run(사람 실행 요청) | backlog(이월)
severity: medium            # low | medium | high | critical
blocking: false             # 릴리스 차단 여부
owner:                      # 처리 주체
due:
state: open                 # open | decided | closed
decision:
sync:                       # not-needed | pending | synced:<회의·문서 ID>
axis:                       # human-run만 — rules/human-only.yaml 축 ID (린트 ⑨)
affected: []                # 영향 FDR·AC·스펙
---

# {{TITLE}}

- 작성: {{AGENT}} · {{DATE}}

## 내용

- qa: 캡처 · 증상 · 되어야 할 모습 (분류는 에이전트가, 리뷰어≠수정자)
- human-run: 절차 · 기대 결과 · 기록란
- backlog: 사실 · 왜 지금 안 하나 · 해소 조건 · 하지 말 것

## 처리 기록
