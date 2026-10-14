/**
 * 읽기(inspect) 하나를 revision 기준으로 중복 없이 돌린다. 커맨드를 실행한 쪽은 결과를 바로 읽고(need 없음), 엔진 이벤트
 * (projectChanged, revision R)를 받은 구독자는 `need = R` 로 부른다: store 가 이미 R 이상을 읽었으면 건너뛰고, 같은 읽기가
 * 진행 중이면 끝나길 기다린 뒤 다시 판단한다(그 읽기가 R 을 가져왔으면 건너뛴다). 커맨드 하나에 "실행한 쪽의 읽기 + 이벤트
 * 구독자의 읽기" 가 겹치던 것을 하나로 만든다(M4-8). revision 은 엔진 `project.inspect`·`sequence.inspect` 결과와
 * projectChanged 이벤트가 같은 값을 준다.
 */
export class RevisionGate {
  private current: Promise<void> | null = null;

  /** `have` 는 store 가 마지막으로 읽은 revision(없으면 -1) */
  constructor(private readonly have: () => number) {}

  /** 진행 중인 읽기가 있는지(진단·테스트) */
  get busy(): boolean {
    return this.current !== null;
  }

  async run(need: number | undefined, read: () => Promise<void>): Promise<void> {
    if (need !== undefined) {
      if (this.have() >= need) return;
      if (this.current) {
        await this.current.catch(() => undefined);
        if (this.have() >= need) return;
      }
    }
    const p = read().finally(() => {
      if (this.current === p) this.current = null;
    });
    this.current = p;
    return p;
  }
}

/** 구독자가 넘길 need: revision 이 앞으로 갔을 때만 그 값. 뒤로 갔으면(엔진 재시작으로 0) 무조건 다시 읽는다 */
export function neededRevision(next: number, prev: number): number | undefined {
  return next > prev ? next : undefined;
}
