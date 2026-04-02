const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config();

exports.default = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping notarization — not macOS build');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !applePassword || !teamId) {
    console.warn('Skipping notarization — missing APPLE_ID, APPLE_APP_PASSWORD, or APPLE_TEAM_ID');
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  const zipPath = `${appPath}.zip`;

  console.log(`Zipping ${appPath} ...`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });

  console.log(`Notarizing ${zipPath} ...`);

  // xcrun notarytool submit (v2) with --wait blocks until Apple finishes processing
  execSync(
    `xcrun notarytool submit "${zipPath}" --apple-id "${appleId}" --password "${applePassword}" --team-id "${teamId}" --wait`,
    { stdio: 'inherit' }
  );

  execSync(`rm -f "${zipPath}"`);

  console.log('Stapling notarization ticket ...');
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });

  console.log('Notarization complete');
};
