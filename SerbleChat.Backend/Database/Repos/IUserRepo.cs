using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IUserRepo {
    Task<ChatUser> CreateUser(ChatUser user);
    Task<ChatUser?> GetUserById(int id);
    Task<ChatUser?> GetUserByUsername(string username);
    Task UpdateRefreshToken(int id, string refreshToken);
    Task UpdateUser(ChatUser user);
}
