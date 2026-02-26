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

        WebhookReceiver receiver = new(liveKitSettings.Value.Key, liveKitSettings.Value.Secret);
        WebhookEvent ev = receiver.Receive(body, HttpContext.Request.Headers.Authorization.FirstOrDefault());
        
        await voiceManager.OnWebhook(ev);
        return Ok();
    }
}
