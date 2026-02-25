using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using StackExchange.Redis;

namespace SerbleChat.Backend.Controllers;

[Route("/account")]
[ApiController]
[Authorize]
public class AccountController(IUserRepo users, IUnreadsRepo unreads, IChannelRepo channels, IConnectionMultiplexer redis) : ControllerBase {
    
    [HttpGet]
    public async Task<ActionResult<UserAccountResponse>> Get() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }
        
        return Ok(UserAccountResponse.FromChatUser(user));
    }
    
    [HttpPatch]
    public async Task<ActionResult> Patch([FromBody] UserAccountUpdateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }
        
        if (request.DefaultDmNotificationPreferences != null) {
            user.DefaultDmNotificationPreferences = request.DefaultDmNotificationPreferences;
        }
        
        if (request.DefaultGuildNotificationPreferences != null) {
            user.DefaultGuildNotificationPreferences = request.DefaultGuildNotificationPreferences;
        }

        if (request.DefaultGroupNotificationPreferences != null) {
            user.DefaultGroupNotificationPreferences = request.DefaultGroupNotificationPreferences;
        }
        
        if (request.NotificationsWhileOnline.HasValue) {
            user.NotificationsWhileOnline = request.NotificationsWhileOnline.Value;
        }

        if (request.Blurb != null) {
            user.Blurb = request.Blurb;
        }
        
        if (request.Color != null) {
            user.Color = request.Color;
        }

        await users.UpdateUser(user);
        return Ok();
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<PublicUserResponse>> GetPublic(string id) {
        ChatUser? user = await users.GetUserById(id);
        if (user == null) {
            return NotFound("User not found");
        }
        
        RedisValue result = await redis.GetDatabase().StringGetAsync("status:" + id);
        return Ok(PublicUserResponse.FromChatUser(user, result.HasValue));
    }

    [HttpGet("from-username/{username}")]
    public async Task<ActionResult<PublicUserResponse>> GetByUsername(string username) {
        ChatUser? user = await users.GetUserByUsername(username);
        if (user == null) {
            return NotFound("User not found");
        }

        RedisValue result = await redis.GetDatabase().StringGetAsync("status:" + user.Id);
        return Ok(PublicUserResponse.FromChatUser(user, result.HasValue));
    }
    
    [HttpPost("blocks/{id}")]
    public async Task<ActionResult> BlockUser(string id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        if (userId == id) {
            return BadRequest("Cannot block yourself");
        }
        
        ChatUser? userToBlock = await users.GetUserById(id);
        if (userToBlock == null) {
            return NotFound("User to block not found");
        }
        
        await users.BlockUser(userId, id);
        return Ok();
    }

    [HttpDelete("blocks/{id}")]
    public async Task<ActionResult> UnblockUser(string id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        if (userId == id) {
            return BadRequest("Cannot unblock yourself");
        }
        
        ChatUser? userToUnblock = await users.GetUserById(id);
        if (userToUnblock == null) {
            return NotFound("User to unblock not found");
        }
        
        await users.UnblockUser(userId, id);
        return Ok();
    }

    [HttpGet("blocks")]
    public async Task<ActionResult<PublicUserResponse[]>> GetBlockedUsers() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        UserBlock[] blocks = await users.GetBlockedUsers(userId);
        PublicUserResponse[] response = new PublicUserResponse[blocks.Length];
        for (int i = 0; i < blocks.Length; i++) {
            response[i] = await users.CompilePublicUserResponse(blocks[i].BlockedUserNavigation);
        }
        
        return Ok(response);
    }

    [HttpGet("client-options")]
    public async Task<ActionResult<string>> GetClientOptions() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        string options = await users.GetClientOptions(userId);
        return Ok(options);
    }
    
    [HttpPut("client-options")]
    public async Task<ActionResult> SetClientOptions([FromBody] string options) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        await users.SetClientOptions(userId, options);
        return Ok();
    }
    
    [HttpGet("unreads")]
    public async Task<ActionResult<Dictionary<int, int>>> GetUnreadCounts() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }

        Dictionary<int, Channel> channelData = (await channels.GetChannelsVisibleToUser(userId)).ToDictionary(c => c.Id);
        Dictionary<int, UserChannelNotificationPreferences> channelPrefs = await users.GetAllChannelNotificationPreferences(userId);
        Dictionary<int, UserGuildNotificationPreferences> guildPrefs = await users.GetAllUserGuildNotificationPreferences(userId);
        Dictionary<int, int> msgUnreadCounts = await unreads.GetChannelUnreadMessagesCounts(userId);
        Dictionary<int, int> mentionUnreadCounts = await unreads.GetChannelUnreadMentionsCounts(userId);
        Dictionary<int, int> response = new();
        foreach (int channelId in msgUnreadCounts.Keys.Union(mentionUnreadCounts.Keys)) {
            Channel channel = channelData[channelId];
            
            int msgCount = msgUnreadCounts.GetValueOrDefault(channelId, 0);
            int mentionCount = mentionUnreadCounts.GetValueOrDefault(channelId, 0);
            NotificationPreferences pref = channelPrefs.TryGetValue(channelId, out UserChannelNotificationPreferences? o) 
                ? o.Preferences
                : NotificationPreferences.DefaultPreferences;
            
            int? guildId = channel.GuildId;
            NotificationPreferences guildPref = guildId == null 
                ? NotificationPreferences.DefaultPreferences 
                : guildPrefs.TryGetValue(guildId.Value, out UserGuildNotificationPreferences? g) 
                    ? g.Preferences
                    : NotificationPreferences.DefaultPreferences;

            NotificationPreferences userPref = channel.Type switch {
                ChannelType.Guild => user.DefaultGuildNotificationPreferences,
                ChannelType.Dm => user.DefaultDmNotificationPreferences,
                ChannelType.Group => user.DefaultGroupNotificationPreferences,
                _ => throw new ArgumentOutOfRangeException()
            };

            // apply overrides from most important to least important: channel > guild > user
            pref = pref.ApplyOverride(guildPref);
            pref = pref.ApplyOverride(userPref);
            
            response.Add(channelId, pref.Unreads switch {
                NotificationPreference.AllMessages => msgCount,
                NotificationPreference.MentionsOnly => mentionCount,
                NotificationPreference.Nothing => 0,
                _ => throw new ArgumentOutOfRangeException()
            });
        }
        
        return Ok(response);
    }

    [HttpPost("web-push-subscription")]
    public async Task<ActionResult> AddWebPushSubscription([FromBody] WebNotificationHookAddRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        UserWebNotificationHook subscription = new() {
            UserId = userId,
            Url = request.Url,
            P256dh = request.P256dh,
            Auth = request.Auth,
            UserAgent = Request.Headers.UserAgent.FirstOrDefault("") ?? "",
            CreatedAt = DateTime.UtcNow
        };
        await users.CreateWebNotificationSubscription(subscription);
        return Ok();
    }
}
