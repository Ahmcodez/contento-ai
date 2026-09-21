const { Queue, Worker } = require('bullmq');
const connection = require('../src/redis/client');
const config = require('../src/config');
const metrics = require('../src/metrics');
const {
  QUEUE_NAMES,
  PHYSICAL_QUEUES,
  STAGE_TO_QUEUE,
  LEGACY_QUEUE_TO_STAGE,
  RETRY_CONFIG,
  getQueue,
  getPhysicalQueue,
  closeAllQueues,
} = require('../src/queue/queues');
const { buildDispatcher, buildWorkerGroups, STAGES } = require('../src/workers');
const { migrateLegacyQueues } = require('../src/queue/legacyMigration');

const own = () => connection.duplicate();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 8000, step = 50 } = {}) {
  const start = Date.now();
   
  while (Date.now() - start < timeout) {
     
    if (await fn()) return true;
     
    await sleep(step);
  }
  return false;
}

afterAll(async () => {
  await closeAllQueues();
});

describe('queue routing integrity', () => {
  it('routes every logical stage to exactly one physical queue, and every physical queue carries a stage', () => {
    const stages = Object.values(QUEUE_NAMES);
    expect(Object.keys(STAGE_TO_QUEUE).sort()).toEqual([...stages].sort());
    const physical = new Set(Object.values(STAGE_TO_QUEUE));
    expect([...physical].sort()).toEqual(Object.values(PHYSICAL_QUEUES).sort());
    expect(physical.size).toBe(5);
  });

  it('every stage has a handler, a unique job name and a retry policy', () => {
    const jobNames = new Set();
    for (const stage of Object.values(QUEUE_NAMES)) {
      expect(typeof STAGES[stage].handler).toBe('function');
      expect(STAGES[stage].jobName).toEqual(expect.any(String));
      expect(jobNames.has(STAGES[stage].jobName)).toBe(false);
      jobNames.add(STAGES[stage].jobName);
      expect(RETRY_CONFIG[stage].attempts).toBeGreaterThanOrEqual(1);
    }
  });

  it('getQueue(stage) returns the shared physical Queue; unknown stages throw', () => {
    expect(getQueue(QUEUE_NAMES.VIDEO_VALIDATE)).toBe(getQueue(QUEUE_NAMES.AUDIO_EXTRACT));
    expect(getQueue(QUEUE_NAMES.VIDEO_VALIDATE)).toBe(getPhysicalQueue(PHYSICAL_QUEUES.LIGHT));
    expect(() => getQueue('not-a-stage')).toThrow(/Unknown queue stage/);
  });
});

describe('resource isolation is preserved (guards against future accidental merges)', () => {
  const carried = (queue) => Object.keys(STAGE_TO_QUEUE).filter((s) => STAGE_TO_QUEUE[s] === queue);

  it('the heavy stages each keep a queue to themselves', () => {
    expect(carried(PHYSICAL_QUEUES.RENDER)).toEqual([QUEUE_NAMES.CLIP_RENDER]);
    expect(carried(PHYSICAL_QUEUES.TRANSCRIPTION)).toEqual([QUEUE_NAMES.TRANSCRIPTION_PROCESS]);
    expect(carried(PHYSICAL_QUEUES.DOWNLOAD)).toEqual([QUEUE_NAMES.URL_IMPORT_DOWNLOAD]);
  });

  it('the shared queues carry only the compatible stages', () => {
    expect(carried(PHYSICAL_QUEUES.LIGHT).sort()).toEqual(
      [QUEUE_NAMES.URL_IMPORT_RESOLVE, QUEUE_NAMES.VIDEO_VALIDATE, QUEUE_NAMES.AUDIO_EXTRACT, QUEUE_NAMES.JOB_FINALIZE].sort(),
    );
    expect(carried(PHYSICAL_QUEUES.AI).sort()).toEqual(
      [QUEUE_NAMES.CONTENT_ANALYZE, QUEUE_NAMES.CLIPS_DETECT, QUEUE_NAMES.CONTENT_GENERATE].sort(),
    );
  });

  it('keeps transcription at concurrency 1 and gives the shared queues the documented slots', () => {
    const byQueue = Object.fromEntries(buildWorkerGroups().map((g) => [g.queue, g.concurrency]));
    expect(byQueue[PHYSICAL_QUEUES.TRANSCRIPTION]).toBe(config.queue.concurrencyTranscription);
    expect(byQueue[PHYSICAL_QUEUES.TRANSCRIPTION]).toBe(1);
    expect(byQueue[PHYSICAL_QUEUES.RENDER]).toBe(config.queue.concurrencyDefault);
    expect(byQueue[PHYSICAL_QUEUES.DOWNLOAD]).toBe(config.queue.concurrencyDefault);
    expect(byQueue[PHYSICAL_QUEUES.LIGHT]).toBe(config.queue.concurrencyLight);
    // AI default = old 3 queues x 2, so worst-case simultaneous provider calls is unchanged
    expect(byQueue[PHYSICAL_QUEUES.AI]).toBe(config.queue.concurrencyAi);
    expect(config.queue.concurrencyAi).toBe(3 * config.queue.concurrencyDefault);
  });
});

