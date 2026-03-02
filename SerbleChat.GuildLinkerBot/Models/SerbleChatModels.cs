namespace SerbleChat.GuildLinkerBot.Models;

/// <summary>
/// Represents a Serble Chat message
/// </summary>
public class SerbleMessage {
    public long Id { get; set; }
    public long ChannelId { get; set; }
    public DateTime CreatedAt { get; set; }
    public string AuthorId { get; set; } = "";
    public string Content { get; set; } = "";
}

/// <summary>
/// Represents a request to send a message in Serble Chat
/// </summary>
public class SendMessageBody {
    public string Content { get; set; } = "";
}

/// <summary>
/// Represents a user in Serble Chat
/// </summary>
public class SerbleUser {
    public string Id { get; set; } = "";
    public string Username { get; set; } = "";
    public string? Avatar { get; set; }
}

/// <summary>
/// SignalR protocol models for Serble Chat updates
/// </summary>
public class SerbleVoiceEvent {
    public string UserId { get; set; } = "";
    public long ChannelId { get; set; }
}
