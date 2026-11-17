const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.resolve(rootDir, 'release');
const wwwDir = path.resolve(releaseDir, 'www');
const clientDist = path.resolve(rootDir, 'dist');

console.log('--- Finalizing Release ---');

// Ensure release/www exists (this is where React app lives in release)
if (!fs.existsSync(wwwDir)) {
    fs.mkdirSync(wwwDir, { recursive: true });
}

// Helper to copy directory recursive
function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach(childItemName => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

// 1. Copy Frontend (built React app from /dist to /release/www)
if (fs.existsSync(clientDist)) {
    console.log(`Copying frontend from ${clientDist} to ${wwwDir}...`);
    // Clear old www if exists to avoid stale files
    if (fs.existsSync(wwwDir)) fs.rmSync(wwwDir, { recursive: true, force: true });
    copyRecursiveSync(clientDist, wwwDir);
} else {
    console.error(`Frontend build missing at ${clientDist}. Did you run npm run build?`);
    process.exit(1);
}

// 2. Copy Backend Bundle
const backendBundle = path.resolve(rootDir, 'dist-pkg', 'server.cjs');
const backendDest = path.join(releaseDir, 'server.cjs');
if (fs.existsSync(backendBundle)) {
    console.log(`Copying backend bundle to ${backendDest}...`);
    fs.copyFileSync(backendBundle, backendDest);
} else {
    console.error(`Backend bundle missing at ${backendBundle}. Did you run build:backend?`);
    process.exit(1);
}

// 2.1 Copy node.exe (Standalone)
const nodeExeSource = path.resolve(rootDir, 'dist-pkg', 'node.exe');
const nodeExeDest = path.join(releaseDir, 'node.exe');
if (fs.existsSync(nodeExeSource)) {
    console.log(`Found node.exe in dist-pkg. Copying to release for standalone mode...`);
    fs.copyFileSync(nodeExeSource, nodeExeDest);
}

// 3. Copy Config (Local simulator config)
const simulatorConfigDir = path.resolve(rootDir, 'config');
const releaseConfigDir = path.resolve(releaseDir, 'config');

const itemsToCopy = ['devices', 'controllers'];

itemsToCopy.forEach(item => {
    const src = path.join(simulatorConfigDir, item);
    const dest = path.join(releaseConfigDir, item);

    if (fs.existsSync(src)) {
        console.log(`Copying ${item} config from ${src} to ${dest}...`);
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
        copyRecursiveSync(src, dest);
    } else {
        console.warn(`Warning: ${item} config source not found at ${src}`);
    }
});

// 4. Create Launchers
const batPath = path.join(releaseDir, 'start-windows.bat');
const shPath = path.join(releaseDir, 'start-linux.sh');

console.log('Generating launchers...');

// Windows Batch
fs.writeFileSync(batPath, '@echo off\nnode server.cjs\npause');

// Linux Shell
fs.writeFileSync(shPath, '#!/bin/bash\nnode server.cjs');
fs.chmodSync(shPath, '755');

console.log('Release created successfully at:', releaseDir);
console.log('You can zip this folder and share it.');
