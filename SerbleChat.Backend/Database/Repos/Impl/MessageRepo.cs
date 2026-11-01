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
