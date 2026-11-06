const asyncHandler = require('../utils/asyncHandler');
const downloader = require('../tools/downloader/service');
const { sendMedia } = require('../utils/sendMedia');

const info = asyncHandler(async (req, res) => {
  res.status(200).json(await downloader.getInfo(req.body.url));
});

const create = asyncHandler(async (req, res) => {
  res.status(202).json(await downloader.createDownload(req.body.url, req.body.optionId, req.ip));
});

const status = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json(await downloader.getStatus(req.params.id));
});

/** The file itself: opened by plain navigation (an <a href>), so no JSON, no auth header, only the unguessable id. */
const file = asyncHandler(async (req, res) => {
  const result = await downloader.openFile(req.params.id, req.headers.range);
  // no-store: nothing between the server and the visitor should keep a copy
  return sendMedia(req, res, result, { cache: 'no-store', disposition: result.disposition });
});

module.exports = { info, create, status, file };
