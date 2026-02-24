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
    
    Task<string> GetClientOptions(string userId);
    Task SetClientOptions(string userId, string options);
    
    Task<UserChannelNotificationPreferences> GetChannelNotificationPreferences(string userId, int channelId);
    Task<Dictionary<int, UserChannelNotificationPreferences>> GetAllChannelNotificationPreferences(string userId);
    Task<UserGuildNotificationPreferences> GetUserGuildNotificationPreferences(string userId, int guildId);
    Task<Dictionary<int, UserGuildNotificationPreferences>> GetAllUserGuildNotificationPreferences(string userId);
    Task SetChannelNotificationPreferences(string userId, int channelId, UserChannelNotificationPreferences preferences);
    Task SetUserGuildNotificationPreferences(string userId, int guildId, UserGuildNotificationPreferences preferences);
    
    Task<PublicUserResponse> CompilePublicUserResponse(ChatUser user);
}
