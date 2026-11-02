using System.Net;
using System.Net.Sockets;
using SerbleChat.Backend.Services.Ntfy;

namespace SerbleChat.Backend.Services.Net;

/// <summary>
/// HTTP plumbing for requests to URLs that users choose (ntfy servers, push endpoints). Every connection checks the
/// address it actually connects to, so a hostname can't be pointed at an internal service after it was validated.
/// </summary>
public static class SafeHttp {
    public const string BlockedAddressMessage = "The server's address isn't on the public internet, so it can't be used.";

    /// <summary>
    /// A handler that only connects to public addresses (unless <paramref name="allowPrivate"/>), never follows redirects
    /// or uses a proxy (either would bypass the check), and keeps idle connections around so pushes don't pay for a new
    /// TLS handshake after a quiet minute.
    /// </summary>
    public static SocketsHttpHandler CreateHandler(bool allowPrivate, TimeSpan connectTimeout) {
        return new SocketsHttpHandler {
            AllowAutoRedirect = false,
            UseProxy = false,
            ConnectTimeout = connectTimeout,
            PooledConnectionLifetime = TimeSpan.FromMinutes(15),  // still picks up DNS changes
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(10),
            KeepAlivePingDelay = TimeSpan.FromSeconds(30),
            KeepAlivePingTimeout = TimeSpan.FromSeconds(10),
            KeepAlivePingPolicy = HttpKeepAlivePingPolicy.WithActiveRequests,
            EnableMultipleHttp2Connections = true,
            ConnectCallback = (context, token) => ConnectToAllowedAddress(context.DnsEndPoint, allowPrivate, token)
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

    public static async Task<IPAddress[]> ResolveAllowed(string host, bool allowPrivate, CancellationToken token) {
        host = host.Trim('[', ']');
        IPAddress[] addresses = IPAddress.TryParse(host, out IPAddress? literal)
            ? [literal]
            : await Dns.GetHostAddressesAsync(host, token);
        return allowPrivate ? addresses : addresses.Where(PublicAddressGuard.IsPublic).ToArray();
    }

    /// <summary>Checks a URL a client wants us to send to later. Returns an error message, or null if it's acceptable.</summary>
    public static async Task<string?> CheckUrl(string url, bool allowPrivate, int maxLength, CancellationToken token = default) {
        if (string.IsNullOrWhiteSpace(url) || url.Length > maxLength) {
            return $"The URL must be at most {maxLength} characters.";
        }
        if (!Uri.TryCreate(url, UriKind.Absolute, out Uri? uri) || uri.Scheme is not ("https" or "http")) {
            return "The URL must be an http(s) URL.";
        }
        if (uri.Scheme == "http" && !allowPrivate) {
            return "The URL must use https.";
        }
        if (!string.IsNullOrEmpty(uri.UserInfo)) {
            return "The URL can't contain a username or password.";
        }
        try {
            IPAddress[] allowed = await ResolveAllowed(uri.IdnHost, allowPrivate, token);
            return allowed.Length == 0 ? BlockedAddressMessage : null;
        }
        catch (SocketException) {
            return $"Couldn't resolve {uri.Host}.";
        }
    }

    /// <summary>Reads a Retry-After header as a delay from now, if there is one.</summary>
    public static TimeSpan? RetryAfter(System.Net.Http.Headers.HttpResponseHeaders? headers) {
        if (headers?.RetryAfter == null) return null;
        if (headers.RetryAfter.Delta is { } delta) return delta;
        if (headers.RetryAfter.Date is { } date) {
            TimeSpan wait = date - DateTimeOffset.UtcNow;
            return wait > TimeSpan.Zero ? wait : TimeSpan.Zero;
        }
        return null;
    }
}

/// <summary>Asks for HTTP/2 where the server offers it, so many concurrent pushes to one service share a connection.</summary>
public class PreferHttp2Handler : DelegatingHandler {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
        if (request.RequestUri?.Scheme == "https") {
            request.Version = HttpVersion.Version20;
            request.VersionPolicy = HttpVersionPolicy.RequestVersionOrLower;
        }
        return base.SendAsync(request, cancellationToken);
    }
}

public class BlockedAddressException(string message) : IOException(message);
