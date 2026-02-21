using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services;

public interface IJwtManager {
    string GenerateToken(ChatUser user);
}
