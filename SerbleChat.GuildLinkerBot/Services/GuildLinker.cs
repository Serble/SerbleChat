using Discord;
using Discord.WebSocket;
using Microsoft.Extensions.Logging;
using SerbleChat.GuildLinkerBot.Config;
using SerbleChat.GuildLinkerBot.Models;

namespace SerbleChat.GuildLinkerBot.Services;

/// <summary>
/// Service that handles the linking between Serble Chat and Discord guilds
/// </summary>
public class GuildLinker(
    ILogger<GuildLinker> logger,
    ISerbleChatClient serbleChatClient,
    IDiscordService discordService,
    BotConfiguration config)
    : IGuildLinker {
    
    private readonly Dictionary<string, SerbleUser> _userCache = new();
    private readonly HashSet<string> _recentlyForwardedMessages = [];
    private readonly object _messageLock = new();
    private const int MaxTrackedMessages = 1000;

    public async Task StartAsync() {
        try {
            // Register callbacks for Serble Chat events
            serbleChatClient.OnNewMessage(HandleSerbleChatMessageAsync);
            serbleChatClient.OnUserJoinedVoice(HandleSerbleChatUserJoinedVoiceAsync);
            serbleChatClient.OnUserLeftVoice(HandleSerbleChatUserLeftVoiceAsync);

            // Register callbacks for Discord events
            discordService.OnMessageReceived(HandleDiscordMessageAsync);
            discordService.OnUserJoinedVoice(HandleDiscordUserJoinedVoiceAsync);
            discordService.OnUserLeftVoice(HandleDiscordUserLeftVoiceAsync);

            // Join all configured voice channels (if enabled)
            foreach (GuildLinkConfig guildLink in config.GuildLinks) {
                if (guildLink.EnableVoiceConnection) {
                    logger.LogInformation("Attempting to join voice channel for guild {DiscordGuildId}", guildLink.DiscordGuildId);
                    await discordService.JoinVoiceChannelAsync(guildLink.DiscordGuildId, guildLink.DiscordVoiceChannelId);
                } else {
                    logger.LogInformation("Voice connection disabled for guild {DiscordGuildId}", guildLink.DiscordGuildId);
                }
                logger.LogInformation("Guild link started for Serble guild {SerbleGuildId} <-> Discord guild {DiscordGuildId}",
                    guildLink.SerbleChatGuildId, guildLink.DiscordGuildId);
            }

            logger.LogInformation("Guild linker service started successfully");
        } catch (Exception ex) {
            logger.LogError(ex, "Failed to start guild linker service");
            throw;
        }
    }

    public async Task StopAsync() {
        try {
            // Leave all voice channels
            foreach (GuildLinkConfig guildLink in config.GuildLinks) {
                await discordService.LeaveVoiceChannelAsync(guildLink.DiscordGuildId);
            }

            logger.LogInformation("Guild linker service stopped");
        } catch (Exception ex) {
            logger.LogError(ex, "Error while stopping guild linker service");
        }
    }

    #region Serble Chat Event Handlers

    private async Task HandleSerbleChatMessageAsync(SerbleMessage message) {
        try {
            // Create a unique identifier for this message
            string messageKey = $"serble:{message.Id}";
            
            // Check if we recently forwarded this message (prevent loops)
            lock (_messageLock) {
                if (_recentlyForwardedMessages.Contains(messageKey)) {
                    return; // Skip, this is a message we forwarded
                }
            }

            // Find which guild link this message belongs to
            GuildLinkConfig? guildLink = config.GuildLinks.FirstOrDefault(gl =>
                gl.ChannelMappings.ContainsKey(message.ChannelId));

            if (guildLink == null) {
                return; // Message not in a mapped channel
            }

            // Get the mapping for this channel
            if (!guildLink.ChannelMappings.TryGetValue(message.ChannelId, out ulong discordChannelId)) {
                return;
            }

            // Check if the message starts with "**" which indicates it was forwarded from Discord
            if (message.Content.StartsWith("**") && message.Content.Contains("**: ")) {
                logger.LogDebug("Skipping forwarded message to prevent loop: {MessageId}", message.Id);
                return;
            }

            // Get user information
            SerbleUser? user = await GetOrFetchUserAsync(message.AuthorId);
            string userName = user?.Username ?? message.AuthorId;

            // Format message with author prefix (same format as Serble Chat)
            string messageToSend = $"**{userName}**: {message.Content}";

            // Track this message as forwarded
            lock (_messageLock) {
                _recentlyForwardedMessages.Add($"discord:forwarded:{discordChannelId}:{messageToSend.GetHashCode()}");
                if (_recentlyForwardedMessages.Count > MaxTrackedMessages) {
                    _recentlyForwardedMessages.Clear();
                }
            }

            // Forward the message to Discord
            await discordService.SendMessageAsync(discordChannelId, messageToSend);

            logger.LogInformation("Forwarded message from Serble channel {ChannelId} to Discord channel {DiscordChannelId}",
                message.ChannelId, discordChannelId);
        } catch (Exception ex) {
            logger.LogError(ex, "Failed to forward Serble Chat message {MessageId}", message.Id);
        }
    }

    private async Task HandleSerbleChatUserJoinedVoiceAsync(SerbleVoiceEvent voiceEvent) {
        try {
            GuildLinkConfig? guildLink = config.GuildLinks.FirstOrDefault(gl =>
                gl.SerbleChatVoiceChannelId == voiceEvent.ChannelId);

            if (guildLink == null) {
                return;
            }

            SerbleUser? user = await GetOrFetchUserAsync(voiceEvent.UserId);
            string userName = user?.Username ?? voiceEvent.UserId;

            logger.LogInformation("User {UserName} joined Serble voice channel {ChannelId}",
                userName, voiceEvent.ChannelId);

            // Notify Discord channel about the join
            // (Voice forwarding is handled by listening to voice state changes)
        } catch (Exception ex) {
            logger.LogError(ex, "Failed to handle Serble Chat user voice join event");
        }
    }

    private async Task HandleSerbleChatUserLeftVoiceAsync(SerbleVoiceEvent voiceEvent) {
        try {
            GuildLinkConfig? guildLink = config.GuildLinks.FirstOrDefault(gl =>
                gl.SerbleChatVoiceChannelId == voiceEvent.ChannelId);

            if (guildLink == null) {
                return;
            }

            SerbleUser? user = await GetOrFetchUserAsync(voiceEvent.UserId);
            string userName = user?.Username ?? voiceEvent.UserId;

            logger.LogInformation("User {UserName} left Serble voice channel {ChannelId}",
                userName, voiceEvent.ChannelId);
        } catch (Exception ex) {
            logger.LogError(ex, "Failed to handle Serble Chat user voice leave event");
        }
    }

    #endregion

    #region Discord Event Handlers

    private async Task HandleDiscordMessageAsync(IMessage message) {
        try {
            // Ignore messages in non-text channels
            if (message.Channel is not ITextChannel textChannel) {
                return;
            }

            // Check if message is from the bot itself (prevents forwarding our own messages)
            SocketSelfUser? currentUser = discordService.GetCurrentUser();
            if (currentUser != null && message.Author.Id == currentUser.Id) {
                logger.LogDebug("Skipping bot's own message in Discord");
                return;
            }

            // Create a unique identifier for this message
            string messageKey = $"discord:forwarded:{textChannel.Id}:{message.Content.GetHashCode()}";
            
            // Check if we recently forwarded this message (prevent loops)
            lock (_messageLock) {
                if (_recentlyForwardedMessages.Contains(messageKey)) {
                    logger.LogDebug("Skipping recently forwarded message to prevent loop");
                    return;
                }
            }

            // Find which guild link this message belongs to
            GuildLinkConfig? guildLink = config.GuildLinks.FirstOrDefault(gl =>
                gl.ChannelMappings.Values.Contains(textChannel.Id) &&
                gl.DiscordGuildId == textChannel.GuildId);

            if (guildLink == null) {
                return; // Message not in a mapped channel
            }

            // Get the Serble Chat channel ID
            long serbleChannelId = guildLink.ChannelMappings
                .FirstOrDefault(m => m.Value == textChannel.Id).Key;

            if (serbleChannelId == 0) {
                return;
            }

            // Build the message content to send
            string? content = message.Content;
            if (string.IsNullOrEmpty(content) && message.Embeds.Count > 0) {
                // If the message only has embeds, include their text
                List<string> embedTexts = message.Embeds
                    .Where(e => !string.IsNullOrEmpty(e.Description))
                    .Select(e => e.Description)
                    .ToList();

                if (embedTexts.Any()) {
                    content = string.Join("\n", embedTexts);
                }
            }

            if (string.IsNullOrEmpty(content)) {
                return; // Nothing to forward
            }

            // Check if the message starts with "**" which indicates it was forwarded from Serble Chat
            if (content.StartsWith("**") && content.Contains("**: ")) {
                logger.LogDebug("Skipping forwarded message to prevent loop");
                return;
            }

            // Add author information
            string messageToSend = $"**{message.Author.Username}**: {content}";

            // Track this message as forwarded
            lock (_messageLock) {
                _recentlyForwardedMessages.Add($"serble:forwarded:{serbleChannelId}:{messageToSend.GetHashCode()}");
                if (_recentlyForwardedMessages.Count > MaxTrackedMessages) {
                    _recentlyForwardedMessages.Clear();
                }
            }

            // Forward the message to Serble Chat
            await serbleChatClient.SendMessageAsync(serbleChannelId, messageToSend);

            logger.LogInformation("Forwarded message from Discord channel {ChannelId} to Serble channel {SerbleChannelId}",
                textChannel.Id, serbleChannelId);
        } catch (Exception ex) {
            logger.LogError(ex, "Failed to forward Discord message");
        }
    }

    private async Task HandleDiscordUserJoinedVoiceAsync(SocketUser user, SocketVoiceState oldState, SocketVoiceState newState) {
        try {
            if (newState.VoiceChannel == null) {
                return;
            }

            // Find which guild link this user joined in
            GuildLinkConfig? guildLink = config.GuildLinks.FirstOrDefault(gl =>
                gl.DiscordVoiceChannelId == newState.VoiceChannel.Id &&
                gl.DiscordGuildId == newState.VoiceChannel.Guild.Id);

            if (guildLink == null) {
                return;
            }

            logger.LogInformation("User {UserName} joined Discord voice channel {ChannelId}",
                user.Username, newState.VoiceChannel.Id);

            // In a real implementation, you would forward this to Serble Chat or handle voice forwarding
        } catch (Exception ex) {
            logger.LogError(ex, "Failed to handle Discord user voice join event");
        }
    }

    private async Task HandleDiscordUserLeftVoiceAsync(SocketUser user, SocketVoiceState oldState, SocketVoiceState newState) {
        try {
            if (oldState.VoiceChannel == null) {
                return;
            }

            GuildLinkConfig? guildLink = config.GuildLinks.FirstOrDefault(gl =>
                gl.DiscordVoiceChannelId == oldState.VoiceChannel.Id &&
                gl.DiscordGuildId == oldState.VoiceChannel.Guild.Id);

            if (guildLink == null) {
                return;
            }

            logger.LogInformation("User {UserName} left Discord voice channel {ChannelId}",
                user.Username, oldState.VoiceChannel.Id);
        } catch (Exception ex) {
            logger.LogError(ex, "Failed to handle Discord user voice leave event");
        }
    }

    #endregion

    #region Helper Methods

    private async Task<SerbleUser?> GetOrFetchUserAsync(string userId) {
        // Check cache first
        if (_userCache.TryGetValue(userId, out SerbleUser? cachedUser)) {
            return cachedUser;
        }

        // Fetch from API
        SerbleUser? user = await serbleChatClient.GetUserAsync(userId);
        if (user != null) {
            _userCache[userId] = user;
        }

        return user;
    }

    #endregion
}
