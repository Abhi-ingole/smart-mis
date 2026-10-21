// PM2 process file:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "smart-mis",
      cwd: "./server",
      script: "dist/index.js",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
      time: true,
    },
  ],
};
