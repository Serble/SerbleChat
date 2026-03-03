using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IGroupChatRepo {
    public Task<List<GroupChatMember>> GetMembers(long channelId);
    public Task<List<GroupChatMember>> GetGroupChats(string userId);
    public Task<GroupChat?> GetGroupChat(long channelId);
    public Task<bool> IsMemberInChat(long channelId, string userId);
    public Task AddGroupChat(GroupChat groupChat, Channel channel);
    public Task RemoveGroupChat(long channelId);
    public Task AddMembers(IEnumerable<GroupChatMember> newMembers);
    public Task RemoveMember(long channelId, string userId);
    public Task<bool> AnyAreMembers(long channelId, IEnumerable<string> userIds);
}
