const { buildPrompt, formatAnalysisSignals } = require('../src/services/clipDetection.service');

const baseTranscript = { fullText: 'Some transcript text.' };
const baseAnalysis = { topics: ['t1'], summary: 'A summary.' };

describe('clip-detection prompt surfaces story/quote/opinion data (real gap: this used to be discarded)', () => {
  it('includes a listed story with its timestamp when the analysis has one', () => {
    const analysis = {
      ...baseAnalysis,
      stories: [{ text: 'The time the server caught fire during the demo.', startMs: 125000 }],
    };
    const prompt = buildPrompt(baseTranscript, analysis);
    expect(prompt).toContain('Notable stories/anecdotes');
    expect(prompt).toContain('The time the server caught fire during the demo.');
    expect(prompt).toContain('[2:05]'); // 125000ms = 2:05
  });

  it('includes memorable quotes, surprising statements and strong opinions when present', () => {
    const analysis = {
      ...baseAnalysis,
      memorableQuotes: [{ text: 'Quote text.', startMs: 1000 }],
      surprisingStatements: [{ text: 'Surprising text.', startMs: 2000 }],
      strongOpinions: [{ text: 'Hot take text.', startMs: 3000 }],
    };
    const prompt = buildPrompt(baseTranscript, analysis);
    expect(prompt).toContain('Memorable quotes');
    expect(prompt).toContain('Quote text.');
    expect(prompt).toContain('Surprising statements');
    expect(prompt).toContain('Surprising text.');
    expect(prompt).toContain('Strong opinions/hot takes');
    expect(prompt).toContain('Hot take text.');
  });

  it('omits categories entirely absent from the analysis, rather than printing an empty heading', () => {
    const prompt = buildPrompt(baseTranscript, baseAnalysis); // no stories/quotes/etc.
    expect(prompt).not.toContain('Notable stories/anecdotes');
    expect(prompt).not.toContain('Memorable quotes');
    expect(prompt).not.toContain('Surprising statements');
    expect(prompt).not.toContain('Strong opinions/hot takes');
  });

  it('omits unused categories (keyPoints, conclusions, etc.) even when present, to control prompt/token cost', () => {
    const analysis = { ...baseAnalysis, keyPoints: [{ text: 'A key point.' }], conclusions: [{ text: 'A conclusion.' }] };
    const prompt = buildPrompt(baseTranscript, analysis);
    expect(prompt).not.toContain('A key point.');
    expect(prompt).not.toContain('A conclusion.');
  });

  it('handles an item with no startMs (omits the timestamp prefix, keeps the text)', () => {
    const analysis = { ...baseAnalysis, stories: [{ text: 'No timestamp story.' }] };
    const prompt = buildPrompt(baseTranscript, analysis);
    expect(prompt).toContain('- No timestamp story.');
    expect(prompt).not.toContain('[undefined]');
    expect(prompt).not.toContain('[NaN');
  });

  it('caps each category at 12 items to bound prompt growth on long content (e.g. a 2-hour podcast)', () => {
    const manyStories = Array.from({ length: 30 }, (_, i) => ({ text: `Story number ${i}`, startMs: i * 1000 }));
    const prompt = buildPrompt(baseTranscript, { ...baseAnalysis, stories: manyStories });
    expect(prompt).toContain('Story number 0');
    expect(prompt).toContain('Story number 11');
    expect(prompt).not.toContain('Story number 12');
    expect(prompt).not.toContain('Story number 29');
  });

  it('formatAnalysisSignals returns an empty string when the analysis has none of the relevant categories', () => {
    expect(formatAnalysisSignals(baseAnalysis)).toBe('');
  });

  it('still includes the existing summary/topics and full transcript (no regression)', () => {
    const prompt = buildPrompt(baseTranscript, { ...baseAnalysis, stories: [{ text: 'A story.', startMs: 0 }] });
    expect(prompt).toContain('Key topics: t1');
    expect(prompt).toContain('Summary: A summary.');
    expect(prompt).toContain('Some transcript text.');
  });
});
