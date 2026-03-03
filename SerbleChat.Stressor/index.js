import fs from 'fs';
import { StressTestBot } from './bot.js';

class StressTestManager {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = null;
        this.bots = [];
        this.startTime = null;
        this.statsInterval = null;
        this.userIdPool = []; // Global pool of valid user IDs
        this.timingsFile = 'timings.csv'; // File to store query timings
        
        // Initialize timings file with header (only once)
        fs.writeFileSync(this.timingsFile, 'timestamp,botId,queryType,durationMs,success\n');
    }

    loadConfig() {
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
            console.log('✓ Configuration loaded successfully');
            return true;
        } catch (error) {
            console.error('✗ Failed to load configuration:', error.message);
            return false;
        }
    }

    validateConfig() {
        if (!this.config.apiBaseUrl) {
            console.error('✗ API base URL is required');
            return false;
        }

        if (!this.config.tokens || this.config.tokens.length === 0) {
            console.error('✗ At least one token is required');
            return false;
        }

        if (this.config.messagesPerMinute <= 0) {
            console.error('✗ Messages per minute must be greater than 0');
            return false;
        }

        console.log('✓ Configuration validated');
        return true;
    }

    async startBots() {
        // Determine how many tokens to use
        const numTokens = this.config.numTokens && this.config.numTokens > 0 
            ? Math.min(this.config.numTokens, this.config.tokens.length)
            : this.config.tokens.length;
        
        const tokensToUse = this.config.tokens.slice(0, numTokens);
        
        console.log(`\n🚀 Starting ${tokensToUse.length} bot(s)...\n`);
        
        for (let i = 0; i < tokensToUse.length; i++) {
            const token = tokensToUse[i];
            const bot = new StressTestBot(token, this.config, i + 1, this.bots, this.userIdPool, this.timingsFile);
            this.bots.push(bot);
            
            const started = await bot.start();
            if (!started) {
                console.error(`✗ Failed to start bot ${i + 1}`);
            } else {
                // Add bot's user ID to the pool
                if (bot.client.userId) {
                    this.userIdPool.push(bot.client.userId);
                }
            }
            
            // Small delay between bot starts
            await this.sleep(500);
        }

        // Add any additional user IDs from config
        if (this.config.additionalUserIds && Array.isArray(this.config.additionalUserIds)) {
            this.userIdPool.push(...this.config.additionalUserIds);
        }

        console.log(`\n✓ ${this.bots.filter(b => b.isRunning).length}/${this.config.tokens.length} bot(s) started successfully`);
        console.log(`✓ User ID pool contains ${this.userIdPool.length} valid ID(s)\n`);
    }

    async stopBots() {
        console.log('\n🛑 Stopping bots...\n');
        
        for (const bot of this.bots) {
            if (bot.isRunning) {
                await bot.stop();
            }
        }
        
        console.log('✓ All bots stopped\n');
    }

    startStatsMonitoring() {
        this.startTime = Date.now();
        
        // Print stats every 10 seconds
        this.statsInterval = setInterval(() => {
            this.printStats();
        }, 10000);
        
        // Initial stats
        setTimeout(() => this.printStats(), 2000);
    }

    stopStatsMonitoring() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    printStats() {
        const runtime = Math.floor((Date.now() - this.startTime) / 1000);
        const totalActions = this.bots.reduce((sum, bot) => sum + bot.actionCount, 0);
        const totalSuccess = this.bots.reduce((sum, bot) => sum + bot.successCount, 0);
        const totalErrors = this.bots.reduce((sum, bot) => sum + bot.errorCount, 0);
        const totalMessages = this.bots.reduce((sum, bot) => sum + bot.messagesSent, 0);
        const actionsPerSecond = runtime > 0 ? (totalActions / runtime).toFixed(2) : '0.00';
        const messagesPerSecond = runtime > 0 ? (totalMessages / runtime).toFixed(2) : '0.00';

        console.log('\n' + '='.repeat(80));
        console.log(`📊 STRESS TEST STATISTICS - Runtime: ${this.formatTime(runtime)}`);
        console.log('='.repeat(80));
        console.log(`Total Messages:    ${totalMessages} (${messagesPerSecond}/sec)`);
        console.log(`Total Actions:     ${totalActions}`);
        console.log(`Successful:        ${totalSuccess} (${this.percentage(totalSuccess, totalActions)})`);
        console.log(`Failed:            ${totalErrors} (${this.percentage(totalErrors, totalActions)})`);
        console.log(`Actions/Second:    ${actionsPerSecond}`);
        console.log('-'.repeat(80));
        
        for (const bot of this.bots) {
            const stats = bot.getStats();
            console.log(`Bot ${stats.botId}:`);
            console.log(`  Actions:    ${stats.actionCount} (${stats.successCount} ✓, ${stats.errorCount} ✗) - ${stats.successRate}`);
            console.log(`  Messages:   ${stats.messagesSent} sent`);
            console.log(`  Entities:   Guilds: ${stats.guilds}, Channels: ${stats.channels}, Friends: ${stats.friends}, Groups: ${stats.groupChats}`);
        }
        
        console.log('='.repeat(80) + '\n');
    }

    printFinalStats() {
        console.log('\n' + '█'.repeat(80));
        console.log('🏁 FINAL STRESS TEST RESULTS');
        console.log('█'.repeat(80));
        
        const runtime = Math.floor((Date.now() - this.startTime) / 1000);
        const totalActions = this.bots.reduce((sum, bot) => sum + bot.actionCount, 0);
        const totalSuccess = this.bots.reduce((sum, bot) => sum + bot.successCount, 0);
        const totalErrors = this.bots.reduce((sum, bot) => sum + bot.errorCount, 0);
        const totalMessages = this.bots.reduce((sum, bot) => sum + bot.messagesSent, 0);
        const actionsPerSecond = runtime > 0 ? (totalActions / runtime).toFixed(2) : '0.00';

        console.log(`\nTest Duration:     ${this.formatTime(runtime)}`);
        console.log(`Total Bots:        ${this.bots.length}`);
        console.log(`Total Messages:    ${totalMessages}`);
        console.log(`Total Actions:     ${totalActions}`);
        console.log(`Successful:        ${totalSuccess} (${this.percentage(totalSuccess, totalActions)})`);
        console.log(`Failed:            ${totalErrors} (${this.percentage(totalErrors, totalActions)})`);
        console.log(`Avg Actions/Sec:   ${actionsPerSecond}`);
        console.log(`Avg Actions/Bot:   ${(totalActions / this.bots.length).toFixed(2)}`);
        
        console.log('\n' + '-'.repeat(80));
        console.log('Per-Bot Breakdown:');
        console.log('-'.repeat(80));
        
        for (const bot of this.bots) {
            const stats = bot.getStats();
            console.log(`\nBot ${stats.botId}:`);
            console.log(`  Total Actions:      ${stats.actionCount}`);
            console.log(`  Messages Sent:      ${stats.messagesSent}`);
            console.log(`  Success Rate:       ${stats.successRate}`);
            console.log(`  Guilds Created:     ${stats.guilds}`);
            console.log(`  Channels Active:    ${stats.channels}`);
            console.log(`  Friends:            ${stats.friends}`);
            console.log(`  Group Chats:        ${stats.groupChats}`);
        }
        
        console.log('\n' + '█'.repeat(80) + '\n');
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        parts.push(`${secs}s`);
        
        return parts.join(' ');
    }

    percentage(value, total) {
        if (total === 0) return '0%';
        return ((value / total) * 100).toFixed(1) + '%';
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async run() {
        console.log('╔═══════════════════════════════════════════════════════════════╗');
        console.log('║         SerbleChat Stress Testing Tool v1.0                  ║');
        console.log('╚═══════════════════════════════════════════════════════════════╝\n');

        if (!this.loadConfig() || !this.validateConfig()) {
            console.error('Failed to initialize. Please check your configuration.');
            process.exit(1);
        }

        console.log('Configuration:');
        console.log(`  API URL:              ${this.config.apiBaseUrl}`);
        console.log(`  Bots:                 ${this.config.tokens.length}`);
        console.log(`  Actions/Minute:       ${this.config.messagesPerMinute}`);
        console.log(`  Verbose Logging:      ${this.config.verboseLogging}`);
        console.log();

        await this.startBots();
        this.startStatsMonitoring();

        // Handle graceful shutdown
        const shutdown = async () => {
            console.log('\n\n⚠️  Shutdown signal received...');
            this.stopStatsMonitoring();
            await this.stopBots();
            this.printFinalStats();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        console.log('Press Ctrl+C to stop the stress test\n');
    }
}

// Main execution
const configPath = process.argv[2] || './config.json';

if (!fs.existsSync(configPath)) {
    console.error(`Configuration file not found: ${configPath}`);
    console.log('\nUsage: node index.js [config-path]');
    console.log('Example: node index.js ./config.json');
    console.log('\nPlease create a config.json file. See config.example.json for reference.');
    process.exit(1);
}

const manager = new StressTestManager(configPath);
manager.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
