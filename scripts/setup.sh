#!/bin/bash

# SONEC Setup Script
# Performs initial environment checks and installs dependencies

set -e

echo "------------------------------------------------"
echo "Initializing SONEC Development Environment"
echo "------------------------------------------------"

# 1. Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js v18 or newer."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js version must be 18 or newer. Current version: $(node -v)"
    exit 1
fi

# 2. Install dependencies
echo "Installing dependencies..."
npm install

# 3. Compile the extension
echo "Compiling the extension..."
npm run compile

# 4. Success message
echo "------------------------------------------------"
echo "Setup Complete!"
echo "Open this folder in VS Code and press F5 to launch the extension."
echo "------------------------------------------------"
