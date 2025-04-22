#!/bin/bash
set -e  # Exit immediately if a command exits with non-zero status

# Remove the existing /runbox if it exists
if [ -d "/tmp/code-sandbox-server" ]; then
    echo "Found existing /tmp/code-sandbox-server directory. Removing it..."
    sudo rm -rf /tmp/code-sandbox-server
fi

# Clone the latest version of the code-sandbox-server
git clone https://github.com/11cafe/code-sandbox-server.git /tmp/code-sandbox-server

# Build the project
cd /tmp/code-sandbox-server/container_manager
npm install
npm run build
# move the built dist to /runbox
mkdir -p /runbox/container_manager
mv /tmp/code-sandbox-server/container_manager/dist /runbox/container_manager/dist
# move the nginx.conf to /runbox
mv /tmp/code-sandbox-server/nginx.conf /etc/nginx/nginx.conf
# move the start.sh to /runbox
mv /tmp/code-sandbox-server/start.sh /runbox/start.sh

# restart the server
sudo /runbox/start.sh
