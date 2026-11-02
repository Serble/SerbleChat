using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Services;

public interface ISerbleApiClient {
    Task<TokenResponse?> Authenticate(string code);
    Task<TokenResponse?> GetAccessToken(string refreshToken);
    Task<SerbleUser?> GetUserInfo(string accessToken);

    /// <summary>
    /// Cross-app sign-in: asks Serble for an authorization code for another app (the audience) on
    /// behalf of the user whose access token this is. The target app redeems the code itself.
    /// </summary>
    Task<CrossAppCodeResult> GetCrossAppCode(string accessToken, string audience);
    Task<TokenResponse?> GetAccessToken(ChatUser user) => GetAccessToken(user.RefreshToken);
}
