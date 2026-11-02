namespace SerbleChat.Backend.Database.Repos;

public interface IUnreadsRepo {
    Task MarkRead(string userId, long channelId, long messageId);
    Task<long> GetLastReadMessageId(string userId, long channelId);
    Task<int> GetUnreadMentionsCount(string userId, long channelId);
    Task<int> GetUnreadMentionsCount(string userId);
    Task<int> GetUnreadMessagesCount(string userId, long channelId);
    Task<Dictionary<long, int>> GetChannelUnreadMentionsCounts(string userId);
    /// <summary>Unread message counts in these channels, counting all of a channel without a read marker.</summary>
    Task<Dictionary<long, int>> GetChannelUnreadMessagesCounts(string userId, IReadOnlyCollection<long> channelIds);
    /// <summary>Each channel's newest message ID. Channels without messages are left out.</summary>
    Task<Dictionary<long, long>> GetLatestMessageIds(IReadOnlyCollection<long> channelIds);
    /// <summary>
    /// Marks these channels read up to now for these users, for when they join: history from before they were
    /// there isn't news to them. Channels without messages need nothing, since a missing marker counts from the start.
    /// </summary>
    Task MarkChannelsReadToLatest(IReadOnlyCollection<string> userIds, IReadOnlyCollection<long> channelIds);
    Task AddUserMentions(long channelId, long messageId, IEnumerable<string> userIds);
}
