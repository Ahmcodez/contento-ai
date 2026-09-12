const YtDlpProvider = require('./YtDlpProvider');
const { matchesHost } = require('./URLProvider');

const ALLOWED_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];

class YouTubeProvider extends YtDlpProvider {
  get name() {
    return 'youtube';
  }

  canHandle(url) {
    return matchesHost(url, ALLOWED_HOSTS);
  }
}

module.exports = YouTubeProvider;
