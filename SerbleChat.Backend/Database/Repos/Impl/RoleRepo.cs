using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class RoleRepo(ChatDatabaseContext context) : IRoleRepo {
    
    public async Task<Role?> GetRole(int id) {
        return await context.Roles.FindAsync(id);
    }

    public Task<Role[]> GetGuildRoles(int guildId) {
        return context.Roles.Where(r => r.GuildId == guildId).ToArrayAsync();
    }

    public Task CreateRole(Role role) {
        context.Roles.Add(role);
        return context.SaveChangesAsync();
    }

    public Task UpdateRole(Role role) {
        context.Roles.Update(role);
        return context.SaveChangesAsync();
    }

    public Task DeleteRole(int id) {
        return context.Roles.Where(r => r.Id == id).ExecuteDeleteAsync();
    }

    public Task<Role[]> GetUserRolesInGuild(string userId, int guildId) {
        return context.UserRoleAssignments
            .Where(a => a.UserId == userId)
            .Join(context.Roles.Where(r => r.GuildId == guildId),
                a => a.RoleId,
                r => r.Id,
                (a, r) => r)
            .ToArrayAsync();
    }

    public Task AddUserRole(int roleId, string userId) {
        context.UserRoleAssignments.Add(new UserRoleAssignment { RoleId = roleId, UserId = userId });
        return context.SaveChangesAsync();
    }

    public Task RemoveUserRole(int roleId, string userId) {
        return context.UserRoleAssignments
            .Where(a => a.RoleId == roleId && a.UserId == userId)
            .ExecuteDeleteAsync();
    }

    public async Task<GuildPermissions> GetUserPermissionsInGuild(string userId, int guildId) {
        Guild guild = (await context.Guilds.FindAsync(guildId))!;

        if (guild.OwnerId == userId) {
            return GuildPermissions.OwnerPermissions;
        }
        
        GuildPermissions?[] permissions = await context.Roles
            .AsNoTracking()
            .Where(r => r.GuildId == guildId)
            .GroupJoin(context.UserRoleAssignments.Where(a => a.UserId == userId),
                r => r.Id,
                a => a.RoleId,
                (r, a) => new { Role = r, HasRole = a.Any() })
            .OrderByDescending(x => x.Role.Priority)
            .Select(x => x.HasRole ? x.Role.Permissions : null)
            .ToArrayAsync();

        GuildPermissions current = guild.DefaultPermissions;

        for (int i = permissions.Length - 1; i >= 0; i--) {
            current = current.ApplyOverrides(permissions[i]);
        }
        
        return current;
    }
}
