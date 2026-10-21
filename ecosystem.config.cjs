// PM2 process file:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "smart-mis",
      cwd: "./server",
      script: "dist/index.js",
      instances: 1, // keep 1: SQLite + the in-process scheduler expect a single process
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      time: true,
    },
  ],
};
