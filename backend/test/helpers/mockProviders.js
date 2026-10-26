/**
 * Canned AI + transcription providers for the real-worker e2e tests. Only these
 * two network boundaries are faked; everything else (DB, Redis, ffmpeg, workers)
 * is real. Install with installMockProviders() in beforeAll and remove with
 * removeMockProviders() in afterAll; the jest.mock('../src/ai') /
 * jest.mock('../src/transcription') calls in the test file read from these globals.
 */
/**
 * Answers the analysis / clip-proposal prompts the way the real model is instructed to:
 * by line id. Reads the "[id] text" lines out of the prompt and proposes one clip that
 * starts at the first line (hook = its opening words, verbatim) and ends at the last.
 */
function answerAnalysisPrompt(prompt) {
  const body = prompt.slice(prompt.indexOf('<transcript>'));
  const lines = [...body.matchAll(/^\[(\d+)\] (.+)$/gm)].map((m) => ({ id: Number(m[1]), text: m[2] }));
  const first = lines[0] || { id: 0, text: 'Opening words of the video' };
  const last = lines[lines.length - 1] || first;
  const hook = first.text.split(' ').slice(0, 6).join(' ');
  return {
    summary: 'A personal story about a failed startup and what it taught the speaker about persistence.',
    topics: ['entrepreneurship', 'failure', 'persistence'],
    keyPoints: [{ text: 'Persistence matters more than raw talent', startLine: last.id }],
    stories: [{ text: 'First startup failing', startLine: first.id, endLine: last.id }],
    strongOpinions: [],
    educationalMoments: [],
    surprisingStatements: [],
    questions: [],
    conclusions: [],
    memorableQuotes: [{ text: 'persistence matters more than raw talent', startLine: last.id }],
    selfContainedIdeas: [],
    clips: [
      {
        startLine: first.id,
        endLine: last.id,
        hook,
        title: 'From startup failure to hard-won lesson',
        summary: 'A short story about startup failure and the lesson learned from it.',
        reason: 'Complete narrative arc with a clear takeaway',
        topic: 'entrepreneurship',
        score: 82,
      },
    ],
  };
}

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
    generateStructuredOutput: jest.fn(async ({ prompt }) => ({ data: answerAnalysisPrompt(prompt), usage: { inputTokens: 5, outputTokens: 5 } })),
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

module.exports = { installMockProviders, removeMockProviders, answerAnalysisPrompt };
