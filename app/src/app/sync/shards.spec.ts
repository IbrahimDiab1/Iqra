import { shardFor } from './shards';

describe('shardFor', () => {
  it('maps sessions to a UTC year-month file', () => {
    expect(shardFor('sessions', { startedAt: Date.UTC(2026, 10, 30, 23) } as never)).toBe(
      'sessions-2026-11.json',
    );
  });

  it('keeps the language notebook in review.json', () => {
    expect(shardFor('review', { id: 'r' } as never)).toBe('review.json');
  });
});
