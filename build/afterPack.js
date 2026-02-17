const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.electronPlatformName === 'darwin') {
    const appPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`
    );
    console.log(`  • ad-hoc signing  app=${appPath}`);
    execSync(`codesign --force --deep -s - "${appPath}"`);
  }
};
