/** 잡은 예외를 사용자에게 보일 글로. Error 면 message, 아니면 문자열로 바꾼다. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
