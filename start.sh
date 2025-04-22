#!/bin/bash

cd /runbox/container_manager
mkdir -p /runbox/logs
pm2 kill
TZ=UTC pm2 start dist/index.js \
  --name "runbox" \
  --time \
  --output /runbox/logs/runbox.out.log \
  --error /runbox/logs/runbox.error.log \
  -- --port 8888

# After starting PM2
pm2 startup
pm2 save

# restart nginx at 80 port
sudo nginx -s stop
sudo nginx -c /runbox/nginx.conf

# to reload nginx config
sudo nginx -s reload -c /runbox/nginx.conf