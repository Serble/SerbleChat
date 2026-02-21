using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Services;

public interface ISerbleApiClient {
    Task<TokenResponse?> Authenticate(string code);
    Task<TokenResponse?> GetAccessToken(string refreshToken);
    Task<SerbleUser?> GetUserInfo(string accessToken);
    Task<TokenResponse?> GetAccessToken(ChatUser user) => GetAccessToken(user.RefreshToken);
}
