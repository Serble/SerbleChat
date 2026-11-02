using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Schemas;

/// <summary>
/// The answer to <c>POST /auth/files</c>. <c>status</c> is one of <c>ok</c> (redeem <c>code</c> at the
/// Files API's <c>POST /account</c>), <c>consent_required</c> (send the user to <c>consentUrl</c> with
/// <c>redirect_uri</c> and <c>state</c> appended, then try again), <c>denied</c>,
/// <c>reauth_required</c> (sign in to SerbleChat again) or <c>unavailable</c>.
/// </summary>
public class FilesConnectResponse {
    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("code")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Code { get; set; }

    [JsonPropertyName("consentUrl")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ConsentUrl { get; set; }

    [JsonPropertyName("message")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Message { get; set; }
}
