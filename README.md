# Morning Brief

커피를 내리는 동안 어제 밤을 훑고, 첫 모금쯤엔 창을 닫아도 되게 만드는 개인용 AI 조간.

`/` 는 오늘 판. 어제는 `/archive/`. 페이지는 그날의 JSON을 렌더할 뿐이고, 읽는 동안 헤드라인은 바뀌지 않는다.

## 로컬

```bash
npm install
npm run dev
```

샘플 판(`editions/2026-09-02.json`)이 열린다. API 키는 필요 없다.

오늘 판을 실제로 모으려면:

```bash
copy .env.example .env
npm run digest
```

같은 날짜의 판이 이미 있으면 덮지 않는다. 다시 만들 때만 `npm run digest -- --force`.

키 없이 돌리면 원문 제목을 그대로 얹은 폴백 판이 생긴다.

## 환경변수

| 이름 | 역할 |
|------|------|
| `LLM_API_KEY` | OpenAI 호환 채팅 API. 없으면 폴백 |
| `LLM_BASE_URL` | 기본 `https://api.openai.com/v1` |
| `LLM_MODEL` | 기본 `gpt-4o-mini` |
| `GITHUB_TOKEN` | GitHub Search 한도. 없어도 동작 |
| `SITE_URL` | 빌드 시 사이트 URL |
| `BASE_PATH` | GitHub Pages 프로젝트 사이트면 `/저장소이름/` |

## GitHub Actions

`.github/workflows/daily.yml` 이 **UTC 21:15 (KST 06:15)** 에 수집·편집·빌드·Pages 배포를 한다. `main` 푸시에도 빌드한다.

저장소 Secrets (없어도 폴백으로 빌드는 통과해야 한다):

- `LLM_API_KEY`
- `LLM_BASE_URL` (선택)
- `LLM_MODEL` (선택)

GitHub Pages 소스 는 **GitHub Actions** 로 둔다. 프로젝트 사이트면 주소는 `https://<user>.github.io/GithubNews/`.

## 문서

| 파일 | 역할 |
|------|------|
| [docs/PRODUCT.md](docs/PRODUCT.md) | 왜 만드는가, 무엇을 넣지 않는가 |
| [prompts/MORNING_EDITOR.md](prompts/MORNING_EDITOR.md) | 매일 판을 닫는 편집장 프롬프트 |
| [prompts/IMPLEMENT.md](prompts/IMPLEMENT.md) | 이 앱을 붙일 때 쓴 구현 프롬프트 |
