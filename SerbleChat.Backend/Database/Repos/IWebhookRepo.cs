using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IWebhookRepo {
    Task<Webhook?> GetWebhook(long id);
    Task<Webhook[]> GetGuildWebhooks(long guildId);
    Task<int> CountGuildWebhooks(long guildId);
    Task CreateWebhook(Webhook webhook);
    Task UpdateWebhook(Webhook webhook);
    Task DeleteWebhook(long id);
}
