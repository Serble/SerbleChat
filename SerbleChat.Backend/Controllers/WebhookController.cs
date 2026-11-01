using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services;

namespace SerbleChat.Backend.Controllers;

/// <summary>
/// Managing a guild's webhooks. Posting through one is <see cref="WebhookExecuteController"/>.
/// Needs Manage Webhooks in the guild, and in the target channel when choosing where it posts.
/// </summary>
[ApiController]
[Route("guild/{guildId:long}/webhooks")]
[Authorize]
public class WebhookController(IWebhookRepo webhooks, IGuildRepo guilds, IChannelRepo channels,
    IImagesService images) : ControllerBase {

    [HttpGet]
    public async Task<ActionResult<IEnumerable<WebhookResponse>>> GetWebhooks(long guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        if (!await CanManage(userId, guildId)) return Forbid();

        Webhook[] list = await webhooks.GetGuildWebhooks(guildId);
        return Ok(list.Select(WebhookResponse.FromWebhook));
    }

    [HttpPost]
    public async Task<ActionResult<WebhookResponse>> CreateWebhook(long guildId, [FromBody] WebhookCreateRequest body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        if (await guilds.GetGuild(guildId) == null) return NotFound("Guild not found");
        if (!await CanManage(userId, guildId)) return Forbid();

        string name = body.Name?.Trim() ?? "";
        if (name.Length == 0 || name.Length > WebhookLimits.NameMaxLength) {
            return BadRequest($"Name must be 1 to {WebhookLimits.NameMaxLength} characters");
        }

        ActionResult? channelError = await CheckTargetChannel(userId, guildId, body.ChannelId);
        if (channelError != null) return channelError;

        if (await webhooks.CountGuildWebhooks(guildId) >= WebhookLimits.MaxPerGuild) {
            return BadRequest($"A guild can have at most {WebhookLimits.MaxPerGuild} webhooks");
        }

        Webhook webhook = new() {
            GuildId = guildId,
            ChannelId = body.ChannelId,
            Name = name,
            Token = GenerateToken(),
            CreatedById = userId,
            CreatedAt = DateTime.UtcNow
        };
        await webhooks.CreateWebhook(webhook);
        return Ok(WebhookResponse.FromWebhook(webhook));
    }

    /// <summary>Rename it or point it at a different channel. The URL stays the same.</summary>
    [HttpPatch("{webhookId:long}")]
    public async Task<ActionResult<WebhookResponse>> UpdateWebhook(long guildId, long webhookId, [FromBody] WebhookUpdateRequest body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        if (!await CanManage(userId, guildId)) return Forbid();

        Webhook? webhook = await webhooks.GetWebhook(webhookId);
        if (webhook == null || webhook.GuildId != guildId) return NotFound("Webhook not found");

        if (body.Name != null) {
            string name = body.Name.Trim();
            if (name.Length == 0 || name.Length > WebhookLimits.NameMaxLength) {
                return BadRequest($"Name must be 1 to {WebhookLimits.NameMaxLength} characters");
            }
            webhook.Name = name;
        }

        if (body.ChannelId != null && body.ChannelId != webhook.ChannelId) {
            ActionResult? channelError = await CheckTargetChannel(userId, guildId, body.ChannelId.Value);
            if (channelError != null) return channelError;
            webhook.ChannelId = body.ChannelId;
        }

        await webhooks.UpdateWebhook(webhook);
        return Ok(WebhookResponse.FromWebhook(webhook));
    }

    /// <summary>Replace the token, so the old URL stops working.</summary>
    [HttpPost("{webhookId:long}/token")]
    public async Task<ActionResult<WebhookResponse>> RegenerateToken(long guildId, long webhookId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        if (!await CanManage(userId, guildId)) return Forbid();

        Webhook? webhook = await webhooks.GetWebhook(webhookId);
        if (webhook == null || webhook.GuildId != guildId) return NotFound("Webhook not found");

        webhook.Token = GenerateToken();
        await webhooks.UpdateWebhook(webhook);
        return Ok(WebhookResponse.FromWebhook(webhook));
    }

    [HttpDelete("{webhookId:long}")]
    public async Task<ActionResult> DeleteWebhook(long guildId, long webhookId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        if (!await CanManage(userId, guildId)) return Forbid();

        Webhook? webhook = await webhooks.GetWebhook(webhookId);
        if (webhook == null || webhook.GuildId != guildId) return NotFound("Webhook not found");

        await webhooks.DeleteWebhook(webhookId);
        if (webhook.HasAvatar) {
            await images.DeleteImage(AvatarKey(webhookId));
        }
        return Ok();
    }

    [HttpPut("{webhookId:long}/avatar")]
    public async Task<ActionResult<WebhookResponse>> SetAvatar(long guildId, long webhookId, IFormFile file) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        if (!await CanManage(userId, guildId)) return Forbid();

        Webhook? webhook = await webhooks.GetWebhook(webhookId);
        if (webhook == null || webhook.GuildId != guildId) return NotFound("Webhook not found");

        if (!images.IsFileValid(file, out string? msg)) {
            return BadRequest(msg);
        }

        await images.UploadImage(file, AvatarKey(webhookId));
        webhook.HasAvatar = true;
        await webhooks.UpdateWebhook(webhook);
        return Ok(WebhookResponse.FromWebhook(webhook));
    }

    [HttpDelete("{webhookId:long}/avatar")]
    public async Task<ActionResult<WebhookResponse>> DeleteAvatar(long guildId, long webhookId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        if (!await CanManage(userId, guildId)) return Forbid();

        Webhook? webhook = await webhooks.GetWebhook(webhookId);
        if (webhook == null || webhook.GuildId != guildId) return NotFound("Webhook not found");

        await images.DeleteImage(AvatarKey(webhookId));
        webhook.HasAvatar = false;
        await webhooks.UpdateWebhook(webhook);
        return Ok(WebhookResponse.FromWebhook(webhook));
    }

    public static string AvatarKey(long webhookId) => $"webhook-avatars/{webhookId}.webp";

    private async Task<bool> CanManage(string userId, long guildId) {
        if (!await guilds.IsGuildMember(guildId, userId)) return false;
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId);
        return perms.HasPerm(p => p.ManageWebhooks);
    }

    /// <summary>
    /// A webhook can only post where its manager could manage webhooks themselves,
    /// so nobody can use one to reach a channel they can't see.
    /// </summary>
    private async Task<ActionResult?> CheckTargetChannel(string userId, long guildId, long channelId) {
        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null || channel.Type != ChannelType.Guild || channel.GuildId != guildId) {
            return BadRequest("That channel isn't in this guild");
        }
        if (!await channels.UserHasAccessToChannel(userId, channel, false, guildPermission: p => p.ManageWebhooks)) {
            return Forbid();
        }
        return null;
    }

    /// <summary>64 URL-safe characters, the same alphabet as Discord tokens.</summary>
    private static string GenerateToken() {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))
            .Replace('+', '-')
            .Replace('/', '_');  // 48 bytes is a multiple of 3, so there's no padding
    }
}
