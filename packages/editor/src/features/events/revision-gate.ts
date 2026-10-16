/**
 * 읽기(inspect) 하나를 revision 기준으로 중복 없이 돌린다. 커맨드를 실행한 쪽은 결과를 바로 읽고(need 없음), 엔진 이벤트
 * (projectChanged, revision R)를 받은 구독자는 `need = R` 로 부른다: store 가 이미 R 이상을 읽었으면 건너뛰고, 같은 읽기가
 * 진행 중이면 끝나길 기다린 뒤 다시 판단한다(그 읽기가 R 을 가져왔으면 건너뛴다). 커맨드 하나에 "실행한 쪽의 읽기 + 이벤트
 * 구독자의 읽기" 가 겹치던 것을 하나로 만든다(M4-8). revision 은 엔진 `project.inspect`·`sequence.inspect` 결과와
 * projectChanged 이벤트가 같은 값을 준다.
 */
export class RevisionGate {
  private current: Promise<void> | null = null;
  /** 읽는 중에 들어온 need 없는 요청들이 함께 기다리는 다음 읽기 하나(최신 상태 한 번이면 모두 만족한다) */
  private next: Promise<void> | null = null;

  /** `have` 는 store 가 마지막으로 읽은 revision(없으면 -1) */
  constructor(private readonly have: () => number) {}

  /** 진행 중인 읽기가 있는지(진단·테스트) */
  get busy(): boolean {
    return this.current !== null || this.next !== null;
  }

  /**
   * need 가 있으면: 이미 그 revision 이상이면 건너뛰고, 진행 중·예약된 읽기를 기다린 뒤 다시 판단한다.
   * need 가 없으면(커맨드를 실행한 쪽): 읽는 중이 아니면 바로 읽고, 읽는 중이면 그 뒤의 읽기 하나에 붙는다. 실행 취소를 연달아
   * 누르는 것처럼 요청이 몰리면 N 번이 아니라 "지금 읽기 + 마지막 한 번" 이 된다(뒤 읽기는 모든 요청보다 늦게 시작하므로 최신이다).
   */
  async run(need: number | undefined, read: () => Promise<void>): Promise<void> {
    if (need !== undefined) {
      if (this.have() >= need) return;
      for (let waiting = this.current ?? this.next; waiting; waiting = this.current ?? this.next) {
        await waiting.catch(() => undefined);
        if (this.have() >= need) return;
      }
      return this.start(read);
    }
    if (!this.current) return this.start(read);
    this.next ??= this.current
      .catch(() => undefined)
      .then(() => {
        this.next = null;
        return this.start(read);
      });
    return this.next;
  }

  private start(read: () => Promise<void>): Promise<void> {
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
