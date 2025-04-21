#!/bin/bash
set -e  # Exit immediately if a command exits with non-zero status

nohup env code-server --auth none --host 0.0.0.0 --port 6666 > /code-server.log 2>&1 &
node /server_dist/index.js