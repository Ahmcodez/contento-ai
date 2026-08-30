const connection = require('../src/redis/client');
const { getQueue, closeAllQueues, QUEUE_NAMES } = require('../src/queue/queues');

describe('redis connection resilience config', () => {
  it('keeps maxRetriesPerRequest: null, which BullMQ requires on any connection it manages', () => {
    expect(connection.options.maxRetriesPerRequest).toBeNull();
  });

  it('sets a TCP keepalive, so idle connections against hosted/managed Redis are not silently dropped before either side notices (a common real cause of ECONNRESET)', () => {
    expect(connection.options.keepAlive).toBeGreaterThan(0);
  });

  it('has an explicit retryStrategy that backs off with each attempt and stays capped, rather than growing unbounded or retrying instantly forever', () => {
    const { retryStrategy } = connection.options;
    expect(typeof retryStrategy).toBe('function');

    const delays = [1, 2, 5, 20, 100].map((attempt) => retryStrategy(attempt));
    // Strictly increasing while below the cap...
    expect(delays[0]).toBeLessThan(delays[1]);
    expect(delays[1]).toBeLessThan(delays[2]);
    // ...but never unbounded — a long outage must not turn into
    // multi-minute gaps between reconnect attempts.
    delays.forEach((d) => expect(d).toBeLessThanOrEqual(5000));
  });
});

describe('BullMQ connection-per-consumer (not one shared socket across every queue)', () => {
  afterAll(async () => {
    await closeAllQueues();
  });

  it('gives each Queue its own duplicated connection, not the single shared base connection', () => {
    const queueA = getQueue(QUEUE_NAMES.VIDEO_VALIDATE);
    const queueB = getQueue(QUEUE_NAMES.AUDIO_EXTRACT);

    // Neither queue uses the raw base connection directly...
    expect(queueA.opts.connection).not.toBe(connection);
    expect(queueB.opts.connection).not.toBe(connection);
    // ...and the two queues don't share a connection with each other
    // either — sharing one socket across many BullMQ consumers (Queues
    // holding pipelined commands, Workers holding blocking commands) is
    // exactly the contention pattern that produces spontaneous
    // ECONNRESET under real load.
    expect(queueA.opts.connection).not.toBe(queueB.opts.connection);
  });

  it('getQueue still returns the same Queue instance (and therefore the same connection) on repeated calls for the same name', () => {
    const first = getQueue(QUEUE_NAMES.CLIP_RENDER);
    const second = getQueue(QUEUE_NAMES.CLIP_RENDER);
    expect(first).toBe(second);
    expect(first.opts.connection).toBe(second.opts.connection);
  });

  it('closeAllQueues actually closes each duplicated connection (not just the Queue wrapper), so shutdown does not leak sockets', async () => {
    const queue = getQueue(QUEUE_NAMES.CONTENT_ANALYZE);
    const dup = queue.opts.connection;
    if (dup.status !== 'ready') {
      await new Promise((resolve) => dup.once('ready', resolve));
    }
    expect(dup.status).toBe('ready');

    await closeAllQueues();

    // ioredis flips `.status` to 'close'/'end' via its own socket-close
    // event handling, which can land a tick after quit() resolves — wait
    // for it explicitly rather than assert on a status that may not have
    // settled yet.
    if (!['end', 'close'].includes(dup.status)) {
      await new Promise((resolve) => dup.once('end', resolve));
    }
    expect(['end', 'close']).toContain(dup.status);
  });
});
