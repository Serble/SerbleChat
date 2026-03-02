using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;
using SerbleChat.GuildLinkerBot.Models;

namespace SerbleChat.GuildLinkerBot.Services;

/// <summary>
/// Client for connecting to Serble Chat API
/// </summary>
public class SerbleChatClient : ISerbleChatClient {
    private readonly ILogger<SerbleChatClient> _logger;
    private readonly HttpClient _httpClient;
    private readonly string _apiUrl;
    private readonly string _accessToken;
    private HubConnection? _hubConnection;

    private Func<SerbleMessage, Task>? _onNewMessageCallback;
    private Func<SerbleVoiceEvent, Task>? _onUserJoinedVoiceCallback;
    private Func<SerbleVoiceEvent, Task>? _onUserLeftVoiceCallback;

    public bool IsConnected => _hubConnection?.State == HubConnectionState.Connected;

    public SerbleChatClient(ILogger<SerbleChatClient> logger, HttpClient httpClient, string apiUrl, string accessToken) {
        _logger = logger;
        _httpClient = httpClient;
        _apiUrl = apiUrl.TrimEnd('/');
        _accessToken = accessToken;
        _httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _accessToken);
    }

    public async Task ConnectAsync() {
        try {
            _hubConnection = new HubConnectionBuilder()
                .WithUrl($"{_apiUrl}/updates?access_token={Uri.EscapeDataString(_accessToken)}")
                .WithAutomaticReconnect()
                .Build();

            // Register message handlers
            _hubConnection.On<SerbleMessage>("NewMessage", async msg => {
                _logger.LogInformation("Received new message: {MessageId} in channel {ChannelId}", msg.Id, msg.ChannelId);
                if (_onNewMessageCallback != null) {
                    await _onNewMessageCallback(msg);
                }
            });

            _hubConnection.On<SerbleVoiceEvent>("ClientJoinVoice", async voiceEvent => {
                _logger.LogInformation("User {UserId} joined voice channel {ChannelId}", voiceEvent.UserId, voiceEvent.ChannelId);
                if (_onUserJoinedVoiceCallback != null) {
                    await _onUserJoinedVoiceCallback(voiceEvent);
                }
            });

            _hubConnection.On<SerbleVoiceEvent>("ClientLeaveVoice", async voiceEvent => {
                _logger.LogInformation("User {UserId} left voice channel {ChannelId}", voiceEvent.UserId, voiceEvent.ChannelId);
                if (_onUserLeftVoiceCallback != null) {
                    await _onUserLeftVoiceCallback(voiceEvent);
                }
            });

            _hubConnection.Reconnected += async (connectionId) => {
                _logger.LogInformation("Reconnected to Serble Chat");
            };

            _hubConnection.Reconnecting += async (error) => {
                _logger.LogWarning("Reconnecting to Serble Chat due to: {Error}", error?.Message);
            };

            _hubConnection.Closed += async error => {
                _logger.LogError("Disconnected from Serble Chat: {Error}", error?.Message);
            };

            await _hubConnection.StartAsync();
            _logger.LogInformation("Connected to Serble Chat SignalR hub");
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to connect to Serble Chat");
            throw;
        }
    }

    public async Task DisconnectAsync() {
        if (_hubConnection != null) {
            await _hubConnection.StopAsync();
            await _hubConnection.DisposeAsync();
            _hubConnection = null;
            _logger.LogInformation("Disconnected from Serble Chat");
        }
    }

    public async Task SendMessageAsync(long channelId, string content) {
        try {
            SendMessageBody request = new() { Content = content };
            StringContent jsonContent = new(JsonSerializer.Serialize(request), System.Text.Encoding.UTF8, "application/json");

            HttpResponseMessage response = await _httpClient.PostAsync($"{_apiUrl}/channel/{channelId}", jsonContent);
            response.EnsureSuccessStatusCode();
            _logger.LogInformation("Sent message to Serble Chat channel {ChannelId}", channelId);
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to send message to Serble Chat channel {ChannelId}", channelId);
            throw;
        }
    }

    public async Task<SerbleUser?> GetUserAsync(string userId) {
        try {
            HttpResponseMessage response = await _httpClient.GetAsync($"{_apiUrl}/account/{userId}");
            if (!response.IsSuccessStatusCode) {
                return null;
            }

            string content = await response.Content.ReadAsStringAsync();
            JsonSerializerOptions options = new() {
                PropertyNameCaseInsensitive = true,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
            };
            SerbleUser? user = JsonSerializer.Deserialize<SerbleUser>(content, options);
            return user;
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to get user {UserId} from Serble Chat", userId);
            return null;
        }
    }

    public void OnNewMessage(Func<SerbleMessage, Task> callback) {
        _onNewMessageCallback = callback;
    }

    public void OnUserJoinedVoice(Func<SerbleVoiceEvent, Task> callback) {
        _onUserJoinedVoiceCallback = callback;
    }

    public void OnUserLeftVoice(Func<SerbleVoiceEvent, Task> callback) {
        _onUserLeftVoiceCallback = callback;
    }
}
