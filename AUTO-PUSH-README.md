# 🚀 Auto-Push System for Flowbox

This project now has **automatic GitHub deployment** set up! Every update will be automatically pushed to GitHub and can be auto-merged.

## ✨ Features

- **Automatic File Watching**: Monitors all file changes in real-time
- **Auto-Commit & Push**: Automatically commits and pushes changes to GitHub
- **GitHub Actions CI/CD**: Automated deployment pipeline
- **Debounced Updates**: Prevents excessive commits with smart timing
- **Configurable**: Easy to customize via `auto-config.json`

## 🎯 Quick Start

### 1. Start Auto-Pushing (Recommended)
```bash
npm run watch
```
This will:
- Watch all files for changes
- Auto-commit changes every 2 seconds (debounced)
- Auto-push to GitHub main branch
- Keep running until you stop it (Ctrl+C)

### 2. Manual Push
```bash
npm run auto-push
```
This will:
- Commit all current changes
- Push to GitHub main branch
- Exit when done

### 3. Deploy & Start Server
```bash
npm run deploy
```
This will:
- Push changes to GitHub
- Start the development server

## 📁 Files Added

- `.github/workflows/auto-deploy.yml` - GitHub Actions CI/CD pipeline
- `auto-push.js` - Core automation script
- `watch-changes.js` - File watching and auto-push
- `auto-config.json` - Configuration settings
- `setup-auto-push.sh` - Setup script

## ⚙️ Configuration

Edit `auto-config.json` to customize:

```json
{
  "autoPush": {
    "enabled": true,
    "branch": "main",
    "debounceDelay": 2000,
    "ignoredFiles": [
      "node_modules/**",
      ".git/**",
      "*.log"
    ]
  },
  "github": {
    "repository": "futurita/flowbox",
    "autoMerge": true,
    "deployToPages": true
  }
}
```

## 🔄 How It Works

1. **File Watcher** monitors all files (except ignored ones)
2. **Debounced Processing** waits 2 seconds after last change
3. **Auto-Commit** creates timestamped commit messages
4. **Auto-Push** pushes to GitHub main branch
5. **GitHub Actions** triggers deployment pipeline
6. **Auto-Merge** (if configured) merges changes automatically

## 🛡️ Safety Features

- **Ignored Files**: Automatically ignores system files, logs, and temporary files
- **Debouncing**: Prevents excessive commits during rapid changes
- **Error Handling**: Graceful error handling with detailed logging
- **Status Checks**: Verifies git status before committing

## 📊 GitHub Actions

The system includes a GitHub Actions workflow that:
- Triggers on every push to main branch
- Sets up Node.js environment
- Installs dependencies
- Deploys to GitHub Pages (if enabled)
- Provides build status and logs

## 🎛️ Commands Reference

| Command | Description |
|---------|-------------|
| `npm run watch` | Start file watching and auto-push |
| `npm run auto-push` | One-time commit and push |
| `npm run deploy` | Push and start server |
| `npm start` | Start development server only |

## 🔧 Troubleshooting

### If auto-push fails:
1. Check git status: `git status`
2. Verify remote: `git remote -v`
3. Check GitHub permissions
4. Review error logs in console

### If GitHub Actions fail:
1. Check `.github/workflows/auto-deploy.yml`
2. Verify repository settings
3. Check GitHub Pages settings
4. Review Actions tab in GitHub

## 📈 Benefits

- **Zero Manual Work**: Never forget to commit/push changes
- **Real-time Sync**: Changes are immediately available on GitHub
- **Team Collaboration**: Team members always have latest version
- **Deployment Ready**: Automatic deployment to GitHub Pages
- **Version Control**: Every change is tracked with timestamps

## 🎉 Success!

Your Flowbox project now has **full automation**! 

- ✅ Every file change is automatically committed
- ✅ Every commit is automatically pushed to GitHub
- ✅ GitHub Actions handles deployment
- ✅ No manual git commands needed
- ✅ Real-time collaboration ready

**Just run `npm run watch` and start coding!** 🚀
