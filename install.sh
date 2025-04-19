sudo apt update
sudo apt install nginx -y
# echo 'export PATH=$PATH:/usr/sbin' >> ~/.bashrc
# source ~/.bashrc

nginx -v

git clone https://github.com/11cafe/code-sandbox-server.git runbox
cd runbox
npm install
npm run build

node dist/src/index.js --port 8888 & 1>./log/runbox.log 2>&1 &

sudo nginx -c ./nginx.conf