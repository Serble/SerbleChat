using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Schemas;

public record UserAccountResponse(string Id, string Username, bool IsAdmin, bool IsBanned, DateTime CreatedAt) {
    public static UserAccountResponse FromChatUser(ChatUser user) {
        return new UserAccountResponse(user.Id, user.Username, user.IsAdmin, user.IsBanned, user.CreatedAt);
    }
}

public record PublicUserResponse(string Id, string Username, bool IsAdmin, bool IsBanned, DateTime CreatedAt) {
    public static PublicUserResponse FromChatUser(ChatUser user) {
        return new PublicUserResponse(user.Id, user.Username, user.IsAdmin, user.IsBanned, user.CreatedAt);
    }
}
