using Discord;
using Discord.WebSocket;
using Discord.Audio;

namespace SerbleChat.GuildLinkerBot.Services;

/// <summary>
/// Interface for Discord service
/// </summary>
public interface IDiscordService {
    /// <summary>
    /// Start the Discord bot
    /// </summary>
    Task StartAsync(string token);

    /// <summary>
    /// Stop the Discord bot
    /// </summary>
    Task StopAsync();

    /// <summary>
    /// Send a message to a Discord channel
    /// </summary>
    Task SendMessageAsync(ulong channelId, string content, string authorName = "", string? avatarUrl = null);

    /// <summary>
    /// Join a Discord voice channel
    /// </summary>
    Task JoinVoiceChannelAsync(ulong guildId, ulong voiceChannelId);

    /// <summary>
    /// Leave a Discord voice channel
    /// </summary>
    Task LeaveVoiceChannelAsync(ulong guildId);

    /// <summary>
    /// Get the current audio client for a guild
    /// </summary>
    IAudioClient? GetVoiceClient(ulong guildId);

    /// <summary>
    /// Register a callback for Discord messages
    /// </summary>
    void OnMessageReceived(Func<IMessage, Task> callback);

    /// <summary>
    /// Register a callback for users joining voice
    /// </summary>
    void OnUserJoinedVoice(Func<SocketUser, SocketVoiceState, SocketVoiceState, Task> callback);

    /// <summary>
    /// Register a callback for users leaving voice
    /// </summary>
    void OnUserLeftVoice(Func<SocketUser, SocketVoiceState, SocketVoiceState, Task> callback);

    /// <summary>
    /// Check if the bot is ready
    /// </summary>
    bool IsReady { get; }

    /// <summary>
    /// Get the bot's current user
    /// </summary>
    SocketSelfUser? GetCurrentUser();
}
