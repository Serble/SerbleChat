using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IMessageRepo {
    /// <summary>
    /// Newest first. <paramref name="before"/> and <paramref name="after"/> are exclusive message ID cursors.
    /// With <paramref name="after"/>, it's the <paramref name="limit"/> messages right after that ID (so paging
    /// forward has no gaps), still returned newest first.
    /// </summary>
    Task<List<Message>> GetMessages(long channelId, int limit = 50, int offset = 0, long? before = null, long? after = null);
    /// <summary>
    /// The message <paramref name="aroundId"/> (when it exists) with up to <paramref name="limit"/>/2 messages on
    /// each side of it, newest first. Works whether or not the message itself still exists.
    /// </summary>
    Task<List<Message>> GetMessagesAround(long channelId, long aroundId, int limit = 50);
    /// <summary>
    /// Messages containing every one of <paramref name="terms"/> (case-insensitive substring match), newest first.
    /// <paramref name="before"/> is an exclusive message ID cursor for the next page.
    /// </summary>
    Task<List<Message>> SearchMessages(long channelId, IReadOnlyList<string> terms, string? authorId, long? before, int limit);
    /// <summary>How many messages <see cref="SearchMessages"/> would find across every page.</summary>
    Task<int> CountSearchResults(long channelId, IReadOnlyList<string> terms, string? authorId);
    Task<Message?> GetMessage(long id);
    Task CreateMessage(Message message);
    Task UpdateMessage(Message message);
    Task DeleteMessage(long id);
}
