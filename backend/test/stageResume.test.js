const { PIPELINE_STATE_TO_STAGE, STAGE_JOB_NAMES, audioKeyFor } = require('../src/queue/stageResume');
const { STAGE_TO_QUEUE } = require('../src/queue/queues');
const { STAGES } = require('../src/workers');
const { STATE_GROUPS, TERMINAL_STATES } = require('../src/services/job.service');

describe('stage resume mapping', () => {
  // job.service's STATE_GROUPS lists every processing state the app knows about,
  // so it is the reference for "did someone add a state and forget the mapping".
  const knownStates = Object.keys(STATE_GROUPS);

  test('every in-progress state except UPLOADING (an upload in flight) maps to a stage', () => {
    const inProgress = knownStates.filter((s) => !TERMINAL_STATES.has(s) && s !== 'UPLOADING');
    expect(Object.keys(PIPELINE_STATE_TO_STAGE).sort()).toEqual(inProgress.sort());
  });

  test('every mapped stage is a real routed stage with a registered worker job name', () => {
    for (const stage of new Set(Object.values(PIPELINE_STATE_TO_STAGE))) {
      expect(STAGE_TO_QUEUE[stage]).toBeDefined();
      expect(STAGE_JOB_NAMES[stage]).toBe(STAGES[stage].jobName);
    }
  });

  test('audio key matches the one audio.extract writes', () => {
    expect(audioKeyFor('ws/proj/ULID123.mp4')).toBe('ws/proj/ULID123.audio.wav');
  });
});
