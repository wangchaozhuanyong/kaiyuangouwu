/* eslint-disable no-console */
import fs from 'fs-extra';
import { spawn } from 'node:child_process';
import path from 'path';

const compiledUiDir = path.join(__dirname, 'lib/admin-ui');
console.log('Building admin-ui from source...');

fs.removeSync(compiledUiDir);

const adminUiDir = path.join(__dirname, '../admin-ui');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildProcess = spawn(npmExecutable, ['run', 'build:app', '--prefix', adminUiDir], {
    cwd: adminUiDir,
    stdio: 'inherit',
});

buildProcess.on('close', code => {
    if (code === 0) {
        fs.copySync(path.join(__dirname, '../admin-ui/dist'), compiledUiDir);
    } else {
        console.log('Could not build!');
        process.exitCode = 1;
    }
});
