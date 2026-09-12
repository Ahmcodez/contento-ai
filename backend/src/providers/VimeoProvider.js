const YtDlpProvider = require('./YtDlpProvider');
const { matchesHost } = require('./URLProvider');

const ALLOWED_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];

class VimeoProvider extends YtDlpProvider {
  get name() {
    return 'vimeo';
  }

  canHandle(url) {
    return matchesHost(url, ALLOWED_HOSTS);
  }
}

module.exports = VimeoProvider;
