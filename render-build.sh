#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
npx prisma generate
npm run build

# Download yt-dlp for Linux (Render)
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
chmod a+rx yt-dlp
