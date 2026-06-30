const { exec } = require('child_process');

exec(`".\\yt-dlp.exe" -f "best[ext=mp4]" -j --ignore-errors --cookies "cookies\\cookies.txt" "https://www.instagram.com/p/DaKo9IdjAPb/"`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
  if (stdout.length > 0) {
    const lines = stdout.trim().split('\n');
    try {
      const j = JSON.parse(lines[0]);
      console.log("HAS URL:", j.url ? 'YES' : 'NO', j.url);
    } catch(e) {
      console.log("PARSE ERR:", e.message);
    }
  }
});
