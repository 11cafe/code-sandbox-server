#!/bin/bash
set -e  # Exit immediately if a command exits with non-zero status

# 1. Create the folder
sudo mkdir -p /runbox

# 2. Change ownership to the current user
sudo chown "$USER":"$USER" /runbox

# 3. (Optional) Set full permissions for the user only (read/write/execute)
chmod 700 /runbox

sudo apt update
sudo apt install nginx -y
# echo 'export PATH=$PATH:/usr/sbin' >> ~/.bashrc
# source ~/.bashrc

sudo nginx -v

cd /runbox 
git clone https://github.com/11cafe/code-sandbox-server.git .

# install nodejs
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# build the project
npm install
npm run build

# setup nginx
chmod +x ./container_manager/update-nginx.sh
mkdir -p ./nginx/dynamics

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

sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# make docker cmd avaialable to current user without sudo
sudo usermod -aG docker $USER
newgrp docker

docker --version

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
sudo systemctl restart docker

# for adding timestamp to the log
sudo apt-get install -y moreutils

npm install -g pm2

# START SCRIPT
mkdir -p ./log
TZ=UTC pm2 start dist/src/index.js \
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