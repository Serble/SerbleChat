namespace SerbleChat.GuildLinkerBot.Services;

/// <summary>
/// Interface for guild linking functionality
/// </summary>
public interface IGuildLinker {
    /// <summary>
    /// Start the guild linker service
    /// </summary>
    Task StartAsync();

    /// <summary>
    /// Stop the guild linker service
    /// </summary>
    Task StopAsync();
}
