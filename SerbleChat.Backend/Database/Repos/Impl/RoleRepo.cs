using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class RoleRepo(ChatDatabaseContext context) : IRoleRepo {
    
    public async Task<Role?> GetRole(long id) {
        return await context.Roles.FindAsync(id);
    }

    public Task<Role[]> GetGuildRoles(long guildId) {
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

    public Task DeleteRole(long id) {
        return context.Roles.Where(r => r.Id == id).ExecuteDeleteAsync();
    }

    public Task<Role[]> GetUserRolesInGuild(string userId, long guildId) {
        return context.UserRoleAssignments
            .Where(a => a.UserId == userId)
            .Join(context.Roles.Where(r => r.GuildId == guildId),
                a => a.RoleId,
                r => r.Id,
                (a, r) => r)
            .ToArrayAsync();
    }

    public Task AddUserRole(long roleId, string userId) {
        context.UserRoleAssignments.Add(new UserRoleAssignment { RoleId = roleId, UserId = userId });
        return context.SaveChangesAsync();
    }

    public Task RemoveUserRole(long roleId, string userId) {
        return context.UserRoleAssignments
            .Where(a => a.RoleId == roleId && a.UserId == userId)
            .ExecuteDeleteAsync();
    }
}
