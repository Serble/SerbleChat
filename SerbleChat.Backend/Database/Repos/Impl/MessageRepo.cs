using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class MessageRepo(ChatDatabaseContext context) : IMessageRepo {
    
    public async Task<List<Message>> GetMessages(int channelId, int limit = 50, int offset = 0) {
        return await context.Messages
            .Where(m => m.ChannelId == channelId)
            .OrderByDescending(m => m.CreatedAt)
            .Skip(offset)
            .Take(limit)
            .ToListAsync();
    }

    public async Task<Message?> GetMessage(int id) {
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

    public Task DeleteMessage(int id) {
        return context.Messages.Where(m => m.Id == id).ExecuteDeleteAsync();
    }
}
