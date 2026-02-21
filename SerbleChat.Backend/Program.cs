using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Repos.Impl;
using SerbleChat.Backend.Services;
using SerbleChat.Backend.Services.Impl;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.Services.AddOptions<SerbleApiSettings>()
    .Bind(builder.Configuration.GetSection("SerbleApi"));
builder.Services.AddOptions<JwtSettings>()
    .Bind(builder.Configuration.GetSection("Jwt"));

JwtSettings jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>() ?? throw new Exception("JWT settings not found");

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
});

builder.Services.AddAuthorization();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddControllers();
builder.Services.AddCors(options => {
    options.AddPolicy("AllowAll", policy => {
        policy.AllowAnyOrigin()
            .AllowAnyMethod()
            .AllowAnyHeader();
    });
});

// db
builder.Services.AddDbContext<ChatDatabaseContext>(options =>
    options.UseMySql(builder.Configuration.GetConnectionString("MySql"),
        ServerVersion.AutoDetect(builder.Configuration.GetConnectionString("MySql"))));
builder.Services.AddScoped<IUserRepo, UserRepo>();

// services
builder.Services.AddScoped<IJwtManager, JwtManager>();
builder.Services.AddHttpClient<ISerbleApiClient, SerbleApiClient>();

WebApplication app = builder.Build();

if (app.Environment.IsDevelopment()) {
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapControllers();
app.UseCors("AllowAll");
app.UseAuthentication();
app.UseAuthorization();
app.Run();

