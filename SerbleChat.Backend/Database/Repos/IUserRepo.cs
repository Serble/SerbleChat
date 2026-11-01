using SerbleChat.Backend.Services.Ntfy;
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
    
    Task<UserChannelNotificationPreferences> GetChannelNotificationPreferences(string userId, long channelId);
    Task<Dictionary<long, UserChannelNotificationPreferences>> GetAllChannelNotificationPreferences(string userId);
    Task<UserGuildNotificationPreferences> GetUserGuildNotificationPreferences(string userId, long guildId);
    Task<Dictionary<long, UserGuildNotificationPreferences>> GetAllUserGuildNotificationPreferences(string userId);
    Task SetChannelNotificationPreferences(string userId, long channelId, UserChannelNotificationPreferences preferences);
    Task SetUserGuildNotificationPreferences(string userId, long guildId, UserGuildNotificationPreferences preferences);
    
    // mass notification prefs gets
    Task<Dictionary<string, UserChannelNotificationPreferences>> GetUsersChannelNotificationPreferences(IEnumerable<string> userIds, long channelId);
    Task<Dictionary<string, UserGuildNotificationPreferences>> GetUsersGuildNotificationPreferences(IEnumerable<string> userIds, long guildId);
    
    Task CreateWebNotificationSubscription(UserWebNotificationHook subscription);
    Task<IEnumerable<UserWebNotificationHook>> GetWebNotificationSubscriptions(string userId);
    Task DeleteWebNotificationSubscriptions(params long[] subscriptionId);
    Task<Dictionary<string, IEnumerable<UserWebNotificationHook>>> GetUsersWebNotificationSubscriptions(IEnumerable<string> userIds);

    // ntfy
    Task CreateNtfySubscription(UserNtfySubscription subscription);
    Task<UserNtfySubscription[]> GetNtfySubscriptions(string userId);
    Task<UserNtfySubscription?> GetNtfySubscription(string userId, long id);
    Task<int> CountNtfySubscriptions(string userId);
    Task UpdateNtfySubscription(UserNtfySubscription subscription);
    Task DeleteNtfySubscription(UserNtfySubscription subscription);
    /// <summary>Enabled subscriptions only, grouped by user.</summary>
    Task<Dictionary<string, UserNtfySubscription[]>> GetUsersEnabledNtfySubscriptions(IEnumerable<string> userIds);
    /// <summary>Records delivery outcomes without loading the rows. Failures past the threshold disable the subscription.</summary>
    Task RecordNtfyDeliveryResults(IEnumerable<long> succeeded, IEnumerable<NtfyDeliveryFailure> failed, int disableAfterFailures);
    
    Task<PublicUserResponse> CompilePublicUserResponse(ChatUser user);
    /// <summary>Like <see cref="CompilePublicUserResponse"/>, with one presence lookup for everyone.</summary>
    Task<PublicUserResponse[]> CompilePublicUserResponses(IReadOnlyCollection<ChatUser> users);
}
