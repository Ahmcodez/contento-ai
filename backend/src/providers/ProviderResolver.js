const { ProviderError } = require('./URLProvider');
const YouTubeProvider = require('./YouTubeProvider');
const VimeoProvider = require('./VimeoProvider');
const TikTokProvider = require('./TikTokProvider');
const DropboxProvider = require('./DropboxProvider');
const DirectMediaProvider = require('./DirectMediaProvider');

/**
 * Registered in priority order: specific providers (YouTube, Vimeo,
 * TikTok, Dropbox — each a strict hostname allowlist, see
 * URLProvider.js's matchesHost) are checked before the permissive
 * extension-based DirectMediaProvider fallback, so e.g. a YouTube share
 * URL is never accidentally treated as a direct file.
 *
 * Adding a provider is exactly: write a class implementing URLProvider
 * (src/providers/URLProvider.js) and add an instance to this array —
 * nothing else in the ingestion pipeline (service/controller/queue/
 * processors) ever branches on provider identity.
 */
const PROVIDERS = [
  new YouTubeProvider(),
  new VimeoProvider(),
  new TikTokProvider(),
  new DropboxProvider(),
  new DirectMediaProvider(),
];

/**
 * Returns the first registered provider whose canHandle(url) matches.
 * Throws ProviderError('unsupported_provider') if none do — this is
 * the DETECTING_PROVIDER stage's only real job.
 */
function resolveProvider(url) {
  const provider = PROVIDERS.find((p) => p.canHandle(url));
  if (!provider) {
    throw new ProviderError(
      'This URL is not from a supported source. Supported: YouTube, Vimeo, TikTok, Dropbox, and direct video file links (.mp4, .mov, .mkv, .webm).',
      { retryable: false, reason: 'unsupported_provider', statusCode: 422 },
    );
  }
  return provider;
}

function getProviderByName(name) {
  return PROVIDERS.find((p) => p.name === name) || null;
}

module.exports = { resolveProvider, getProviderByName, PROVIDERS };
