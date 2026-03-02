using Discord;
using Discord.WebSocket;
using Discord.Audio;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;

namespace SerbleChat.GuildLinkerBot.Services;

/// <summary>
/// Service for interacting with Discord
/// </summary>
public class DiscordService : IDiscordService {
    private readonly ILogger<DiscordService> _logger;
    private DiscordSocketClient? _client;
    private Func<IMessage, Task>? _onMessageReceivedCallback;
    private Func<SocketUser, SocketVoiceState, SocketVoiceState, Task>? _onUserJoinedVoiceCallback;
    private Func<SocketUser, SocketVoiceState, SocketVoiceState, Task>? _onUserLeftVoiceCallback;
    private readonly ConcurrentDictionary<ulong, CancellationTokenSource> _voiceKeepAliveTokens = new();

    public bool IsReady => _client?.ConnectionState == ConnectionState.Connected;

    public DiscordService(ILogger<DiscordService> logger) {
        _logger = logger;
    }

    public async Task StartAsync(string token) {
        try {
            _client = new DiscordSocketClient(new DiscordSocketConfig {
                GatewayIntents = GatewayIntents.All,
                LogLevel = LogSeverity.Info
            });

            _client.Log += LogAsync;
            _client.Ready += ReadyAsync;
            _client.MessageReceived += MessageReceivedAsync;
            _client.UserVoiceStateUpdated += UserVoiceStateUpdatedAsync;

            await _client.LoginAsync(TokenType.Bot, token);
            await _client.StartAsync();

            // Wait for the client to be ready
            int attempts = 0;
            while (!IsReady && attempts < 30) {
                await Task.Delay(1000);
                attempts++;
            }

            if (!IsReady) {
                throw new Exception("Discord client failed to connect within timeout period");
            }

            _logger.LogInformation("Discord bot started successfully");
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to start Discord bot");
            throw;
        }
    }

    public async Task StopAsync() {
        if (_client != null) {
            // Cancel all keep-alive tasks
            foreach (KeyValuePair<ulong, CancellationTokenSource> kvp in _voiceKeepAliveTokens) {
                kvp.Value.Cancel();
                kvp.Value.Dispose();
            }
            _voiceKeepAliveTokens.Clear();

            await _client.StopAsync();
            await _client.LogoutAsync();
            _client.Dispose();
            _client = null;
            _logger.LogInformation("Discord bot stopped");
        }
    }

    public async Task SendMessageAsync(ulong channelId, string content, string authorName = "", string? avatarUrl = null) {
        try {
            if (_client?.GetChannel(channelId) is not IMessageChannel channel) {
                _logger.LogWarning("Channel {ChannelId} not found", channelId);
                return;
            }

            // If we have an author name, create an embed to show the original author
            if (!string.IsNullOrEmpty(authorName)) {
                Embed? embed = new EmbedBuilder()
                    .WithAuthor(authorName, avatarUrl)
                    .WithDescription(content)
                    .WithColor(Color.Blue)
                    .WithCurrentTimestamp()
                    .Build();

                await channel.SendMessageAsync(embed: embed);
            } else {
                await channel.SendMessageAsync(content);
            }

            _logger.LogInformation("Sent message to Discord channel {ChannelId}", channelId);
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to send message to Discord channel {ChannelId}", channelId);
        }
    }

    public async Task JoinVoiceChannelAsync(ulong guildId, ulong voiceChannelId) {
        try {
            if (_client == null) {
                throw new Exception("Discord client not initialized");
            }

            SocketGuild? guild = _client.GetGuild(guildId);
            if (guild == null) {
                _logger.LogWarning("Guild {GuildId} not found", guildId);
                return;
            }

            // Check if already connected
            if (guild.AudioClient != null) {
                _logger.LogInformation("Already connected to voice channel in guild {GuildId}", guildId);
                return;
            }

            SocketVoiceChannel? voiceChannel = guild.GetVoiceChannel(voiceChannelId);
            if (voiceChannel == null) {
                _logger.LogWarning("Voice channel {VoiceChannelId} not found in guild {GuildId}", voiceChannelId, guildId);
                return;
            }

            _logger.LogInformation("Connecting to voice channel {VoiceChannelId} in guild {GuildId}", voiceChannelId, guildId);
            IAudioClient? audioClient = await voiceChannel.ConnectAsync();
            _logger.LogInformation("Successfully connected to voice channel {VoiceChannelId} in guild {GuildId}", voiceChannelId, guildId);

            // Start keep-alive task to maintain the connection
            CancellationTokenSource cancellationTokenSource = new();
            _voiceKeepAliveTokens[guildId] = cancellationTokenSource;
            
            _ = Task.Run(async () => await KeepVoiceConnectionAliveAsync(audioClient, guildId, cancellationTokenSource.Token), cancellationTokenSource.Token);
            
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to join voice channel {VoiceChannelId} in guild {GuildId}", voiceChannelId, guildId);
            throw;
        }
    }

