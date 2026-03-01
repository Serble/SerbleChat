using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Helpers;
using SerbleChat.Backend.Schemas;
using StackExchange.Redis;
using Role = SerbleChat.Backend.Database.Structs.Role;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class GuildRepo(ChatDatabaseContext context, IConnectionMultiplexer redis, IRoleRepo roles) : IGuildRepo {
    
    public async Task<Guild?> GetGuild(long id) {
        return await context.Guilds.FindAsync(id);
    }

    public async Task<Guild[]> GetGuildsForUser(string userId) {
        return await context.GuildMembers.Where(m => m.UserId == userId)
            .Select(m => m.GuildNavigation)
            .ToArrayAsync();
    }

    public async Task CreateGuild(Guild guild) {
        context.Guilds.Add(guild);
        await context.SaveChangesAsync();
    }

    public Task DeleteGuild(long id) {
        return context.Guilds.Where(g => g.Id == id).ExecuteDeleteAsync();
    }

    public async Task UpdateGuild(Guild guild) {
        context.Guilds.Update(guild);
        await context.SaveChangesAsync();
    }

    public async Task AddGuildMember(long guildId, string userId) {
        bool exists = await context.GuildMembers
            .AnyAsync(m => m.GuildId == guildId && m.UserId == userId);
        if (exists) return;
        context.GuildMembers.Add(new GuildMember { GuildId = guildId, UserId = userId });
        await context.SaveChangesAsync();
    }

    public Task<bool> IsGuildMember(long guildId, string userId) {
        return context.GuildMembers
            .AnyAsync(m => m.GuildId == guildId && m.UserId == userId);
    }

    public Task<ChatUser[]> GetGuildMembers(long guildId) {
        return context.GuildMembers
            .Where(m => m.GuildId == guildId)
            .Select(m => m.UserNavigation)
            .ToArrayAsync();
    }

    public Task<GuildChannel?> GetGuildChannel(long channelId) {
        return context.GuildChannels
            .Where(c => c.ChannelId == channelId)
            .Include(c => c.ChannelNavigation)
            .FirstOrDefaultAsync();
    }

    public async Task CreateGuildChannel(GuildChannel channel) {
        context.GuildChannels.Add(channel);
        await context.SaveChangesAsync();
    }

    public Task DeleteGuildChannel(long id) {
        return context.GuildChannels.Where(c => c.ChannelId == id).ExecuteDeleteAsync();
    }

    public Task UpdateGuildChannel(GuildChannel channel) {
        context.GuildChannels.Update(channel);
        return context.SaveChangesAsync();
    }

    public Task<GuildChannel[]> GetGuildChannels(long guildId) {
        return context.GuildChannels
            .Where(c => c.GuildId == guildId)
            .Include(c => c.ChannelNavigation)
            .ToArrayAsync();
    }

    public Task<Channel[]> GetGuildChannelsAsChannels(long guildId) {
        return context.GuildChannels
            .Where(c => c.GuildId == guildId)
            .Select(c => c.ChannelNavigation)
            .ToArrayAsync();
    }

    /// <summary>
    /// Returns all guild members who have the <c>ViewChannel</c> permission for
    /// <paramref name="channelId"/>, paired with their guild-scoped roles (ordered by
    /// priority descending).
    ///
    /// Executes exactly <b>4 SQL queries</b> regardless of member / role count:
    /// <list type="number">
    ///   <item>GuildChannels → Guilds (guildId, ownerId, defaultPermissions)</item>
    ///   <item>GuildMembers → ChatUsers</item>
    ///   <item>UserRoleAssignments inner-joined with Roles (filtered to this guild)</item>
    ///   <item>ChannelPermissionOverrides for this channel</item>
    /// </list>
    /// Permission resolution mirrors <see cref="GetUserPermissions"/> exactly.
    /// </summary>
    private async Task<List<(ChatUser User, List<Role> Roles)>> GetVisibleMembersWithRoles(long channelId) {
        // Query 1: guild context via a single JOIN (GuildChannels → Guilds)
        var guildInfo = await context.GuildChannels
            .AsNoTracking()
            .Where(c => c.ChannelId == channelId)
            .Select(c => new {
                c.GuildId,
                OwnerId            = c.GuildNavigation.OwnerId,
                DefaultPermissions = c.GuildNavigation.DefaultPermissions
            })
            .FirstOrDefaultAsync();

        if (guildInfo == null) return [];

        long guildId = guildInfo.GuildId;

        // Query 2: all guild members with their user rows
        ChatUser[] allMembers = await context.GuildMembers
            .Where(m => m.GuildId == guildId)
            .Select(m => m.UserNavigation)
            .ToArrayAsync();

        // Query 3: role assignments for every member of this guild — single INNER JOIN
        var roleAssignments = await (
            from ura in context.UserRoleAssignments
            join r   in context.Roles on ura.RoleId equals r.Id
            where r.GuildId == guildId
            select new { ura.UserId, Role = r }
        ).ToArrayAsync();

        // Query 4: channel-level permission overrides
        ChannelPermissionOverride[] channelOverrides = await context.ChannelPermissionOverrides
            .Where(o => o.ChannelId == channelId)
            .ToArrayAsync();

        // Build per-user role lookup (priority descending — same order as GetUserPermissions)
        Dictionary<string, List<Role>> rolesByUser = roleAssignments
            .GroupBy(x => x.UserId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => x.Role).OrderByDescending(r => r.Priority).ToList());

        List<(ChatUser, List<Role>)> visible = new(allMembers.Length);

        foreach (ChatUser user in allMembers) {
            // Guild owner bypasses all permission checks
            if (user.Id == guildInfo.OwnerId) {
                rolesByUser.TryGetValue(user.Id, out List<Role>? ownerRoles);
                visible.Add((user, ownerRoles ?? []));
                continue;
            }

            rolesByUser.TryGetValue(user.Id, out List<Role>? memberRoles);
            memberRoles ??= [];

            // Replicate GetUserPermissions exactly:
            //   list = [role perms desc-priority] ++ [applicable channel overrides]
            //   then applied in reverse (lowest-priority role first, highest wins).
            List<GuildPermissions?> permissions =
                memberRoles.Select(GuildPermissions? (r) => r.Permissions).ToList();

            foreach (ChannelPermissionOverride co in channelOverrides) {
                if (co.RoleId.HasValue) {
                    if (memberRoles.Any(r => r.Id == co.RoleId.Value))
                        permissions.Add(co.Permissions);
                } else if (co.UserId == user.Id) {
                    permissions.Add(co.Permissions);
                }
            }

            GuildPermissions effective = guildInfo.DefaultPermissions;
            for (int i = permissions.Count - 1; i >= 0; i--) {
                effective = effective.ApplyOverrides(permissions[i]);
            }

            if (effective.HasPerm(p => p.ViewChannel)) {
                visible.Add((user, memberRoles));
            }
        }

        return visible;
    }

    public async Task<ChatUser[]> GetGuildChannelMembers(long channelId) {
        return (await GetVisibleMembersWithRoles(channelId))
            .Select(m => m.User)
            .ToArray();
    }

    public async Task<GuildMemberResponse[]> GetGuildChannelMembersDetails(long channelId) {
        List<(ChatUser User, List<Role> Roles)> members = await GetVisibleMembersWithRoles(channelId);

        List<GuildMemberResponse> result = new(members.Count);
        foreach ((ChatUser user, List<Role> memberRoles) in members) {
            string colour = "#ffffff";
            foreach (Role role in memberRoles) {
                if (!string.IsNullOrWhiteSpace(role.Color)) {
                    colour = role.Color;
                    break;
                }
            }
            bool online = redis.GetDatabase().StringGet($"status:{user.Id}").HasValue;
            result.Add(new GuildMemberResponse(PublicUserResponse.FromChatUser(user, online), colour));
        }

        return result.ToArray();
    }

    public Task<ChannelPermissionOverride[]> GetChannelPermissionOverrides(long channelId) {
        return context.ChannelPermissionOverrides
            .Where(o => o.ChannelId == channelId)
            .ToArrayAsync();
    }

    public async Task<ChannelPermissionOverride?> GetChannelPermissionOverride(long id) {
        return await context.ChannelPermissionOverrides.FindAsync(id);
    }

    public Task CreateChannelPermissionOverride(ChannelPermissionOverride permissionOverride) {
        context.ChannelPermissionOverrides.Add(permissionOverride);
        return context.SaveChangesAsync();
    }

    public Task DeleteChannelPermissionOverride(long id) {
        return context.ChannelPermissionOverrides.Where(o => o.Id == id).ExecuteDeleteAsync();
    }

    public Task UpdateChannelPermissionOverride(ChannelPermissionOverride permissionOverride) {
        context.ChannelPermissionOverrides.Update(permissionOverride);
        return context.SaveChangesAsync();
    }

    public Task CreateInvite(GuildInvite invite) {
        context.GuildInvites.Add(invite);
        return context.SaveChangesAsync();
    }

    public Task<GuildInvite?> GetInvite(string id) {
        return context.GuildInvites
            .Where(i => i.Id == id)
            .Include(i => i.GuildNavigation)
            .FirstOrDefaultAsync();
    }

    public Task DeleteInvite(string id) {
        return context.GuildInvites.Where(i => i.Id == id).ExecuteDeleteAsync();
    }

    public Task<GuildInvite[]> GetGuildInvites(long guildId) {
        return context.GuildInvites
            .Where(i => i.GuildId == guildId)
            .ToArrayAsync();
    }
    
    // TODO: Redis cache result
    public async Task<GuildPermissions> GetUserPermissions(string userId, long guildId, long channelId) {
        Guild guild = (await context.Guilds.FindAsync(guildId))!;

        if (guild.OwnerId == userId) {
            return GuildPermissions.OwnerPermissions;
        }
        
        List<GuildPermissions?> permissions = await context.Roles
            .AsNoTracking()
            .Where(r => r.GuildId == guildId)
            .GroupJoin(context.UserRoleAssignments.Where(a => a.UserId == userId),
                r => r.Id,
                a => a.RoleId,
                (r, a) => new { Role = r, HasRole = a.Any() })
            .OrderByDescending(x => x.Role.Priority)
            .Select(x => x.HasRole ? x.Role.Permissions : null)
            .ToListAsync();

        GuildPermissions current = guild.DefaultPermissions;

        if (channelId != -1) {
            AsyncLazy<Role[]> userRoles = new(() => roles.GetUserRolesInGuild(userId, guildId));
            
            ChannelPermissionOverride[] overrides = await GetChannelPermissionOverrides(channelId);
            foreach (ChannelPermissionOverride co in overrides) {
                if (co.RoleId != null) {  // role id override
                    if ((await userRoles.Value).Any(r => r.Id == co.RoleId)) {
                        permissions.Add(co.Permissions);
                    }
                }
                else {  // user id override
                    ArgumentNullException.ThrowIfNull(co.UserId);
                    if (co.UserId == userId) {
                        permissions.Add(co.Permissions);
                    }
                }
            }
        }

        for (int i = permissions.Count - 1; i >= 0; i--) {
            current = current.ApplyOverrides(permissions[i]);
        }
        
        return current;
    }

    public async Task<Dictionary<long, GuildPermissions>> GetUserPermissionsForGuild(string userId, long guildId) {
        // Query 1: guild context
        Guild? guild = await context.Guilds.FindAsync(guildId);
        if (guild == null) return [];

        // Query 2: all channel ids for this guild
        long[] channelIds = await context.GuildChannels
            .Where(c => c.GuildId == guildId)
            .Select(c => c.ChannelId)
            .ToArrayAsync();

        if (channelIds.Length == 0) return [];

        // Guild owner gets full permissions on every channel — skip remaining queries
        if (guild.OwnerId == userId)
            return channelIds.ToDictionary(id => id, _ => GuildPermissions.OwnerPermissions);

        // Query 3: user's roles in this guild, priority descending
        // (mirrors the OrderByDescending in GetUserPermissions so index 0 = highest-priority role)
        Role[] userRoles = await (
            from ura in context.UserRoleAssignments
            join r in context.Roles on ura.RoleId equals r.Id
            where ura.UserId == userId && r.GuildId == guildId
            orderby r.Priority descending
            select r
        ).ToArrayAsync();

        long[] userRoleIds = userRoles.Select(r => r.Id).ToArray();

        // Query 4: all channel overrides for every channel in this guild that apply to
        // this user — single IN query, no per-channel round-trips
        ChannelPermissionOverride[] allOverrides = await context.ChannelPermissionOverrides
            .Where(co => channelIds.Contains(co.ChannelId)
                      && (co.UserId == userId
                          || (co.RoleId != null && userRoleIds.Contains(co.RoleId.Value))))
            .ToArrayAsync();

        // Group overrides by channel for O(1) lookup in the resolution loop below
        Dictionary<long, List<ChannelPermissionOverride>> overridesByChannel = allOverrides
            .GroupBy(co => co.ChannelId)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Base role permission list — identical for every channel; only channel-specific
        // overrides differ. Built priority-descending so the reverse-apply loop gives the
        // same result as GetUserPermissions (index 0 = highest-priority, applied last, wins).
        List<GuildPermissions?> baseRolePerms = userRoles
            .Select(GuildPermissions? (r) => r.Permissions)
            .ToList();

        Dictionary<long, GuildPermissions> result = new(channelIds.Length);

        foreach (long channelId in channelIds) {
            // Append this channel's overrides after the role perms — same structure that
            // GetUserPermissions builds before its reverse-apply loop
            List<GuildPermissions?> permissions = new(baseRolePerms);
            if (overridesByChannel.TryGetValue(channelId, out List<ChannelPermissionOverride>? channelOverrides)) {
                foreach (ChannelPermissionOverride co in channelOverrides) {
                    permissions.Add(co.Permissions);
                }
            }

            // Apply in reverse: lowest-priority entry first, highest-priority role wins
            GuildPermissions effective = guild.DefaultPermissions;
            for (int i = permissions.Count - 1; i >= 0; i--) {
                effective = effective.ApplyOverrides(permissions[i]);
            }

            result[channelId] = effective;
        }

        return result;
    }
}