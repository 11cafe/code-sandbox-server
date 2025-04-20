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