describe('retry policy survives sharing a queue', () => {
  it('jobs from different stages on one queue keep their own attempts/backoff', async () => {
    const queue = getQueue(QUEUE_NAMES.VIDEO_VALIDATE);
    await queue.drain();
    const validate = await queue.add('video.validate', { processingJobId: 'r1' }, { ...RETRY_CONFIG[QUEUE_NAMES.VIDEO_VALIDATE] });
    const audio = await queue.add('audio.extract', { processingJobId: 'r2' }, { ...RETRY_CONFIG[QUEUE_NAMES.AUDIO_EXTRACT] });
    const finalize = await getQueue(QUEUE_NAMES.JOB_FINALIZE).add(
      'job.finalize',
      { processingJobId: 'r3' },
      { ...RETRY_CONFIG[QUEUE_NAMES.JOB_FINALIZE] },
    );
    expect(validate.opts.attempts).toBe(1);
    expect(audio.opts).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    expect(finalize.opts).toMatchObject({ attempts: 3, backoff: { type: 'fixed', delay: 2000 } });
    await queue.drain();
  });

  it('a real shared Worker retries each job by its own policy and runs them concurrently', async () => {
    const name = `test-shared-${Date.now()}`;
    const q = new Queue(name, { connection: own() });
    const calls = { flaky: 0, steady: 0 };
    const worker = new Worker(
      name,
      buildDispatcher(name, [
        {
          stage: 'flaky-stage',
          jobName: 'flaky.job',
          handler: async () => {
            calls.flaky += 1;
            if (calls.flaky === 1) throw new Error('transient');
          },
        },
        {
          stage: 'steady-stage',
          jobName: 'steady.job',
          handler: async () => {
            calls.steady += 1;
          },
        },
      ]),
      { connection: own(), concurrency: 2, drainDelay: 30 },
    );
    try {
      await worker.waitUntilReady();
      await q.add('flaky.job', { processingJobId: 'x' }, { attempts: 3, backoff: { type: 'fixed', delay: 200 } });
      await q.add('steady.job', { processingJobId: 'y' }, { attempts: 1 });
      const done = await waitFor(async () => (await q.getJobCounts('completed')).completed === 2);
      expect(done).toBe(true);
      expect(calls).toEqual({ flaky: 2, steady: 1 }); // flaky retried once, steady never
    } finally {
      await worker.close();
      await worker.opts.connection.quit().catch(() => {});
      await q.obliterate({ force: true });
      await q.close();
    }
  });
});

describe('dispatcher', () => {
  it('routes by job name and records metrics/logs under the LOGICAL stage name', async () => {
    const seen = [];
    const dispatch = buildDispatcher('any-queue', [
      { stage: QUEUE_NAMES.VIDEO_VALIDATE, jobName: 'video.validate', handler: async (j) => seen.push(['v', j.id]) },
      { stage: QUEUE_NAMES.AUDIO_EXTRACT, jobName: 'audio.extract', handler: async (j) => seen.push(['a', j.id]) },
    ]);
    const mk = (name, id) => ({ id, name, data: { processingJobId: 'p' }, opts: { attempts: 1 }, attemptsMade: 0 });
    await dispatch(mk('audio.extract', '1'));
    await dispatch(mk('video.validate', '2'));
    expect(seen).toEqual([['a', '1'], ['v', '2']]);
    const snap = JSON.stringify(metrics.snapshot());
    expect(snap).toContain('stage_completed{stage=audio-extract}');
    expect(snap).toContain('stage_completed{stage=video-validate}');
  });

  it('fails an unknown job name immediately and unrecoverably (no wasted retries)', async () => {
    const dispatch = buildDispatcher('any-queue', []);
    await expect(dispatch({ id: '9', name: 'mystery.job', data: {}, opts: {}, attemptsMade: 0 })).rejects.toMatchObject({
      name: 'UnrecoverableError',
      message: expect.stringContaining('mystery.job'),
    });
  });
});

