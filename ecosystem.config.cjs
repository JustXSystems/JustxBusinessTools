/**
 * PM2 process file for production (Hostinger VPS).
 * Apps: justx-jbt-api (:4002) + justx-jbt-web (:3002)
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 reload ecosystem.config.cjs --update-env
 */
module.exports = {
  apps: [
    {
      name: "justx-jbt-api",
      cwd: __dirname,
      script: "npm",
      args: "run start -w server",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        WEB_BASE_PATH: "/jbt",
      },
      max_memory_restart: "512M",
      time: true,
      autorestart: true,
    },
    {
      name: "justx-jbt-web",
      cwd: __dirname,
      script: "npm",
      args: "run start -w web -- -p 3002",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        PORT: "3002",
        NEXT_PUBLIC_BASE_PATH: "/jbt",
        WEB_BASE_PATH: "/jbt",
        // Manifest / absolute icon URLs — Next sees localhost:3002 behind nginx otherwise
        WEB_PUBLIC_ORIGIN: "https://justxsystems.com",
      },
      max_memory_restart: "512M",
      time: true,
      autorestart: true,
    },
  ],
};
