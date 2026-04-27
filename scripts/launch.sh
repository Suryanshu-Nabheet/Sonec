#!/bin/bash

# AutoCode Launch Script
# Compiles and launches the extension in a new VS Code window

set -e

echo "Building AutoCode Engine..."
npm run compile

echo "Launching VS Code Extension Host..."
code --extensionDevelopmentPath="$(pwd)" .
