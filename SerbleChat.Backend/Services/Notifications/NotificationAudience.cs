using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database;
using SerbleChat.Backend.Database.Repos.Impl;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services.Notifications;

/// <summary>Everyone who might be notified about a message in a channel, and everything needed to decide how.</summary>
public class NotificationAudience {
    /// <summary>Members who can see the channel.</summary>
    public Dictionary<string, ChatUser> Members { get; init; } = [];
    /// <summary>Each guild member's roles, highest priority first. Empty outside guilds.</summary>
    public Dictionary<string, List<Role>> Roles { get; init; } = [];
    public string? GuildName { get; init; }
    public Dictionary<string, UserWebNotificationHook[]> Hooks { get; init; } = [];
    public Dictionary<string, UserNtfySubscription[]> Ntfy { get; init; } = [];
    public Dictionary<string, UserChannelNotificationPreferences> ChannelPrefs { get; init; } = [];
    public Dictionary<string, UserGuildNotificationPreferences> GuildPrefs { get; init; } = [];
    public HashSet<string> Connected { get; init; } = [];
}

/// <summary>
/// Loads a <see cref="NotificationAudience"/>. Every query is filtered by the channel (or its guild) rather than by a
/// list of member IDs, so none of them waits for another: they all run at once, each on its own connection, and the
/// whole load costs one database round trip instead of eight.
/// </summary>
public class NotificationAudienceLoader(IServiceScopeFactory scopes, IPresenceService presence) {

