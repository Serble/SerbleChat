using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services;
using SerbleChat.Backend.Services.Net;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;

namespace SerbleChat.Backend.Controllers;

[Route("/account")]
[ApiController]
[Authorize]
public class AccountController(IUserRepo users, IUnreadsRepo unreads, IChannelRepo channels, 
    IPresenceService presence, IImagesService images, IOptions<PushNotificationsSettings> pushSettings,
    IOptions<NotificationSettings> notificationSettings) : ControllerBase {
    
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

        bool profileChanged = false;
        if (request.Blurb != null && request.Blurb != user.Blurb) {
            user.Blurb = request.Blurb;
            profileChanged = true;
        }
        
        if (request.Color != null && request.Color != user.Color) {
            user.Color = request.Color;
            profileChanged = true;
        }

        await users.UpdateUser(user);
        if (profileChanged) {
            await presence.BroadcastProfile(user);
        }
        return Ok();
    }

    /// <summary>The most users <see cref="GetMany"/> returns at once.</summary>
    public const int MaxBatchUsers = 500;

    /// <summary>
    /// Many users' public profiles in one request, for clients refreshing everyone they have cached (e.g. after
    /// being offline, when they may have missed <c>UserUpdated</c> and <c>UserStatusUpdated</c> events).
    /// Unknown IDs are left out.
    /// </summary>
    [HttpPost("batch")]
    public async Task<ActionResult<PublicUserResponse[]>> GetMany([FromBody] UserBatchRequest request) {
        if (request.Ids == null! || request.Ids.Length == 0) {
            return Ok(Array.Empty<PublicUserResponse>());
        }
        if (request.Ids.Length > MaxBatchUsers) {
            return BadRequest($"At most {MaxBatchUsers} users at a time");
        }
        ChatUser[] found = await users.GetUsersByIds(request.Ids);
        return Ok(await users.CompilePublicUserResponses(found));
    }

    /// <summary>
    /// The newest message ID in every channel the caller can see (channels with no messages are left out).
    /// Lets a client that was away tell which of its cached conversations moved on, and order its lists, without
    /// fetching each one.
    /// </summary>
    [HttpGet("channel-activity")]
    public async Task<ActionResult<Dictionary<long, long>>> GetChannelActivity() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        List<long> visible = (await channels.GetChannelsVisibleToUser(userId)).Select(c => c.Id).ToList();
        return Ok(await unreads.GetLatestMessageIds(visible));
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
    public async Task<ActionResult<Dictionary<long, int>>> GetUnreadCounts() {
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
        Dictionary<long, int> msgUnreadCounts = await unreads.GetChannelUnreadMessagesCounts(userId, channelData.Keys);
        Dictionary<long, int> mentionUnreadCounts = await unreads.GetChannelUnreadMentionsCounts(userId);
        Dictionary<long, int> response = new();
        foreach (long channelId in msgUnreadCounts.Keys.Union(mentionUnreadCounts.Keys)) {
            // Mentions can be in channels the user can no longer see (left the guild, lost access)
            if (!channelData.TryGetValue(channelId, out Channel? channel)) continue;
            
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

        if (!ValidPushKeys(request.P256dh, request.Auth)) {
            return BadRequest("p256dh must be an uncompressed P-256 public key and auth 16 bytes, both base64url.");
        }

        // We'll be sending requests to this URL, so it has to be a real push service on the public internet
        string? urlError = await SafeHttp.CheckUrl(request.Url, pushSettings.Value.AllowPrivateEndpoints, 1024, HttpContext.RequestAborted);
        if (urlError != null) {
            return BadRequest(urlError);
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
        await users.UpsertWebNotificationSubscription(subscription, notificationSettings.Value.MaxEndpointsPerUser);
        return Ok();
    }

    /// <summary>
    /// A browser replaced its push subscription (the service worker's <c>pushsubscriptionchange</c>). The service
    /// worker has no login token, so the old endpoint URL is the proof: only the push service, that browser and we
    /// know it.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("web-push-subscription/rotate")]
    public async Task<ActionResult> RotateWebPushSubscription([FromBody] WebNotificationHookRotateRequest request) {
        if (!ValidPushKeys(request.P256dh, request.Auth)) {
            return BadRequest("p256dh must be an uncompressed P-256 public key and auth 16 bytes, both base64url.");
        }
        string? urlError = await SafeHttp.CheckUrl(request.Url, pushSettings.Value.AllowPrivateEndpoints, 1024, HttpContext.RequestAborted);
        if (urlError != null) {
            return BadRequest(urlError);
        }
        return await users.ReplaceWebNotificationSubscriptionUrl(request.OldUrl, request.Url, request.P256dh, request.Auth)
            ? Ok()
            : NotFound();
    }

    /// <summary>Keys we couldn't encrypt to would fail every delivery, so turn them away at the door.</summary>
    private static bool ValidPushKeys(string p256dh, string auth) {
        static byte[]? FromBase64Url(string s) {
            try {
                string b64 = s.Trim().TrimEnd('=').Replace('-', '+').Replace('_', '/');
                return Convert.FromBase64String(b64.PadRight(b64.Length + (4 - b64.Length % 4) % 4, '='));
            }
            catch (FormatException) {
                return null;
            }
        }
        byte[]? key = FromBase64Url(p256dh);
        byte[]? secret = FromBase64Url(auth);
        return key is { Length: 65 } && key[0] == 0x04 && secret is { Length: 16 };
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

        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }

        long version = await images.UploadImage(file, $"pfp/{userId}.webp");
        await users.SetAvatarVersion(user, version);
        await presence.BroadcastProfile(user);
        return Ok(new { AvatarVersion = version });
    }

    [HttpDelete("pfp")]
    public async Task<IActionResult> DeleteProfilePicture() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        ChatUser? user = await users.GetUserById(userId);
        if (user == null) {
            return NotFound("User not found in local database");
        }

        await images.DeleteImage($"pfp/{userId}.webp");
        await users.SetAvatarVersion(user, 0);
        await presence.BroadcastProfile(user);
        return Ok();
    }
}
