#!/bin/bash

nohup env code-server --auth none --host 0.0.0.0 --port 6666 > /code-server.log 2>&1 &
node /server_dist/index.js