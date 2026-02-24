namespace SerbleChat.Backend.Database.Repos;

public interface IUnreadsRepo {
    Task MarkRead(string userId, int channelId, int messageId);
    Task<int> GetUnreadMentionsCount(string userId, int channelId);
    Task<int> GetUnreadMentionsCount(string userId);
    Task<int> GetUnreadMessagesCount(string userId, int channelId);
    Task<Dictionary<int, int>> GetChannelUnreadMentionsCounts(string userId);
    Task<Dictionary<int, int>> GetChannelUnreadMessagesCounts(string userId);
    Task AddUserMentions(int channelId, int messageId, IEnumerable<string> userIds);
}
