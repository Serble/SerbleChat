using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Repos;

public interface IRoleRepo {
    public Task<Role?> GetRole(int id);
    public Task<Role[]> GetGuildRoles(int guildId);
    public Task CreateRole(Role role);
    public Task UpdateRole(Role role);
    public Task DeleteRole(int id);
    
    public Task<Role[]> GetUserRolesInGuild(string userId, int guildId);
    public Task AddUserRole(int roleId, string userId);
    public Task RemoveUserRole(int roleId, string userId);
}
