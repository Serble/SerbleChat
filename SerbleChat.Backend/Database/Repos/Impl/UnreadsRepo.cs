using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class UnreadsRepo(ChatDatabaseContext context) : IUnreadsRepo {
    
    public async Task MarkRead(string userId, long channelId, long messageId) {
        ChannelRead? existing = context.ChannelReads.FirstOrDefault(x => x.ChannelId == channelId && x.UserId == userId);
        if (existing == null) {
            ChannelRead newRead = new() {
                ChannelId = channelId,
                UserId = userId,
                LastReadMessageId = messageId
            };
            context.ChannelReads.Add(newRead);
        } else {
            if (existing.LastReadMessageId >= messageId) {
                return;  // already marked as read up to this message or further, no update needed
            }
            existing.LastReadMessageId = messageId;
            context.ChannelReads.Update(existing);
        }
        await context.SaveChangesAsync();
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

    public Task<int> GetUnreadMessagesCount(string userId, long channelId) {
        return context.Messages
            .Where(m => m.ChannelId == channelId)
            .Join(context.ChannelReads.Where(cr => cr.UserId == userId && cr.ChannelId == channelId),
                m => m.ChannelId, cr => cr.ChannelId, (m, cr) => new { Message = m, Read = cr })
            .Where(x => x.Message.Id > x.Read.LastReadMessageId)
            .Select(x => x.Message.Id) // can be x.Message or 1, just need any result
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

    public Task<Dictionary<long, int>> GetChannelUnreadMessagesCounts(string userId) {
        return context.Messages
            .Join(context.ChannelReads.Where(cr => cr.UserId == userId),
                m => m.ChannelId, cr => cr.ChannelId, (m, cr) => new { Message = m, Read = cr })
            .Where(x => x.Message.Id > x.Read.LastReadMessageId)
            .GroupBy(x => x.Message.ChannelId)
            .Select(g => new {
                ChannelId = g.Key,
                UnreadCount = g.Count()
            }).ToDictionaryAsync(o => o.ChannelId, o => o.UnreadCount);
    }

    public Task AddUserMentions(long channelId, long messageId, IEnumerable<string> userIds) {
        List<MessageMention> mentions = userIds.Select(userId => new MessageMention {
            UserId = userId,
            MessageId = messageId
        }).ToList();
        context.MessageMentions.AddRange(mentions);
        return context.SaveChangesAsync();
    }
}
