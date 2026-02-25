using System.Security.Claims;
using System.Text.RegularExpressions;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Helpers;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Controllers;

[ApiController]
[Route("channel")]
[Authorize]
public partial class ChannelController(IChannelRepo channels, IDmChannelRepo dms, IGroupChatRepo groups, IMessageRepo msgs,
    IHubContext<ChatHub> updates, IUserRepo users, IGuildRepo guilds, IOptions<LiveKitSettings> liveKitSettings,
    IUnreadsRepo unreads, IVoiceManager voiceManager, INotificationService notifications) : ControllerBase {

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

                if (sendMessages) {
                    bool blocked = await users.AreUsersBlocked(dmChannel.User1Id, dmChannel.User2Id);
                    if (blocked) {
                        return false;
                    }
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
        if (!await channels.UserHasAccessToChannel(userId, channel, true)) {
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
        
        // add all the mentions
        List<string> mentionedUserIds = [];
        foreach (Match match in UserMentionsMatcher().Matches(body.Content)) {
            mentionedUserIds.Add(match.Groups[1].Value);
        }
        
        await updates.Clients.Users(mentionedUserIds).SendAsync("MentionedInMessage", new {
            MessageId = msg.Id,
            ChannelId = channel.Id
        });
        await unreads.AddUserMentions(channelId, msg.Id, mentionedUserIds);
        
        notifications.EnqueueMessageProcessing(channel, msg, mentionedUserIds);
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
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) {
            return Forbid();
        }
    
        List<Message> messages = await msgs.GetMessages(channelId, limit, offset);
        await unreads.MarkRead(userId, channelId, messages.FirstOrDefault()?.Id ?? 0);
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
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) {
            return Forbid();
        }
        
        return Ok(channel);
    }

    // This is expensive, for redis this is O(n), where n is member count.
    // But for MySQL this is O(1).
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
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) {
            return Forbid();
        }
        
        IEnumerable<ChatUser> members = await channels.GetChannelMembers(channel);
        List<PublicUserResponse> response = [];
        foreach (ChatUser member in members) {
            response.Add(await users.CompilePublicUserResponse(member));
        }
        
        return Ok(response);
    }

    [HttpGet("{channelId:int}/unreads")]
    public async Task<ActionResult<UnreadsResponse>> GetChannelUnreads(int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return Unauthorized("User not found in local database");
        }
    
        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }
        
        // permission check
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) {
            return Forbid();
        }

        NotificationPreferences prefs = (await users.GetChannelNotificationPreferences(userId, channelId)).Preferences;
        NotificationPreferences guildPrefs = channel.GuildId.HasValue
            ? (await users.GetUserGuildNotificationPreferences(userId, channel.GuildId.Value)).Preferences
            : NotificationPreferences.DefaultPreferences;
        NotificationPreferences userDefaultPrefs = channel.Type switch {
            ChannelType.Guild => user.DefaultGuildNotificationPreferences,
            ChannelType.Dm => user.DefaultDmNotificationPreferences,
            ChannelType.Group => user.DefaultGroupNotificationPreferences,
            _ => NotificationPreferences.DefaultPreferences
        };
        
        // apply them all
        prefs = prefs.ApplyOverride(guildPrefs);
        prefs = prefs.ApplyOverride(userDefaultPrefs);
        
        return prefs.Unreads switch {
            NotificationPreference.AllMessages => Ok(new UnreadsResponse {
                Count = await unreads.GetUnreadMessagesCount(userId, channelId)
            }),
            NotificationPreference.MentionsOnly => Ok(new UnreadsResponse {
                Count = await unreads.GetUnreadMentionsCount(userId, channelId)
            }),
            NotificationPreference.Nothing => Ok(new UnreadsResponse { Count = 0 }),
            _ => throw new ArgumentOutOfRangeException()
        };
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
        
        HashSet<string> members = body.UserIds.ToHashSet();
        await groups.AddMembers(
            members.Select(id => new GroupChatMember {GroupChatId = groupId, UserId = id})
        );
        await updates.Clients.Users(members).SendAsync("NewChannel", new {
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
        Result<string, ActionResult<LiveKitTokenResponse>> result = 
            await CheckVoicePerms<LiveKitTokenResponse>(channelId, false);
        if (result.GetErr(out ActionResult<LiveKitTokenResponse> error)) {
            return error;
        }

        string userId = result.Unwrap();
        
        AccessToken token = new AccessToken(liveKitSettings.Value.Key, liveKitSettings.Value.Secret)
            .WithIdentity(userId)
            .WithGrants(new VideoGrants {
                RoomJoin = true,
                Room = $"channel:{channelId}"
            });
        
        return Ok(new LiveKitTokenResponse { Token = token.ToJwt() });
    }

    [HttpGet("{channelId:int}/voice")]
    public async Task<ActionResult<UsersInVoiceResponse>> GetUsersInVoice(int channelId) {
        Result<string, ActionResult<UsersInVoiceResponse>> result = 
            await CheckVoicePerms<UsersInVoiceResponse>(channelId, false);
        if (result.GetErr(out ActionResult<UsersInVoiceResponse> error)) {
            return error;
        }

        return Ok(new UsersInVoiceResponse {
            Users = await voiceManager.GetConnectedUsers(channelId)
        });
    }
    
    private async Task<Result<string, ActionResult<T>>> CheckVoicePerms<T>(int channelId, bool joining) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Result<string, ActionResult<T>>.Err(Unauthorized());
        }
        
        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return Result<string, ActionResult<T>>.Err(NotFound());
        }
        
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) {
            return Result<string, ActionResult<T>>.Err(Forbid());
        }
        
        if (!channel.VoiceCapable) {
            return Result<string, ActionResult<T>>.Err(BadRequest());
        }
        
        if (channel.Type == ChannelType.Guild) {
            GuildPermissions perms = await guilds.GetUserPermissions(userId, channel.GuildId!.Value);
            if (!((perms.ViewChannel.ToBool() && (!joining || perms.JoinVoice.ToBool())) || perms.Administrator.ToBool())) {
                return Result<string, ActionResult<T>>.Err(Forbid());
            }
        }

        return Result<string, ActionResult<T>>.Ok(userId);
    }
    
    [HttpGet("{channelId:int}/notification-preferences")]
    public async Task<ActionResult<NotificationPreferences>> GetNotificationPreferences(int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) return NotFound("Channel not found");
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) return Forbid();

        UserChannelNotificationPreferences prefs = await users.GetChannelNotificationPreferences(userId, channelId);
        return Ok(prefs.Preferences);
    }

    [HttpPut("{channelId:int}/notification-preferences")]
    public async Task<ActionResult> SetNotificationPreferences(int channelId, [FromBody] SetNotificationPreferencesBody body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();

        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) return NotFound("Channel not found");
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) return Forbid();

        UserChannelNotificationPreferences prefs = await users.GetChannelNotificationPreferences(userId, channelId);
        prefs.UserId = userId;
        prefs.ChannelId = channelId;
        if (body.Notifications.HasValue) prefs.Preferences.Notifications = body.Notifications.Value;
        if (body.Unreads.HasValue) prefs.Preferences.Unreads = body.Unreads.Value;
        await users.SetChannelNotificationPreferences(userId, channelId, prefs);
        return Ok();
    }

    [GeneratedRegex("<@user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>")]
    private static partial Regex UserMentionsMatcher();
}
