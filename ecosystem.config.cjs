/**
 * PM2 process file — auto-restart on crash, restart on memory leak, logs.
 *
 * Usage:
 *   npm i -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup   # survive server reboot
 */
module.exports = {
  apps: [
    {
      name: "moviebox-api",
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      max_restarts: 50,
      min_uptime: "5s",
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
      },
      // PORT / MB_* come from the shell or a .env loaded by the host
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
