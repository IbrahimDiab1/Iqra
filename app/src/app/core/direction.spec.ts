import { effectiveDirection, isRtl } from './direction';

describe('effectiveDirection', () => {
  it('follows the detected direction on auto or when nothing was chosen', () => {
    expect(effectiveDirection({ direction: 'rtl' })).toBe('rtl');
    expect(effectiveDirection({ direction: 'ltr', textDirection: 'auto' })).toBe('ltr');
  });
  it('lets the reader override detection either way', () => {
    expect(effectiveDirection({ direction: 'rtl', textDirection: 'ltr' })).toBe('ltr');
    expect(effectiveDirection({ direction: 'ltr', textDirection: 'rtl' })).toBe('rtl');
    expect(isRtl({ direction: 'ltr', textDirection: 'rtl' })).toBe(true);
    expect(isRtl(null)).toBe(false);
  });
});
