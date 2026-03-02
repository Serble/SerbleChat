using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SerbleChat.GuildLinkerBot.Config;
using SerbleChat.GuildLinkerBot.Services;

// Build configuration
IConfigurationRoot configuration = new ConfigurationBuilder()
    .SetBasePath(Directory.GetCurrentDirectory())
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
    .AddJsonFile($"appsettings.{Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production"}.json", optional: true)
    .AddEnvironmentVariables()
    .Build();

// Build service collection
ServiceCollection services = new();

// Add logging
services.AddLogging(builder => {
    builder.AddConsole();
    builder.SetMinimumLevel(LogLevel.Information);
});

// Add configuration
BotConfiguration botConfig = configuration.GetSection("Bot").Get<BotConfiguration>()
                             ?? throw new Exception("Bot configuration not found in appsettings.json");
services.AddSingleton(botConfig);

// Add HTTP client for Serble Chat API
services.AddHttpClient();

// Add Serble Chat client
services.AddSingleton<ISerbleChatClient>(sp => {
    ILogger<SerbleChatClient> logger = sp.GetRequiredService<ILogger<SerbleChatClient>>();
    HttpClient httpClient = sp.GetRequiredService<HttpClient>();
    return new SerbleChatClient(logger, httpClient, botConfig.SerbleChatApiUrl, botConfig.SerbleChatAccessToken);
});

// Add Discord service
services.AddSingleton<IDiscordService>(sp => {
    ILogger<DiscordService> logger = sp.GetRequiredService<ILogger<DiscordService>>();
    return new DiscordService(logger);
});

// Add guild linker
services.AddSingleton<IGuildLinker, GuildLinker>();

ServiceProvider serviceProvider = services.BuildServiceProvider();
ILogger<Program> logger = serviceProvider.GetRequiredService<ILogger<Program>>();

try {
    logger.LogInformation("Starting Serble Chat/Discord Guild Linker Bot");

    // Get services
    IDiscordService discordService = serviceProvider.GetRequiredService<IDiscordService>();
    ISerbleChatClient serbleChatClient = serviceProvider.GetRequiredService<ISerbleChatClient>();
    IGuildLinker guildLinker = serviceProvider.GetRequiredService<IGuildLinker>();

    // Connect to Serble Chat
    logger.LogInformation("Connecting to Serble Chat...");
    await serbleChatClient.ConnectAsync();

    // Start Discord bot
    logger.LogInformation("Starting Discord bot...");
    await discordService.StartAsync(botConfig.DiscordBotToken);

    // Start guild linker
    logger.LogInformation("Starting guild linker...");
    await guildLinker.StartAsync();

    logger.LogInformation("Bot started successfully!");

    // Keep the bot running
    await Task.Delay(Timeout.Infinite);
} catch (Exception ex) {
    logger.LogCritical(ex, "Bot crashed with exception");
    Environment.Exit(1);
}
