/**
 * AutoCode Advanced Setup Script
 * 
 * Handles project initialization, validation of environment variables,
 * and pre-run diagnostic tests for local models (Ollama).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

async function setup() {
    console.log('--- AutoCode Engine Initialization ---');

    try {
        // 1. Dependency Check
        console.log('Checking dependencies...');
        execSync('npm --version', { stdio: 'ignore' });
        
        // 2. Install
        console.log('Installing npm packages...');
        execSync('npm install', { stdio: 'inherit' });

        // 3. Environment Check
        const envPath = path.join(process.cwd(), '.env');
        if (!fs.existsSync(envPath)) {
            console.log('Creating default .env from template...');
            // In a real scenario, we'd copy from a template
            fs.writeFileSync(envPath, 'AutoCode_LOG_LEVEL=info\n');
        }

        // 4. Local Model Connectivity (Ollama)
        console.log('Checking local model status (Ollama)...');
        try {
            const status = execSync('curl http://localhost:11434/api/tags', { encoding: 'utf8' });
            if (status.includes('models')) {
                console.log('Ollama is online and responsive.');
            }
        } catch {
            console.warn('Warning: Ollama is not running. Local completions will not be available until started.');
        }

        console.log('\nAutoCode setup completed successfully.');
    } catch (error) {
        console.error('Setup failed:', error);
        process.exit(1);
    }
}

setup();
