# 요구사항 층

`harness.yaml` `requirements.mode`가 `monorepo`면 여기가 정본, `separate-repo`면 기획 저장소가 정본이고 여기엔 핀(커밋·rev)만 둔다.

| 파일 | 내용 | 상태 |
|---|---|---|
| `intake/INTAKE-YYMMDD-slug/` | 외부 원본(불변) + 추출본 + manifest(해시·제공자·날짜) | |
| `brief.md` | 목적·사용자·문제·성공 기준 | draft |
| `scope.md` | 범위·비범위·제약·옵션 | draft |
| `requirements.md` | REQ-NNN + AC + 출처(INTAKE:위치). `confirmed`만 FDR 입력 | draft |
| `open-questions.md` | 미결 (PG 승격 전) | |
| `acceptance/` | 수용 기록 ACC-… | |

확정은 회의록이 아니라 **확정 커밋**이다(`Confirmed-By:` 트레일러). 요구가 바뀌면 REQ를 supersede하고 영향 FDR을 `unrun`으로 강등한다.
