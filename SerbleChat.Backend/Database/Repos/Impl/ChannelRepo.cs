using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class ChannelRepo(ChatDatabaseContext context) : IChannelRepo {
    
    public async Task<Channel?> GetChannel(string id) {
        return await context.Channels.FindAsync(id);
    }

    public async Task CreateChannel(Channel channel) {
        context.Channels.Add(channel);
        await context.SaveChangesAsync();
    }

    public async Task UpdateChannel(Channel channel) {
        context.Channels.Update(channel);
        await context.SaveChangesAsync();
    }

    public async Task DeleteChannel(string id) {
        Channel? channel = await GetChannel(id);
        if (channel == null) {
            return;
        }

        context.Channels.Remove(channel);
        await context.SaveChangesAsync();
    }
}
