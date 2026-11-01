using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services.Ntfy;

namespace SerbleChat.Backend.Controllers;

[Route("/account/ntfy")]
[ApiController]
[Authorize]
public partial class NtfyController(IUserRepo users, INtfyClient ntfy, IOptions<NtfySettings> settings) : ControllerBase {

    [HttpGet]
    public async Task<ActionResult<NtfySubscriptionResponse[]>> List() {
        if (!TryGetUserId(out string userId)) return Unauthorized();
        UserNtfySubscription[] subs = await users.GetNtfySubscriptions(userId);
        return Ok(subs.Select(NtfySubscriptionResponse.From));
    }

    [HttpPost]
    public async Task<ActionResult<NtfySubscriptionResponse>> Create([FromBody] NtfySubscriptionCreateRequest request) {
        if (!TryGetUserId(out string userId)) return Unauthorized();

        if (await users.CountNtfySubscriptions(userId) >= settings.Value.MaxSubscriptionsPerUser) {
            return BadRequest($"You can have at most {settings.Value.MaxSubscriptionsPerUser} ntfy topics.");
        }

        string? error = await Validate(request.ServerUrl, request.Topic);
        if (error != null) return BadRequest(error);

        UserNtfySubscription sub = new() {
            UserId = userId,
            ServerUrl = NormaliseServerUrl(request.ServerUrl),
            Topic = request.Topic.Trim(),
            AccessToken = string.IsNullOrWhiteSpace(request.AccessToken) ? null : request.AccessToken.Trim(),
            IncludeContent = request.IncludeContent,
            Enabled = true,
            CreatedAt = DateTime.UtcNow
        };
        await users.CreateNtfySubscription(sub);
        return Ok(NtfySubscriptionResponse.From(sub));
    }

    [HttpPatch("{id:long}")]
    public async Task<ActionResult<NtfySubscriptionResponse>> Update(long id, [FromBody] NtfySubscriptionUpdateRequest request) {
        if (!TryGetUserId(out string userId)) return Unauthorized();
        UserNtfySubscription? sub = await users.GetNtfySubscription(userId, id);
        if (sub == null) return NotFound();

        bool destinationChanged = false;
        if (request.ServerUrl != null || request.Topic != null) {
            string server = request.ServerUrl ?? sub.ServerUrl;
            string topic = request.Topic ?? sub.Topic;
            string? error = await Validate(server, topic);
            if (error != null) return BadRequest(error);
            sub.ServerUrl = NormaliseServerUrl(server);
            sub.Topic = topic.Trim();
            destinationChanged = true;
        }

        if (request.AccessToken != null) {
            sub.AccessToken = string.IsNullOrWhiteSpace(request.AccessToken) ? null : request.AccessToken.Trim();
            destinationChanged = true;
        }

        if (request.IncludeContent.HasValue) {
            sub.IncludeContent = request.IncludeContent.Value;
        }

        if (request.Enabled.HasValue) {
            sub.Enabled = request.Enabled.Value;
        }

        // Fixing the destination or turning it back on gives it a clean slate.
        if (destinationChanged || request.Enabled == true) {
            sub.ConsecutiveFailures = 0;
            if (destinationChanged) sub.Enabled = request.Enabled ?? true;
        }

        await users.UpdateNtfySubscription(sub);
        return Ok(NtfySubscriptionResponse.From(sub));
    }

    [HttpDelete("{id:long}")]
    public async Task<ActionResult> Delete(long id) {
        if (!TryGetUserId(out string userId)) return Unauthorized();
        UserNtfySubscription? sub = await users.GetNtfySubscription(userId, id);
        if (sub == null) return NotFound();
        await users.DeleteNtfySubscription(sub);
        return Ok();
    }

    /// <summary>Sends a test notification and records the outcome like a normal delivery would.</summary>
    [HttpPost("{id:long}/test")]
    public async Task<ActionResult<NtfyTestResponse>> Test(long id) {
        if (!TryGetUserId(out string userId)) return Unauthorized();
        UserNtfySubscription? sub = await users.GetNtfySubscription(userId, id);
        if (sub == null) return NotFound();

        NtfyPublishResult result = await ntfy.Publish(sub, new NtfyNotification(
            "Serble Chat", "Test notification: ntfy notifications are working.", Tags: ["white_check_mark"]),
            HttpContext.RequestAborted);

        if (result.Success) {
            // a passing test also re-enables a subscription that was switched off after failures
            sub.Enabled = true;
            sub.ConsecutiveFailures = 0;
            sub.LastSuccessAt = DateTime.UtcNow;
            await users.UpdateNtfySubscription(sub);
        }
        else {
            await users.RecordNtfyDeliveryResults([], [new NtfyDeliveryFailure(sub.Id, result.Outcome, result.Error ?? "")],
                settings.Value.DisableAfterFailures);
        }

        return Ok(new NtfyTestResponse(result.Success, result.Error));
    }

    private async Task<string?> Validate(string serverUrl, string topic) {
        if (!TopicMatcher().IsMatch(topic.Trim())) {
            return "Topics can only contain letters, numbers, - and _, up to 64 characters.";
        }

        if (!Uri.TryCreate(serverUrl.Trim(), UriKind.Absolute, out Uri? uri) || uri.Scheme is not ("https" or "http")) {
            return "The server must be an http:// or https:// URL.";
        }
        if (!string.IsNullOrEmpty(uri.UserInfo)) {
            return "Put credentials in the access token field, not the URL.";
        }
        if (!string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) {
            return "The server URL can't have a query string or fragment.";
        }

        return await ntfy.CheckServerAddress(uri, HttpContext.RequestAborted);
    }

    /// <summary>Lower-cases the host and makes sure the path ends with a slash, since ntfy's JSON API is at the server root.</summary>
    private static string NormaliseServerUrl(string serverUrl) {
        Uri uri = new(serverUrl.Trim());
        UriBuilder builder = new(uri) { Host = uri.Host.ToLowerInvariant() };
        if (!builder.Path.EndsWith('/')) builder.Path += "/";
        return builder.Uri.AbsoluteUri;
    }

    private bool TryGetUserId(out string userId) {
        userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
        return userId != "";
    }

    // ntfy's own topic rule
    [GeneratedRegex("^[-_A-Za-z0-9]{1,64}$")]
    private static partial Regex TopicMatcher();
}
