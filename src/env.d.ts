/// <reference types="astro/client" />

declare module '*.css?raw' {
  const content: string
  export default content
}

