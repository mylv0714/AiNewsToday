export type FeedTier = 1 | 2

export type Feed = {
  name: string
  url: string
  /** 1 = 공식 랩/회사, 2 = 큐레이션·저널리즘 */
  tier: FeedTier
  /** 이 시간보다 오래된 항목은 버린다. 기본은 티어에 따름. */
  hours?: number
  maxItems?: number
  /** true면 제목/스니펫이 AI 키워드와 맞을 때만 남긴다. */
  requireAiKeyword?: boolean
}

export const feeds: Feed[] = [
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml', tier: 1 },
  { name: 'DeepMind', url: 'https://deepmind.google/blog/rss.xml', tier: 1 },
  { name: 'Google AI', url: 'https://blog.google/technology/ai/rss/', tier: 1 },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', tier: 1 },
  { name: 'NVIDIA', url: 'https://blogs.nvidia.com/blog/category/generative-ai/feed/', tier: 1 },
  {
    name: 'Microsoft Research',
    url: 'https://www.microsoft.com/en-us/research/blog/feed/',
    tier: 1,
    hours: 72,
    maxItems: 5,
    requireAiKeyword: true,
  },
  { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', tier: 2, hours: 72, maxItems: 6 },
  { name: 'Interconnects', url: 'https://www.interconnects.ai/feed', tier: 2, hours: 168, maxItems: 3 },
  { name: 'Ahead of AI', url: 'https://magazine.sebastianraschka.com/feed', tier: 2, hours: 168, maxItems: 3 },
  { name: 'Latent Space', url: 'https://www.latent.space/feed', tier: 2, hours: 168, maxItems: 3 },
  { name: 'Lilian Weng', url: 'https://lilianweng.github.io/index.xml', tier: 2, hours: 336, maxItems: 2 },
  { name: 'One Useful Thing', url: 'https://www.oneusefulthing.org/feed', tier: 2, hours: 168, maxItems: 2 },
  {
    name: 'MIT Tech Review',
    url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
    tier: 2,
    hours: 36,
    maxItems: 3,
  },
  { name: 'The Decoder', url: 'https://the-decoder.com/feed/', tier: 2, hours: 36, maxItems: 4 },
  { name: 'Lobsters', url: 'https://lobste.rs/t/ai.rss', tier: 2, hours: 36, maxItems: 6 },
]
