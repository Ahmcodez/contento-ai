/**
 * What a visitor is told when something goes wrong. Written for the public tool: the import flow's
 * messages mention "importing", and some runner errors describe how the server is set up
 * (e.g. where yt-dlp should be installed), which must never be shown to an anonymous visitor.
 * Keyed by ProviderError.reason; anything unknown gets the safe generic line.
 */
const GENERIC = 'The video could not be downloaded right now. Please try again in a moment.';

const BY_REASON = {
  private_video: 'This video is private, so it can\u2019t be downloaded.',
  unavailable: 'This video is unavailable. It may have been removed or the link may be wrong.',
  authentication_required: 'This video needs a sign-in to watch (for example it is age-restricted, members-only, or the site asked for a check), so it can\u2019t be downloaded here.',
  geo_restricted: 'This video isn\u2019t available in the region our servers are in.',
  unsupported_provider: 'This link isn\u2019t from a supported site.',
  too_large: 'This video is larger than the free downloader\u2019s size limit. Try a lower quality or audio only.',
  no_audio_after_merge: 'The video could not be downloaded with sound. Please try again or pick another quality.',
  timeout: 'The video site took too long to respond. Please try again.',
  extraction_failed: GENERIC,
  not_configured: 'The video downloader is temporarily unavailable. Please try again later.',
};

function messageFor(reason) {
  return BY_REASON[reason] || GENERIC;
}

module.exports = { messageFor, GENERIC };
