using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services;
using SerbleChat.Backend.Services.Webhooks;

namespace SerbleChat.Backend.Controllers;

/// <summary>
/// The public side of webhooks, shaped like Discord's API so existing integrations can post here.
/// The token in the URL is the only credential. Webhooks post wherever they're pointed,
/// whatever the channel's permissions say (the person who pointed it there was checked).
/// </summary>
/// <remarks>
/// Served at <c>/webhooks/…</c>, <c>/api/webhooks/…</c> and <c>/api/v{n}/webhooks/…</c>,
/// so both pasted URLs and libraries given a custom Discord API base work.
/// Like Discord, <c>…/slack</c> takes Slack's format and <c>…/github</c> takes GitHub's events.
/// Bodies are read by hand rather than model-bound, because senders are sloppy about content
/// types: JSON, form fields and multipart (<c>payload_json</c>) are all accepted on every route.
/// </remarks>
[ApiController]
[AllowAnonymous]
[Route("webhooks/{webhookId:long}/{token}")]
[Route("api/webhooks/{webhookId:long}/{token}")]
[Route("api/v{version:int}/webhooks/{webhookId:long}/{token}")]
public class WebhookExecuteController(IWebhookRepo webhooks, IChannelRepo channels, IMessageSender sender) : ControllerBase {

    /// <summary>Discord's "Execute Webhook". 204 by default, or the created message with <c>?wait=true</c>.</summary>
    [HttpPost]
    public async Task<ActionResult> Execute(long webhookId, string token, [FromQuery] string? wait = null) {
        (Webhook? webhook, Channel? channel, ActionResult? error) = await Resolve(webhookId, token);
        if (error != null) return error;

        (JsonElement? body, int files, ActionResult? bodyError) = await ReadBody("payload_json");
        if (bodyError != null) return bodyError;

        WebhookPost post = body == null
            ? new WebhookPost(null, [], null, null)
            : DiscordPayload.Parse(body.Value);
        if (post.Content?.Length > MessageLimits.ContentMaxLength) {
            return BadRequest(new DiscordError(50035, $"content: Must be {MessageLimits.ContentMaxLength} or fewer in length."));
        }

        ActionResult<Message> result = await Post(webhook!, channel!, post, files);
        if (result.Result != null) return result.Result;
        return wait is "true" or "1" or "True" ? Ok(ToDiscordMessage(result.Value!, webhook!)) : NoContent();
    }

    /// <summary>Slack's incoming webhook format. Answers with Slack's plain <c>ok</c>.</summary>
    [HttpPost("slack")]
    public async Task<ActionResult> ExecuteSlack(long webhookId, string token) {
        (Webhook? webhook, Channel? channel, ActionResult? error) = await Resolve(webhookId, token);
        if (error != null) return error;

        // Old Slack integrations send the JSON as a form field called "payload"
        (JsonElement? body, int files, ActionResult? bodyError) = await ReadBody("payload");
        if (bodyError != null) return bodyError;

        WebhookPost post = body == null
            ? new WebhookPost(null, [], null, null)
            : SlackPayload.Parse(body.Value);
        ActionResult<Message> result = await Post(webhook!, channel!, post, files);
        return result.Result ?? Content("ok", "text/plain");
    }

    /// <summary>
    /// GitHub repository webhooks (set the content type to either JSON or form). Events we don't
    /// show, like <c>ping</c>, are accepted and ignored so GitHub doesn't flag the hook as failing.
    /// </summary>
    [HttpPost("github")]
    public async Task<ActionResult> ExecuteGitHub(long webhookId, string token) {
        (Webhook? webhook, Channel? channel, ActionResult? error) = await Resolve(webhookId, token);
        if (error != null) return error;

        (JsonElement? body, _, ActionResult? bodyError) = await ReadBody("payload");
        if (bodyError != null) return bodyError;

        string eventName = Request.Headers["X-GitHub-Event"].ToString();
        RichEmbed? embed = body == null ? null : GitHubEvents.Format(eventName, body.Value);
        if (embed == null) {
            return NoContent();
        }

        ActionResult<Message> result = await Post(webhook!, channel!, new WebhookPost(null, [embed], null, null), 0);
        return result.Result ?? NoContent();
    }

    /// <summary>Discord's "Get Webhook with Token". Some tools call it to check a URL before saving it.</summary>
    [HttpGet]
    public async Task<ActionResult> GetWebhook(long webhookId, string token) {
        Webhook? webhook = await webhooks.GetWebhook(webhookId);
        if (webhook == null) return NotFound(DiscordError.UnknownWebhook);
        if (!TokenMatches(webhook.Token, token)) return Unauthorized(DiscordError.InvalidToken);

        return Ok(new Dictionary<string, object?> {
            ["type"] = 1,
            ["id"] = webhook.Id.ToString(),
            ["name"] = webhook.Name,
            ["avatar"] = null,
            ["channel_id"] = webhook.ChannelId?.ToString(),
            ["guild_id"] = webhook.GuildId?.ToString(),
            ["application_id"] = null,
            ["token"] = webhook.Token,
            ["url"] = $"{Request.Scheme}://{Request.Host}{Request.PathBase}/webhooks/{webhook.Id}/{webhook.Token}"
        });
    }

