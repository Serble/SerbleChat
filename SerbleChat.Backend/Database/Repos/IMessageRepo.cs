using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IMessageRepo {
    /// <summary>
    /// Newest first. <paramref name="before"/> and <paramref name="after"/> are exclusive message ID cursors.
    /// With <paramref name="after"/>, it's the <paramref name="limit"/> messages right after that ID (so paging
    /// forward has no gaps), still returned newest first.
    /// </summary>
    Task<List<Message>> GetMessages(long channelId, int limit = 50, int offset = 0, long? before = null, long? after = null);
    Task<Message?> GetMessage(long id);
    Task CreateMessage(Message message);
    Task UpdateMessage(Message message);
    Task DeleteMessage(long id);
}
