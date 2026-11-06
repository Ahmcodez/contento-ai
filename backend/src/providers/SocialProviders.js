const YtDlpProvider = require('./YtDlpProvider');
const { matchesHost } = require('./URLProvider');

/**
 * More sources yt-dlp can read. Same shape as YouTube/Vimeo/TikTok: a strict hostname
 * allowlist (never a substring match) decides which URLs ever reach yt-dlp, and yt-dlp
 * does the rest. Which of these actually work for a given video depends on the site
 * (some need the video to be public, some change often); a failure comes back as a clear,
 * non-retryable message rather than a crash.
 */
function makeProvider(name, hosts) {
  return class extends YtDlpProvider {
    get name() {
      return name;
    }

    canHandle(url) {
      return matchesHost(url, hosts);
    }
  };
}

const FacebookProvider = makeProvider('facebook', ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch']);
const InstagramProvider = makeProvider('instagram', ['instagram.com', 'www.instagram.com']);
const TwitterProvider = makeProvider('twitter', ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com']);
const DailymotionProvider = makeProvider('dailymotion', ['dailymotion.com', 'www.dailymotion.com', 'dai.ly']);
const RedditProvider = makeProvider('reddit', ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'v.redd.it']);

module.exports = { FacebookProvider, InstagramProvider, TwitterProvider, DailymotionProvider, RedditProvider };
