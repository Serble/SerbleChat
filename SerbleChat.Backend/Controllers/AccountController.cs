using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services;

namespace SerbleChat.Backend.Controllers;

[Route("/account")]
[ApiController]
[Authorize]
public class AccountController(IUserRepo users, IUnreadsRepo unreads, IChannelRepo channels, 
    IPresenceService presence, IImagesService images) : ControllerBase {
    
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

        if (request.NotificationsWhileAway.HasValue) {
            user.NotificationsWhileAway = request.NotificationsWhileAway.Value;
        }

        if (request.WebPushIncludeContent.HasValue) {
            user.WebPushIncludeContent = request.WebPushIncludeContent.Value;
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
        
        return Ok(await users.CompilePublicUserResponse(user));
    }

    [HttpGet("from-username/{username}")]
    public async Task<ActionResult<PublicUserResponse>> GetByUsername(string username) {
        ChatUser? user = await users.GetUserByUsername(username);
        if (user == null) {
            return NotFound("User not found");
        }

        return Ok(await users.CompilePublicUserResponse(user));
    }

    /// <summary>Sets the caller's status type, optional message and optional expiry, replacing any current status.</summary>
    [HttpPut("status")]
    public async Task<ActionResult<OwnStatusUpdate>> SetStatus([FromBody] SetStatusRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        if (!UserStatusNames.TryParse(request.Type, out UserStatusType type)) {
            return BadRequest("Status type must be one of online, away, dnd or invisible");
        }

        string message = UserStatusExtensions.NormaliseStatusMessage(request.Message);
        if (message.Length > UserStatusExtensions.MaxMessageLength) {
            return BadRequest($"Status message can be at most {UserStatusExtensions.MaxMessageLength} characters");
        }

        DateTime? expiresAt = request.ExpiresAt?.ToUniversalTime();
        if (expiresAt.HasValue && expiresAt.Value <= DateTime.UtcNow) {
            return BadRequest("Status expiry must be in the future");
        }

        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }

        user.StatusType = type;
        user.StatusMessage = message;
        // An Online status with no message is the default, so there's nothing to expire
        user.StatusExpiresAt = type == UserStatusType.Online && message.Length == 0 ? null : expiresAt;
        await users.UpdateUser(user);
        await presence.BroadcastStatus(user);
        return Ok(OwnStatusUpdate.From(user));
    }

    /// <summary>Resets the caller's status to Online with no message.</summary>
    [HttpDelete("status")]
    public async Task<ActionResult<OwnStatusUpdate>> ClearStatus() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }

        user.ClearStatus();
        await users.UpdateUser(user);
        await presence.BroadcastStatus(user);
        return Ok(OwnStatusUpdate.From(user));
    }

    /// <summary>
    /// Called by the user's client when its status's expiry passes. Clears the status only if it
    /// really has expired, so a tab with an old timer can't wipe a status set since in another tab.
    /// The broadcast matters for Invisible, which other clients can't time out themselves.
    /// </summary>
    [HttpPost("status/expire")]
    public async Task<ActionResult<OwnStatusUpdate>> ExpireStatus() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }

        if (user.StatusExpired()) {
            user.ClearStatus();
            await users.UpdateUser(user);
            await presence.BroadcastStatus(user);
        }
        return Ok(OwnStatusUpdate.From(user));
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
        return Ok(await users.CompilePublicUserResponses(blocks.Select(b => b.BlockedUserNavigation).ToArray()));
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

        Dictionary<long, Channel> channelData = (await channels.GetChannelsVisibleToUser(userId)).ToDictionary(c => c.Id);
        Dictionary<long, UserChannelNotificationPreferences> channelPrefs = await users.GetAllChannelNotificationPreferences(userId);
        Dictionary<long, UserGuildNotificationPreferences> guildPrefs = await users.GetAllUserGuildNotificationPreferences(userId);
        Dictionary<long, int> msgUnreadCounts = await unreads.GetChannelUnreadMessagesCounts(userId);
        Dictionary<long, int> mentionUnreadCounts = await unreads.GetChannelUnreadMentionsCounts(userId);
        Dictionary<long, int> response = new();
        foreach (int channelId in msgUnreadCounts.Keys.Union(mentionUnreadCounts.Keys)) {
            Channel channel = channelData[channelId];
            
            int msgCount = msgUnreadCounts.GetValueOrDefault(channelId, 0);
            int mentionCount = mentionUnreadCounts.GetValueOrDefault(channelId, 0);
            NotificationPreferences pref = channelPrefs.TryGetValue(channelId, out UserChannelNotificationPreferences? o) 
                ? o.Preferences
                : NotificationPreferences.DefaultPreferences;
            
            long? guildId = channel.GuildId;
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

    /// <summary>Registers a Web Push endpoint, or refreshes it if it's already registered.</summary>
    [HttpPost("web-push-subscription")]
    public async Task<ActionResult> AddWebPushSubscription([FromBody] WebNotificationHookAddRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        PushSubscriptionKind? kind = request.Kind?.ToLowerInvariant() switch {
            null or "" or "browser" => PushSubscriptionKind.Browser,
            "unifiedpush" => PushSubscriptionKind.UnifiedPush,
            _ => null
        };
        if (kind == null) {
            return BadRequest("kind must be 'browser' or 'unifiedpush'");
        }

        string userAgent = Request.Headers.UserAgent.FirstOrDefault("") ?? "";
        UserWebNotificationHook subscription = new() {
            UserId = userId,
            Url = request.Url,
            P256dh = request.P256dh,
            Auth = request.Auth,
            UserAgent = userAgent.Length > 255 ? userAgent[..255] : userAgent,
            Kind = kind.Value,
            CreatedAt = DateTime.UtcNow
        };
        await users.UpsertWebNotificationSubscription(subscription);
        return Ok();
    }

    /// <summary>Unregisters a Web Push endpoint, e.g. when the user turns notifications off or logs out.</summary>
    [HttpDelete("web-push-subscription")]
    public async Task<ActionResult> RemoveWebPushSubscription([FromBody] WebNotificationHookRemoveRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        return await users.DeleteWebNotificationSubscription(userId, request.Url) ? Ok() : NotFound();
    }
    
    [HttpPut("pfp")]
    public async Task<IActionResult> UploadProfilePicture(IFormFile file) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        if (!images.IsFileValid(file, out string? msg)) {
            return BadRequest(msg);
        }

        await images.UploadImage(file, $"pfp/{userId}.webp");
        return Ok();
    }

    [HttpDelete("pfp")]
    public async Task<IActionResult> DeleteProfilePicture() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        await images.DeleteImage($"pfp/{userId}.webp");
        return Ok();
    }
}
