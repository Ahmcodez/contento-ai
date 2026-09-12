const YtDlpProvider = require('./YtDlpProvider');
const { matchesHost } = require('./URLProvider');

const ALLOWED_HOSTS = ['dropbox.com', 'www.dropbox.com', 'dl.dropboxusercontent.com'];

class DropboxProvider extends YtDlpProvider {
  get name() {
    return 'dropbox';
  }

  canHandle(url) {
    return matchesHost(url, ALLOWED_HOSTS);
  }
}

module.exports = DropboxProvider;
