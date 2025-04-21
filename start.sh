#!/bin/bash

cd /runbox/container_manager
pm2 kill
TZ=UTC pm2 start dist/index.js \
  --name "runbox" \
  --time \
  -- --port 8888

# After starting PM2
pm2 startup
pm2 save

sudo nginx -s stop

# start nginx at 80 port
sudo nginx -c /runbox/nginx.conf

# to reload nginx config
sudo nginx -s reload -c /runbox/nginx.conf