using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IRoleRepo {
    public Task<Role?> GetRole(long id);
    public Task<Role[]> GetGuildRoles(long guildId);
    public Task CreateRole(Role role);
    public Task UpdateRole(Role role);
    public Task DeleteRole(long id);
    
    public Task<Role[]> GetUserRolesInGuild(string userId, long guildId);
    public Task AddUserRole(long roleId, string userId);
    public Task RemoveUserRole(long roleId, string userId);
}
