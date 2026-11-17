// pm2 keeps the backend running, restarts it if it crashes,
// and starts it again after a server reboot.
module.exports = {
  apps: [
    {
      name: "learn-api",
      cwd: ".",
      script: "server.js",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
