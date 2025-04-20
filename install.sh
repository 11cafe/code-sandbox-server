# 1. Create the folder
sudo mkdir -p /home/runbox

# 2. Change ownership to the current user
sudo chown "$USER":"$USER" /home/runbox

# 3. (Optional) Set full permissions for the user only (read/write/execute)
chmod 700 /home/runbox

sudo apt update
sudo apt install nginx -y
# echo 'export PATH=$PATH:/usr/sbin' >> ~/.bashrc
# source ~/.bashrc

nginx -v

git clone https://github.com/11cafe/code-sandbox-server.git runbox
cd runbox

npm install
npm run build

# setup nginx
chmod +x ./container_manager/update-nginx.sh
mkdir -p ./nginx/dynamics


# adding more ips to default address pool otherwise it will consume all ips
# /etc/docker/daemon.json
# cat <<EOF > /etc/docker/daemon.json
# {
#   "default-address-pools": [
#     {
#       "base": "172.17.0.0/16",
#       "size": 24
#     },
#     {
#       "base": "172.18.0.0/16",
#       "size": 24
#     },
#     {
#       "base": "172.19.0.0/16",
#       "size": 24
#     }
#   ]
# }
# EOF

# sudo systemctl restart docker
