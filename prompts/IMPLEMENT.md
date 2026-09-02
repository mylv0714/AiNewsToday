# 프롬프트: Morning Brief 구현

아래를 새 에이전트 세션에 그대로 붙여 이 저장소를 구현한다. 기획의 정본은 `docs/PRODUCT.md`, 매일 편집 프롬프트는 `prompts/MORNING_EDITOR.md`다. 구현 중 제품 결정이 충돌하면 **PRODUCT.md를 이긴다**. UI 취향보다 유한한 판, 한국어 평서체, 조용한 아침을 우선한다.

---

너는 빈 저장소 `GithubNews`에 **개인용 AI 조간 웹페이지**를 만든다.

## 제품 (한 줄)

매일 아침 KST 기준, 커피 한 잔 동안 읽는 닫힌 AI 뉴스 판. 이름은 Morning Brief. `/`는 오늘 판, 어제는 아카이브.

## 읽을 것 (순서대로, 빼먹지 말 것)

1. `docs/PRODUCT.md` — 왜, 누구, 섹션, 소스, 랭킹, 톤, 시각, MVP 범위
2. `prompts/MORNING_EDITOR.md` — 매일 JSON 에디션을 쓰는 시스템 프롬프트
3. 이 파일의 기술 제약

PRODUCT.md §3 편집 원칙, §4 정보 구조, §8 시각, §9 MVP를 구현 체크리스트로 쓴다. 여기에 없는 기능을 창작하지 마라.

## 기술 스택

- **Astro** (정적). React 아일랜드는 테마 토글 정도만.
- TypeScript, strict
- 스타일: 전역 CSS 한 파일 + CSS 변수. Tailwind를 써도 되지만 유틸이 페이지를 지저분하게 만들지 말 것
- Node 20+
- 배포: GitHub Pages에 정적 export. GitHub Actions가
  1. 매일 **UTC 21:15** (KST 06:15) 수집+편집+빌드+deploy
  2. `main` 푸시에도 빌드
- LLM: OpenAI 호환 API (환경변수 `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`). 키 없거나 실패하면 폴백 에디션
- 시크릿을 커밋하지 마라. `.env.example`만

패키지 매니저: pnpm이 있으면 pnpm, 없으면 npm. 락파일 하나.

## 디렉터리

```
src/
  pages/
    index.astro          # 오늘 판
    archive/index.astro  # 날짜 목록
    archive/[date].astro # 과거 판
  layouts/EditionLayout.astro
  components/            # Hero, Overnight, Tools, Papers, Github, IfTime, Footer
  styles/global.css
scripts/
  collect.ts             # 소스 → 정규화 후보
  edit.ts                # MORNING_EDITOR 호출 → editions/YYYY-MM-DD.json
  digest.ts              # collect + edit (npm run digest)
editions/                # 생성된 판. 샘플 하루치는 커밋
prompts/MORNING_EDITOR.md
docs/PRODUCT.md
.github/workflows/daily.yml
```

`editions/`의 JSON은 앱의 소스 오브 트루스다. 페이지는 이 파일을 읽어 렌더할 뿐.

## 수집 (`scripts/collect.ts`)

네트워크가 일부 실패해도 전체가 죽지 않게, 소스별 try/catch.

최소 소스:

1. **RSS** — 공식 랩/회사 블로그. 목록은 `src/data/feeds.ts`로 분리해 쉽게 늘리게.
   넣을 피드 (가능한 공식만): OpenAI, Anthropic, DeepMind, Meta AI, Hugging Face 블로그, Google AI
2. **Hacker News** — Algolia `search_by_date`, 키워드: `AI OR LLM OR "open source" OR GPT OR Claude OR Gemini OR "machine learning"`, 지난 24h, 점수 필터는 낮게 (편집장이 자른다)
3. **arXiv API** — `cs.AI, cs.LG, cs.CL` 최근. 제목+초록 앞부분만
4. **GitHub** — `search/repositories?q=created:>날짜+topic:llm` 류 + 옵션으로 trending HTML은 깨지기 쉬우니 검색 API 우선. `GITHUB_TOKEN`이 있으면 헤더에 넣고, 없어도 동작

정규화 아이템:

```ts
type Candidate = {
  id: string
  title: string
  url: string
  source: string
  published_at: string
  snippet: string
  extra?: Record<string, string | number>
}
```

URL 정규화로 중복 1차 제거. 결과는 `cache/candidates-YYYY-MM-DD.json` (cache는 gitignore).

## 편집 (`scripts/edit.ts`)

