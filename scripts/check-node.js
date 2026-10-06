'use strict';
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('\nKalman Police Records needs Node.js 24 or newer.\nInstall Node.js 24 LTS from https://nodejs.org/ then reopen your terminal.\n');
  process.exit(1);
}
