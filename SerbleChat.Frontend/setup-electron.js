#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 SerbleChat Electron Setup\n');

// Check if node_modules exists
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.log('📦 Installing dependencies...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('✅ Dependencies installed!\n');
  } catch (error) {
    console.error('❌ Failed to install dependencies');
    process.exit(1);
  }
} else {
  console.log('✅ Dependencies already installed\n');
}

console.log('Available commands:');
console.log('  npm run dev              - Run in browser (web/PWA)');
console.log('  npm run electron:dev     - Run as Electron app');
console.log('  npm run electron:build   - Build desktop app');
console.log('\nFor more info, see ELECTRON.md\n');
