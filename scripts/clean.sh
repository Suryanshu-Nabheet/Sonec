#!/bin/bash

# AutoCode Clean Script
# Removes build artifacts and cached files

set -e

echo "Cleaning build artifacts..."
rm -rf out
rm -rf *.vsix

echo "Cleaning node_modules..."
rm -rf node_modules

echo "Clean Complete."
