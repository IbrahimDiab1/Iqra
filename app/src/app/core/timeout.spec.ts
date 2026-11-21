import { TimeoutError, withTimeout } from './timeout';

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('passes the result of work that finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it('passes the failure of work that fails in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError when the work never settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = withTimeout(new Promise<void>(() => {}), 500).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBeInstanceOf(TimeoutError);
  });
});
