const { enqueueVideoValidate } = require('../src/queue/producers');
const { QUEUE_NAMES, getQueue, closeAllQueues } = require('../src/queue/queues');

describe('queue producers', () => {
  afterAll(async () => {
    await closeAllQueues();
  });

  it('enqueues a video.validate job with the expected payload', async () => {
    const queue = getQueue(QUEUE_NAMES.VIDEO_VALIDATE);
    await queue.drain();

    const job = await enqueueVideoValidate({ processingJobId: 'job-1', mediaAssetId: 'asset-1' });

    expect(job.name).toBe('video.validate');
    expect(job.data).toEqual({ processingJobId: 'job-1', mediaAssetId: 'asset-1' });

    const fetched = await queue.getJob(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched.data.mediaAssetId).toBe('asset-1');
  });

  it('gives the video.validate queue a non-retrying config since validation failures are deterministic', async () => {
    const job = await enqueueVideoValidate({ processingJobId: 'job-2', mediaAssetId: 'asset-2' });
    expect(job.opts.attempts).toBe(1);
  });
});
