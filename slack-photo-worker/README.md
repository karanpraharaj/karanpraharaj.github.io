# Slack Photo Uploader — Current Setup

Reference documentation for the Slack-to-website photo pipeline.

---

## Overview

Photos uploaded to Slack automatically appear on [karanpraharaj.com/photography](https://karanpraharaj.com/photography.html).

**Flow:** Slack → Cloudflare Worker → GitHub → Website

---

## Components

### 1. Slack App
- **Name:** (your app name)
- **Workspace:** kpbase
- **Channel:** #photos (or your channel name)
- **Events subscribed:** `message.channels`, `file_shared`
- **Bot scopes:** `files:read`, `channels:history`
- **Manage at:** [api.slack.com/apps](https://api.slack.com/apps)

### 2. Cloudflare Worker
- **Name:** `slack-photo-uploader`
- **URL:** `https://slack-photo-uploader.slack-photo-uploader.workers.dev`
- **Code location:** `slack-photo-worker/src/index.js`
- **Config:** `slack-photo-worker/wrangler.toml`
- **Dashboard:** [dash.cloudflare.com](https://dash.cloudflare.com) → Workers

**Secrets stored in worker:**
| Secret | Description |
|--------|-------------|
| `SLACK_BOT_TOKEN` | Bot OAuth token (`xoxb-...`) |
| `GITHUB_TOKEN` | Fine-grained PAT with repo write access |

### 3. GitHub
- **Repo:** `karanpraharaj/karanpraharaj.github.io`
- **Branch:** `main`
- **Photo storage:** `photos/img/`
- **Photo index:** `photos/photos.json`
- **Token permissions:** Contents (read/write)

---

## Commands

**Add photo:** Upload image with caption
```
Caption | Location | YYYY-MM-DD
```

**Delete photo:** Text message only
```
DELETE | filename.jpg
```

---

## Files in Repo

```
slack-photo-worker/
├── src/index.js      # Worker logic
├── wrangler.toml     # Cloudflare config
└── README.md         # This file

photos/
├── img/              # Photo files
└── photos.json       # Photo metadata
```

---

## Maintenance

**Redeploy worker after code changes:**
```bash
cd slack-photo-worker
wrangler deploy
```

**View live logs:**
```bash
wrangler tail
```

**Update secrets:**
```bash
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put GITHUB_TOKEN
```

---

## Credentials Location

| Credential | Where to find/regenerate |
|------------|--------------------------|
| Slack Bot Token | Slack App → OAuth & Permissions |
| GitHub Token | GitHub → Settings → Developer settings → Personal access tokens |
| Cloudflare | `wrangler login` to re-authenticate |
