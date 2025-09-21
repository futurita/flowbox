#!/usr/bin/env node

/**
 * Auto Push Script for Flowbox
 * Automatically commits and pushes changes to GitHub
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class AutoPusher {
  constructor() {
    this.repoPath = process.cwd();
    this.gitStatus = null;
  }

  async checkGitStatus() {
    try {
      const status = execSync('git status --porcelain', { 
        encoding: 'utf8',
        cwd: this.repoPath 
      });
      return status.trim().split('\n').filter(line => line.length > 0);
    } catch (error) {
      console.error('Error checking git status:', error.message);
      return [];
    }
  }

  async commitChanges() {
    const changes = await this.checkGitStatus();
    
    if (changes.length === 0) {
      console.log('No changes to commit');
      return false;
    }

    const timestamp = new Date().toISOString();
    const commitMessage = `Auto-commit: ${changes.length} file(s) changed at ${timestamp}`;
    
    try {
      // Add all changes
      execSync('git add .', { cwd: this.repoPath });
      
      // Commit changes
      execSync(`git commit -m "${commitMessage}"`, { cwd: this.repoPath });
      
      console.log(`✅ Committed ${changes.length} file(s): ${commitMessage}`);
      return true;
    } catch (error) {
      console.error('Error committing changes:', error.message);
      return false;
    }
  }

  async pushToGitHub() {
    try {
      execSync('git push origin main', { cwd: this.repoPath });
      console.log('✅ Successfully pushed to GitHub');
      return true;
    } catch (error) {
      console.error('Error pushing to GitHub:', error.message);
      return false;
    }
  }

  async autoPush() {
    console.log('🚀 Starting auto-push process...');
    
    const committed = await this.commitChanges();
    if (committed) {
      await this.pushToGitHub();
    }
    
    console.log('✨ Auto-push process completed');
  }
}

// Run if called directly
if (require.main === module) {
  const autoPusher = new AutoPusher();
  autoPusher.autoPush().catch(console.error);
}

module.exports = AutoPusher;
