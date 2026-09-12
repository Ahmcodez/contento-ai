const YtDlpProvider = require('./YtDlpProvider');
const { matchesHost } = require('./URLProvider');

const ALLOWED_HOSTS = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'];

class TikTokProvider extends YtDlpProvider {
  get name() {
    return 'tiktok';
  }

  canHandle(url) {
    return matchesHost(url, ALLOWED_HOSTS);
  }
}

module.exports = TikTokProvider;
