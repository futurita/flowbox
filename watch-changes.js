#!/usr/bin/env node

/**
 * File Watcher for Auto-Push
 * Watches for file changes and automatically pushes to GitHub
 */

const chokidar = require('chokidar');
const AutoPusher = require('./auto-push');
const path = require('path');

class FileWatcher {
  constructor() {
    this.autoPusher = new AutoPusher();
    this.debounceTimer = null;
    this.debounceDelay = 2000; // 2 seconds delay
    this.isProcessing = false;
  }

  startWatching() {
    console.log('👀 Starting file watcher...');
    console.log('📁 Watching for changes in:', process.cwd());
    
    const watcher = chokidar.watch('.', {
      ignored: [
        /node_modules/,
        /\.git/,
        /\.github/,
        /\.DS_Store/,
        /\.vscode/,
        /\.idea/,
        /\.log$/,
        /\.tmp$/,
        /\.temp$/,
        /auto-push\.js$/,
        /watch-changes\.js$/
      ],
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('change', (filePath) => {
      this.handleFileChange(filePath);
    });

    watcher.on('add', (filePath) => {
      this.handleFileChange(filePath);
    });

    watcher.on('unlink', (filePath) => {
      this.handleFileChange(filePath);
    });

    console.log('✅ File watcher is active. Press Ctrl+C to stop.');
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping file watcher...');
      watcher.close();
      process.exit(0);
    });
  }

  handleFileChange(filePath) {
    if (this.isProcessing) {
      return;
    }

    console.log(`📝 File changed: ${filePath}`);
    
    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new timer
    this.debounceTimer = setTimeout(async () => {
      await this.processChanges();
    }, this.debounceDelay);
  }

  async processChanges() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    console.log('🔄 Processing changes...');
    
    try {
      await this.autoPusher.autoPush();
    } catch (error) {
      console.error('❌ Error processing changes:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}

// Run if called directly
if (require.main === module) {
  const fileWatcher = new FileWatcher();
  fileWatcher.startWatching();
}

module.exports = FileWatcher;
