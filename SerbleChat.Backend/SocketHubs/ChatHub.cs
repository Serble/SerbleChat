using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using StackExchange.Redis;

namespace SerbleChat.Backend.SocketHubs;

[Authorize]
public class ChatHub(IChannelRepo channels, IGuildRepo guilds, IConnectionMultiplexer redis) : Hub {
    
    public async Task SayHello(string name) {
        await Clients.All.SendAsync("ReceiveMessage", $"Hello, {name}!");
    }

    public async Task UpdateStatus() {
        string userId = Context.UserIdentifier ?? throw new Exception("User identifier is null");
        await redis.GetDatabase().StringSetAsync("status:" + userId, "online", TimeSpan.FromMinutes(1));
    }

    public async Task RefreshListeners() {
        string userId = Context.UserIdentifier ?? throw new Exception("User identifier is null");
        
        List<Channel> visible = await channels.GetChannelsVisibleToUser(userId);
        foreach (Channel channel in visible) {
            await Groups.AddToGroupAsync(Context.ConnectionId, $"channel-{channel.Id}");
        }

        IEnumerable<Guild> userGuilds = await guilds.GetGuildsForUser(userId);
        foreach (Guild guild in userGuilds) {
            await Groups.AddToGroupAsync(Context.ConnectionId, $"guild-{guild.Id}");
        }
        
        await Clients.Caller.SendAsync("GroupsUpdated", visible.Select(c => new {
            c.Id,
            c.Name,
            c.Type
        }));
    }

    public override async Task OnConnectedAsync() {
        // we need to add them to channels they're in
        await Clients.Caller.SendAsync("Hello", "Welcome to the chat hub!");
        string userId = Context.UserIdentifier ?? throw new Exception("User identifier is null");

        List<Channel> visible = await channels.GetChannelsVisibleToUser(userId);

        // Join channel groups
        HashSet<int> guildIds = [];
        foreach (Channel channel in visible) {
            await Groups.AddToGroupAsync(Context.ConnectionId, $"channel-{channel.Id}");
            if (channel.GuildId.HasValue) {
                guildIds.Add(channel.GuildId.Value);
            }
        }

        // Join guild groups (used for RolesUpdated and other guild-wide events)
        foreach (int guildId in guildIds) {
            await Groups.AddToGroupAsync(Context.ConnectionId, $"guild-{guildId}");
        }

        await Clients.Caller.SendAsync("GroupsUpdated", visible.Select(c => new {
            c.Id,
            c.Name,
            c.Type
        }));
    }
}