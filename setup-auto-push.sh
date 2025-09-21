#!/bin/bash

echo "🚀 Setting up Auto-Push for Flowbox..."
echo "=================================="

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "❌ Git repository not found. Please initialize git first."
    exit 1
fi

# Check if remote is set
if ! git remote get-url origin > /dev/null 2>&1; then
    echo "❌ No remote origin found. Please set up GitHub remote first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Make scripts executable
chmod +x auto-push.js
chmod +x watch-changes.js

# Create initial commit if needed
if [ -n "$(git status --porcelain)" ]; then
    echo "📝 Creating initial commit for automation setup..."
    git add .
    git commit -m "Setup: Auto-push automation system"
fi

echo "✅ Auto-push setup completed!"
echo ""
echo "Available commands:"
echo "  npm run auto-push    - Push current changes to GitHub"
echo "  npm run watch        - Watch for file changes and auto-push"
echo "  npm run deploy       - Push changes and start server"
echo ""
echo "🎯 To start auto-pushing, run: npm run watch"
echo "🔗 GitHub repository: $(git remote get-url origin)"