    private async Task KeepVoiceConnectionAliveAsync(IAudioClient audioClient, ulong guildId, CancellationToken cancellationToken) {
        try {
            _logger.LogInformation("Starting voice keep-alive for guild {GuildId}", guildId);
            
            using AudioOutStream? audioOutStream = audioClient.CreatePCMStream(AudioApplication.Mixed);
            
            // Send silent audio frames to keep connection alive
            // Discord expects 20ms of audio at 48000 Hz, 2 channels, 16-bit
            // That's 48000 * 0.02 * 2 * 2 = 3840 bytes per frame
            byte[] silentFrame = new byte[3840];
            
            while (!cancellationToken.IsCancellationRequested && audioClient.ConnectionState == ConnectionState.Connected) {
                try {
                    await audioOutStream.WriteAsync(silentFrame, 0, silentFrame.Length, cancellationToken);
                    await Task.Delay(20, cancellationToken); // 20ms per frame
                } catch (OperationCanceledException) {
                    break;
                } catch (Exception ex) {
                    _logger.LogWarning(ex, "Error sending keep-alive audio for guild {GuildId}", guildId);
                    await Task.Delay(1000, cancellationToken); // Wait before retry
                }
            }
            
            _logger.LogInformation("Voice keep-alive stopped for guild {GuildId}", guildId);
        } catch (Exception ex) {
            _logger.LogError(ex, "Voice keep-alive task failed for guild {GuildId}", guildId);
        }
    }

    public async Task LeaveVoiceChannelAsync(ulong guildId) {
        try {
            // Cancel keep-alive task
            if (_voiceKeepAliveTokens.TryRemove(guildId, out CancellationTokenSource? cts)) {
                cts.Cancel();
                cts.Dispose();
            }

            if (_client == null) {
                return;
            }

            SocketGuild? guild = _client.GetGuild(guildId);
            if (guild == null) {
                return;
            }

            IAudioClient? audioClient = guild.AudioClient;
            if (audioClient != null) {
                await audioClient.StopAsync();
                _logger.LogInformation("Left voice channel in guild {GuildId}", guildId);
            }
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to leave voice channel in guild {GuildId}", guildId);
        }
    }

    public IAudioClient? GetVoiceClient(ulong guildId) {
        return _client?.GetGuild(guildId)?.AudioClient;
    }

    public void OnMessageReceived(Func<IMessage, Task> callback) {
        _onMessageReceivedCallback = callback;
    }

    public void OnUserJoinedVoice(Func<SocketUser, SocketVoiceState, SocketVoiceState, Task> callback) {
        _onUserJoinedVoiceCallback = callback;
    }

    public void OnUserLeftVoice(Func<SocketUser, SocketVoiceState, SocketVoiceState, Task> callback) {
        _onUserLeftVoiceCallback = callback;
    }

    public SocketSelfUser? GetCurrentUser() {
        return _client?.CurrentUser;
    }

    private Task LogAsync(LogMessage message) {
        // Map Discord log levels to Microsoft.Extensions.Logging levels
        switch (message.Severity) {
            case LogSeverity.Critical:
            case LogSeverity.Error:
                // Check if this is a voice WebSocket exception (which is normal)
                if (message.Exception is Discord.Net.WebSocketClosedException || 
                    (message.Exception?.InnerException is Discord.Net.WebSocketClosedException)) {
                    _logger.LogWarning("[{Source}] Voice connection closed: {Message}", message.Source, message.Message);
                } else if (message.Exception != null) {
                    _logger.LogError(message.Exception, "[{Source}] {Message}", message.Source, message.Message);
                } else {
                    _logger.LogError("[{Source}] {Message}", message.Source, message.Message);
                }
                break;
            case LogSeverity.Warning:
                _logger.LogWarning("[{Source}] {Message}", message.Source, message.Message);
                break;
            case LogSeverity.Info:
                _logger.LogInformation("[{Source}] {Message}", message.Source, message.Message);
                break;
            case LogSeverity.Verbose:
            case LogSeverity.Debug:
                _logger.LogDebug("[{Source}] {Message}", message.Source, message.Message);
                break;
        }
        return Task.CompletedTask;
    }

    private Task ReadyAsync() {
        _logger.LogInformation("Discord bot is ready");
        return Task.CompletedTask;
    }

    private async Task MessageReceivedAsync(SocketMessage message) {
        // Ignore bot messages
        if (message.Author.IsBot) {
            return;
        }

        if (_onMessageReceivedCallback != null) {
            await _onMessageReceivedCallback(message);
        }
    }

    private async Task UserVoiceStateUpdatedAsync(SocketUser user, SocketVoiceState oldState, SocketVoiceState newState) {
        // Check if user joined a voice channel
        if (oldState.VoiceChannel == null && newState.VoiceChannel != null) {
            if (_onUserJoinedVoiceCallback != null) {
                await _onUserJoinedVoiceCallback(user, oldState, newState);
            }
        }
        // Check if user left a voice channel
        else if (oldState.VoiceChannel != null && newState.VoiceChannel == null) {
            if (_onUserLeftVoiceCallback != null) {
                await _onUserLeftVoiceCallback(user, oldState, newState);
            }
        }
        // Check if user switched channels
        else if (oldState.VoiceChannel?.Id != newState.VoiceChannel?.Id) {
            if (oldState.VoiceChannel != null && _onUserLeftVoiceCallback != null) {
                await _onUserLeftVoiceCallback(user, oldState, newState);
            }
            if (newState.VoiceChannel != null && _onUserJoinedVoiceCallback != null) {
                await _onUserJoinedVoiceCallback(user, oldState, newState);
            }
        }
    }
}