- `prompts/MORNING_EDITOR.md`의 System 구간을 시스템 프롬프트로
- User는 그 파일의 템플릿대로 날짜 + candidates JSON
- 응답 JSON 파싱. 코드펜스가 있으면 벗겨라
- zod로 스키마 검증. 실패 시 한 번 재시도, 또 실패면 폴백
- 폴백: 후보 상위 N개를 섹션에 단순 배치. 한국어 헤드라인 대신 원제. `one_liner`: `요약 모델에 실패해 원문 제목만 모았습니다.`
- 성공이면 `editions/YYYY-MM-DD.json` 기록
- `reading_minutes`가 없거나 이상하면 글자 수로 재계산

오늘 판이 이미 있고 `--force`가 없으면 덮지 마라. 아침 동결 원칙.

## UI

PRODUCT.md §4 구조를 시각적으로 그대로.

- 문서 타이틀: `Morning Brief · YYYY.MM.DD`
- 최상단 큰 날짜 (한글: `2026년 9월 2일 수요일`)
- 그 옆 또는 아래: `{n}분 판`
- `one_liner`을 날짜 다음 가장 눈에 띄는 문장으로
- 섹션 제목 카피 고정:
  - 히어로 위에 작은 라벨 `오늘` (hero null이면 섹션 전체 생략)
  - `당신이 자는 동안`
  - `모델 · 도구` (빈 배열이면 생략)
  - `논문 세 편` (개수에 맞춰 `논문` / `논문 한 편` 등으로 자연스럽게)
  - `GitHub`
  - `커피가 남았다면` (null이면 생략)
- 각 아이템: 헤드라인, lede, 소스명, 상대시각, kind 작은 라벨, 원문 링크 (새 탭)
- 히어로만 `body` 문단
- 하단 고정: `이 판은 여기까지입니다. 창을 닫아도 됩니다.`
- `quiet_night === true`이면 히어로 자리에 그 카피를 크게 쓰지 말고, one_liner로 충분
- 아카이브 링크는 푸터에만. 헤더를 앱 셸처럼 만들지 마라
- `prefers-color-scheme` + 토글. 토글은 localStorage. 색 변수는 PRODUCT.md §8
- 본문 max-width ~680px, 종이 배경, 과한 그림자·테두리 없음
- 반응형: 모바일에서도 한 열, 패딩만 조절
- 영어 폰트와 한글 폰트 fallback을 명시 (Pretendard는 fontsource 또는 CDN)

샘플 에디션을 `editions/`에 하나 넣어, API 키 없이 `pnpm dev`만으로 **완성된 아침 페이지가 보이게** 하라. 샘플은 허구여도 되지만 톤은 PRODUCT에 맞출 것. 날짜는 2026-09-02.

## GitHub Actions

`daily.yml`:

- schedule cron `15 21 * * *`
- contents: write
- Node 설치, 의존성, `pnpm digest` 또는 `npm run digest`
- 빌드
- editions json이 바뀌었으면 커밋 (`chore: edition YYYY-MM-DD`) 후 Pages deploy
- `LLM_API_KEY` 등은 Actions secrets. 없어도 폴백으로 녹색이어야 한다 (샘플/폴백 판)

Pages 설정이 필요하면 `actions/deploy-pages` 또는 기존 gh-pages 패턴 중 저장소에 맞는 단순한 쪽.

## README

짧고 한국어. 포함:

- 이 제품이 무엇인가 (커피, 8분, 닫힌 판)
- 로컬 실행: install, `dev`, `digest`
- 환경변수 표
- Actions secrets
- 링크: PRODUCT.md, 두 프롬프트

마케팅 문장, 배지 잔치, “Built with” 로고월 넣지 마라.

## 완료 조건

- [ ] `pnpm install && pnpm dev` 로 샘플 오늘 판이 아름답게 뜬다
- [ ] 섹션 카피, 하단 문장, 날짜 타이포가 PRODUCT와 일치한다
- [ ] hero/if_time/빈 배열 섹션이 숨겨진다
- [ ] 라이트/새벽 테마가 실제로 종이/잉크처럼 보인다 (네온 금지)
- [ ] `digest`가 키 없이 폴백 json을 만든다
- [ ] 스키마가 MORNING_EDITOR와 같다
- [ ] 시크릿·node_modules·cache가 커밋되지 않는다
- [ ] 무한스크롤, 로그인, DB, 검색, 댓글이 없다

## 작업 순서

1. Astro 스케폴드와 샘플 JSON으로 **UI를 먼저** 완성한다. 아침 페이지가 눈에 보이기 전에 수집기를 키우지 마라.
2. 수집기 + 폴백 편집
3. LLM 편집 연결
4. Actions
5. README

커밋은 논리 단위로. 사용자가 커밋을 요청하지 않았다면 이 프롬프트를 실행하는 에이전트는 코드만 작성하고, 커밋 여부는 사용자 규칙에 따른다.

구현을 시작하라.
