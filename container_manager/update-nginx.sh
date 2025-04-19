#!/bin/bash

# Get sandbox ID and IP from arguments
SANDBOX_ID=$1
CONTAINER_IP=$2
SERVER_NAME=$3

if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Error: Missing required arguments"
    echo "Usage: $0 <sandbox_id> <container_ip> <server_name>"
    exit 1
fi

# Create nginx configuration for the sandbox
cat > /home/weixuan/runbox/nginx/dynamics/${SANDBOX_ID}.conf << EOF
server {
    listen 80;
    server_name ${SERVER_NAME};

    location / {
        proxy_pass http://${CONTAINER_IP}:6666;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Test nginx configuration
# sudo nginx -t

# Reload nginx if configuration is valid
# sudo nginx -s reload
sudo nginx -s reload -c /home/weixuan/runbox/nginx.conf
#     echo "Nginx configuration updated for sandbox ${SANDBOX_ID}"
# else
#     echo "Error in nginx configuration"
#     exit 1
# fi 