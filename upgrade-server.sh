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
cp -r /tmp/code-sandbox-server/container_manager/* /runbox/container_manager/
cd /runbox/container_manager
npm install
npm run build

# restart the server gracefully 0 downtime
pm2 reload
