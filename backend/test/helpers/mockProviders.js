/**
 * Canned AI + transcription providers for the real-worker e2e tests. Only these
 * two network boundaries are faked; everything else (DB, Redis, ffmpeg, workers)
 * is real. Install with installMockProviders() in beforeAll and remove with
 * removeMockProviders() in afterAll; the jest.mock('../src/ai') /
 * jest.mock('../src/transcription') calls in the test file read from these globals.
 */
function installMockProviders() {
  global.__mockTranscriptionProvider = {
    transcribe: jest.fn().mockResolvedValue({
      fullText: 'Welcome to the show. Today I want to tell you a surprising story about my first startup failing. It taught me that persistence matters more than raw talent.',
      language: 'en',
      segments: [
        { startMs: 0, endMs: 2000, text: 'Welcome to the show.' },
        { startMs: 2000, endMs: 6000, text: 'Today I want to tell you a surprising story about my first startup failing.' },
        { startMs: 6000, endMs: 9000, text: 'It taught me that persistence matters more than raw talent.' },
      ],
    }),
  };
  global.__mockAIProvider = {
    constructor: { name: 'MockAIProvider' },
    generateStructuredOutput: jest.fn(async ({ prompt }) => {
      if (prompt.includes('clip moments')) {
        return {
          data: {
            clips: [{
              startMs: 2000, endMs: 9000, title: 'From failure to lesson', hook: 'My first startup failed — here is what it taught me',
              summary: 'A short story about startup failure.', reason: 'Complete arc', topic: 'entrepreneurship', estimatedQualityScore: 82,
            }],
          },
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
      return {
        data: {
          summary: 'A personal story about a failed startup.', topics: ['entrepreneurship'],
          keyPoints: [{ text: 'Persistence matters', startMs: 6000, endMs: 9000 }], stories: [{ text: 'First startup failing', startMs: 2000, endMs: 6000 }],
          strongOpinions: [], educationalMoments: [], surprisingStatements: [], questions: [], conclusions: [],
          memorableQuotes: [{ text: 'persistence matters more than raw talent', startMs: 6000, endMs: 9000 }], selfContainedIdeas: [],
        },
        usage: { inputTokens: 5, outputTokens: 5 },
      };
    }),
    generateText: jest.fn(async () => ({
      text: 'A grounded piece of written content generated from the transcript, discussing the startup failure and the persistence lesson.',
      usage: { inputTokens: 5, outputTokens: 5 },
    })),
  };
}

function removeMockProviders() {
  delete global.__mockAIProvider;
  delete global.__mockTranscriptionProvider;
}

module.exports = { installMockProviders, removeMockProviders };
