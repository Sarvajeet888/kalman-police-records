'use strict';
require('./check-node');
const { createApp } = require('../server');
const { app, close } = createApp();
let port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be a number from 0 to 65535.'); close(); process.exit(1);
}
let server;
function start() {
  server = app.listen(port, '127.0.0.1', () => {
    console.log('\nKALMAN SYSTEMS — Police Records');
    console.log(`Open http://localhost:${server.address().port}`);
    console.log('Initial login: admin / Kalman@123');
    console.log('Keep this terminal open. Ctrl+C stops the server.\n');
  });
  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT && port < 3010) {
      console.log(`Port ${port} is busy; trying ${port + 1}...`); port++; start();
    } else { console.error('Cannot start server:', error.message); close(); process.exit(1); }
  });
}
start();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => { close(); process.exit(0); });
  server.closeIdleConnections();
});
