using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Repos;

public interface IUserRepo {
    Task<ChatUser> CreateUser(ChatUser user);
    Task<ChatUser?> GetUserById(string id);
    Task<ChatUser?> GetUserByUsername(string username);
    Task UpdateRefreshToken(string id, string refreshToken);
    Task UpdateUser(ChatUser user);
    
    Task<bool> AreUsersBlocked(string userId1, string userId2);
    Task BlockUser(string blockerId, string blockedId);
    Task UnblockUser(string blockerId, string blockedId);
    Task<UserBlock[]> GetBlockedUsers(string userId);
    
    Task<PublicUserResponse> CompilePublicUserResponse(ChatUser user);
}
