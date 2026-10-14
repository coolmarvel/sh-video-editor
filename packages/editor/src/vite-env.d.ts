declare module '*.css';
declare module '*.svg?raw' {
  const source: string;
  export default source;
}
declare const __APP_VERSION__: string | undefined;
