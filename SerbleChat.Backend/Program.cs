using System.Text;
using Amazon;
using Amazon.S3;
using Lib.Net.Http.WebPush;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Repos.Impl;
using SerbleChat.Backend.Services;
using SerbleChat.Backend.Services.Impl;
using SerbleChat.Backend.SocketHubs;
using StackExchange.Redis;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.Services.AddOptions<SerbleApiSettings>().Bind(builder.Configuration.GetSection("SerbleApi"));
builder.Services.AddOptions<JwtSettings>().Bind(builder.Configuration.GetSection("Jwt"));
builder.Services.AddOptions<ApiSettings>().Bind(builder.Configuration.GetSection("Api"));
builder.Services.AddOptions<LiveKitSettings>().Bind(builder.Configuration.GetSection("LiveKit"));
builder.Services.AddOptions<PushNotificationsSettings>().Bind(builder.Configuration.GetSection("PushNotifications"));
builder.Services.AddOptions<S3Settings>().Bind(builder.Configuration.GetSection("S3"));

JwtSettings jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>() ?? throw new Exception("JWT settings not found");
ApiSettings apiSettings = builder.Configuration.GetSection("Api").Get<ApiSettings>() ?? throw new Exception("API settings not found");
PushNotificationsSettings pushSettings = builder.Configuration.GetSection("PushNotifications").Get<PushNotificationsSettings>() ?? throw new Exception("Push notifications settings not found");
S3Settings s3Settings = builder.Configuration.GetSection("S3").Get<S3Settings>() ?? throw new Exception("S3 settings not found");

builder.Services.AddAuthentication(options => {
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
}).AddJwtBearer(options => {
    options.TokenValidationParameters = new TokenValidationParameters {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtSettings.Issuer,
        ValidAudience = jwtSettings.Audience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Secret))
    };
    // SignalR sends the JWT token as a query-string param because WebSocket
    // upgrades cannot carry custom headers.
    options.Events = new JwtBearerEvents {
        OnMessageReceived = context => {
            string? accessToken = context.Request.Query["access_token"];
            PathString path = context.HttpContext.Request.Path;
            if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/updates")) {
                context.Token = accessToken;
            }
            return Task.CompletedTask;
        }
    };
});

builder.Services.AddSingleton<IAmazonS3>(_ => {
    AmazonS3Config config = new() {
        ServiceURL = s3Settings.ServiceUrl,
        ForcePathStyle = true
    };
    return new AmazonS3Client(s3Settings.AccessKey, s3Settings.SecretKey, config);
});


builder.Services.AddSignalR();
builder.Services.AddAuthorization();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddControllers()
    .AddJsonOptions(opts => {
        opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        opts.JsonSerializerOptions.DictionaryKeyPolicy  = System.Text.Json.JsonNamingPolicy.CamelCase;
    });
builder.Services.AddCors(options => {
    options.AddPolicy("AllowAll", policy => {
        // Cors enforces that allow origin isn't * for SignalR with creds.
        // So we need to actually specify the origin.
        policy.WithOrigins(apiSettings.AllowedOrigins)
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials();
    });
});

// redis
builder.Services.AddSingleton<IConnectionMultiplexer>(_ => {
    string configuration = builder.Configuration.GetConnectionString("Redis") 
                           ?? throw new Exception("Redis connection string not found");
    return ConnectionMultiplexer.Connect(configuration);
});

// db
builder.Services.AddDbContext<ChatDatabaseContext>(options =>
    options.UseMySql(builder.Configuration.GetConnectionString("MySql"),
        ServerVersion.AutoDetect(builder.Configuration.GetConnectionString("MySql"))));
builder.Services.AddScoped<IUserRepo, UserRepo>();
builder.Services.AddScoped<IFriendshipRepo, FriendshipRepo>();
builder.Services.AddScoped<IChannelRepo, ChannelRepo>();
builder.Services.AddScoped<IDmChannelRepo, DmChannelRepo>();
builder.Services.AddScoped<IMessageRepo, MessageRepo>();
builder.Services.AddScoped<IGroupChatRepo, GroupChatRepo>();
builder.Services.AddScoped<IGuildRepo, GuildRepo>();
builder.Services.AddScoped<IRoleRepo, RoleRepo>();
builder.Services.AddScoped<IUnreadsRepo, UnreadsRepo>();

// generic services
builder.Services.AddScoped<IJwtManager, JwtManager>();
builder.Services.AddSingleton<INotificationService, NotificationService>();
builder.Services.AddHostedService<NotificationBackgroundService>();
builder.Services.AddHttpClient<ISerbleApiClient, SerbleApiClient>();
builder.Services.AddScoped<IVoiceManager, VoiceManager>();
builder.Services.AddScoped<IImagesService, ImagesService>();

// push notifications
builder.Services.AddMemoryCache();
builder.Services.AddMemoryVapidTokenCache();
builder.Services.AddPushServiceClient(options => {
    options.PublicKey = pushSettings.VapidPublicKey;
    options.PrivateKey = pushSettings.VapidPrivateKey;
    options.Subject = pushSettings.Subject;
});

WebApplication app = builder.Build();

if (app.Environment.IsDevelopment()) {
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowAll");
app.UseAuthentication();
app.UseAuthorization();
app.MapHub<ChatHub>("/updates");
app.MapControllers();
app.Run();