    private async Task<(Webhook?, Channel?, ActionResult?)> Resolve(long webhookId, string token) {
        Webhook? webhook = await webhooks.GetWebhook(webhookId);
        if (webhook == null) {
            return (null, null, NotFound(DiscordError.UnknownWebhook));
        }
        if (!TokenMatches(webhook.Token, token)) {
            return (null, null, Unauthorized(DiscordError.InvalidToken));
        }

        Channel? channel = webhook.ChannelId == null ? null : await channels.GetChannel(webhook.ChannelId.Value);
        if (channel == null) {
            return (null, null, NotFound(DiscordError.UnknownChannel));  // its channel was deleted and no new one was picked
        }
        return (webhook, channel, null);
    }

    /// <summary>
    /// The request's JSON payload, from a raw body (whatever the content type claims), a form field
    /// named <paramref name="formField"/>, or plain form fields. Also counts attached files.
    /// </summary>
    private async Task<(JsonElement? Body, int Files, ActionResult? Error)> ReadBody(string formField) {
        string? json;
        int files = 0;

        if (Request.HasFormContentType) {
            IFormCollection form = await Request.ReadFormAsync();
            files = form.Files.Count;
            if (form.TryGetValue(formField, out var payload)) {
                json = payload.ToString();
            }
            else {
                // Plain fields, e.g. curl -F content=hi or a urlencoded body
                Dictionary<string, string> fields = form.ToDictionary(f => f.Key, f => f.Value.ToString());
                json = fields.Count == 0 ? null : JsonSerializer.Serialize(fields);
            }
        }
        else {
            using StreamReader reader = new(Request.Body, Encoding.UTF8);
            json = await reader.ReadToEndAsync();
        }

        if (string.IsNullOrWhiteSpace(json)) {
            return (null, files, null);
        }
        try {
            using JsonDocument doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) {
                return (null, files, BadRequest(DiscordError.InvalidJson));
            }
            return (doc.RootElement.Clone(), files, null);
        }
        catch (JsonException) {
            return (null, files, BadRequest(DiscordError.InvalidJson));
        }
    }

    /// <summary>Validates the overrides and posts the message. Returns the message, or the error to send back.</summary>
    private async Task<ActionResult<Message>> Post(Webhook webhook, Channel channel, WebhookPost post, int droppedFiles) {
        string content = RichEmbed.Compose(post.Content, post.Embeds, droppedFiles, MessageLimits.ContentMaxLength);
        if (string.IsNullOrWhiteSpace(content)) {
            return BadRequest(DiscordError.EmptyMessage);
        }

        string username = webhook.Name;
        if (post.Username != null) {
            string trimmed = post.Username.Trim();
            if (trimmed.Length > WebhookLimits.NameMaxLength) {
                return BadRequest(new DiscordError(50035, $"username: Must be between 1 and {WebhookLimits.NameMaxLength} in length."));
            }
            if (trimmed.Length > 0) username = trimmed;
        }

        string? avatarUrl = null;
        if (!string.IsNullOrWhiteSpace(post.AvatarUrl)) {
            avatarUrl = post.AvatarUrl.Trim();
            if (avatarUrl.Length > WebhookLimits.AvatarUrlMaxLength || !RichEmbed.IsHttpUrl(avatarUrl)) {
                return BadRequest(new DiscordError(50035, "avatar_url: Not a well formed URL."));
            }
        }

        Message msg = new() {
            AuthorId = null,
            WebhookId = webhook.Id,
            WebhookUsername = username,
            WebhookAvatarUrl = avatarUrl,
            ChannelId = channel.Id,
            Content = content,
            CreatedAt = DateTime.UtcNow
        };
        await sender.Send(channel, msg);
        return msg;
    }

    private static bool TokenMatches(string expected, string given) {
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(given));
    }

    /// <summary>The subset of Discord's message object that clients of this endpoint look at.</summary>
    private static object ToDiscordMessage(Message msg, Webhook webhook) {
        string webhookId = webhook.Id.ToString();
        return new Dictionary<string, object?> {
            ["id"] = msg.Id.ToString(),
            ["type"] = 0,
            ["channel_id"] = msg.ChannelId.ToString(),
            ["author"] = new Dictionary<string, object?> {
                ["id"] = webhookId,
                ["username"] = msg.WebhookUsername,
                ["avatar"] = null,
                ["discriminator"] = "0000",
                ["bot"] = true
            },
            ["content"] = msg.Content,
            ["timestamp"] = new DateTimeOffset(DateTime.SpecifyKind(msg.CreatedAt, DateTimeKind.Utc)).ToString("yyyy-MM-ddTHH:mm:ss.ffffffzzz"),
            ["edited_timestamp"] = null,
            ["tts"] = false,
            ["mention_everyone"] = false,
            ["mentions"] = Array.Empty<object>(),
            ["mention_roles"] = Array.Empty<object>(),
            ["attachments"] = Array.Empty<object>(),
            ["embeds"] = Array.Empty<object>(),
            ["pinned"] = false,
            ["flags"] = 0,
            ["webhook_id"] = webhookId
        };
    }
}
