// PM2 process file: keeps the app running and restarts it after crashes or a server reboot.
//   pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'task-management',
      cwd: './backend',
      script: 'src/index.js',
      node_args: '--env-file=.env',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
    },
  ],
};
