using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IFriendshipRepo {
    Task<Friendship[]> GetFriendships(string userId);
    Task<Friendship?> GetFriendship(string user1Id, string user2Id);
    Task AddFriendship(Friendship friendship);
    Task RemoveFriendship(long id);
    Task ModifyFriendship(Friendship friendship);
    
    Task<bool> IsFriendsWith(string userId, string[] userIds);
}
