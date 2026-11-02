using System.Diagnostics;
using System.Net;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Services.Net;

namespace SerbleChat.Backend.Services.Notifications;

public enum SendStatus {
    Success,
    /// <summary>Worth retrying: network trouble, timeouts, rate limits, server errors.</summary>
    Transient,
    /// <summary>Won't work by retrying this message (4xx).</summary>
    Permanent,
    /// <summary>The push service says the subscription no longer exists (404, 410).</summary>
    Gone
}

public record SendResult(SendStatus Status, int? StatusCode, string? Error, TimeSpan Duration, TimeSpan? RetryAfter = null);

/// <summary>Sends Web Push messages (browsers and UnifiedPush) for the notification pipeline.</summary>
public class WebPushSender {
    public const string HttpClientName = "webpush";

    private readonly IHttpClientFactory _clients;
    private readonly VapidAuthentication _vapid;

    public WebPushSender(IHttpClientFactory clients, IOptions<PushNotificationsSettings> settings, IVapidTokenCache tokenCache) {
        _clients = clients;
        _vapid = new VapidAuthentication(settings.Value.VapidPublicKey, settings.Value.VapidPrivateKey) {
            Subject = settings.Value.Subject,
            TokenCache = tokenCache
        };
    }

    public async Task<SendResult> Send(string endpoint, string p256dh, string auth, string payload, bool highUrgency,
        string? topic, TimeSpan timeToLive, CancellationToken token) {
        PushServiceClient client = new(_clients.CreateClient(HttpClientName)) {
            DefaultAuthentication = _vapid,
            AutoRetryAfter = false  // retries go through the queue, so a 429 never holds a worker
        };
        PushSubscription subscription = new() {
            Endpoint = endpoint,
            Keys = new Dictionary<string, string> { ["p256dh"] = p256dh, ["auth"] = auth }
        };
        PushMessage message = new(payload) {
            Urgency = highUrgency ? PushMessageUrgency.High : PushMessageUrgency.Normal,
            Topic = topic,
            TimeToLive = (int)Math.Max(60, timeToLive.TotalSeconds)
        };

        Stopwatch watch = Stopwatch.StartNew();
        try {
            await client.RequestPushMessageDeliveryAsync(subscription, message, token);
            return new SendResult(SendStatus.Success, 201, null, watch.Elapsed);
        }
        catch (PushServiceClientException e) {
            int code = (int)e.StatusCode;
            string error = $"{code} {e.Message}".Trim();
            SendStatus status = e.StatusCode switch {
                HttpStatusCode.NotFound or HttpStatusCode.Gone => SendStatus.Gone,
                HttpStatusCode.TooManyRequests or HttpStatusCode.RequestTimeout => SendStatus.Transient,
                >= HttpStatusCode.InternalServerError => SendStatus.Transient,
                _ => SendStatus.Permanent
            };
            return new SendResult(status, code, error, watch.Elapsed, SafeHttp.RetryAfter(e.Headers));
        }
        catch (HttpRequestException e) when (e.InnerException is BlockedAddressException) {
            return new SendResult(SendStatus.Permanent, null, SafeHttp.BlockedAddressMessage, watch.Elapsed);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) {
            return new SendResult(SendStatus.Transient, null, "Timed out", watch.Elapsed);
        }
        catch (HttpRequestException e) {
            return new SendResult(SendStatus.Transient, null, e.InnerException?.Message ?? e.Message, watch.Elapsed);
        }
        catch (Exception e) when (e is ArgumentException or FormatException or System.Security.Cryptography.CryptographicException
                                      or InvalidOperationException) {
            // Bad subscription keys (encrypting fails) or an unusable URL: retrying won't help
            return new SendResult(SendStatus.Permanent, null, "Invalid subscription: " + e.Message, watch.Elapsed);
        }
    }
}
