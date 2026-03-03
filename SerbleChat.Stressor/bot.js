import { SerbleChatClient } from './client.js';

export class StressTestBot {
    constructor(token, config, botId, allBots, userIdPool, timingsFile = null) {
        this.token = token;
        this.config = config;
        this.botId = botId;
        this.allBots = allBots;
        this.userIdPool = userIdPool; // Reference to shared pool of valid user IDs
        this.client = new SerbleChatClient(token, config.apiBaseUrl, botId, timingsFile);
        
        this.actionCount = 0;
        this.successCount = 0;
        this.errorCount = 0;
        this.messagesSent = 0;
        
        this.isRunning = false;
    }

    async start() {
        const connected = await this.client.connect();
        if (!connected) {
            console.error(`Bot ${this.botId}: Failed to connect`);
            return false;
        }
        
        console.log(`Bot ${this.botId}: Connected successfully`);
        this.isRunning = true;
        
        // Start two independent loops: message sending and random actions
        this.messageLoop();
        this.actionLoop();
        
        return true;
    }

    async stop() {
        this.isRunning = false;
        await this.client.disconnect();
        console.log(`Bot ${this.botId}: Disconnected`);
    }

    async messageLoop() {
        // Messages are sent at a constant, configured rate
        const messageInterval = (60 * 1000) / this.config.messagesPerMinute;
        
        while (this.isRunning) {
            try {
                await this.sendRandomMessage();
                await this.sleep(messageInterval);
            } catch (error) {
                if (this.config.logErrors) {
                    console.error(`Bot ${this.botId}: Error sending message:`, error.message);
                }
            }
        }
    }

    async sendRandomMessage() {
        const channelIds = this.getAllAccessibleChannels();
        if (channelIds.length === 0) {
            if (this.config.verboseLogging) {
                console.log(`Bot ${this.botId}: No channels available yet for sending messages`);
            }
            if (process.env.DEBUG === 'true') {
                console.error('\n' + '='.repeat(80));
                console.error('🐛 DEBUG: No channels available for sending messages');
                console.error('='.repeat(80));
                this.dumpDebugInfo();
                process.exit(1);
            }
            return;
        }

        const channelId = this.randomElement(channelIds);
        const message = this.generateMessage();
        const result = await this.client.sendMessage(channelId, message);
        
        if (result.success) {
            this.messagesSent++;
            if (this.config.logActions) {
                console.log(`Bot ${this.botId}: Sent message to channel ${channelId}`);
            }
        } else {
            if (this.config.logErrors) {
                console.error(`Bot ${this.botId}: Failed to send message to channel ${channelId}:`, result.error);
            }
            
            // If DEBUG is enabled, dump debug info and exit
            if (process.env.DEBUG === 'true') {
                console.error('\n' + '='.repeat(80));
                console.error('🐛 DEBUG: Message send failure detected - dumping debug info');
                console.error('='.repeat(80));
                console.error(`\nFailed to send message to channel: ${channelId}`);
                console.error(`Error: ${result.error}`);
                this.dumpDebugInfo();
                process.exit(1);
            }
        }
    }

    async actionLoop() {
        // Actions run independently at their own rate based on delayBetweenActionsMs
        while (this.isRunning) {
            try {
                await this.performRandomAction();
                
                const { min, max } = this.config.delayBetweenActionsMs;
                const randomDelay = Math.random() * (max - min) + min;
                
                await this.sleep(randomDelay);
            } catch (error) {
                if (this.config.logErrors) {
                    console.error(`Bot ${this.botId}: Error in action loop:`, error.message);
                }
            }
        }
    }

    async performRandomAction() {
        const action = this.selectRandomAction();
        if (!action) {
            return;
        }

        this.actionCount++;
        
        if (this.config.logActions) {
            console.log(`Bot ${this.botId}: Performing action: ${action}`);
        }

        const result = await this.executeAction(action);
        
        if (result.success) {
            this.successCount++;
        } else {
            this.errorCount++;
            if (this.config.logErrors) {
                console.error(`Bot ${this.botId}: Action ${action} failed:`, result.error);
            }
            
            if (this.config.retryFailedActions && result.retryable !== false) {
                await this.retryAction(action);
            }
        }
    }

