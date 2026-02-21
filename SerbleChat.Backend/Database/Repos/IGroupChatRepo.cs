using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IGroupChatRepo {
    public Task<List<GroupChatMember>> GetMembers(int channelId);
    public Task<List<GroupChatMember>> GetGroupChats(string userId);
    public Task<GroupChat?> GetGroupChat(int channelId);
    public Task<bool> IsMemberInChat(int channelId, string userId);
    public Task AddGroupChat(GroupChat groupChat, Channel channel);
    public Task RemoveGroupChat(int channelId);
    public Task AddMembers(IEnumerable<GroupChatMember> newMembers);
    public Task RemoveMember(int channelId, string userId);
}