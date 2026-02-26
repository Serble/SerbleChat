namespace SerbleChat.Backend.Database.Repos;

public interface IUnreadsRepo {
    Task MarkRead(string userId, long channelId, long messageId);
    Task<int> GetUnreadMentionsCount(string userId, long channelId);
    Task<int> GetUnreadMentionsCount(string userId);
    Task<int> GetUnreadMessagesCount(string userId, long channelId);
    Task<Dictionary<long, int>> GetChannelUnreadMentionsCounts(string userId);
    Task<Dictionary<long, int>> GetChannelUnreadMessagesCounts(string userId);
    Task AddUserMentions(long channelId, long messageId, IEnumerable<string> userIds);
}
