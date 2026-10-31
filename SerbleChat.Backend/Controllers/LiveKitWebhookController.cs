using Livekit.Server.Sdk.Dotnet;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Services;

namespace SerbleChat.Backend.Controllers;

[ApiController]
[Route("livekit/webhook")]
public class LiveKitWebhookController(IVoiceManager voiceManager, IOptions<LiveKitSettings> liveKitSettings) : ControllerBase {

    [HttpPost]
    public async Task<IActionResult> HandleWebhook() {
        using StreamReader reader = new(Request.Body);
        string body = await reader.ReadToEndAsync();

        LiveKitSettings settings = liveKitSettings.Value;
        // env vars can't be null, so treat empty as unset too
        bool hasWebhookKey = !string.IsNullOrEmpty(settings.WebhookKey);
        WebhookReceiver receiver = hasWebhookKey
            ? new WebhookReceiver(settings.WebhookKey!, settings.WebhookSecret!)
            : new WebhookReceiver(settings.Key, settings.Secret);
        WebhookEvent ev;
        try {
            // ignore unknown fields so a newer shared LiveKit server doesn't break us
            ev = receiver.Receive(body, HttpContext.Request.Headers.Authorization.FirstOrDefault(), ignoreUnknownFields: true);
        }
        catch (Exception) {
            // bad signature/checksum, the SDK only throws plain Exceptions
            return Unauthorized();
        }

        await voiceManager.OnWebhook(ev);
        return Ok();
    }
}
