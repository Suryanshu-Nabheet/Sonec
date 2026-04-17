#!/bin/bash

# SONEC Test Suite Launcher
# Compiles the research/test files and executes mocha

set -e

echo "Compiling for tests..."
npm run compile

echo "Running Mocha Test Suite..."
npm test
