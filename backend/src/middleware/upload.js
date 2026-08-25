const multer = require('multer');
const fs = require('fs');
const path = require('path');
const config = require('../config');

fs.mkdirSync(path.resolve(config.storage.tmpPath), { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.resolve(config.storage.tmpPath)),
  filename: (req, file, cb) => {
    // Temp filename only — never used as the final storage key.
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.limits.maxUploadSizeMb * 1024 * 1024,
    files: 1,
  },
});

module.exports = upload;
