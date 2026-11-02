using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Services.Impl;

public class SerbleApiClient(HttpClient httpClient, IOptions<SerbleApiSettings> settings, ILogger<SerbleApiClient> logger)
    : ISerbleApiClient {

    private const string CrossAppGrantType = "urn:serble:params:oauth:grant-type:cross-app-code";
    
    public async Task<TokenResponse?> Authenticate(string code) {
        Dictionary<string, string?> query = new() {
            { "code", code },
            { "client_id", settings.Value.ClientId },
            { "client_secret", settings.Value.ClientSecret },
            { "grant_type", "authorization_code" }
        };

        string url = QueryHelpers.AddQueryString(
            $"{settings.Value.BaseUrl}oauth/token/refresh", query);
        
        HttpResponseMessage response = 
            await httpClient.PostAsync(url, new StringContent(""));

        if (!response.IsSuccessStatusCode) {
            return null;
        }
        
        string responseContent = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<TokenResponse>(responseContent);
    }

    public async Task<TokenResponse?> GetAccessToken(string refreshToken) {
        Dictionary<string, string?> query = new() {
            { "refresh_token", refreshToken },
            { "client_id", settings.Value.ClientId },
            { "client_secret", settings.Value.ClientSecret },
            // Serble's legacy access endpoint takes this grant type for refresh-token exchanges too
            { "grant_type", "authorization_code" }
        };

        string url = QueryHelpers.AddQueryString(
            $"{settings.Value.BaseUrl}oauth/token/access", query);
        
        HttpResponseMessage response = 
            await httpClient.PostAsync(url, new StringContent(""));

        if (!response.IsSuccessStatusCode) {
            logger.LogInformation("Serble refused a refresh token exchange ({Status}): {Body}",
                (int)response.StatusCode, await response.Content.ReadAsStringAsync());
            return null;
        }
        
        string responseContent = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<TokenResponse>(responseContent);
    }

    // /account
    public Task<SerbleUser?> GetUserInfo(string accessToken) {
        httpClient.DefaultRequestHeaders.Add("SerbleAuth", "App " + accessToken);
        
        return httpClient.GetFromJsonAsync<SerbleUser>($"{settings.Value.BaseUrl}account");
    }

    public async Task<CrossAppCodeResult> GetCrossAppCode(string accessToken, string audience) {
        FormUrlEncodedContent form = new(new Dictionary<string, string> {
            { "grant_type", CrossAppGrantType },
            { "client_id", settings.Value.ClientId },
            { "client_secret", settings.Value.ClientSecret },
            { "subject_token", accessToken },
            { "audience", audience }
        });

        HttpResponseMessage response;
        string body;
        try {
            response = await httpClient.PostAsync($"{settings.Value.BaseUrl}oauth/token", form);
            body = await response.Content.ReadAsStringAsync();
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) {
            logger.LogWarning(e, "Cross-app code request to Serble failed");
            return new CrossAppCodeResult(CrossAppCodeOutcome.Failed, Error: "Serble could not be reached");
        }

        JsonElement? json = null;
        try { json = JsonSerializer.Deserialize<JsonElement>(body); }
        catch (JsonException) { /* handled below */ }

        string? Prop(string name) =>
            json is { ValueKind: JsonValueKind.Object } j && j.TryGetProperty(name, out JsonElement v)
                && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        if (response.IsSuccessStatusCode) {
            string? code = Prop("code");
            if (!string.IsNullOrEmpty(code)) return new CrossAppCodeResult(CrossAppCodeOutcome.Issued, Code: code);
            logger.LogWarning("Serble issued a cross-app response without a code: {Body}", body);
            return new CrossAppCodeResult(CrossAppCodeOutcome.Failed, Error: "Serble returned no code");
        }

        string? error = Prop("error");
        string? description = Prop("error_description") ?? error;
        switch (error) {
            case "consent_required": {
                string? consentUrl = Prop("consent_url");
                if (!string.IsNullOrEmpty(consentUrl))
                    return new CrossAppCodeResult(CrossAppCodeOutcome.ConsentRequired, ConsentUrl: consentUrl);
                break;
            }
            // The target refuses this app, or the user may not use one of them.
            case "access_denied":
            case "unauthorized_client":
            case "invalid_target":
                return new CrossAppCodeResult(CrossAppCodeOutcome.Denied, Error: description);
            // The subject token is no good: the user revoked SerbleChat or their account changed.
            case "invalid_grant":
                return new CrossAppCodeResult(CrossAppCodeOutcome.ReauthRequired, Error: description);
        }

        logger.LogWarning("Cross-app code request failed with {Status}: {Body}", (int)response.StatusCode, body);
        return new CrossAppCodeResult(CrossAppCodeOutcome.Failed, Error: description ?? $"HTTP {(int)response.StatusCode}");
    }
}
