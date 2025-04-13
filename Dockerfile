FROM ubuntu:22.04

# Install essential packages
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    git \
    vim \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Miniconda
RUN mkdir -p /miniconda3 && \
    wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /miniconda3/miniconda.sh && \
    bash /miniconda3/miniconda.sh -b -u -p /miniconda3 && \
    rm /miniconda3/miniconda.sh

# Initialize conda
RUN bash -c "source /miniconda3/bin/activate && \
    conda init --all"

# Install NVM
# RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash

# # Configure shell to source NVM
# RUN export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")" && \
#     [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && \
#     nvm install 22 && \
#     nvm use 22


# Install Node.js directly instead of using NVM
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
apt-get install -y nodejs
WORKDIR /home

# node --version v22.14.0
# python --version 3.12.9

# CMD ["/bin/bash"]
CMD ["npx", "-y", "linux-commander@latest"]
