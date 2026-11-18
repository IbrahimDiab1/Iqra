export interface Place {
  page: number;
  offset: number;
}

const MAX_ENTRIES = 50;

/** Back and forward stacks for jumps (links, search results, outline entries). */
export class JumpHistory {
  private backStack: Place[] = [];
  private forwardStack: Place[] = [];

  /** Records a place to return to. Clears the forward stack. Ignores a place on the same page as the top. */
  push(from: Place): void {
    this.forwardStack = [];
    const top = this.backStack[this.backStack.length - 1];
    if (top && top.page === from.page) return;
    this.backStack.push({ ...from });
    if (this.backStack.length > MAX_ENTRIES) this.backStack.shift();
  }

  back(current: Place): Place | null {
    const prev = this.backStack.pop();
    if (!prev) return null;
    this.forwardStack.push({ ...current });
    return prev;
  }

  forward(current: Place): Place | null {
    const next = this.forwardStack.pop();
    if (!next) return null;
    this.backStack.push({ ...current });
    return next;
  }

  get canBack(): boolean {
    return this.backStack.length > 0;
  }

  get canForward(): boolean {
    return this.forwardStack.length > 0;
  }

  clear(): void {
    this.backStack = [];
    this.forwardStack = [];
  }
}
