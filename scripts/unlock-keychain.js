const { execSync } = require('child_process');
require('dotenv').config();

const password = process.env.KEYCHAIN_PASSWORD;
if (!password) {
  console.warn('Skipping keychain unlock — missing KEYCHAIN_PASSWORD in .env');
  process.exit(0);
}

const keychain = '~/Library/Keychains/login.keychain-db';

try {
  execSync(`security unlock-keychain -p "${password}" ${keychain}`, { stdio: 'inherit' });
  execSync(`security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${password}" ${keychain}`, { stdio: 'inherit' });
  console.log('Keychain unlocked');
} catch (e) {
  console.error('Failed to unlock keychain:', e.message);
  process.exit(1);
}
