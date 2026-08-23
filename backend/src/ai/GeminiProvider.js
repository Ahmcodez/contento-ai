const { AIProvider, AIProviderError } = require('./AIProvider');
const { CONTENT_ANALYSIS_JSON_SCHEMA } = require('./schemas');
const config = require('../config');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Models occasionally wrap JSON in a markdown code fence even when asked
 * for raw JSON. Stripping this is a mechanical, safe recovery step —
 * distinct from "guessing" at malformed content — before we give up and
 * classify the response as unparseable.
 */
function stripMarkdownFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

/**
 * Real Gemini implementation of AIProvider, using the plain HTTP API
 * (no vendor SDK dependency, keeps this adapter self-contained). Requires
 * GEMINI_API_KEY — the factory (./index.js) only constructs this class
 * when AI_PROVIDER=gemini and a key is present.
 */
class GeminiProvider extends AIProvider {
  constructor(apiKey, { model = 'gemini-1.5-flash' } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }

  async callGenerateContent(contents, { systemPrompt, maxTokens, temperature, responseSchema } = {}) {
    const url = `${GEMINI_API_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [{ role: 'user', parts: [{ text: contents }] }],
      generationConfig: {
        maxOutputTokens: maxTokens || 2048,
        temperature: temperature ?? 0.7,
        ...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}),
      },
    };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AIProviderError(`Network error calling Gemini: ${err.message}`, {
        retryable: true,
        reason: 'network_error',
      });
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const text = await response.text().catch(() => '');
      throw new AIProviderError(`Gemini API error (${response.status}): ${text}`, {
        retryable,
        reason: response.status === 429 ? 'rate_limited' : 'provider_error',
      });
    }

    const json = await response.json();
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const usage = {
      inputTokens: json.usageMetadata?.promptTokenCount || 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount || 0,
    };
    return { text, usage };
  }

  async generateText({ prompt, systemPrompt, maxTokens, temperature }) {
    const { text, usage } = await this.callGenerateContent(prompt, { systemPrompt, maxTokens, temperature });
    return { text, usage };
  }

  async generateStructuredOutput({ prompt, systemPrompt, schema, maxTokens }) {
    const { text, usage } = await this.callGenerateContent(prompt, {
      systemPrompt,
      maxTokens,
      responseSchema: schema,
    });

    let data;
    try {
      data = JSON.parse(stripMarkdownFences(text));
    } catch {
      // A response that fails schema/JSON validation is treated as a
      // retryable provider error, not silently passed through malformed
      // (see docs/AI.md §5).
      throw new AIProviderError('Gemini returned a response that could not be parsed as JSON', {
        retryable: true,
        reason: 'invalid_structured_output',
      });
    }
    return { data, usage };
  }

  async analyzeContent({ transcript }) {
    const prompt = `Analyze the following video transcript in depth. Identify: an overall summary, key topics, key points, stories told, strong opinions expressed, educational moments, surprising statements, questions raised, conclusions reached, memorable quotes, and self-contained ideas that could stand alone. Include approximate startMs/endMs timestamps where the transcript text suggests them.\n\nTranscript:\n${transcript}`;
    const { data, usage } = await this.generateStructuredOutput({
      prompt,
      schema: CONTENT_ANALYSIS_JSON_SCHEMA,
      maxTokens: 4096,
    });
    return { ...data, usage };
  }

  async generateSocialContent({ contentType, transcript, analysis }) {
    const prompts = {
      blog: 'Write a blog post (600-900 words) based on this video content.',
      linkedin: 'Write a LinkedIn post (150-250 words) based on this video content.',
      x_twitter: 'Write a single X/Twitter post (under 280 characters) based on this video content.',
      instagram_caption: 'Write an Instagram caption (under 200 words, with relevant hashtags) based on this video content.',
      youtube_description: 'Write a YouTube video description (150-300 words) based on this video content.',
    };
    const instruction = prompts[contentType];
    if (!instruction) {
      throw new AIProviderError(`Unsupported content type: ${contentType}`, { retryable: false, reason: 'invalid_input' });
    }

    const prompt = `${instruction}\n\nVideo summary: ${analysis?.summary || ''}\nKey topics: ${(analysis?.topics || []).join(', ')}\n\nFull transcript for reference:\n${transcript}`;
    const { text, usage } = await this.generateText({ prompt, maxTokens: 1500 });
    return { body: text, usage };
  }
}

module.exports = GeminiProvider;
