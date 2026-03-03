#!/usr/bin/env node

/**
 * Helper script to generate scenario config files
 * Usage: node generate-scenarios.js
 */

import fs from 'fs';

const scenarios = {
  'messages': {
    name: 'Message Spam Test',
    description: 'High-volume message sending',
    config: {
      messagesPerMinute: 120,
      enabledActions: {
        sendMessage: true
      },
      actionWeights: {
        sendMessage: 100
      },
      delayBetweenActionsMs: { min: 100, max: 500 }
    }
  },
  'guilds': {
    name: 'Guild Management Stress',
    description: 'Guild, channel, and role management',
    config: {
      messagesPerMinute: 40,
      enabledActions: {
        createGuild: true,
        updateGuild: true,
        createChannel: true,
        updateChannel: true,
        reorderChannels: true,
        createRole: true,
        updateRole: true,
        assignRole: true,
        createInvite: true
      },
      actionWeights: {
        createGuild: 5,
        updateGuild: 10,
        createChannel: 15,
        updateChannel: 10,
        reorderChannels: 8,
        createRole: 12,
        updateRole: 8,
        assignRole: 15,
        createInvite: 8
      }
    }
  },
  'social': {
    name: 'Social Features Test',
    description: 'Friend requests, DMs, and group chats',
    config: {
      messagesPerMinute: 60,
      enabledActions: {
        sendMessage: true,
        sendFriendRequest: true,
        acceptFriendRequest: true,
        createGroupChat: true,
        addMembersToGroup: true,
        createDm: true
      },
      actionWeights: {
        sendMessage: 30,
        sendFriendRequest: 15,
        acceptFriendRequest: 20,
        createGroupChat: 10,
        addMembersToGroup: 10,
        createDm: 15
      }
    }
  }
};

function generateScenario(name, scenario, baseConfig) {
  const config = {
    ...baseConfig,
    ...scenario.config,
    enabledActions: {
      sendMessage: false,
      deleteMessage: false,
      sendFriendRequest: false,
      acceptFriendRequest: false,
      removeFriend: false,
      createGuild: false,
      deleteGuild: false,
      updateGuild: false,
      leaveGuild: false,
      createChannel: false,
      deleteChannel: false,
      updateChannel: false,
      reorderChannels: false,
      createRole: false,
      deleteRole: false,
      updateRole: false,
      assignRole: false,
      removeRole: false,
      createInvite: false,
      acceptInvite: false,
      deleteInvite: false,
      createGroupChat: false,
      deleteGroupChat: false,
      addMembersToGroup: false,
      createDm: false,
      createPermissionOverride: false,
      deletePermissionOverride: false,
      updatePermissionOverride: false,
      ...scenario.config.enabledActions
    }
  };

  const filename = `config.scenario-${name}.json`;
  fs.writeFileSync(filename, JSON.stringify(config, null, 2));
  console.log(`✓ Generated ${filename} - ${scenario.name}`);
}

console.log('Generating scenario configuration files...\n');

// Load base config
let baseConfig;
try {
  if (fs.existsSync('./config.example.json')) {
    baseConfig = JSON.parse(fs.readFileSync('./config.example.json', 'utf8'));
  } else {
    console.error('✗ config.example.json not found');
    process.exit(1);
  }
} catch (error) {
  console.error('✗ Failed to load base config:', error.message);
  process.exit(1);
}

// Generate scenario files
for (const [name, scenario] of Object.entries(scenarios)) {
  generateScenario(name, scenario, baseConfig);
}

console.log('\n✓ All scenario files generated successfully!');
console.log('\nTo use a scenario:');
console.log('  node index.js config.scenario-messages.json');
console.log('\nAvailable scenarios:');
for (const [name, scenario] of Object.entries(scenarios)) {
  console.log(`  - ${name}: ${scenario.description}`);
}
