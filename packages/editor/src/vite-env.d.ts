declare module '*.css';
declare module '*.svg?raw' {
  const source: string;
  export default source;
}
declare const __APP_VERSION__: string | undefined;
/** vite `?raw`: 파일을 글자 그대로 가져온다(features/onboarding/usage-doc.ts 가 docs/guides/usage.md 를 번들한다) */
declare module '*.md?raw' {
  const text: string;
  export default text;
}
