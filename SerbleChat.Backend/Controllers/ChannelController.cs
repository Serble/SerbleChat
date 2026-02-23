using System.Security.Claims;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Controllers;

[ApiController]
[Route("channel")]
[Authorize]
public class ChannelController(IChannelRepo channels, IDmChannelRepo dms, IGroupChatRepo groups, IMessageRepo msgs,
    IHubContext<ChatHub> updates, IUserRepo users, IGuildRepo guilds, IRoleRepo roles, IOptions<LiveKitSettings> liveKitSettings) : ControllerBase {

    private async Task<bool> UserHasAccessToChannel(string userId, Channel channel, bool sendMessages) {
        switch (channel.Type) {
            case ChannelType.Group:
                return await groups.IsMemberInChat(channel.Id, userId);
            
            case ChannelType.Dm: {
                DmChannel? dmChannel = await dms.GetDmChannel(channel.Id);
                if (dmChannel == null) {
                    return false;
                }

                if (!(dmChannel.User1Id == userId || dmChannel.User2Id == userId)) {
                    return false;
                }
                
                return true;
            }

            case ChannelType.Guild: {
                if (!channel.GuildId.HasValue) {
                    return false;
                }

                if (!await guilds.IsGuildMember(channel.GuildId.Value, userId)) {
                    return false;
                }

                if (sendMessages) {
                    GuildPermissions perms = await guilds.GetUserPermissions(userId, channel.GuildId.Value, channel.Id);
                    if (!perms.HasPerm(p => p.SendMessages)) {
                        return false;
                    }
                }
                
                return true;
            }
            
            default:
                return false;
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
        if (!await UserHasAccessToChannel(userId, channel, true)) {
            return Forbid();
        }

        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel != null) {
            // guild permission check
            GuildPermissions perms = await guilds.GetUserPermissions(userId, guildChannel.GuildId, channelId);
            if (!(perms.SendMessages.ToBool() || perms.Administrator.ToBool())) {
                return Forbid();
            }
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
            GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
            if (guildChannel != null) {
                // guild permission check
                GuildPermissions perms = await guilds.GetUserPermissions(userId, guildChannel.GuildId, channelId);
                if (!(perms.ManageMessages.ToBool() || perms.Administrator.ToBool())) {
                    return Forbid();
                }
            }
            else {  // if it's not a guild channel, only the author can delete
                return Forbid();
            }
        }  // the author can always delete their own message, even without manage messages perms
        
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
        if (!await UserHasAccessToChannel(userId, channel, false)) {
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
        if (!await UserHasAccessToChannel(userId, channel, false)) {
            return Forbid();
        }
        
        return Ok(channel);
    }

    [HttpGet("{channelId:int}/members")]
    public async Task<ActionResult<IEnumerable<PublicUserResponse>>> GetChannelMembers(int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
    
        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }
        
        // permission check
        if (!await UserHasAccessToChannel(userId, channel, false)) {
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

            case ChannelType.Guild: {
                ChatUser[] members = await guilds.GetGuildChannelMembers(channelId);
                List<PublicUserResponse> response = [];
                foreach (ChatUser member in members) {
                    response.Add(await users.CompilePublicUserResponse(member));
                }
                return Ok(response);
            }
                
            default:
                throw new InvalidOperationException("Unknown channel type");
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
                UserId = userId,
                chat.ChannelId
            });
        }
        
        return Ok();
    }

    [HttpPost("group")]
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

        HashSet<string> members = body.Users.ToHashSet();
        members.Add(userId);
        await groups.AddMembers(
            members.Select(id => new GroupChatMember {GroupChatId = groupChat.ChannelId, UserId = id})
        );
        await updates.Clients.Users(members).SendAsync("NewChannel", channel);
        
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

    [HttpPost("{channelId:int}/voice")]
    public async Task<ActionResult<LiveKitTokenResponse>> GetVoiceToken(int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound();
        }
        
        if (!await UserHasAccessToChannel(userId, channel)) {
            return Forbid();
        }
        
        if (!channel.VoiceCapable) {
            return BadRequest();
        }
        
        if (channel.Type == ChannelType.Guild) {
            GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, channel.GuildId!.Value);
            if (!(perms.JoinVoice.ToBool() || perms.Administrator.ToBool())) {
                return Forbid();
            }
        }
        
        AccessToken token = new AccessToken(liveKitSettings.Value.Key, liveKitSettings.Value.Secret)
            .WithIdentity(userId)
            .WithGrants(new VideoGrants {
                RoomJoin = true,
                Room = $"channel:{channelId}"
            });
        
        return Ok(new LiveKitTokenResponse { Token = token.ToJwt() });
    }
}
