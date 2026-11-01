using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class WebhookRepo(ChatDatabaseContext context) : IWebhookRepo {

    public Task<Webhook?> GetWebhook(long id) {
        return context.Webhooks.FirstOrDefaultAsync(w => w.Id == id);
    }

    public Task<Webhook[]> GetGuildWebhooks(long guildId) {
        return context.Webhooks
            .AsNoTracking()
            .Where(w => w.GuildId == guildId)
            .OrderBy(w => w.CreatedAt)
            .ToArrayAsync();
    }

    public Task<int> CountGuildWebhooks(long guildId) {
        return context.Webhooks.CountAsync(w => w.GuildId == guildId);
    }

    public Task CreateWebhook(Webhook webhook) {
        context.Webhooks.Add(webhook);
        return context.SaveChangesAsync();
    }

    public Task UpdateWebhook(Webhook webhook) {
        context.Webhooks.Update(webhook);
        return context.SaveChangesAsync();
    }

    public Task DeleteWebhook(long id) {
        return context.Webhooks.Where(w => w.Id == id).ExecuteDeleteAsync();
    }
}
