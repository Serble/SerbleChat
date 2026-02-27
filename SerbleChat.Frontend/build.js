#!/usr/bin/env node

/**
 * Build script for SerbleChat
 * Handles both web and desktop builds with helpful output
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const buildType = args[0] || 'web';

console.log('🏗️  SerbleChat Build Tool\n');

function runCommand(command, description) {
  console.log(`📦 ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} completed!\n`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} failed!`);
    return false;
  }
}

function checkEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.log('⚠️  Warning: No .env file found');
    console.log('   Copy .env.example to .env and configure it first\n');
    return false;
  }
  return true;
}

switch (buildType) {
  case 'web':
    console.log('Building web version...\n');
    checkEnvFile();
    if (runCommand('npm run build', 'Building web application')) {
      console.log('✨ Web build complete!');
      console.log('📁 Output: dist/\n');
    }
    break;

  case 'electron':
  case 'desktop':
    console.log('Building desktop application...\n');
    checkEnvFile();
    if (runCommand('npm run build', 'Building web application')) {
      if (runCommand('electron-builder', 'Packaging Electron app')) {
        console.log('✨ Desktop build complete!');
        console.log('📁 Output: dist-electron/\n');
      }
    }
    break;

  case 'all':
    console.log('Building all versions...\n');
    checkEnvFile();
    if (runCommand('npm run build', 'Building web application')) {
      console.log('✨ Web build complete!');
      console.log('📁 Output: dist/\n');
      
      if (runCommand('electron-builder', 'Packaging Electron app')) {
        console.log('✨ Desktop build complete!');
        console.log('📁 Output: dist-electron/\n');
      }
    }
    break;

  case 'help':
  case '--help':
  case '-h':
    console.log('Usage: node build.js [type]\n');
    console.log('Types:');
    console.log('  web       - Build web version (default)');
    console.log('  electron  - Build desktop application');
    console.log('  all       - Build both versions');
    console.log('  help      - Show this help\n');
    break;

  default:
    console.log(`❌ Unknown build type: ${buildType}`);
    console.log('Run "node build.js help" for usage\n');
    process.exit(1);
}
