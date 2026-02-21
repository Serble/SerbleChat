using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Controllers;

// POST /channel/dm/{userId}
// GET /channel/dm/{userId}
// GET /channel/dm

// POST /channel/group
// GET /channel/group/{groupId}
// GET /channel/group

// POST /channel/{channelId}
// GET /channel/{channelId}/messages

[ApiController]
[Route("channel")]
[Authorize]
public class ChannelController(IChannelRepo channels, IDmChannelRepo dms, IGroupChatRepo groups, IMessageRepo msgs) : ControllerBase {

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
        }
        
        return Ok(await channels.GetChannel(dmChannel.ChannelId));
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

    [HttpPost("group")] // TEST: does this return channel information??
    public async Task<ActionResult<GroupChat>> CreateGroupChat([FromBody] CreateGroupChatBody body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        GroupChat groupChat = new() { OwnerId = userId };
        await groups.AddGroupChat(groupChat, new Channel {
            CreatedAt = DateTime.UtcNow,
            Name = body.Name,
            VoiceCapable = true,
            Type = ChannelType.Group
        });

        HashSet<string> users = body.Users.ToHashSet();
        users.Add(userId);
        await groups.AddMembers(
            users.Select(id => new GroupChatMember {GroupChatId = groupChat.ChannelId, UserId = id})
        );
        
        return Ok(groupChat);
    }
}
