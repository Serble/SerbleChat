using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class GroupChatRepo(ChatDatabaseContext context) : IGroupChatRepo {
    
    public Task<List<GroupChatMember>> GetMembers(int channelId) {
        return context.GroupChatMembers
            .Where(g => g.GroupChatId == channelId)
            .Include(g => g.UserNavigation)
            .ToListAsync();
    }
    
    public async Task<List<GroupChatMember>> GetGroupChats(string userId) {
        List<GroupChatMember> dmChannels = await context.GroupChatMembers
            .Where(g => g.UserId == userId)
            .Select(gcm => new {
                Channel = gcm,
                LastMessage = context.Messages
                    .Where(m => m.ChannelId == gcm.GroupChatId)
                    .OrderByDescending(m => m.CreatedAt)
                    .Select(m => m.CreatedAt)
                    .FirstOrDefault()
            })
            .OrderByDescending(x => x.LastMessage)
            .Select(x => x.Channel)
            .ToListAsync();
        
        return dmChannels;
    }
    
    public async Task<GroupChat?> GetGroupChat(int channelId) {
        return await context.GroupChats
            .Where(g => g.ChannelId == channelId)
            .Include(a => a.ChannelNavigation)
            .FirstAsync();
    }
    
    public Task AddGroupChat(GroupChat groupChat, Channel channel) {
        groupChat.ChannelNavigation = channel;
        context.GroupChats.Add(groupChat);
        return context.SaveChangesAsync();
    }

    public async Task RemoveGroupChat(int channelId) {
        await context.GroupChatMembers.Where(m => m.GroupChatId == channelId).ExecuteDeleteAsync();
        await context.GroupChats.Where(g => g.ChannelId == channelId).ExecuteDeleteAsync();
        await context.Channels.Where(c => c.Id == channelId).ExecuteDeleteAsync();
    }
    
    public Task AddMembers(IEnumerable<GroupChatMember> newMembers) {
        context.GroupChatMembers.AddRange(newMembers);
        return context.SaveChangesAsync();
    }
    
    public Task RemoveMember(int channelId, string userId) {
        return context.GroupChatMembers
            .Where(g => g.GroupChatId == channelId && g.UserId == userId)
            .ExecuteDeleteAsync();
    }
    
    public Task<bool> IsMemberInChat(int channelId, string userId) {
        return Task.FromResult(context.GroupChatMembers
            .Any(g => g.GroupChatId == channelId && g.UserId == userId));
    }
}