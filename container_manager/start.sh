#!/bin/bash

# Start nginx in the background
nginx -g "daemon off;" &

# Start the Node.js server
node dist/index.js