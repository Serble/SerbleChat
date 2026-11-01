using System.Net;
using System.Net.Sockets;

namespace SerbleChat.Backend.Services.Ntfy;

/// <summary>
/// Decides whether an address is on the public internet, so that user-supplied URLs can't be used to
/// reach loopback, private networks, cloud metadata endpoints and the like (SSRF).
/// </summary>
public static class PublicAddressGuard {
    private static readonly (IPAddress Network, int Prefix)[] BlockedV4 = [
        (IPAddress.Parse("0.0.0.0"), 8),        // "this" network
        (IPAddress.Parse("10.0.0.0"), 8),       // private
        (IPAddress.Parse("100.64.0.0"), 10),    // carrier-grade NAT
        (IPAddress.Parse("127.0.0.0"), 8),      // loopback
        (IPAddress.Parse("169.254.0.0"), 16),   // link-local, includes cloud metadata
        (IPAddress.Parse("172.16.0.0"), 12),    // private
        (IPAddress.Parse("192.0.0.0"), 24),     // IETF protocol assignments
        (IPAddress.Parse("192.0.2.0"), 24),     // documentation
        (IPAddress.Parse("192.88.99.0"), 24),   // 6to4 relay anycast
        (IPAddress.Parse("192.168.0.0"), 16),   // private
        (IPAddress.Parse("198.18.0.0"), 15),    // benchmarking
        (IPAddress.Parse("198.51.100.0"), 24),  // documentation
        (IPAddress.Parse("203.0.113.0"), 24),   // documentation
        (IPAddress.Parse("224.0.0.0"), 4),      // multicast
        (IPAddress.Parse("240.0.0.0"), 4),      // reserved, includes broadcast
    ];

    private static readonly (IPAddress Network, int Prefix)[] BlockedV6 = [
        (IPAddress.Parse("::"), 128),           // unspecified
        (IPAddress.Parse("::1"), 128),          // loopback
        (IPAddress.Parse("100::"), 64),         // discard
        (IPAddress.Parse("2001:db8::"), 32),    // documentation
        (IPAddress.Parse("fc00::"), 7),         // unique local
        (IPAddress.Parse("fe80::"), 10),        // link-local
        (IPAddress.Parse("fec0::"), 10),        // site-local (deprecated)
        (IPAddress.Parse("ff00::"), 8),         // multicast
    ];

    private static readonly (IPAddress Network, int Prefix) Nat64 = (IPAddress.Parse("64:ff9b::"), 96);
    private static readonly (IPAddress Network, int Prefix) SixToFour = (IPAddress.Parse("2002::"), 16);
    private static readonly (IPAddress Network, int Prefix) Teredo = (IPAddress.Parse("2001::"), 32);

    public static bool IsPublic(IPAddress address) {
        if (address.IsIPv4MappedToIPv6) {
            address = address.MapToIPv4();
        }

        if (address.AddressFamily == AddressFamily.InterNetwork) {
            return !BlockedV4.Any(b => InPrefix(address, b.Network, b.Prefix));
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6) {
            return false;
        }

        if (BlockedV6.Any(b => InPrefix(address, b.Network, b.Prefix))) {
            return false;
        }

        byte[] bytes = address.GetAddressBytes();

        // Deprecated IPv4-compatible addresses (::a.b.c.d)
        if (bytes.Take(12).All(b => b == 0)) {
            return IsPublic(new IPAddress(bytes[12..16]));
        }

        // Transition mechanisms that embed an IPv4 address: judge by the embedded one.
        if (InPrefix(address, Nat64.Network, Nat64.Prefix)) {
            return IsPublic(new IPAddress(bytes[12..16]));
        }
        if (InPrefix(address, SixToFour.Network, SixToFour.Prefix)) {
            return IsPublic(new IPAddress(bytes[2..6]));
        }
        if (InPrefix(address, Teredo.Network, Teredo.Prefix)) {
            // Teredo stores the client's address inverted in the last four bytes
            return IsPublic(new IPAddress(bytes[12..16].Select(b => (byte)~b).ToArray()));
        }

        return true;
    }

    private static bool InPrefix(IPAddress address, IPAddress network, int prefix) {
        if (address.AddressFamily != network.AddressFamily) {
            return false;
        }

        byte[] a = address.GetAddressBytes();
        byte[] n = network.GetAddressBytes();
        int fullBytes = prefix / 8;
        for (int i = 0; i < fullBytes; i++) {
            if (a[i] != n[i]) return false;
        }

        int remainingBits = prefix % 8;
        if (remainingBits == 0) return true;
        int mask = 0xFF << (8 - remainingBits) & 0xFF;
        return (a[fullBytes] & mask) == (n[fullBytes] & mask);
    }
}
