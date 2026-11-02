using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class UnreadsRepo(ChatDatabaseContext context) : IUnreadsRepo {
    
    public async Task MarkRead(string userId, long channelId, long messageId) {
        // One atomic statement: a client marking a channel read twice at once (it does, as messages
        // arrive) used to race between the lookup and the insert and fail on the unique index.
        // GREATEST keeps the read position from ever moving backwards.
        await context.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO ChannelReads (ChannelId, UserId, LastReadMessageId)
            VALUES ({channelId}, {userId}, {messageId})
            ON DUPLICATE KEY UPDATE LastReadMessageId = GREATEST(LastReadMessageId, {messageId})
            """);
    }

    public async Task<long> GetLastReadMessageId(string userId, long channelId) {
        long? val = await context.ChannelReads
            .Where(cr => cr.UserId == userId && cr.ChannelId == channelId)
            .Select(cr => (long?)cr.LastReadMessageId) // cast to nullable long for DefaultIfEmpty
            .FirstOrDefaultAsync(); // if no record, return 0 as default
        return val ?? 0;
    }

    public async Task<int> GetUnreadMentionsCount(string userId, long channelId) {
        return await (
            from m in context.Messages
            join mm in context.MessageMentions on m.Id equals mm.MessageId
            // Left join to ChannelReads: this user's "last read" for this channel
            join cr in context.ChannelReads.Where(cr => cr.UserId == userId && cr.ChannelId == channelId)
                on m.ChannelId equals cr.ChannelId into reads
            from read in reads.DefaultIfEmpty()
            where mm.UserId == userId
                  && m.ChannelId == channelId
                  && (read == null || m.Id > read.LastReadMessageId)
            select m.Id // can be m, or 1, just need any result
        ).CountAsync();
    }

    public Task<int> GetUnreadMentionsCount(string userId) {
        return (
            from m in context.Messages
            join mm in context.MessageMentions on m.Id equals mm.MessageId
            // Left join to ChannelReads: this user's "last read" for this channel
            join cr in context.ChannelReads.Where(cr => cr.UserId == userId)
                on m.ChannelId equals cr.ChannelId into reads
            from read in reads.DefaultIfEmpty()
            where mm.UserId == userId
                  && (read == null || m.Id > read.LastReadMessageId)
            select m.Id
        ).CountAsync();
    }

    public async Task<int> GetUnreadMessagesCount(string userId, long channelId) {
        // No read marker means nothing in the channel has been read yet (joining a guild or group sets one at
        // its newest message, see MarkChannelsReadToLatest)
        long lastRead = await GetLastReadMessageId(userId, channelId);
        return await context.Messages
            .Where(m => m.ChannelId == channelId && m.Id > lastRead && (m.AuthorId == null || m.AuthorId != userId))
            .CountAsync();
    }

    public Task<Dictionary<long, int>> GetChannelUnreadMentionsCounts(string userId) {
        return (
            from m in context.Messages
            join mm in context.MessageMentions on m.Id equals mm.MessageId
            // Join to ChannelReads on ChannelId and for the same user, LEFT JOIN (DefaultIfEmpty)
            join cr in context.ChannelReads.Where(r => r.UserId == userId)
                on m.ChannelId equals cr.ChannelId into reads
            from read in reads.DefaultIfEmpty()
            where mm.UserId == userId
                  && (read == null || m.Id > read.LastReadMessageId)
            group m by m.ChannelId
            into g
            select new {
                ChannelId = g.Key,
                UnreadMentionCount = g.Count()
            }
        ).ToDictionaryAsync(o => o.ChannelId, o => o.UnreadMentionCount);
    }

    public Task<Dictionary<long, int>> GetChannelUnreadMessagesCounts(string userId, IReadOnlyCollection<long> channelIds) {
        long[] ids = channelIds.ToArray();
        return (
            from m in context.Messages
            // Left join: a channel with no read marker has never been read, so all of it counts
            join cr in context.ChannelReads.Where(r => r.UserId == userId)
                on m.ChannelId equals cr.ChannelId into reads
            from read in reads.DefaultIfEmpty()
            where ids.Contains(m.ChannelId)
                  && (read == null || m.Id > read.LastReadMessageId)
                  // What you sent yourself was never unread to you
                  && (m.AuthorId == null || m.AuthorId != userId)
            group m by m.ChannelId
            into g
            select new {
                ChannelId = g.Key,
                UnreadCount = g.Count()
            }).ToDictionaryAsync(o => o.ChannelId, o => o.UnreadCount);
    }

    public Task<Dictionary<long, long>> GetLatestMessageIds(IReadOnlyCollection<long> channelIds) {
        long[] ids = channelIds.ToArray();
        return context.Messages
            .Where(m => ids.Contains(m.ChannelId))
            .GroupBy(m => m.ChannelId)
            .Select(g => new { ChannelId = g.Key, Latest = g.Max(m => m.Id) })
            .ToDictionaryAsync(o => o.ChannelId, o => o.Latest);
    }

    public async Task MarkChannelsReadToLatest(IReadOnlyCollection<string> userIds, IReadOnlyCollection<long> channelIds) {
        if (userIds.Count == 0 || channelIds.Count == 0) return;
        Dictionary<long, long> latest = await GetLatestMessageIds(channelIds);
        foreach (string userId in userIds) {
            foreach ((long channelId, long messageId) in latest) {
                await MarkRead(userId, channelId, messageId);
            }
        }
    }

    public Task AddUserMentions(long channelId, long messageId, IEnumerable<string> userIds) {
        string[] validUserIds = context.Users
            .Where(u => userIds.Contains(u.Id))
            .Select(u => u.Id)
            .ToArray();
        
        List<MessageMention> mentions = validUserIds.Select(userId => new MessageMention {
            UserId = userId,
            MessageId = messageId
        }).ToList();
        context.MessageMentions.AddRange(mentions);
        return context.SaveChangesAsync();
    }
}
