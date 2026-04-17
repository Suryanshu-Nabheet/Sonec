#!/bin/bash

# SONEC Production Bundling Script
# Prepares the extension for marketplace distribution

set -e

echo "Starting Production Build..."

# 1. Clean previous builds
echo "Cleaning existing build artifacts..."
npm run clean

# 2. Fresh install
echo "Installing clean dependencies..."
npm install --production=false

# 3. Linting
echo "Running lint check..."
npm run lint

# 4. Compilation
echo "Compiling TypeScript..."
npm run compile

# 5. Packaging
echo "Packaging extension (.vsix)..."
if command -v vsce &> /dev/null; then
    vsce package
else
    echo "Warning: vsce not found. Skipping .vsix generation."
    echo "You can install vsce globally via: npm install -g @vscode/vsce"
fi

echo "------------------------------------------------"
echo "Production Build Complete."
echo "------------------------------------------------"
