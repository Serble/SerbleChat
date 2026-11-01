using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.SocketHubs;
using StackExchange.Redis;

namespace SerbleChat.Backend.Services.Impl;

public class PresenceService(
    IConnectionMultiplexer redis,
    IHubContext<ChatHub> hub,
    IServiceScopeFactory scopes,
    ILogger<PresenceService> logger) : IPresenceService {

    /// <summary>Clients heartbeat every 30s, so this survives one missed beat.</summary>
    private static readonly TimeSpan StatusTtl = TimeSpan.FromMinutes(1);

    /// <summary>Connections that haven't heartbeated for this long are treated as dead (e.g. their server crashed).</summary>
    private static readonly TimeSpan ConnectionTtl = TimeSpan.FromSeconds(90);

    // KEYS[1] = status key, KEYS[2] = connections zset
    // ARGV[1] = now (unix s), ARGV[2] = connection id, ARGV[3] = connection ttl (s), ARGV[4] = status ttl (s)
    // Returns 1 if the user just came online.
    private static readonly LuaScript HeartbeatScript = LuaScript.Prepare("""
        redis.call('ZADD', @connections, @now, @connectionId)
        redis.call('EXPIRE', @connections, @connectionTtl)
        if redis.call('SET', @status, 'online', 'EX', @statusTtl, 'NX') then
            return 1
        end
        redis.call('EXPIRE', @status, @statusTtl)
        return 0
        """);

    // Returns 1 if that was the user's last live connection and they were online.
    private static readonly LuaScript DisconnectScript = LuaScript.Prepare("""
        redis.call('ZREM', @connections, @connectionId)
        redis.call('ZREMRANGEBYSCORE', @connections, '-inf', @staleBefore)
        if redis.call('ZCARD', @connections) > 0 then
            return 0
        end
        return redis.call('DEL', @status)
        """);

    private static RedisKey StatusKey(string userId) => "status:" + userId;
    private static RedisKey ConnectionsKey(string userId) => "connections:" + userId;

    public async Task<bool> IsConnected(string userId) {
        return await redis.GetDatabase().KeyExistsAsync(StatusKey(userId));
    }

    public async Task<HashSet<string>> GetConnected(IEnumerable<string> userIds) {
        string[] ids = userIds.Distinct().ToArray();
        if (ids.Length == 0) return [];
        RedisValue[] values = await redis.GetDatabase().StringGetAsync(ids.Select(StatusKey).ToArray());
        HashSet<string> connected = [];
        for (int i = 0; i < ids.Length; i++) {
            if (values[i].HasValue) connected.Add(ids[i]);
        }
        return connected;
    }

    public async Task Heartbeat(string userId, string connectionId) {
        RedisResult result = await redis.GetDatabase().ScriptEvaluateAsync(HeartbeatScript, new {
            status = StatusKey(userId),
            connections = ConnectionsKey(userId),
            now = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            connectionId,
            connectionTtl = (long)ConnectionTtl.TotalSeconds,
            statusTtl = (long)StatusTtl.TotalSeconds
        });
        if ((long)result == 1) {
            await BroadcastStatus(userId);
        }
    }

    public async Task Disconnected(string userId, string connectionId) {
        RedisResult result = await redis.GetDatabase().ScriptEvaluateAsync(DisconnectScript, new {
            status = StatusKey(userId),
            connections = ConnectionsKey(userId),
            connectionId,
            staleBefore = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - (long)ConnectionTtl.TotalSeconds
        });
        if ((long)result == 1) {
            await BroadcastStatus(userId);
        }
    }

    private async Task BroadcastStatus(string userId) {
        using IServiceScope scope = scopes.CreateScope();
        ChatUser? user = await scope.ServiceProvider.GetRequiredService<IUserRepo>().GetUserById(userId);
        if (user == null) return;
        await BroadcastStatus(user, scope.ServiceProvider);
    }

    public async Task BroadcastStatus(ChatUser user) {
        using IServiceScope scope = scopes.CreateScope();
        await BroadcastStatus(user, scope.ServiceProvider);
    }

    private async Task BroadcastStatus(ChatUser user, IServiceProvider services) {
        try {
            bool connected = await IsConnected(user.Id);

            // Everyone who could see this user: their guilds, DMs and group chats.
            // A connection in several of these groups gets the event more than once; the client just overwrites.
            List<string> groups = [];
            groups.AddRange((await services.GetRequiredService<IGuildRepo>().GetGuildsForUser(user.Id))
                .Select(g => $"guild-{g.Id}"));
            groups.AddRange((await services.GetRequiredService<IDmChannelRepo>().GetDmChannels(user.Id))
                .Select(dm => $"channel-{dm.ChannelId}"));
            groups.AddRange((await services.GetRequiredService<IGroupChatRepo>().GetGroupChats(user.Id))
                .Select(g => $"channel-{g.GroupChatId}"));

            if (groups.Count > 0) {
                await hub.Clients.Groups(groups).SendAsync("UserStatusUpdated", UserStatusUpdate.From(user, connected));
            }
            await hub.Clients.User(user.Id).SendAsync("OwnStatusUpdated", OwnStatusUpdate.From(user));
        }
        catch (Exception e) {
            // A failed broadcast only means stale dots until the next refetch; never fail the caller over it
            logger.LogWarning(e, "Failed to broadcast status for user {UserId}", user.Id);
        }
    }
}
