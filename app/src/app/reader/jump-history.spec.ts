import { JumpHistory } from './jump-history';

describe('JumpHistory', () => {
  it('goes back to the last pushed place and forward again', () => {
    const h = new JumpHistory();
    h.push({ page: 1, offset: 0 });
    h.push({ page: 2, offset: 0 });

    expect(h.back({ page: 3, offset: 0 })).toEqual({ page: 2, offset: 0 });
    expect(h.canForward).toBe(true);
    expect(h.forward({ page: 2, offset: 0 })).toEqual({ page: 3, offset: 0 });
  });

  it('clears the forward stack on push', () => {
    const h = new JumpHistory();
    h.push({ page: 1, offset: 0 });
    h.back({ page: 2, offset: 0 });
    expect(h.canForward).toBe(true);

    h.push({ page: 5, offset: 0 });
    expect(h.canForward).toBe(false);
    expect(h.forward({ page: 5, offset: 0 })).toBeNull();
  });

  it('ignores a push of the same page as the top', () => {
    const h = new JumpHistory();
    h.push({ page: 4, offset: 0 });
    h.push({ page: 4, offset: 0.5 });

    expect(h.back({ page: 9, offset: 0 })).toEqual({ page: 4, offset: 0 });
    expect(h.canBack).toBe(false);
  });

  it('keeps at most 50 entries', () => {
    const h = new JumpHistory();
    for (let p = 1; p <= 51; p++) h.push({ page: p, offset: 0 });

    let count = 0;
    let current = { page: 100, offset: 0 };
    while (h.canBack) {
      current = h.back(current)!;
      count++;
    }
    expect(count).toBe(50);
    expect(current.page).toBe(2);
  });

  it('back and forward return null when empty, and clear empties both stacks', () => {
    const h = new JumpHistory();
    expect(h.back({ page: 1, offset: 0 })).toBeNull();
    expect(h.forward({ page: 1, offset: 0 })).toBeNull();

    h.push({ page: 1, offset: 0 });
    h.back({ page: 2, offset: 0 });
    h.clear();
    expect(h.canBack).toBe(false);
    expect(h.canForward).toBe(false);
  });
});
