#!/usr/bin/env node

/**
 * Helper script to test authentication and extract token
 * Usage: node get-token.js <code>
 * 
 * Where <code> is the authorization code from Serble OAuth flow
 */

import axios from 'axios';
import fs from 'fs';

const API_BASE_URL = process.env.API_URL || 'http://localhost:5000';

async function getToken(code) {
    try {
        console.log('🔐 Authenticating with code...');
        
        const response = await axios.post(`${API_BASE_URL}/auth`, {
            Code: code
        });

        if (response.data && response.data.Token) {
            console.log('\n✓ Authentication successful!');
            console.log('\nYour token:');
            console.log('─'.repeat(80));
            console.log(response.data.Token);
            console.log('─'.repeat(80));
            
            // Verify the token works
            console.log('\n🔍 Verifying token...');
            const verifyResponse = await axios.get(`${API_BASE_URL}/auth`, {
                headers: {
                    'Authorization': `Bearer ${response.data.Token}`
                }
            });
            
            if (verifyResponse.status === 200) {
                console.log('✓ Token verified successfully!\n');
                
                // Ask if they want to save it
                console.log('To use this token, add it to your config.json file in the "tokens" array.');
                
                return response.data.Token;
            }
        } else {
            console.error('✗ Authentication failed: Invalid response format');
            return null;
        }
    } catch (error) {
        console.error('\n✗ Authentication failed:');
        if (error.response) {
            console.error(`  Status: ${error.response.status}`);
            console.error(`  Message: ${error.response.data || error.message}`);
        } else {
            console.error(`  ${error.message}`);
        }
        return null;
    }
}

async function testToken(token) {
    try {
        console.log('\n🔍 Testing token...');
        
        const response = await axios.get(`${API_BASE_URL}/auth`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.status === 200) {
            console.log('✓ Token is valid!\n');
            return true;
        }
    } catch (error) {
        console.error('\n✗ Token test failed:');
        if (error.response) {
            console.error(`  Status: ${error.response.status}`);
            console.error(`  Message: ${error.response.data || error.message}`);
        } else {
            console.error(`  ${error.message}`);
        }
        return false;
    }
}

async function addTokenToConfig(token) {
    const configPath = './config.json';
    
    try {
        let config;
        
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf8');
            config = JSON.parse(configData);
        } else {
            // Use example config as template
            if (fs.existsSync('./config.example.json')) {
                const exampleData = fs.readFileSync('./config.example.json', 'utf8');
                config = JSON.parse(exampleData);
            } else {
                console.error('✗ No config file found. Please create config.json first.');
                return false;
            }
        }
        
        if (!config.tokens) {
            config.tokens = [];
        }
        
        if (!config.tokens.includes(token)) {
            config.tokens.push(token);
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            console.log(`✓ Token added to ${configPath}`);
            console.log(`  Total tokens in config: ${config.tokens.length}\n`);
            return true;
        } else {
            console.log('⚠️  Token already exists in config\n');
            return true;
        }
    } catch (error) {
        console.error('✗ Failed to update config:', error.message);
        return false;
    }
}

// Main execution
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║         SerbleChat Token Helper                              ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');
console.log(`API URL: ${API_BASE_URL}\n`);

const args = process.argv.slice(2);
const command = args[0];
const value = args[1];

if (!command) {
    console.log('Usage:');
    console.log('  node get-token.js auth <code>     - Authenticate and get token');
    console.log('  node get-token.js test <token>    - Test if a token is valid');
    console.log('  node get-token.js add <token>     - Add token to config.json');
    console.log('\nEnvironment variables:');
    console.log('  API_URL - Set custom API URL (default: http://localhost:5000)');
    console.log('\nExample:');
    console.log('  API_URL=https://api.example.com node get-token.js auth abc123');
    process.exit(1);
}

(async () => {
    switch (command) {
        case 'auth':
            if (!value) {
                console.error('✗ Authorization code is required');
                console.log('Usage: node get-token.js auth <code>');
                process.exit(1);
            }
            const token = await getToken(value);
            if (token) {
                await addTokenToConfig(token);
            }
            break;
            
        case 'test':
            if (!value) {
                console.error('✗ Token is required');
                console.log('Usage: node get-token.js test <token>');
                process.exit(1);
            }
            await testToken(value);
            break;
            
        case 'add':
            if (!value) {
                console.error('✗ Token is required');
                console.log('Usage: node get-token.js add <token>');
                process.exit(1);
            }
            const isValid = await testToken(value);
            if (isValid) {
                await addTokenToConfig(value);
            }
            break;
            
        default:
            console.error(`✗ Unknown command: ${command}`);
            console.log('Valid commands: auth, test, add');
            process.exit(1);
    }
})();