    public async Task<NotificationAudience> Load(Channel channel) {
        long channelId = channel.Id;

        Task<UserChannelNotificationPreferences[]> channelPrefsTask = Query(db => db.UserChannelNotificationPreferences
            .AsNoTracking().Where(p => p.ChannelId == channelId).ToArrayAsync());

        NotificationAudience audience;
        switch (channel.Type) {
            case ChannelType.Guild when channel.GuildId.HasValue: {
                long guildId = channel.GuildId.Value;
                var guildTask = Query(db => db.Guilds.AsNoTracking()
                    .Where(g => g.Id == guildId)
                    .Select(g => new { g.OwnerId, g.DefaultPermissions, g.Name })
                    .FirstOrDefaultAsync());
                Task<ChatUser[]> membersTask = Query(db => db.GuildMembers.AsNoTracking()
                    .Where(m => m.GuildId == guildId).Select(m => m.UserNavigation).ToArrayAsync());
                var rolesTask = Query(db => (
                    from ura in db.UserRoleAssignments.AsNoTracking()
                    join r in db.Roles.AsNoTracking() on ura.RoleId equals r.Id
                    where r.GuildId == guildId
                    select new { ura.UserId, Role = r }).ToArrayAsync());
                Task<ChannelPermissionOverride[]> overridesTask = Query(db => db.ChannelPermissionOverrides.AsNoTracking()
                    .Where(o => o.ChannelId == channelId).ToArrayAsync());
                Task<UserWebNotificationHook[]> hooksTask = Query(db => db.UserWebNotificationHooks.AsNoTracking()
                    .Where(h => db.GuildMembers.Any(m => m.GuildId == guildId && m.UserId == h.UserId)).ToArrayAsync());
                Task<UserNtfySubscription[]> ntfyTask = Query(db => db.UserNtfySubscriptions.AsNoTracking()
                    .Where(s => s.Enabled && db.GuildMembers.Any(m => m.GuildId == guildId && m.UserId == s.UserId)).ToArrayAsync());
                Task<UserGuildNotificationPreferences[]> guildPrefsTask = Query(db => db.UserGuildNotificationPreferences
                    .AsNoTracking().Where(p => p.GuildId == guildId).ToArrayAsync());

                await Task.WhenAll(channelPrefsTask, guildTask, membersTask, rolesTask, overridesTask, hooksTask, ntfyTask, guildPrefsTask);

                var guild = guildTask.Result;
                List<(ChatUser User, List<Role> Roles)> visible = guild == null
                    ? []
                    : GuildRepo.ComputeVisibleMembers(guild.OwnerId, guild.DefaultPermissions, membersTask.Result,
                        rolesTask.Result.Select(x => (x.UserId, x.Role)), overridesTask.Result);
                audience = new NotificationAudience {
                    Members = visible.ToDictionary(v => v.User.Id, v => v.User),
                    Roles = visible.ToDictionary(v => v.User.Id, v => v.Roles),
                    GuildName = guild?.Name,
                    Hooks = GroupByUser(hooksTask.Result, h => h.UserId),
                    Ntfy = GroupByUser(ntfyTask.Result, s => s.UserId),
                    ChannelPrefs = channelPrefsTask.Result.ToDictionary(p => p.UserId),
                    GuildPrefs = guildPrefsTask.Result.ToDictionary(p => p.UserId)
                };
                break;
            }

            case ChannelType.Dm: {
                Task<ChatUser[]> membersTask = Query(db => db.Users.AsNoTracking()
                    .Where(u => db.DmChannels.Any(d => d.ChannelId == channelId && (d.User1Id == u.Id || d.User2Id == u.Id)))
                    .ToArrayAsync());
                Task<UserWebNotificationHook[]> hooksTask = Query(db => db.UserWebNotificationHooks.AsNoTracking()
                    .Where(h => db.DmChannels.Any(d => d.ChannelId == channelId && (d.User1Id == h.UserId || d.User2Id == h.UserId)))
                    .ToArrayAsync());
                Task<UserNtfySubscription[]> ntfyTask = Query(db => db.UserNtfySubscriptions.AsNoTracking()
                    .Where(s => s.Enabled && db.DmChannels.Any(d => d.ChannelId == channelId && (d.User1Id == s.UserId || d.User2Id == s.UserId)))
                    .ToArrayAsync());
                await Task.WhenAll(channelPrefsTask, membersTask, hooksTask, ntfyTask);
                audience = new NotificationAudience {
                    Members = membersTask.Result.ToDictionary(u => u.Id),
                    Hooks = GroupByUser(hooksTask.Result, h => h.UserId),
                    Ntfy = GroupByUser(ntfyTask.Result, s => s.UserId),
                    ChannelPrefs = channelPrefsTask.Result.ToDictionary(p => p.UserId)
                };
                break;
            }

            case ChannelType.Group: {
                Task<ChatUser[]> membersTask = Query(db => db.GroupChatMembers.AsNoTracking()
                    .Where(m => m.GroupChatId == channelId).Select(m => m.UserNavigation).ToArrayAsync());
                Task<UserWebNotificationHook[]> hooksTask = Query(db => db.UserWebNotificationHooks.AsNoTracking()
                    .Where(h => db.GroupChatMembers.Any(m => m.GroupChatId == channelId && m.UserId == h.UserId))
                    .ToArrayAsync());
                Task<UserNtfySubscription[]> ntfyTask = Query(db => db.UserNtfySubscriptions.AsNoTracking()
                    .Where(s => s.Enabled && db.GroupChatMembers.Any(m => m.GroupChatId == channelId && m.UserId == s.UserId))
                    .ToArrayAsync());
                await Task.WhenAll(channelPrefsTask, membersTask, hooksTask, ntfyTask);
                audience = new NotificationAudience {
                    Members = membersTask.Result.DistinctBy(u => u.Id).ToDictionary(u => u.Id),
                    Hooks = GroupByUser(hooksTask.Result, h => h.UserId),
                    Ntfy = GroupByUser(ntfyTask.Result, s => s.UserId),
                    ChannelPrefs = channelPrefsTask.Result.ToDictionary(p => p.UserId)
                };
                break;
            }

            default:
                await channelPrefsTask;
                return new NotificationAudience();
        }

        // Redis sits next to the server, so this second step is cheap
        HashSet<string> connected = await presence.GetConnected(audience.Members.Keys);
        audience.Connected.UnionWith(connected);
        return audience;
    }

    /// <summary>
    /// Runs a query on its own context. Started on the thread pool: EF does a fair bit of work synchronously before
    /// its first real await (context setup, query compilation, opening the connection), and without this the
    /// "parallel" queries would line up behind each other doing it.
    /// </summary>
    private Task<T> Query<T>(Func<ChatDatabaseContext, Task<T>> query) => Task.Run(async () => {
        using IServiceScope scope = scopes.CreateScope();
        ChatDatabaseContext db = scope.ServiceProvider.GetRequiredService<ChatDatabaseContext>();
        return await query(db);
    });

    private static Dictionary<string, T[]> GroupByUser<T>(IEnumerable<T> items, Func<T, string> user) =>
        items.GroupBy(user).ToDictionary(g => g.Key, g => g.ToArray());
}
