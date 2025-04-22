#!/bin/bash
set -e  # Exit immediately if a command exits with non-zero status

# Remove the existing /runbox if it exists
if [ -d "/tmp/code-sandbox-server" ]; then
    echo "Found existing /tmp/code-sandbox-server directory. Removing it..."
    sudo rm -rf /tmp/code-sandbox-server
fi
sudo mkdir -p /runbox

# Change /runbox ownership to the current user
sudo chown -R "$USER":"$USER" /runbox

# Set full permissions for the user recursively in /runbox
chmod -R 700 /runbox

sudo apt update
sudo apt install nginx -y
sudo apt install git -y
sudo nginx -v

git clone https://github.com/11cafe/code-sandbox-server.git /tmp/code-sandbox-server

# install nodejs
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo apt-get install -y build-essential # for npm install node-pty to work

# build the project
mkdir -p /runbox/container_manager
rm -rf /runbox/container_manager/*  # Add this line to clear existing contents
# cp -r /tmp/code-sandbox-server/container_manager/* /runbox/container_manager/
mv /tmp/code-sandbox-server/container_manager /runbox/container_manager
cd /runbox/container_manager
npm install
npm run build

mv /tmp/code-sandbox-server/nginx.conf /runbox/nginx.conf
mv /tmp/code-sandbox-server/start.sh /runbox/start.sh
mkdir -p /runbox/nginx/dynamics

# Set full permissions for the user recursively in /data
sudo mkdir -p /data/workspaces
sudo chown -R "$USER":"$USER" /data
chmod -R 700 /data

# install docker
# Add Docker's official GPG key:
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# make docker cmd avaialable to current user without sudo
echo "Adding current user to docker group"
sudo usermod -aG docker $USER
# newgrp docker # this will stuck and hang the script here since it creates new shell

docker --version
docker pull weixuanf/runbox

# adding more ips to default address pool otherwise it will consume all ips
sudo tee /etc/docker/daemon.json > /dev/null << 'EOF'
{
  "default-address-pools": [
    {
      "base": "172.17.0.0/16",
      "size": 24
    },
    {
      "base": "172.18.0.0/16",
      "size": 24
    },
    {
      "base": "172.19.0.0/16",
      "size": 24
    }
  ]
}
EOF

# Restart Docker to apply the changes
echo "Restarting docker"
sudo systemctl restart docker

sudo npm install -g pm2

# START SCRIPT
echo "Starting runbox"
cd /runbox
chmod +x start.sh
./start.sh