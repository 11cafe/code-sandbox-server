#!/bin/bash

set -e  # Exit immediately if a command exits with non-zero status

# Start nginx in the background
# nginx -g "daemon off;" &
nginx -g "daemon off;" &
