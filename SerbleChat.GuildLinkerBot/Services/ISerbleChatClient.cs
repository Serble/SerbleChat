using SerbleChat.GuildLinkerBot.Models;

namespace SerbleChat.GuildLinkerBot.Services;

/// <summary>
/// Interface for interacting with Serble Chat API
/// </summary>
public interface ISerbleChatClient {
    /// <summary>
    /// Connect to Serble Chat via SignalR for real-time updates
    /// </summary>
    Task ConnectAsync();

    /// <summary>
    /// Disconnect from Serble Chat
    /// </summary>
    Task DisconnectAsync();

    /// <summary>
    /// Send a message to a Serble Chat channel
    /// </summary>
    Task SendMessageAsync(long channelId, string content);

    /// <summary>
    /// Get information about a Serble Chat user
    /// </summary>
    Task<SerbleUser?> GetUserAsync(string userId);

    /// <summary>
    /// Register a callback for new messages
    /// </summary>
    void OnNewMessage(Func<SerbleMessage, Task> callback);

    /// <summary>
    /// Register a callback for user joining voice
    /// </summary>
    void OnUserJoinedVoice(Func<SerbleVoiceEvent, Task> callback);

    /// <summary>
    /// Register a callback for user leaving voice
    /// </summary>
    void OnUserLeftVoice(Func<SerbleVoiceEvent, Task> callback);

    /// <summary>
    /// Check if the client is connected
    /// </summary>
    bool IsConnected { get; }
}
