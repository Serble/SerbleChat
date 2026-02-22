using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Controllers;

[ApiController]
[Route("channel")]
[Authorize]
public class ChannelController(IChannelRepo channels, IDmChannelRepo dms, IGroupChatRepo groups, IMessageRepo msgs, 
    IHubContext<ChatHub> updates, IUserRepo users) : ControllerBase {
    
    private async Task<bool> UserHasAccessToChannel(string userId, Channel channel) {
        switch (channel.Type) {
            case ChannelType.Group: {
                return await groups.IsMemberInChat(channel.Id, userId);
            }
            
            case ChannelType.Dm: {
                DmChannel? dmChannel = await dms.GetDmChannel(channel.Id);
                return dmChannel != null && (dmChannel.User1Id == userId || dmChannel.User2Id == userId);
            }

            case ChannelType.Guild:
            default:
                // guild channel
                throw new NotImplementedException();
        }
    }

    [HttpPost("{channelId:int}")]
    public async Task<ActionResult> PostMessage(int channelId, [FromBody] SendMessageBody body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }
        
        // permission check
        if (!await UserHasAccessToChannel(userId, channel)) {
            return Forbid();
        }

        Message msg = new() {
            AuthorId = userId,
            ChannelId = channel.Id,
            Content = body.Content,
            CreatedAt = DateTime.UtcNow
        };
        await msgs.CreateMessage(msg);
        await updates.Clients.Group($"channel-{channel.Id}").SendAsync("NewMessage", msg);
        return Ok();
    }

    [HttpDelete("{channelId:int}/message/{messageId:int}")]
    public async Task<ActionResult> DeleteMessage(int channelId, int messageId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Message? message = await msgs.GetMessage(messageId);
        if (message == null || message.ChannelId != channelId) {
            return NotFound("Message not found");
        }

        if (message.AuthorId != userId) {
            return Forbid();
        }
        
        await msgs.DeleteMessage(messageId);
        await updates.Clients.Group($"channel-{channelId}").SendAsync("DeleteMessage", new {
            Id = messageId,
            ChannelId = channelId
        });
        return Ok();
    }

    [HttpGet("{channelId:int}/messages")]
    public async Task<ActionResult<IEnumerable<Message>>> GetMessages(int channelId, [FromQuery] int limit = 50, [FromQuery] int offset = 0) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
    
        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }
        
        // permission check
        if (!await UserHasAccessToChannel(userId, channel)) {
            return Forbid();
        }
    
        List<Message> messages = await msgs.GetMessages(channelId, limit, offset);
        return Ok(messages);
    }
    
    [HttpGet("{channelId:int}")]
    public async Task<ActionResult<Channel>> GetChannel(int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
    
        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }
        
        // permission check
        if (!await UserHasAccessToChannel(userId, channel)) {
            return Forbid();
        }
        
        return Ok(channel);
    }

    [HttpGet("{channelId:int}/members")]
    public async Task<ActionResult<IEnumerable<string>>> GetChannelMembers(int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
    
        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }
        
        // permission check
        if (!await UserHasAccessToChannel(userId, channel)) {
            return Forbid();
        }

        switch (channel.Type) {
            case ChannelType.Group: {
                IEnumerable<GroupChatMember> members = await groups.GetMembers(channelId);
                List<PublicUserResponse> response = [];
                foreach (GroupChatMember member in members) {
                    response.Add(await users.CompilePublicUserResponse(member.UserNavigation));
                }
                return Ok(response);
            }
            
            case ChannelType.Dm: {
                DmChannel? dmChannel = await dms.GetDmChannel(channelId);
                if (dmChannel == null) {
                    return NotFound("DM channel not found");
                }
                List<PublicUserResponse> response = [];
                response.Add(await users.CompilePublicUserResponse(dmChannel.User1Navigation));
                response.Add(await users.CompilePublicUserResponse(dmChannel.User2Navigation));
                return Ok(response);
            }

            case ChannelType.Guild:
            default:
                // guild channel
                throw new NotImplementedException();
        }
    }

    // ==============================
    //     Group chat endpoints
    // ==============================

    [HttpGet("group")]
    public async Task<ActionResult<IEnumerable<GroupChat>>> GetGroupChats() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        IEnumerable<GroupChatMember> dmChannels = await groups.GetGroupChats(userId);
        return Ok(dmChannels);
    }
    
    [HttpGet("group/{groupId:int}")]
    public async Task<ActionResult<GroupChat>> GetGroupChat(int groupId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        GroupChat? chat = await groups.GetGroupChat(groupId);
        if (chat == null) {
            return NotFound("Group not found");
        }

        if (!await groups.IsMemberInChat(groupId, userId)) {
            return Forbid();
        }
        
        return Ok(chat);
    }
    
    [HttpPost("group/{groupId:int}/members")]
    public async Task<ActionResult> AddMembersToGroupChat(int groupId, [FromBody] AddGroupChatMembersBody body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        GroupChat? chat = await groups.GetGroupChat(groupId);
        if (chat == null) {
            return NotFound("Group not found");
        }

        if (chat.OwnerId != userId) {
            return Forbid();
        }
        
        HashSet<string> users = body.UserIds.ToHashSet();
        await groups.AddMembers(
            users.Select(id => new GroupChatMember {GroupChatId = groupId, UserId = id})
        );
        await updates.Clients.Users(users).SendAsync("NewChannel", new {
            Id = groupId,
            Channel = chat.ChannelNavigation,
            Type = ChannelType.Group
        });
        
        return Ok();
    }
    
    [HttpDelete("group/{groupId:int}")]
    public async Task<ActionResult> DeleteOrLeaveGroupChat(int groupId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        GroupChat? chat = await groups.GetGroupChat(groupId);
        if (chat == null) {
            return NotFound("Group not found");
        }

        if (!await groups.IsMemberInChat(groupId, userId)) {
            return Forbid();
        }
        
        if (chat.OwnerId == userId) {
            // delete the group
            await groups.RemoveGroupChat(groupId);
            await updates.Clients.Group($"channel-{groupId}").SendAsync("ChannelDeleted", new {
                ChannelId = groupId
            });
        }
        else {
            // just leave
            await groups.RemoveMember(groupId, userId);
            await updates.Clients.Group($"channel-{groupId}").SendAsync("UserLeft", new {
                UserId = userId
            });
        }
        
        return Ok();
    }

    [HttpPost("group")] // TEST: does this return channel information??
    public async Task<ActionResult<GroupChat>> CreateGroupChat([FromBody] CreateGroupChatBody body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        GroupChat groupChat = new() { OwnerId = userId };
        Channel channel = new() {
            CreatedAt = DateTime.UtcNow,
            Name = body.Name,
            VoiceCapable = true,
            Type = ChannelType.Group
        };
        await groups.AddGroupChat(groupChat, channel);

        HashSet<string> users = body.Users.ToHashSet();
        users.Add(userId);
        await groups.AddMembers(
            users.Select(id => new GroupChatMember {GroupChatId = groupChat.ChannelId, UserId = id})
        );
        await updates.Clients.Users(users).SendAsync("NewChannel", channel);
        
        return Ok(groupChat);
    }
    
    // ==============================
    //        DM endpoints
    // ==============================

    [HttpGet("dm/{otherId}")]
    public async Task<ActionResult<Channel>> GetDmChannel(string otherId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        DmChannel? dmChannel = await dms.GetDmChannel(userId, otherId);
        if (dmChannel == null) {
            // create a new one
            Channel channel = new() {
                CreatedAt = DateTime.UtcNow,
                Name = "DM Channel",
                VoiceCapable = true,
                Type = ChannelType.Dm
            };
            await channels.CreateChannel(channel);
            dmChannel = new DmChannel {
                User1Id = userId,
                User2Id = otherId,
                ChannelId = channel.Id
            };
            await dms.CreateDmChannel(dmChannel);
            
            // add them to the chat hub group
            await updates.Clients.Users([
                userId,
                otherId
            ]).SendAsync("NewChannel", channel);
        }
        
        return Ok(dmChannel.ChannelNavigation);
    }
    
    [HttpGet("dm")]
    public async Task<ActionResult<IEnumerable<DmChannel>>> GetDmChannels() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        List<DmChannel> dmChannels = await dms.GetDmChannels(userId);
        return Ok(dmChannels);
    }
}
