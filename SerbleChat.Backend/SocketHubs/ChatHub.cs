using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Services;

namespace SerbleChat.Backend.SocketHubs;

[Authorize]
public class ChatHub(IChannelRepo channels, IGuildRepo guilds, IPresenceService presence, IVoiceManager voice,
    INotificationService notifications) : Hub {
    
    public async Task SayHello(string name) {
        await Clients.All.SendAsync("ReceiveMessage", $"Hello, {name}!");
    }

    /// <summary>Presence heartbeat, sent by clients every 30 seconds.</summary>
    public async Task UpdateStatus() {
        string userId = Context.UserIdentifier ?? throw new Exception("User identifier is null");
        await presence.Heartbeat(userId, Context.ConnectionId);
    }
    
    /// <summary>
    /// The client got a ReceiveNotification. Without this within a few seconds the server assumes the connection is
    /// dead and pushes the notification instead.
    /// </summary>
    public Task AckNotification(string ackId) => notifications.AckSocketNotification(ackId);

    public async Task NotifyTyping(long channelId) {
        string userId = Context.UserIdentifier ?? throw new Exception("User identifier is null");

        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return;  // channel doesn't exist, ignore
        }
        
        if (!await channels.UserHasAccessToChannel(userId, channel, true)) {
            return;  // again, ignore invalid request
        }
        
        await Clients.Group($"channel-{channelId}").SendAsync("UserTyping", new {
            UserId = userId,
            ChannelId = channelId
        });
    }

    /// <summary>
    /// Sent by a client in a voice channel whenever its mute/deafen state changes,
    /// so people outside the call can see it. Ignored if the caller isn't in that call.
    /// </summary>
    public async Task UpdateVoiceState(long channelId, bool muted, bool deafened) {
        string userId = Context.UserIdentifier ?? throw new Exception("User identifier is null");
        await voice.UpdateVoiceState(channelId, userId, muted, deafened);
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
        HashSet<long> guildIds = [];
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

        // After joining groups, so this connection also hears its own "came online" broadcast
        await presence.Heartbeat(userId, Context.ConnectionId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception) {
        string? userId = Context.UserIdentifier;
        if (userId != null) {
            await presence.Disconnected(userId, Context.ConnectionId);
        }
        await base.OnDisconnectedAsync(exception);
    }
}