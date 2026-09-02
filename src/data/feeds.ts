export type Feed = {
  name: string
  url: string
}

export const feeds: Feed[] = [
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { name: 'DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
  { name: 'Google AI', url: 'https://blog.google/technology/ai/rss/' },
]
