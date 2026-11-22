# ArthQuant Full-Stack Dockerfile for Hugging Face Spaces
# Combines Node.js 20 (Express + React) and Python 3.11 (FastAPI + Trio ML Ensemble)

FROM python:3.11-slim

# System packages:
# - curl & ca-certificates for Node.js setup
# - build-essential for native npm / python extensions
# - libgomp1 for OpenMP acceleration (required by LightGBM & XGBoost)
# - git for cloning / package references
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    libgomp1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces security sandbox expects user ID 1000
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PORT=3000 \
    NODE_ENV=production \
    PYTHON_BIN=python3

WORKDIR $HOME/app

# Install Python ML dependencies first (cached Docker layer)
COPY --chown=user:user ml_service/requirements.txt ./ml_service/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r ml_service/requirements.txt

# Install Node.js dependencies (cached Docker layer)
COPY --chown=user:user package*.json ./
RUN npm install

# Copy application source code
COPY --chown=user:user . .

# Build production frontend bundle
RUN npm run build

# Switch to non-root user
USER user

# Web port
EXPOSE 3000 7860 10000

# Start ArthQuant (Express starts on $PORT and launches FastAPI ML service on 8000)
CMD ["npm", "start"]