    async retryAction(action) {
        for (let i = 0; i < this.config.maxRetries; i++) {
            await this.sleep(1000 * (i + 1));
            const result = await this.executeAction(action);
            if (result.success) {
                this.successCount++;
                return;
            }
        }
    }

    selectRandomAction() {
        const enabledActions = [];
        const weights = [];

        for (const [action, enabled] of Object.entries(this.config.enabledActions)) {
            if (enabled && this.config.actionWeights[action] > 0) {
                enabledActions.push(action);
                weights.push(this.config.actionWeights[action]);
            }
        }

        if (enabledActions.length === 0) {
            return null;
        }

        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let random = Math.random() * totalWeight;

        for (let i = 0; i < enabledActions.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return enabledActions[i];
            }
        }

        return enabledActions[enabledActions.length - 1];
    }

    async executeAction(action) {
        const actionMap = {
            deleteMessage: () => this.deleteMessage(),
            fetchMessages: () => this.fetchMessages(),
            sendFriendRequest: () => this.sendFriendRequest(),
            removeFriend: () => this.removeFriend(),
            createGuild: () => this.createGuild(),
            deleteGuild: () => this.deleteGuild(),
            updateGuild: () => this.updateGuild(),
            leaveGuild: () => this.leaveGuild(),
            createChannel: () => this.createChannel(),
            deleteChannel: () => this.deleteChannel(),
            updateChannel: () => this.updateChannel(),
            reorderChannels: () => this.reorderChannels(),
            createRole: () => this.createRole(),
            deleteRole: () => this.deleteRole(),
            updateRole: () => this.updateRole(),
            assignRole: () => this.assignRole(),
            removeRole: () => this.removeRole(),
            createInvite: () => this.createInvite(),
            acceptInvite: () => this.acceptInvite(),
            deleteInvite: () => this.deleteInvite(),
            createGroupChat: () => this.createGroupChat(),
            deleteGroupChat: () => this.deleteGroupChat(),
            addMembersToGroup: () => this.addMembersToGroup(),
            createDm: () => this.createDm(),
            createPermissionOverride: () => this.createPermissionOverride(),
            deletePermissionOverride: () => this.deletePermissionOverride(),
            updatePermissionOverride: () => this.updatePermissionOverride()
        };

        const actionFunc = actionMap[action];
        if (!actionFunc) {
            return { success: false, error: 'Unknown action', retryable: false };
        }

        try {
            return await actionFunc();
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========== Action Implementations ==========

    async deleteMessage() {
        if (!this.client.messages || this.client.messages.size === 0) {
            return { success: false, error: 'No messages to delete', retryable: false };
        }
        
        const channelsWithMessages = Array.from(this.client.messages.entries())
            .filter(([_, messages]) => messages.length > 0);
        
        if (channelsWithMessages.length === 0) {
            return { success: false, error: 'No messages to delete', retryable: false };
        }

        const [channelId, messages] = this.randomElement(channelsWithMessages);
        const messageId = this.randomElement(messages);
        
        return await this.client.deleteMessage(channelId, messageId);
    }

    async fetchMessages() {
        const channelIds = this.getAllAccessibleChannels();
        if (channelIds.length === 0) {
            return { success: false, error: 'No channels available', retryable: false };
        }

        const channelId = this.randomElement(channelIds);
        return await this.client.getMessages(channelId, 100, 0);
    }

    async sendFriendRequest() {
        if (this.userIdPool.length === 0) {
            return { success: false, error: 'No valid user IDs available', retryable: false };
        }

        // Check limit
        if (this.client.friends.length >= this.config.limits.maxFriends) {
            return { success: false, error: 'Max friends reached', retryable: false };
        }

        // Get a random user ID from the pool, but not ourselves
        const validIds = this.userIdPool.filter(id => id !== this.client.userId);
        if (validIds.length === 0) {
            return { success: false, error: 'No other valid user IDs available', retryable: false };
        }

        const targetUserId = this.randomElement(validIds);
        return await this.client.sendFriendRequest(targetUserId);
    }

    async removeFriend() {
        if (this.client.friends.length === 0) {
            return { success: false, error: 'No friends to remove', retryable: false };
        }

        const friend = this.randomElement(this.client.friends);
        const friendId = friend.User1Id === this.client.userId ? friend.User2Id : friend.User1Id;
        
        return await this.client.removeFriend(friendId);
    }

    async createGuild() {
        if (this.client.guilds.length >= this.config.limits.maxGuildsPerBot) {
            return { success: false, error: 'Max guilds reached', retryable: false };
        }

        const name = this.generateGuildName();
        return await this.client.createGuild(name);
    }

    async deleteGuild() {
        const ownedGuilds = this.client.guilds.filter(g => this.getProp(g, 'ownerId') === this.client.userId);
        if (ownedGuilds.length === 0) {
            return { success: false, error: 'No owned guilds to delete', retryable: false };
        }

        const guild = this.randomElement(ownedGuilds);
        return await this.client.deleteGuild(this.getProp(guild, 'id'));
    }

    async updateGuild() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds to update', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const newName = this.generateGuildName();
        
        return await this.client.updateGuild(this.getProp(guild, 'id'), { Name: newName });
    }

    async leaveGuild() {
        const joinedGuilds = this.client.guilds.filter(g => this.getProp(g, 'ownerId') !== this.client.userId);
        if (joinedGuilds.length === 0) {
            return { success: false, error: 'No joined guilds to leave', retryable: false };
        }

        const guild = this.randomElement(joinedGuilds);
        return await this.client.leaveGuild(this.getProp(guild, 'id'));
    }

    async createChannel() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        
        // Check channel count for this guild
        const guildChannelsResult = await this.client.getGuildChannels(this.getProp(guild, 'id'));
        if (guildChannelsResult.success) {
            if (guildChannelsResult.channels.length >= this.config.limits.maxChannelsPerGuild) {
                return { success: false, error: 'Max channels reached for guild', retryable: false };
            }
        }

        const name = this.generateChannelName();
        const voiceCapable = Math.random() > 0.7;
        
        return await this.client.createChannel(this.getProp(guild, 'id'), name, voiceCapable);
    }

    async deleteChannel() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const channelsResult = await this.client.getGuildChannels(this.getProp(guild, 'id'));
        
        if (!channelsResult.success || channelsResult.channels.length === 0) {
            return { success: false, error: 'No channels to delete', retryable: false };
        }

        const channel = this.randomElement(channelsResult.channels);
        return await this.client.deleteChannel(this.getProp(guild, 'id'), this.getProp(channel, 'channelId'));
    }

    async updateChannel() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const channelsResult = await this.client.getGuildChannels(this.getProp(guild, 'id'));
        
        if (!channelsResult.success || channelsResult.channels.length === 0) {
            return { success: false, error: 'No channels to update', retryable: false };
        }

        const channel = this.randomElement(channelsResult.channels);
        const newName = this.generateChannelName();
        
        return await this.client.updateChannel(this.getProp(guild, 'id'), this.getProp(channel, 'channelId'), { Name: newName });
    }

    async reorderChannels() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const channelsResult = await this.client.getGuildChannels(this.getProp(guild, 'id'));
        
        if (!channelsResult.success || channelsResult.channels.length < 2) {
            return { success: false, error: 'Not enough channels to reorder', retryable: false };
        }

        const channel = this.randomElement(channelsResult.channels);
        const newIndex = Math.floor(Math.random() * channelsResult.channels.length);
        
        return await this.client.reorderChannel(this.getProp(guild, 'id'), this.getProp(channel, 'channelId'), newIndex);
    }

    async createRole() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        
        // Check role count
        const rolesResult = await this.client.getGuildRoles(this.getProp(guild, 'id'));
        if (rolesResult.success && rolesResult.roles.length >= this.config.limits.maxRolesPerGuild) {
            return { success: false, error: 'Max roles reached', retryable: false };
        }

        const name = this.generateRoleName();
        const color = this.randomColor();
        
        return await this.client.createRole(this.getProp(guild, 'id'), name, color);
    }

    async deleteRole() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const rolesResult = await this.client.getGuildRoles(this.getProp(guild, 'id'));
        
        if (!rolesResult.success || rolesResult.roles.length === 0) {
            return { success: false, error: 'No roles to delete', retryable: false };
        }

        const role = this.randomElement(rolesResult.roles);
        return await this.client.deleteRole(this.getProp(guild, 'id'), this.getProp(role, 'id'));
    }

    async updateRole() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const rolesResult = await this.client.getGuildRoles(this.getProp(guild, 'id'));
        
        if (!rolesResult.success || rolesResult.roles.length === 0) {
            return { success: false, error: 'No roles to update', retryable: false };
        }

        const role = this.randomElement(rolesResult.roles);
        const newName = this.generateRoleName();
        const color = this.randomColor();
        
        return await this.client.updateRole(this.getProp(guild, 'id'), this.getProp(role, 'id'), { Name: newName, Color: color });
    }

    async assignRole() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const [rolesResult, membersResult] = await Promise.all([
            this.client.getGuildRoles(this.getProp(guild, 'id')),
            this.client.getGuildMembers(this.getProp(guild, 'id'))
        ]);
        
        if (!rolesResult.success || rolesResult.roles.length === 0) {
            return { success: false, error: 'No roles available', retryable: false };
        }
        
        if (!membersResult.success || membersResult.members.length === 0) {
            return { success: false, error: 'No members available', retryable: false };
        }

        const role = this.randomElement(rolesResult.roles);
        const member = this.randomElement(membersResult.members);
        
        return await this.client.assignRole(this.getProp(guild, 'id'), this.getProp(member, 'id'), this.getProp(role, 'id'));
    }

    async removeRole() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const [rolesResult, membersResult] = await Promise.all([
            this.client.getGuildRoles(this.getProp(guild, 'id')),
            this.client.getGuildMembers(this.getProp(guild, 'id'))
        ]);
        
        if (!rolesResult.success || rolesResult.roles.length === 0) {
            return { success: false, error: 'No roles available', retryable: false };
        }
        
        if (!membersResult.success || membersResult.members.length === 0) {
            return { success: false, error: 'No members available', retryable: false };
        }

        const role = this.randomElement(rolesResult.roles);
        const member = this.randomElement(membersResult.members);
        
        return await this.client.removeRole(this.getProp(guild, 'id'), this.getProp(member, 'id'), this.getProp(role, 'id'));
    }

    async createInvite() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const result = await this.client.createInvite(this.getProp(guild, 'id'));
        
        if (result.success && result.invite) {
            // Send invite link to 7 random users via DM
            const otherUserIds = this.userIdPool.filter(id => id !== this.client.userId);
            if (otherUserIds.length > 0) {
                const numRecipients = Math.min(7, otherUserIds.length);
                const recipients = [];
                
                // Select random recipients
                const availableIds = [...otherUserIds];
                for (let i = 0; i < numRecipients; i++) {
                    const randomIndex = Math.floor(Math.random() * availableIds.length);
                    recipients.push(availableIds[randomIndex]);
                    availableIds.splice(randomIndex, 1);
                }
                
                // Send invite link to each recipient
                const inviteLink = `${this.config.apiBaseUrl}/invite/${this.getProp(result.invite, 'id')}`;
                for (const userId of recipients) {
                    // Get or create DM channel
                    const dmResult = await this.client.createDm(userId);
                    if (dmResult.success && dmResult.channel) {
                        // Send the invite link
                        await this.client.sendMessage(this.getProp(dmResult.channel, 'id'), `Join my guild! ${inviteLink}`);
                    }
                }
            }
        }
        
        return result;
    }

    async acceptInvite() {
        // Try to find invites from other bots
        const otherBots = this.allBots.filter(b => b.botId !== this.botId && b.client.invites.length > 0);
        if (otherBots.length === 0) {
            return { success: false, error: 'No invites available', retryable: false };
        }

        const targetBot = this.randomElement(otherBots);
        const invite = this.randomElement(targetBot.client.invites);
        
        return await this.client.acceptInvite(this.getProp(invite, 'id'));
    }

    async deleteInvite() {
        if (this.client.invites.length === 0) {
            return { success: false, error: 'No invites to delete', retryable: false };
        }

        const invite = this.randomElement(this.client.invites);
        return await this.client.deleteInvite(this.getProp(invite, 'id'));
    }

    async createGroupChat() {
        if (this.client.groupChats.length >= this.config.limits.maxGroupChats) {
            return { success: false, error: 'Max group chats reached', retryable: false };
        }

        if (this.userIdPool.length <= 1) {
            return { success: false, error: 'Not enough valid user IDs for group chat', retryable: false };
        }

        // Get other valid user IDs (not ourselves)
        const otherUserIds = this.userIdPool.filter(id => id !== this.client.userId);
        if (otherUserIds.length === 0) {
            return { success: false, error: 'No other valid user IDs available', retryable: false };
        }

        const numMembers = Math.min(Math.floor(Math.random() * 4) + 1, otherUserIds.length);
        const members = [];
        for (let i = 0; i < numMembers; i++) {
            members.push(otherUserIds[i]);
        }

        const name = this.generateGroupChatName();
        return await this.client.createGroupChat(name, members);
    }

    async deleteGroupChat() {
        const ownedGroups = this.client.groupChats.filter(g => this.getProp(g, 'ownerId') === this.client.userId);
        if (ownedGroups.length === 0) {
            return { success: false, error: 'No owned group chats to delete', retryable: false };
        }

        const group = this.randomElement(ownedGroups);
        return await this.client.deleteGroupChat(this.getProp(group, 'channelId'));
    }

    async addMembersToGroup() {
        const ownedGroups = this.client.groupChats.filter(g => this.getProp(g, 'ownerId') === this.client.userId);
        if (ownedGroups.length === 0) {
            return { success: false, error: 'No owned group chats', retryable: false };
        }

        if (this.userIdPool.length <= 1) {
            return { success: false, error: 'Not enough valid user IDs', retryable: false };
        }

        const otherUserIds = this.userIdPool.filter(id => id !== this.client.userId);
        if (otherUserIds.length === 0) {
            return { success: false, error: 'No other valid user IDs available', retryable: false };
        }

        const group = this.randomElement(ownedGroups);
        const member = this.randomElement(otherUserIds);
        
        return await this.client.addMembersToGroup(this.getProp(group, 'channelId'), [member]);
    }

    async createDm() {
        if (this.userIdPool.length <= 1) {
            return { success: false, error: 'Not enough valid user IDs for DM', retryable: false };
        }

        const otherUserIds = this.userIdPool.filter(id => id !== this.client.userId);
        if (otherUserIds.length === 0) {
            return { success: false, error: 'No other valid user IDs available', retryable: false };
        }

        const targetUserId = this.randomElement(otherUserIds);
        return await this.client.createDm(targetUserId);
    }

    async createPermissionOverride() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const [channelsResult, rolesResult] = await Promise.all([
            this.client.getGuildChannels(this.getProp(guild, 'id')),
            this.client.getGuildRoles(this.getProp(guild, 'id'))
        ]);
        
        if (!channelsResult.success || channelsResult.channels.length === 0) {
            return { success: false, error: 'No channels available', retryable: false };
        }
        
        if (!rolesResult.success || rolesResult.roles.length === 0) {
            return { success: false, error: 'No roles available', retryable: false };
        }

        const channel = this.randomElement(channelsResult.channels);
        const role = this.randomElement(rolesResult.roles);
        const permissions = this.randomPermissions();
        
        return await this.client.createPermissionOverride(this.getProp(guild, 'id'), this.getProp(channel, 'channelId'), this.getProp(role, 'id'), permissions);
    }

    async deletePermissionOverride() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const channelsResult = await this.client.getGuildChannels(this.getProp(guild, 'id'));
        
        if (!channelsResult.success || channelsResult.channels.length === 0) {
            return { success: false, error: 'No channels available', retryable: false };
        }

        const channel = this.randomElement(channelsResult.channels);
        const overridesResult = await this.client.getPermissionOverrides(this.getProp(guild, 'id'), this.getProp(channel, 'channelId'));
        
        if (!overridesResult.success || overridesResult.overrides.length === 0) {
            return { success: false, error: 'No permission overrides to delete', retryable: false };
        }

        const override = this.randomElement(overridesResult.overrides);
        return await this.client.deletePermissionOverride(this.getProp(guild, 'id'), this.getProp(channel, 'channelId'), this.getProp(override, 'id'));
    }

    async updatePermissionOverride() {
        if (this.client.guilds.length === 0) {
            return { success: false, error: 'No guilds available', retryable: false };
        }

        const guild = this.randomElement(this.client.guilds);
        const channelsResult = await this.client.getGuildChannels(this.getProp(guild, 'id'));
        
        if (!channelsResult.success || channelsResult.channels.length === 0) {
            return { success: false, error: 'No channels available', retryable: false };
        }

        const channel = this.randomElement(channelsResult.channels);
        const overridesResult = await this.client.getPermissionOverrides(this.getProp(guild, 'id'), this.getProp(channel, 'channelId'));
        
        if (!overridesResult.success || overridesResult.overrides.length === 0) {
            return { success: false, error: 'No permission overrides to update', retryable: false };
        }

        const override = this.randomElement(overridesResult.overrides);
        const permissions = this.randomPermissions();
        
        return await this.client.updatePermissionOverride(this.getProp(guild, 'id'), this.getProp(channel, 'channelId'), this.getProp(override, 'id'), permissions);
    }

    // ========== Helper Methods ==========

    getAllAccessibleChannels() {
        const channelIds = [];
        
        // Add guild channel IDs from the cached map
        for (const [guildId, channelIdList] of this.client.guildChannels.entries()) {
            channelIds.push(...channelIdList);
        }
        
        // Add DM channel IDs (camelCase from API)
        for (const dmChannel of this.client.dmChannels) {
            const channelId = dmChannel.channelId || dmChannel.ChannelId;
            if (channelId) {
                channelIds.push(channelId);
            }
        }
        
        // Add group chat channel IDs (camelCase from API)
        for (const groupChat of this.client.groupChats) {
            const channelId = groupChat.channelId || groupChat.ChannelId;
            if (channelId) {
                channelIds.push(channelId);
            }
        }
        
        return channelIds;
    }

    generateMessage() {
        const template = this.randomElement(this.config.messageTemplates);
        return template
            .replace('{count}', this.actionCount)
            .replace('{random}', Math.floor(Math.random() * 10000));
    }

    generateGuildName() {
        const template = this.randomElement(this.config.guildNameTemplates);
        return template
            .replace('{count}', this.client.guilds.length + 1)
            .replace('{random}', Math.floor(Math.random() * 10000));
    }

    generateChannelName() {
        const template = this.randomElement(this.config.channelNameTemplates);
        return template
            .replace('{count}', this.client.channels.length + 1)
            .replace('{random}', Math.floor(Math.random() * 10000));
    }

    generateRoleName() {
        const template = this.randomElement(this.config.roleNameTemplates);
        return template
            .replace('{count}', Math.floor(Math.random() * 100))
            .replace('{random}', Math.floor(Math.random() * 10000));
    }

    generateGroupChatName() {
        const template = this.randomElement(this.config.groupChatNameTemplates);
        return template
            .replace('{count}', this.client.groupChats.length + 1)
            .replace('{random}', Math.floor(Math.random() * 10000));
    }

    randomColor() {
        const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080', '#FFC0CB', ''];
        return this.randomElement(colors);
    }

    randomPermissions() {
        // Generate random permission object
        const boolValues = [0, 1, 2]; // 0 = unset, 1 = allow, 2 = deny
        return {
            Administrator: this.randomElement(boolValues),
            ManageGuild: this.randomElement(boolValues),
            ManageChannels: this.randomElement(boolValues),
            ManageRoles: this.randomElement(boolValues),
            CreateInvites: this.randomElement(boolValues),
            KickMembers: this.randomElement(boolValues),
            BanMembers: this.randomElement(boolValues),
            ViewChannel: this.randomElement(boolValues),
            SendMessages: this.randomElement(boolValues),
            ManageMessages: this.randomElement(boolValues),
            MentionEveryone: this.randomElement(boolValues),
            UseVoice: this.randomElement(boolValues)
        };
    }

    randomElement(array) {
        return array[Math.floor(Math.random() * array.length)];
    }
    
    // Helper to get property value with both camelCase and PascalCase
    getProp(obj, propName) {
        if (!obj) return undefined;
        // Try camelCase first (API default)
        const camelCase = propName.charAt(0).toLowerCase() + propName.slice(1);
        if (obj[camelCase] !== undefined) return obj[camelCase];
        // Try PascalCase as fallback
        const pascalCase = propName.charAt(0).toUpperCase() + propName.slice(1);
        if (obj[pascalCase] !== undefined) return obj[pascalCase];
        return undefined;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    dumpDebugInfo() {
        console.error('\n' + '─'.repeat(80));
        console.error('BOT STATE');
        console.error('─'.repeat(80));
        console.error(`Bot ID: ${this.botId}`);
        console.error(`User ID: ${this.client.userId}`);
        console.error(`Is Running: ${this.isRunning}`);
        console.error(`Messages Sent: ${this.messagesSent}`);
        console.error(`Actions Performed: ${this.actionCount}`);
        console.error(`Success Count: ${this.successCount}`);
        console.error(`Error Count: ${this.errorCount}`);
        
        console.error('\n' + '─'.repeat(80));
        console.error('USER ID POOL');
        console.error('─'.repeat(80));
        console.error(`Total users in pool: ${this.userIdPool.length}`);
        console.error('User IDs:', this.userIdPool);
        
        console.error('\n' + '─'.repeat(80));
        console.error('GUILDS');
        console.error('─'.repeat(80));
        console.error(`Total guilds: ${this.client.guilds.length}`);
        if (this.client.guilds.length > 0) {
            this.client.guilds.forEach(g => {
                console.error(`  - Guild ${this.getProp(g, 'id')}: ${this.getProp(g, 'name')} (Owner: ${this.getProp(g, 'ownerId')})`);
                console.error(`    Raw object:`, JSON.stringify(g));
            });
        } else {
            console.error('  (no guilds)');
        }
        
        console.error('\n' + '─'.repeat(80));
        console.error('GUILD CHANNELS');
        console.error('─'.repeat(80));
        console.error(`Total guild channel maps: ${this.client.guildChannels.size}`);
        let totalGuildChannels = 0;
        for (const [guildId, channelIds] of this.client.guildChannels.entries()) {
            console.error(`  - Guild ${guildId}: ${channelIds.length} channels`);
            channelIds.forEach(cId => {
                console.error(`    • Channel ID: ${cId}`);
            });
            totalGuildChannels += channelIds.length;
        }
        console.error(`Total guild channels: ${totalGuildChannels}`);
        
        console.error('\n' + '─'.repeat(80));
        console.error('DM CHANNELS');
        console.error('─'.repeat(80));
        console.error(`Total DM channels: ${this.client.dmChannels.length}`);
        if (this.client.dmChannels.length > 0) {
            this.client.dmChannels.forEach(dm => {
                const channelId = this.getProp(dm, 'channelId');
                const user1 = this.getProp(dm, 'user1Id');
                const user2 = this.getProp(dm, 'user2Id');
                console.error(`  - DM Channel ID: ${channelId} (Users: ${user1}, ${user2})`);
                console.error(`    Raw object:`, JSON.stringify(dm));
            });
        } else {
            console.error('  (no DM channels)');
        }
        
        console.error('\n' + '─'.repeat(80));
        console.error('GROUP CHATS');
        console.error('─'.repeat(80));
        console.error(`Total group chats: ${this.client.groupChats.length}`);
        if (this.client.groupChats.length > 0) {
            this.client.groupChats.forEach(g => {
                const channelId = this.getProp(g, 'channelId');
                const ownerId = this.getProp(g, 'ownerId');
                console.error(`  - Group Chat Channel ID: ${channelId}, Owner: ${ownerId}`);
                console.error(`    Raw object:`, JSON.stringify(g));
            });
        } else {
            console.error('  (no group chats)');
        }
        
        console.error('\n' + '─'.repeat(80));
        console.error('ACCESSIBLE CHANNELS (for messages)');
        console.error('─'.repeat(80));
        const accessibleChannels = this.getAllAccessibleChannels();
        console.error(`Total accessible channel IDs: ${accessibleChannels.length}`);
        if (accessibleChannels.length > 0) {
            accessibleChannels.forEach(cId => {
                console.error(`  - ${cId}`);
            });
        } else {
            console.error('  ⚠️ NO ACCESSIBLE CHANNELS - This is why messages are failing!');
        }
        
        console.error('\n' + '─'.repeat(80));
        console.error('FRIENDS');
        console.error('─'.repeat(80));
        console.error(`Total friends: ${this.client.friends.length}`);
        console.error(`Pending friend requests: ${this.client.pendingFriendRequests.length}`);
        
        console.error('\n' + '─'.repeat(80));
        console.error('MESSAGES TRACKING');
        console.error('─'.repeat(80));
        console.error(`Channels with tracked messages: ${this.client.messages.size}`);
        for (const [channelId, messageIds] of this.client.messages.entries()) {
            console.error(`  - Channel ${channelId}: ${messageIds.length} messages`);
        }
        
        console.error('\n' + '─'.repeat(80));
        console.error('CONNECTION STATE');
        console.error('─'.repeat(80));
        console.error(`SignalR connected: ${this.client.hubConnection?.state === 'Connected'}`);
        console.error(`SignalR state: ${this.client.hubConnection?.state || 'unknown'}`);
        
        console.error('\n' + '─'.repeat(80));
        console.error('CONFIG');
        console.error('─'.repeat(80));
        console.error(`API Base URL: ${this.config.apiBaseUrl}`);
        console.error(`Messages Per Minute: ${this.config.messagesPerMinute}`);
        console.error(`Delay Between Actions: ${JSON.stringify(this.config.delayBetweenActionsMs)}`);
        
        console.error('\n' + '='.repeat(80));
        console.error('END DEBUG DUMP');
        console.error('='.repeat(80) + '\n');
    }

    getStats() {
        return {
            botId: this.botId,
            actionCount: this.actionCount,
            successCount: this.successCount,
            errorCount: this.errorCount,
            messagesSent: this.messagesSent,
            successRate: this.actionCount > 0 ? (this.successCount / this.actionCount * 100).toFixed(2) + '%' : 'N/A',
            guilds: this.client.guilds.length,
            channels: this.client.channels.length,
            friends: this.client.friends.length,
            groupChats: this.client.groupChats.length
        };
    }
}