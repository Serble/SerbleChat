namespace SerbleChat.GuildLinkerBot.Config;

/// <summary>
/// Configuration for a single guild link between Serble Chat and Discord
/// </summary>
public class GuildLinkConfig {
    /// <summary>
    /// Serble Chat Guild ID
    /// </summary>
    public long SerbleChatGuildId { get; set; }

    /// <summary>
    /// Discord Guild ID
    /// </summary>
    public ulong DiscordGuildId { get; set; }

    /// <summary>
    /// Serble Chat voice-capable channel ID for voice forwarding
    /// </summary>
    public long SerbleChatVoiceChannelId { get; set; }

    /// <summary>
    /// Discord voice channel ID for voice forwarding
    /// </summary>
    public ulong DiscordVoiceChannelId { get; set; }

    /// <summary>
    /// Whether to join voice channels (set to false to disable voice connection)
    /// </summary>
    public bool EnableVoiceConnection { get; set; } = true;

    /// <summary>
    /// Mapping of Serble Chat channel ID to Discord channel ID
    /// </summary>
    public Dictionary<long, ulong> ChannelMappings { get; set; } = new();
}

/// <summary>
/// Main bot configuration
/// </summary>
public class BotConfiguration {
    /// <summary>
    /// Serble Chat API base URL
    /// </summary>
    public string SerbleChatApiUrl { get; set; } = "http://localhost:5210";

    /// <summary>
    /// Serble Chat access token for the bot user
    /// </summary>
    public string SerbleChatAccessToken { get; set; } = "";

    /// <summary>
    /// Discord bot access token
    /// </summary>
    public string DiscordBotToken { get; set; } = "";

    /// <summary>
    /// Guild link configurations
    /// </summary>
    public List<GuildLinkConfig> GuildLinks { get; set; } = new();
}
