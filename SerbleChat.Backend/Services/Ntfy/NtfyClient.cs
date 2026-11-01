using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services.Ntfy;

public class NtfyClient(HttpClient http, IOptions<NtfySettings> settings, ILogger<NtfyClient> logger) : INtfyClient {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    /// <summary>
    /// Handler for the ntfy HttpClient. Every connection goes through <see cref="ConnectToAllowedAddress"/>, so the
    /// address check happens on the address actually connected to (no DNS-rebinding window). Redirects and proxies
    /// are off, because either would bypass that check.
    /// </summary>
    public static SocketsHttpHandler CreateHandler(NtfySettings settings) {
        return new SocketsHttpHandler {
            AllowAutoRedirect = false,
            UseProxy = false,
            ConnectTimeout = TimeSpan.FromSeconds(settings.TimeoutSeconds),
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            ConnectCallback = (context, token) => ConnectToAllowedAddress(context.DnsEndPoint, settings.AllowPrivateAddresses, token)
        };
    }

    private static async ValueTask<Stream> ConnectToAllowedAddress(DnsEndPoint endPoint, bool allowPrivate, CancellationToken token) {
        IPAddress[] addresses = await ResolveAllowed(endPoint.Host, allowPrivate, token);
        if (addresses.Length == 0) {
            throw new BlockedAddressException(BlockedAddressMessage);
        }

        Exception? last = null;
        foreach (IPAddress address in addresses) {
            Socket socket = new(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try {
                await socket.ConnectAsync(new IPEndPoint(address, endPoint.Port), token);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception e) {
                socket.Dispose();
                last = e;
            }
        }
        throw last!;
    }

    private const string BlockedAddressMessage = "The server's address isn't on the public internet, so it can't be used.";

    private static async Task<IPAddress[]> ResolveAllowed(string host, bool allowPrivate, CancellationToken token) {
        host = host.Trim('[', ']');
        IPAddress[] addresses = IPAddress.TryParse(host, out IPAddress? literal)
            ? [literal]
            : await Dns.GetHostAddressesAsync(host, token);
        return allowPrivate ? addresses : addresses.Where(PublicAddressGuard.IsPublic).ToArray();
    }

    public async Task<string?> CheckServerAddress(Uri serverUrl, CancellationToken token = default) {
        try {
            IPAddress[] allowed = await ResolveAllowed(serverUrl.IdnHost, settings.Value.AllowPrivateAddresses, token);
            return allowed.Length == 0 ? BlockedAddressMessage : null;
        }
        catch (SocketException) {
            return $"Couldn't resolve {serverUrl.Host}.";
        }
    }

    public async Task<NtfyPublishResult> Publish(UserNtfySubscription subscription, NtfyNotification notification, CancellationToken token = default) {
        // JSON publishing (POST to the server root) rather than the header API: HttpClient rejects
        // non-ASCII header values, which would break titles with emoji or accented usernames.
        object body = new {
            topic = subscription.Topic,
            title = notification.Title,
            message = notification.Message,
            priority = notification.Priority,
            click = notification.Click,
            tags = notification.Tags
        };

        using HttpRequestMessage request = new(HttpMethod.Post, subscription.ServerUrl);
        request.Content = JsonContent.Create(body, options: JsonOptions);
        if (!string.IsNullOrEmpty(subscription.AccessToken)) {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", subscription.AccessToken);
        }

        using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(settings.Value.TimeoutSeconds));

        try {
            using HttpResponseMessage response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (response.IsSuccessStatusCode) {
                return new NtfyPublishResult(NtfyPublishOutcome.Success);
            }

            string error = await ReadError(response, timeout.Token);
            NtfyPublishOutcome outcome = response.StatusCode switch {
                HttpStatusCode.TooManyRequests => NtfyPublishOutcome.RateLimited,
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound => NtfyPublishOutcome.Rejected,
                // a redirect we won't follow means the URL is wrong
                >= HttpStatusCode.MultipleChoices and < HttpStatusCode.BadRequest => NtfyPublishOutcome.Rejected,
                _ => NtfyPublishOutcome.Failed
            };
            return new NtfyPublishResult(outcome, error);
        }
        catch (HttpRequestException e) when (e.InnerException is BlockedAddressException) {
            return new NtfyPublishResult(NtfyPublishOutcome.Rejected, BlockedAddressMessage);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) {
            return new NtfyPublishResult(NtfyPublishOutcome.Failed, "Timed out contacting the ntfy server.");
        }
        catch (HttpRequestException e) {
            logger.LogDebug(e, "ntfy publish to {Server} failed", subscription.ServerUrl);
            return new NtfyPublishResult(NtfyPublishOutcome.Failed, "Couldn't reach the ntfy server: " + (e.InnerException?.Message ?? e.Message));
        }
    }

    private static async Task<string> ReadError(HttpResponseMessage response, CancellationToken token) {
        string fallback = $"ntfy server returned {(int)response.StatusCode} {response.ReasonPhrase}";
        try {
            // ntfy errors look like {"code":40101,"http":401,"error":"unauthorized","link":"..."}
            await using Stream stream = await response.Content.ReadAsStreamAsync(token);
            byte[] buffer = new byte[4096];
            int read = await stream.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, token);
            using JsonDocument doc = JsonDocument.Parse(buffer.AsMemory(0, read));
            if (doc.RootElement.TryGetProperty("error", out JsonElement err) && err.ValueKind == JsonValueKind.String) {
                return $"{fallback}: {err.GetString()}";
            }
        }
        catch (Exception) {
            // not JSON or not ntfy, fine
        }
        return fallback;
    }
}

internal class BlockedAddressException(string message) : IOException(message);
