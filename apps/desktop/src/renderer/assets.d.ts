/** vite 가 번들에 넣고 URL 을 돌려주는 그림 파일 */
declare module '*.png' {
  const url: string;
  export default url;
}
