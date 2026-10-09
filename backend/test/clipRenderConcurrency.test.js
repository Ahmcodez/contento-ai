const processClipRender = require('../src/workers/processors/clipRender.processor');

const { mapWithConcurrency } = processClipRender;

describe('mapWithConcurrency (clip render pool)', () => {
  it('never runs more than `limit` tasks at once', async () => {
    let current = 0;
    let max = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      current += 1;
      max = Math.max(max, current);
      await new Promise((r) => { setTimeout(r, 20); });
      current -= 1;
    });
    expect(max).toBe(2);
  });

  it('preserves result order regardless of completion order', async () => {
    const delays = [30, 10, 20, 5];
    const results = await mapWithConcurrency(delays, 4, async (ms, i) => {
      await new Promise((r) => { setTimeout(r, ms); });
      return i;
    });
    expect(results.map((r) => r.value)).toEqual([0, 1, 2, 3]);
  });

  it('isolates a failing task by its array position: others still complete, no abort/skip', async () => {
    const results = await mapWithConcurrency(['a', 'b', 'c', 'd'], 2, async (value, index) => {
      if (index === 2) throw new Error('clip at index 2 failed');
      return `${value}-ok`;
    });
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled']);
    expect(results[2].reason.message).toBe('clip at index 2 failed');
    expect(results[0].value).toBe('a-ok');
    expect(results[3].value).toBe('d-ok');
  });

  it('passes both the item value and its index to the worker, in that order', async () => {
    const seen = [];
    await mapWithConcurrency(['x', 'y'], 1, async (value, index) => {
      seen.push([value, index]);
    });
    expect(seen).toEqual([['x', 0], ['y', 1]]);
  });

  it('handles every task failing', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async () => {
      throw new Error('boom');
    });
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('handles an empty list', async () => {
    const results = await mapWithConcurrency([], 2, async () => 'never called');
    expect(results).toEqual([]);
  });

  it('handles a single item', async () => {
    const results = await mapWithConcurrency(['x'], 3, async (v) => v.toUpperCase());
    expect(results).toEqual([{ status: 'fulfilled', value: 'X' }]);
  });

  it('a limit higher than the item count runs them all concurrently, not sequentially', async () => {
    const start = Date.now();
    await mapWithConcurrency([1, 2, 3], 10, async () => {
      await new Promise((r) => { setTimeout(r, 50); });
    });
    // sequential would take ~150ms; concurrent should take ~50ms
    expect(Date.now() - start).toBeLessThan(120);
  });

  it('a limit of 1 is equivalent to the old fully-sequential behavior', async () => {
    const order = [];
    await mapWithConcurrency([1, 2, 3], 1, async (i) => {
      order.push(`start-${i}`);
      await new Promise((r) => { setTimeout(r, 10); });
      order.push(`end-${i}`);
    });
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  });
});
