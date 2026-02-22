using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Repos;

public interface IUserRepo {
    Task<ChatUser> CreateUser(ChatUser user);
    Task<ChatUser?> GetUserById(string id);
    Task<ChatUser?> GetUserByUsername(string username);
    Task UpdateRefreshToken(string id, string refreshToken);
    Task UpdateUser(ChatUser user);
    
    Task<PublicUserResponse> CompilePublicUserResponse(ChatUser user);
}
