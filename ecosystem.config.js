module.exports = {
  apps: [
    {
      name: 'instagram-bot',
      script: 'dist/main.js',
      instances: 'max', // All CPU cores
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
