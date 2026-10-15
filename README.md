# Morning Brief

아침 커피 한 잔 동안 읽는 개인용 AI News.

## 로컬

```bash
npm install
npm run dev
```

샘플 판이 열린다. 오늘 판을 모으려면:

```bash
copy .env.example .env
npm run digest
```

같은 날짜는 덮지 않는다. 다시 만들 때만 `npm run digest -- --force`. 키 없으면 원제만 올린 폴백 판이 생긴다.

수집은 공식 랩(RSS + Anthropic 뉴스룸)과 큐레이션 필자, HN·HF Daily Papers·GitHub 신호를 모은 뒤 점수 순으로 자른다.

## 환경변수


| 이름             | 역할                               |
| -------------- | -------------------------------- |
| `LLM_API_KEY`  | OpenAI 호환 채팅 API. 없으면 폴백         |
| `LLM_BASE_URL` | 기본 `https://api.openai.com/v1`   |
| `LLM_MODEL`    | 기본 `gpt-4o-mini`                 |
| `LLM_FALLBACK_MODELS` | 주 모델이 503/429로 계속 실패할 때 차례로 쓸 모델들. 쉼표 구분. 선택 |
| `LLM_BUDGET_MS` | 요약 재시도 전체 시간 상한. 기본 720000 (12분) |
| `GITHUB_TOKEN` | GitHub Search 한도. 없어도 동작         |
| `SITE_URL`     | 빌드 시 사이트 URL                     |
| `BASE_PATH`    | GitHub Pages 프로젝트 사이트면 `/저장소이름/` |




## 배포

`.github/workflows/daily.yml`이 **UTC 21:15 (KST 06:15)** 에 수집·편집·빌드·Pages 배포를 한다. `main` 푸시에도 빌드한다. KST 12:00·16:00에도 돌지만, 오늘 판이 폴백 판(요약 실패)일 때만 요약을 다시 시도한다.

Secrets는 `LLM_API_KEY`만 있으면 되고, `LLM_BASE_URL` / `LLM_MODEL`은 선택. Pages 소스는 **GitHub Actions**.  
  
여기 Pages에선 무료api_key를 발급해주는 gemini flash 3.6을 사용하고있다

## Pages

[https://mylv0714.github.io/AiNewsToday/](https://mylv0714.github.io/AiNewsToday/)