import axios from 'axios';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import fs from 'fs';
import path from 'path';

export class SerbleChatClient {
    constructor(token, baseUrl, botId, timingsFile = null) {
        this.token = token;
        this.baseUrl = baseUrl;
        this.botId = botId;
        this.timingsFile = timingsFile;
        
        this.axios = axios.create({
            baseURL: baseUrl,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        this.hubConnection = null;
        this.userId = null;
        
        // Track state
        this.guilds = [];
        this.guildChannels = new Map(); // guildId -> [channel IDs]
        this.channels = [];
        this.friends = [];
        this.pendingFriendRequests = [];
        this.groupChats = [];
        this.dmChannels = [];
        this.invites = [];
        this.messages = new Map(); // channelId -> [messageIds]
    }

    async connect() {
        try {
            // Fetch current user ID
            await this.fetchCurrentUserId();
            
            // Connect to SignalR hub
            this.hubConnection = new HubConnectionBuilder()
                .withUrl(`${this.baseUrl}/updates`, {
                    accessTokenFactory: () => this.token
                })
                .withAutomaticReconnect()
                .configureLogging(LogLevel.Warning)
                .build();

            this.setupEventHandlers();
            await this.hubConnection.start();
            
            // Fetch initial data
            await this.fetchInitialData();
            
            return true;
        } catch (error) {
            console.error(`Bot ${this.botId}: Failed to connect:`, error.message);
            return false;
        }
    }

    setupEventHandlers() {
        this.hubConnection.on('NewMessage', (message) => {
            const channelMessages = this.messages.get(message.ChannelId) || [];
            channelMessages.push(message.Id);
            this.messages.set(message.ChannelId, channelMessages);
            
            // Check for invite links in message content
            if (message.content) {
                const inviteRegex = /https?:\/\/[^\s]+\/invite\/([a-zA-Z0-9]+)/g;
                const matches = message.content.matchAll(inviteRegex);
                
                for (const match of matches) {
                    const inviteCode = match[1];
                    // Auto-accept invite
                    this.acceptInvite(inviteCode).catch(err => {
                        console.warn(`Bot ${this.botId}: Failed to auto-join invite ${inviteCode}:`, err.message);
                    });
                }
            }
        });

        this.hubConnection.on('FriendRequestReceived', (data) => {
            this.pendingFriendRequests.push(data.FromUserId);
            // Auto-accept friend requests
            this.acceptFriendRequest(data.FromUserId).catch(err => {
                console.warn(`Failed to auto-accept friend request from ${data.FromUserId}:`, err.message);
            });
        });

        this.hubConnection.on('FriendRequestAccepted', (data) => {
            // Remove from pending and add to friends
            this.pendingFriendRequests = this.pendingFriendRequests.filter(id => id !== data.UserId);
        });

        this.hubConnection.on('GuildInviteReceived', (data) => {
            // Auto-accept guild invites
            if (data.InviteId) {
                this.acceptInvite(data.InviteId).catch(err => {
                    console.warn(`Failed to auto-accept guild invite ${data.InviteId}:`, err.message);
                });
            }
        });

        this.hubConnection.on('FriendRemoved', (data) => {
            this.friends = this.friends.filter(f => f.User1Id !== data.UserId && f.User2Id !== data.UserId);
        });

        this.hubConnection.on('NewChannel', (channel) => {
            // If it's a guild channel, add to guild channels map
            const guildId = channel.guildId || channel.GuildId;
            if (guildId) {
                const channelId = channel.id || channel.Id;
                const guildChannelIds = this.guildChannels.get(guildId) || [];
                guildChannelIds.push(channelId);
                this.guildChannels.set(guildId, guildChannelIds);
            }
            // Note: DM and group channels are tracked separately via their own lists
        });

        this.hubConnection.on('ChannelDeleted', (data) => {
            // Remove from guild channels map
            const deletedChannelId = data.channelId || data.ChannelId;
            for (const [guildId, channelIds] of this.guildChannels.entries()) {
                const filtered = channelIds.filter(id => id !== deletedChannelId);
                if (filtered.length !== channelIds.length) {
                    this.guildChannels.set(guildId, filtered);
                    break;
                }
            }
            this.messages.delete(deletedChannelId);
        });

        this.hubConnection.on('GuildUpdated', async (data) => {
            await this.refreshGuild(data.GuildId);
        });

        this.hubConnection.on('LeftGuild', (data) => {
            const guildId = data.guildId || data.GuildId;
            this.guilds = this.guilds.filter(g => {
                const id = g.id || g.Id;
                return id !== guildId;
            });
            // Remove guild channels from map
            this.guildChannels.delete(guildId);
        });
    }

    async fetchCurrentUserId() {
        try {
            const response = await this.axios.get('/account');
            if (response.data && response.data.id) {
                this.userId = response.data.id;
                return this.userId;
            }
            throw new Error('No user ID in response');
        } catch (error) {
            console.error(`Bot ${this.botId}: Failed to fetch user ID:`, error.message);
            throw error;
        }
    }

    async fetchInitialData() {
        try {
            // Get guilds
            const guildsResponse = await this.axios.get('/guild');
            this.guilds = guildsResponse.data;

            // Get channels for each guild
            for (const guild of this.guilds) {
                try {
                    const guildId = guild.id || guild.Id;
                    const channelsResponse = await this.axios.get(`/guild/${guildId}/channel`);
                    const channelIds = channelsResponse.data.map(gc => gc.channelId || gc.ChannelId);
                    this.guildChannels.set(guildId, channelIds);
                } catch (error) {
                    // Might not have permissions or guild deleted
                    const guildId = guild.id || guild.Id;
                    this.guildChannels.set(guildId, []);
                }
            }

            // Get friends
            const friendsResponse = await this.axios.get('/friends');
            const friendships = friendsResponse.data;
            this.friends = friendships.filter(f => !f.Pending);
            this.pendingFriendRequests = friendships.filter(f => f.Pending && f.User1Id !== this.userId).map(f => f.User1Id);

            // Get group chats - API returns GroupChatMember or GroupChat objects
            const groupsResponse = await this.axios.get('/channel/group');
            this.groupChats = groupsResponse.data.map(item => {
                // Handle different response formats
                if (item.channelId || item.ChannelId) {
                    // Full GroupChat object
                    return item;
                } else if (item.groupChatId || item.GroupChatId) {
                    // GroupChatMember object - channelId = groupChatId for group chats
                    return {
                        channelId: item.groupChatId || item.GroupChatId,
                        ownerId: item.userId || item.UserId,
                        channel: item.channel || item.Channel
                    };
                }
                return item;
            });

            // Get DM channels - API returns Channel objects directly
            const dmsResponse = await this.axios.get('/channel/dm');
            this.dmChannels = dmsResponse.data.map(item => {
                // If it's a raw Channel object, wrap it as a DmChannel
                if (item.type !== undefined && !item.channelId && !item.ChannelId) {
                    return {
                        channelId: item.id || item.Id,
                        user1Id: null, // We don't have this from Channel object alone
                        user2Id: null,
                        channel: item
                    };
                }
                return item;
            });
        } catch (error) {
            console.error(`Bot ${this.botId}: Error fetching initial data:`, error.message);
        }
    }

    async refreshGuild(guildId) {
        try {
            const response = await this.axios.get(`/guild/${guildId}`);
            const index = this.guilds.findIndex(g => g.Id === guildId);
            if (index >= 0) {
                this.guilds[index] = response.data;
            }
        } catch (error) {
            // Guild might have been deleted
            this.guilds = this.guilds.filter(g => g.Id !== guildId);
        }
    }

    // ========== Message Actions ==========

    async sendMessage(channelId, content) {
        const startTime = Date.now();
        try {
            await this.axios.post(`/channel/${channelId}`, { Content: content });
            const duration = Date.now() - startTime;
            this.recordTiming('sendMessage', duration, true);
            return { success: true };
        } catch (error) {
            const duration = Date.now() - startTime;
            this.recordTiming('sendMessage', duration, false);
            return { success: false, error: error.message };
        }
    }

    async deleteMessage(channelId, messageId) {
        try {
            await this.axios.delete(`/channel/${channelId}/message/${messageId}`);
            const channelMessages = this.messages.get(channelId) || [];
            this.messages.set(channelId, channelMessages.filter(id => id !== messageId));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getMessages(channelId, limit = 100, offset = 0) {
        const startTime = Date.now();
        try {
            const response = await this.axios.get(`/channel/${channelId}/messages`, {
                params: { limit, offset }
            });
            const duration = Date.now() - startTime;
            this.recordTiming('getMessages', duration, true);
            return { success: true, messages: response.data };
        } catch (error) {
            const duration = Date.now() - startTime;
            this.recordTiming('getMessages', duration, false);
            return { success: false, error: error.message };
        }
    }

    // ========== Friend Actions ==========

    async sendFriendRequest(friendId) {
        try {
            await this.axios.post(`/friends/${friendId}`);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async acceptFriendRequest(friendId) {
        try {
            await this.axios.post(`/friends/${friendId}`);
            this.pendingFriendRequests = this.pendingFriendRequests.filter(id => id !== friendId);
            await this.fetchInitialData(); // Refresh friends list
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeFriend(friendId) {
        try {
            await this.axios.delete(`/friends/${friendId}`);
            this.friends = this.friends.filter(f => f.User1Id !== friendId && f.User2Id !== friendId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========== Guild Actions ==========

    async createGuild(name) {
        try {
            const response = await this.axios.post('/guild', { Name: name });
            const guild = response.data;
            this.guilds.push(guild);
            
            // Initialize guild channels map (new guilds start with no channels)
            const guildId = guild.id || guild.Id;
            this.guildChannels.set(guildId, []);
            
            return { success: true, guild: guild };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteGuild(guildId) {
        try {
            await this.axios.delete(`/guild/${guildId}`);
            this.guilds = this.guilds.filter(g => {
                const id = g.id || g.Id;
                return id !== guildId;
            });
            // Remove guild channels from map
            this.guildChannels.delete(guildId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateGuild(guildId, data) {
        try {
            await this.axios.patch(`/guild/${guildId}`, data);
            await this.refreshGuild(guildId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async leaveGuild(guildId) {
        try {
            await this.axios.post(`/guild/${guildId}/leave`, {});
            this.guilds = this.guilds.filter(g => g.Id !== guildId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========== Channel Actions ==========

    async createChannel(guildId, name, voiceCapable = false) {
        try {
            const response = await this.axios.post(`/guild/${guildId}/channel`, {
                Name: name,
                VoiceCapable: voiceCapable
            });
            this.channels.push(response.data);
            return { success: true, channel: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteChannel(guildId, channelId) {
        try {
            await this.axios.delete(`/guild/${guildId}/channel/${channelId}`);
            this.channels = this.channels.filter(c => c.Id !== channelId);
            this.messages.delete(channelId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateChannel(guildId, channelId, data) {
        try {
            await this.axios.patch(`/guild/${guildId}/channel/${channelId}`, data);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async reorderChannel(guildId, channelId, newIndex) {
        try {
            await this.axios.post(`/guild/${guildId}/channel/${channelId}/reorder`, {
                NewIndex: newIndex
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getGuildChannels(guildId) {
        try {
            const response = await this.axios.get(`/guild/${guildId}/channel`);
            return { success: true, channels: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========== Role Actions ==========

    async createRole(guildId, name, color = '', permissions = null) {
        try {
            const response = await this.axios.post(`/guild/${guildId}/roles`, {
                Name: name,
                Color: color,
                Permissions: permissions,
                DisplaySeparately: false,
                Mentionable: true
            });
            return { success: true, role: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteRole(guildId, roleId) {
        try {
            await this.axios.delete(`/guild/${guildId}/roles/${roleId}`);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateRole(guildId, roleId, data) {
        try {
            await this.axios.patch(`/guild/${guildId}/roles/${roleId}`, data);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async assignRole(guildId, userId, roleId) {
        try {
            await this.axios.post(`/guild/${guildId}/members/${userId}/roles/${roleId}`);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async removeRole(guildId, userId, roleId) {
        try {
            await this.axios.delete(`/guild/${guildId}/members/${userId}/roles/${roleId}`);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getGuildRoles(guildId) {
        try {
            const response = await this.axios.get(`/guild/${guildId}/roles`);
            return { success: true, roles: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getGuildMembers(guildId) {
        try {
            const response = await this.axios.get(`/guild/${guildId}/members`);
            return { success: true, members: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========== Invite Actions ==========

    async createInvite(guildId) {
        try {
            const response = await this.axios.post(`/guild/${guildId}/invite`);
            this.invites.push(response.data);
            return { success: true, invite: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async acceptInvite(inviteId) {
        try {
            const response = await this.axios.post(`/guild/invite/${inviteId}/accept`);
            const guild = response.data;
            this.guilds.push(guild);
            
            // Fetch channels for the newly joined guild
            const guildId = guild.id || guild.Id;
            try {
                const channelsResponse = await this.axios.get(`/guild/${guildId}/channel`);
                const channelIds = channelsResponse.data.map(gc => gc.channelId || gc.ChannelId);
                this.guildChannels.set(guildId, channelIds);
            } catch (error) {
                // If we can't fetch channels, set empty array
                this.guildChannels.set(guildId, []);
            }
            
            return { success: true, guild: guild };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteInvite(inviteId) {
        try {
            await this.axios.delete(`/guild/invite/${inviteId}`);
            this.invites = this.invites.filter(i => i.Id !== inviteId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getGuildInvites(guildId) {
        try {
            const response = await this.axios.get(`/guild/${guildId}/invite`);
            return { success: true, invites: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========== Group Chat Actions ==========

    async createGroupChat(name, userIds) {
        try {
            const response = await this.axios.post('/channel/group', {
                Name: name,
                Users: userIds
            });
            
            let groupChat = response.data;
            
            // Normalize if needed
            if (!groupChat.channelId && !groupChat.ChannelId) {
                if (groupChat.groupChatId || groupChat.GroupChatId) {
                    groupChat = {
                        channelId: groupChat.groupChatId || groupChat.GroupChatId,
                        ownerId: this.userId,
                        channel: groupChat.channel || groupChat.Channel
                    };
                } else if (groupChat.id || groupChat.Id) {
                    // It's a Channel object
                    groupChat = {
                        channelId: groupChat.id || groupChat.Id,
                        ownerId: this.userId,
                        channel: groupChat
                    };
                }
            }
            
            this.groupChats.push(groupChat);
            return { success: true, groupChat: groupChat };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteGroupChat(groupId) {
        try {
            await this.axios.delete(`/channel/group/${groupId}`);
            this.groupChats = this.groupChats.filter(g => g.ChannelId !== groupId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addMembersToGroup(groupId, userIds) {
        try {
            await this.axios.post(`/channel/group/${groupId}/members`, {
                UserIds: userIds
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========== DM Actions ==========

    async createDm(otherUserId) {
        try {
            const response = await this.axios.get(`/channel/dm/${otherUserId}`);
            let dmChannel = response.data;
            
            // Normalize if it's a raw Channel object
            if (dmChannel.type !== undefined && !dmChannel.channelId && !dmChannel.ChannelId) {
                dmChannel = {
                    channelId: dmChannel.id || dmChannel.Id,
                    user1Id: this.userId,
                    user2Id: otherUserId,
                    channel: dmChannel
                };
            }
            
            const channelId = dmChannel.channelId || dmChannel.ChannelId;
            const existing = this.dmChannels.find(dm => {
                const dmChannelId = dm.channelId || dm.ChannelId;
                return dmChannelId === channelId;
            });
            
            if (!existing) {
                this.dmChannels.push(dmChannel);
            }
            return { success: true, channel: dmChannel };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ========== Permission Override Actions ==========

    async createPermissionOverride(guildId, channelId, roleId, permissions) {
        try {
            const response = await this.axios.post(
                `/guild/${guildId}/channel/${channelId}/permission-overrides`,
                {
                    RoleId: roleId,
                    Permissions: permissions
                }
            );
            return { success: true, override: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deletePermissionOverride(guildId, channelId, overrideId) {
        try {
            await this.axios.delete(
                `/guild/${guildId}/channel/${channelId}/permission-overrides/${overrideId}`
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updatePermissionOverride(guildId, channelId, overrideId, permissions) {
        try {
            await this.axios.patch(
                `/guild/${guildId}/channel/${channelId}/permission-overrides/${overrideId}`,
                {
                    Permissions: permissions
                }
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getPermissionOverrides(guildId, channelId) {
        try {
            const response = await this.axios.get(
                `/guild/${guildId}/channel/${channelId}/permission-overrides`
            );
            return { success: true, overrides: response.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async disconnect() {
        if (this.hubConnection) {
            await this.hubConnection.stop();
        }
    }

    recordTiming(queryType, durationMs, success = true) {
        if (!this.timingsFile) return;
        
        const timestamp = new Date().toISOString();
        const line = `${timestamp},${this.botId},${queryType},${durationMs},${success ? 'true' : 'false'}\n`;
        
        fs.appendFileSync(this.timingsFile, line);
    }
}
