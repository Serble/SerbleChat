namespace SerbleChat.Backend.Config;

public class JwtSettings {
    public string Secret { get; set; } = null!;
    public string Issuer { get; set; } = null!;
    public string Audience { get; set; } = null!;
    public int ExpiryHours { get; set; } = 24;
    
    /// <summary>
    /// This allows anyone to generate accounts and auth tokens
    /// that completely bypass Serble. This is only for testing
    /// and should never be enabled in production.
    /// </summary>
    public bool AllowTestingAccountGeneration { get; set; } = false;
}