describe('legacy in-flight job migration', () => {
  const legacyNames = Object.keys(LEGACY_QUEUE_TO_STAGE);
  const legacy = {};

  async function cleanTargets() {
    await getPhysicalQueue(PHYSICAL_QUEUES.LIGHT).obliterate({ force: true }).catch(() => {});
    await getPhysicalQueue(PHYSICAL_QUEUES.AI).obliterate({ force: true }).catch(() => {});
  }

  beforeEach(async () => {
    await cleanTargets();
    for (const n of ['video-validate', 'content-analyze']) {
      legacy[n] = new Queue(n, { connection: own() });
       
      await legacy[n].obliterate({ force: true }).catch(() => {});
    }
  });

  afterEach(async () => {
    for (const n of Object.keys(legacy)) {
       
      await legacy[n].obliterate({ force: true }).catch(() => {});
       
      await legacy[n].close();
       
      await legacy[n].opts.connection.quit().catch(() => {});
      delete legacy[n];
    }
    await cleanTargets();
  });

  it('covers exactly the queues that were folded away; standalone queues keep their names', () => {
    expect(legacyNames.sort()).toEqual(
      ['audio-extract', 'clips-detect', 'content-analyze', 'content-generate', 'job-finalize', 'url-import-resolve', 'video-validate'].sort(),
    );
    for (const standalone of ['url-import-download', 'transcription-process', 'clip-render']) {
      expect(legacyNames).not.toContain(standalone);
    }
  });

  it('moves waiting and delayed jobs, keeping data, name, remaining retries and due time', async () => {
    await legacy['video-validate'].add('video.validate', { processingJobId: 'w1', mediaAssetId: 'm1' }, { attempts: 1 });
    const delayedJob = await legacy['content-analyze'].add(
      'content.analyze',
      { processingJobId: 'd1' },
      { attempts: 4, delay: 60000, backoff: { type: 'exponential', delay: 3000 } },
    );
    // pretend 2 of 4 attempts were already used
    const client = await legacy['content-analyze'].client;
    await client.hset(`bull:content-analyze:${delayedJob.id}`, 'atm', 2);

    const results = await migrateLegacyQueues({ connection, force: true });
    const total = results.reduce((n, r) => n + r.moved, 0);
    expect(total).toBe(2);

    const light = getPhysicalQueue(PHYSICAL_QUEUES.LIGHT);
    const [moved] = await light.getJobs(['waiting']);
    expect(moved).toMatchObject({ name: 'video.validate', data: { processingJobId: 'w1', mediaAssetId: 'm1' } });

    const ai = getPhysicalQueue(PHYSICAL_QUEUES.AI);
    const [movedDelayed] = await ai.getJobs(['delayed']);
    expect(movedDelayed.name).toBe('content.analyze');
    expect(movedDelayed.opts.attempts).toBe(2); // 4 - 2 already made: no fresh retry budget
    expect(movedDelayed.opts.backoff).toEqual({ type: 'exponential', delay: 3000 });
    const dueInMs = movedDelayed.timestamp + movedDelayed.opts.delay - Date.now();
    expect(dueInMs).toBeGreaterThan(50000);
    expect(dueInMs).toBeLessThanOrEqual(60000);

    // originals are gone from the legacy queues
    expect((await legacy['video-validate'].getJobCounts('waiting')).waiting).toBe(0);
    expect((await legacy['content-analyze'].getJobCounts('delayed')).delayed).toBe(0);
  });

  it('dry-run reports but changes nothing', async () => {
    await legacy['video-validate'].add('video.validate', { processingJobId: 'dry' }, { attempts: 1 });
    const results = await migrateLegacyQueues({ connection, force: true, dryRun: true });
    expect(results.find((r) => r.legacy === 'video-validate').moved).toBe(1);
    expect((await legacy['video-validate'].getJobCounts('waiting')).waiting).toBe(1);
    expect((await getPhysicalQueue(PHYSICAL_QUEUES.LIGHT).getJobCounts('waiting')).waiting).toBe(0);
  });

  it('refuses to migrate while an old worker is still attached to a legacy queue', async () => {
    const oldWorker = new Worker('video-validate', async () => {}, { connection: own(), drainDelay: 30 });
    try {
      await oldWorker.waitUntilReady();
      await legacy['video-validate'].add('video.validate', { processingJobId: 'live' }, { attempts: 1 });
      await expect(migrateLegacyQueues({ connection })).rejects.toThrow(/live worker|Stop the old worker/);
      // nothing moved
      expect((await getPhysicalQueue(PHYSICAL_QUEUES.LIGHT).getJobCounts('waiting')).waiting).toBe(0);
    } finally {
      await oldWorker.close();
      await oldWorker.opts.connection.quit().catch(() => {});
    }
  });

  it('--obliterate removes the emptied legacy queue', async () => {
    await legacy['video-validate'].add('video.validate', { processingJobId: 'o1' }, { attempts: 1 });
    const results = await migrateLegacyQueues({ connection, force: true, obliterate: true });
    expect(results.find((r) => r.legacy === 'video-validate').obliterated).toBe(true);
    const keys = await (await legacy['video-validate'].client).keys('bull:video-validate:*');
    expect(keys).toEqual([]);
  });
});
