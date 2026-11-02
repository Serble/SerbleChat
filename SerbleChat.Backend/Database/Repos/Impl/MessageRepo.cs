using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class MessageRepo(ChatDatabaseContext context) : IMessageRepo {
    
    public async Task<List<Message>> GetMessages(long channelId, int limit = 50, int offset = 0, long? before = null, long? after = null) {
        IQueryable<Message> query = context.Messages.Where(m => m.ChannelId == channelId);
        if (before.HasValue) query = query.Where(m => m.Id < before.Value);

        if (after.HasValue) {
            List<Message> page = await query
                .Where(m => m.Id > after.Value)
                .OrderBy(m => m.Id)
                .Skip(offset)
                .Take(limit)
                .ToListAsync();
            page.Reverse();
            return page;
        }

        // IDs are assigned in creation order, so ordering by them matches CreatedAt and works with the cursors
        return await query
            .OrderByDescending(m => m.Id)
            .Skip(offset)
            .Take(limit)
            .ToListAsync();
    }

    public async Task<List<Message>> GetMessagesAround(long channelId, long aroundId, int limit = 50) {
        int half = Math.Max(1, limit / 2);
        IQueryable<Message> channel = context.Messages.Where(m => m.ChannelId == channelId);
        // The target and what came before it, then what came after: newest first overall
        List<Message> olderAndTarget = await channel.Where(m => m.Id <= aroundId)
            .OrderByDescending(m => m.Id).Take(half + 1).ToListAsync();
        List<Message> newer = await channel.Where(m => m.Id > aroundId)
            .OrderBy(m => m.Id).Take(half).ToListAsync();
        newer.Reverse();
        newer.AddRange(olderAndTarget);
        return newer;
    }

    public async Task<List<Message>> SearchMessages(long channelId, IReadOnlyList<string> terms, string? authorId, long? before, int limit) {
        IQueryable<Message> query = SearchQuery(channelId, terms, authorId);
        if (before.HasValue) query = query.Where(m => m.Id < before.Value);
        return await query.OrderByDescending(m => m.Id).Take(limit).ToListAsync();
    }

    public Task<int> CountSearchResults(long channelId, IReadOnlyList<string> terms, string? authorId) {
        return SearchQuery(channelId, terms, authorId).CountAsync();
    }

    private IQueryable<Message> SearchQuery(long channelId, IReadOnlyList<string> terms, string? authorId) {
        IQueryable<Message> query = context.Messages.Where(m => m.ChannelId == channelId);
        if (authorId != null) query = query.Where(m => m.AuthorId == authorId);
        foreach (string term in terms) {
            // The column's _ci collation makes LIKE case-insensitive
            string pattern = "%" + EscapeLike(term) + "%";
            query = query.Where(m => EF.Functions.Like(m.Content, pattern, "\\"));
        }
        return query;
    }

    private static string EscapeLike(string s) =>
        s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    public async Task<Message?> GetMessage(long id) {
        return await context.Messages.FindAsync(id);
    }

    public Task CreateMessage(Message message) {
        context.Messages.Add(message);
        return context.SaveChangesAsync();
    }

    public Task UpdateMessage(Message message) {
        context.Messages.Update(message);
        return context.SaveChangesAsync();
    }

    public Task DeleteMessage(long id) {
        return context.Messages.Where(m => m.Id == id).ExecuteDeleteAsync();
    }
}
