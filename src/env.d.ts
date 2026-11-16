/// <reference types="vite/client" />

declare module 'virtual:stories' {
  export const BUILD: import('./content.ts').BuildName;
  export const stories: readonly import('./stories.ts').BuiltStory[];
}
