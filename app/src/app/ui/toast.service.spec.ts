import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows one toast at a time, a new one replacing the old', () => {
    service.show('A');
    service.show('B');
    expect(service.current()?.message).toBe('B');
  });

  it('dismisses itself after the default 4000 ms', () => {
    service.show('A');
    vi.advanceTimersByTime(3999);
    expect(service.current()?.message).toBe('A');
    vi.advanceTimersByTime(1);
    expect(service.current()).toBeNull();
  });

  it('runs undo once and dismisses the toast', () => {
    const spy = vi.fn();
    service.show('X', { undo: spy });
    service.undo();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(service.current()).toBeNull();
  });
});
