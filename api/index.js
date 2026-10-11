const { createApp } = require('../server');

const application = createApp({
  dataDirectory: '/tmp'
});

module.exports = application.app;