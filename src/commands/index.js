'use strict';

require('./core');
require('./owner');
require('./group');
require('./downloader');
require('./sticker');
require('./general');
require('./games');
require('./pranks');

const ai = require('./ai');

module.exports = {
    generateReply: ai.generateReply,
    hasAnyKey: ai.hasAnyKey,
};
