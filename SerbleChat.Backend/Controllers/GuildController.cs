using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Controllers;

[ApiController]
[Route("guild")]
[Authorize]
public class GuildController(IGuildRepo guilds, IChannelRepo channels, IRoleRepo roles, IUserRepo users,
    IHubContext<ChatHub> updates) : ControllerBase {

    [HttpGet]
    public async Task<ActionResult<Guild[]>> GetMyGuilds() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        return await guilds.GetGuildsForUser(userId);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Guild>> GetGuildById(int id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) return NotFound("Guild not found");
        return Ok(guild);
    }

    [HttpPost]
    public async Task<ActionResult<Guild>> CreateGuild(GuildCreateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        if (string.IsNullOrEmpty(request.Name)) {
            return BadRequest("Guild name cannot be empty");
        }

        Guild guild = new() {
            Name = request.Name,
            OwnerId = userId,
            CreatedAt = DateTime.UtcNow,
            DefaultPermissions = GuildPermissions.Default
        };
        await guilds.CreateGuild(guild);

        // Add creator as a member so they can access channels
        await guilds.AddGuildMember(guild.Id, userId);

        // now make an example channel
        Channel channel = new() {
            CreatedAt = DateTime.UtcNow,
            Name = "Fluffy Unicorn Discussion",
            Type = ChannelType.Guild,
            GuildId = guild.Id,
            VoiceCapable = false
        };
        await channels.CreateChannel(channel);
        
        GuildChannel guildChannel = new() {
            GuildId = guild.Id,
            Index = 0,
            ChannelId = channel.Id,
        };
        await guilds.CreateGuildChannel(guildChannel);
        
        return Ok(guild);
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> DeleteGuild(int id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, id);
        if (!perms.Administrator.ToBool()) {
            return Forbid();
        }
        
        await guilds.DeleteGuild(id);
        return Ok();
    }

    [HttpPatch("{id:int}")]
    public async Task<ActionResult> UpdateGuild(int id, GuildUpdateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, id);
        if (!(perms.Administrator.ToBool() || perms.ManageGuild.ToBool())) {
            return Forbid();
        }
        
        if (!string.IsNullOrEmpty(request.Name)) {
            guild.Name = request.Name;
        }

        if (request.DefaultPermissions != null) {
            guild.DefaultPermissions = request.DefaultPermissions;
        }
        
        await guilds.UpdateGuild(guild);
        await updates.Clients.Group("guild-" + id).SendAsync("GuildUpdated", new {
            GuildId = guild.Id
        });
        return Ok();
    }

    [HttpGet("{id:int}/my-permissions")]
    public async Task<ActionResult<GuildPermissions>> GetMyPermissions(int id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) return NotFound("Guild not found");
        GuildPermissions perms = await guilds.GetUserPermissions(userId, id);
        return Ok(perms);
    }
    
    [HttpGet("{id:int}/channel/{channelId:int}/my-permissions")]
    public async Task<ActionResult<GuildPermissions>> GetMyPermissions(int id, int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) return NotFound("Guild not found");
        GuildPermissions perms = await guilds.GetUserPermissions(userId, id, channelId);
        return Ok(perms);
    }

    [HttpGet("{guildId:int}/members")]
    public async Task<ActionResult<GuildMemberResponse[]>> GetGuildMembers(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) return NotFound("Guild not found");
        if (!await guilds.IsGuildMember(guildId, userId)) return Forbid();
        // Re-use channel-based details but for any channel in this guild
        Channel[] guildChannels = await guilds.GetGuildChannelsAsChannels(guildId);
        if (guildChannels.Length == 0) {
            // No channels — just return empty member list with no colour info
            return Ok(Array.Empty<GuildMemberResponse>());
        }
        return Ok(await guilds.GetGuildChannelMembersDetails(guildChannels[0].Id));
    }

    // CHANNEL ENDPOINTS

    // this is ~6 queries
    [HttpGet("{guildId:int}/channel")]
    public async Task<ActionResult<IEnumerable<GuildChannel>>> GetChannels(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        Dictionary<long, GuildPermissions> perms = await guilds.GetUserPermissionsForGuild(userId, guildId);
        Dictionary<long, GuildChannel> channelData = (await guilds.GetGuildChannels(guildId))
            .ToDictionary(v => v.ChannelId);

        return Ok(perms
            .Where(p => p.Value.HasPerm(s => s.ViewChannel))
            .Select(p => channelData[p.Key]));
    }

    [HttpPost("{guildId:int}/channel")]
    public async Task<ActionResult<Channel>> CreateChannel(int guildId, GuildChannelCreateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }
        
        Channel channel = new() {
            CreatedAt = DateTime.UtcNow,
            Name = request.Name,
            Type = ChannelType.Guild,
            GuildId = guild.Id,
            VoiceCapable = request.VoiceCapable
        };
        await channels.CreateChannel(channel);

        int channelCount = (await guilds.GetGuildChannels(guild.Id)).Length;
        GuildChannel guildChannel = new() {
            GuildId = guild.Id,
            Index = channelCount,
            ChannelId = channel.Id,
        };
        await guilds.CreateGuildChannel(guildChannel);
        
        string[] memberIds = (await guilds.GetGuildChannelMembers(guildChannel.ChannelId)).Select(m => m.Id)
            .ToArray();
        await updates.Clients.Users(memberIds).SendAsync("NewChannel", channel);
        
        return Ok(channel);
    }

    [HttpDelete("{guildId:int}/channel/{channelId:int}")]
    public async Task<ActionResult> DeleteChannel(int guildId, int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId, channelId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }
        
        await channels.DeleteChannel(channelId);
        await guilds.DeleteGuildChannel(channelId);
        
        await updates.Clients.Group($"channel-{channelId}").SendAsync("ChannelDeleted", new {
            ChannelId = channelId
        });
        return Ok();
    }

    [HttpPatch("{guildId:int}/channel/{channelId:int}")]
    public async Task<ActionResult> UpdateChannel(int guildId, int channelId, GuildChannelUpdateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId, channelId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }

        Channel channel = guildChannel.ChannelNavigation;
        if (!string.IsNullOrEmpty(request.Name)) {
            channel.Name = request.Name;
        }

        if (request.VoiceCapable.HasValue) {
            channel.VoiceCapable = request.VoiceCapable.Value;
        }
        
        await channels.UpdateChannel(channel);
        await updates.Clients.Group("guild-" + guildId).SendAsync("GuildUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }

    [HttpPost("{guildId:int}/channel/{channelId:int}/reorder")]
    public async Task<ActionResult> ReorderChannels(int guildId, int channelId, ChannelReorderRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId, channelId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }
        
        GuildChannel[] guildChannels = await guilds.GetGuildChannels(guildId);
        int oldIndex = guildChannel.Index;
        int newIndex = request.NewIndex;
        if (newIndex < 0 || newIndex >= guildChannels.Length) {
            return BadRequest("New index out of bounds");
        }
        
        if (newIndex == oldIndex) {
            return Ok("No change was needed");  // no change needed
        }

        List<GuildChannel> orderedChannels = guildChannels
            .Where(c => c.ChannelId != channelId)
            .OrderBy(c => c.Index)
            .ToList();
        orderedChannels.Insert(newIndex, guildChannel);
        
        // re-assign indices
        for (int i = 0; i < orderedChannels.Count; i++) {
            orderedChannels[i].Index = i;
            await guilds.UpdateGuildChannel(orderedChannels[i]);
        }
        
        await updates.Clients.Group("guild-" + guildId).SendAsync("GuildUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }

    /// <summary>
    /// Get members of channel.
    /// This is different from <see cref="ChannelController.GetChannelMembers"/> because
    /// it gets guild member information, not just regular user information.
    /// </summary>
    /// <param name="guildId"></param>
    /// <param name="channelId"></param>
    /// <returns></returns>
    [HttpGet("{guildId:int}/channel/{channelId:int}/members")]
    public async Task<ActionResult<GuildMemberResponse[]>> GetChannelMembers(int guildId, int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }
        
        return Ok(await guilds.GetGuildChannelMembersDetails(channelId));
    }

    [HttpGet("{guildId:int}/channel/{channelId:int}/permission-overrides")]
    public async Task<ActionResult<ChannelPermissionOverride[]>> GetChannelPermissionOverrides(int guildId,
        int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }

        return await guilds.GetChannelPermissionOverrides(channelId);
    }

    [HttpDelete("{guildId:int}/channel/{channelId:int}/permission-overrides/{overrideId:int}")]
    public async Task<ActionResult> DeleteChannelPermissionOverride(int guildId, int channelId, int overrideId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId, channelId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }
        
        await guilds.DeleteChannelPermissionOverride(overrideId);
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }

    [HttpPost("{guildId:int}/channel/{channelId:int}/permission-overrides")]
    public async Task<ActionResult> CreateChannelPermissionOverride(int guildId, int channelId,
        ChannelPermissionOverrideCreateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId, channelId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }

        if (request.RoleId == null && request.UserId == null) {
            return BadRequest("Must specify either RoleId or UserId");
        }

        if (request is { RoleId: not null, UserId: not null }) {
            return BadRequest("Cannot specify both RoleId and UserId");
        }
        
        ChannelPermissionOverride permissionOverride = new() {
            ChannelId = channelId,
            RoleId = request.RoleId,
            UserId = request.UserId,
            Permissions = request.Permissions
        };
        
        await guilds.CreateChannelPermissionOverride(permissionOverride);
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }
    
    [HttpPatch("{guildId:int}/channel/{channelId:int}/permission-overrides/{overrideId:int}")]
    public async Task<ActionResult> UpdateChannelPermissionOverride(int guildId, int channelId, int overrideId,
        ChannelPermissionOverrideModifyRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId, channelId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }

        ChannelPermissionOverride? permissionOverride = await guilds.GetChannelPermissionOverride(channelId);
        if (permissionOverride == null) {
            return NotFound("Permission override not found");
        }

        permissionOverride.Permissions = request.Permissions;
        await guilds.UpdateChannelPermissionOverride(permissionOverride);
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }

    // INVITES

    [HttpPost("{guildId:int}/invite")]
    public async Task<ActionResult<GuildInvite>> CreateInvite(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId);
        if (!(perms.Administrator.ToBool() || perms.CreateInvites.ToBool())) {
            return Forbid();
        }
        
        GuildInvite invite = new() {
            GuildId = guildId,
        };
        await guilds.CreateInvite(invite);
        return Ok(invite);
    }
    
    [HttpDelete("invite/{inviteId:int}")]
    public async Task<ActionResult> DeleteInvite(int inviteId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        GuildInvite? invite = await guilds.GetInvite(inviteId);
        if (invite == null) {
            return NotFound("Invite not found");
        }
        
        Guild? guild = await guilds.GetGuild(invite.GuildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, invite.GuildId);
        if (!(perms.Administrator.ToBool() || perms.ManageGuild.ToBool())) {
            return Forbid();
        }
        
        await guilds.DeleteInvite(inviteId);
        return Ok();
    }
    
    [HttpGet("{guildId:int}/invite")]
    public async Task<ActionResult<GuildInvite[]>> GetInvites(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId);
        if (!(perms.Administrator.ToBool() || perms.ManageGuild.ToBool())) {
            return Forbid();
        }
        
        GuildInvite[] invites = await guilds.GetGuildInvites(guildId);
        return Ok(invites);
    }

    [HttpPost("invite/{inviteId:int}/accept")]
    public async Task<ActionResult<Guild>> AcceptInvite(int inviteId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        GuildInvite? invite = await guilds.GetInvite(inviteId);
        if (invite == null) {
            return NotFound("Invite not found");
        }
        
        Guild? guild = await guilds.GetGuild(invite.GuildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        if (await guilds.IsGuildMember(invite.GuildId, userId)) {
            return BadRequest("Already a member of this guild");
        }
        
        await guilds.AddGuildMember(guild.Id, userId);
        return Ok(guild);
    }
    
    // ROLES

    [HttpGet("{guildId:int}/roles")]
    public async Task<ActionResult<Role[]>> GetRoles(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        return Ok(await roles.GetGuildRoles(guildId));
    }

    [HttpPost("{guildId:int}/roles")]
    public async Task<ActionResult<Role>> CreateRole(int guildId, RoleCreateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        Role role = new() {
            GuildId = guildId,
            Name = request.Name,
            Permissions = request.Permissions ?? new GuildPermissions(),
            Color = request.Color ?? "",
            DisplaySeparately = request.DisplaySeparately,
            Mentionable = request.Mentionable
        };
        await roles.CreateRole(role);
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok(role);
    }

    [HttpDelete("{guildId:int}/roles/{roleId:int}")]
    public async Task<ActionResult> DeleteRole(int guildId, int roleId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        Role? role = await roles.GetRole(roleId);
        if (role == null || role.GuildId != guildId) {
            return NotFound("Role not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        await roles.DeleteRole(roleId);
        
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }

    [HttpPatch("{guildId:int}/roles/{roleId:int}")]
    public async Task<ActionResult> UpdateRole(int guildId, int roleId, RoleUpdateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        Role? role = await roles.GetRole(roleId);
        if (role == null || role.GuildId != guildId) {
            return NotFound("Role not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(userId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        if (!string.IsNullOrEmpty(request.Name)) {
            role.Name = request.Name;
        }
        
        if (request.Color != null) {  // can be empty string to reset to default colour
            role.Color = request.Color;
        }
        
        if (request.DisplaySeparately.HasValue) {
            role.DisplaySeparately = request.DisplaySeparately.Value;
        }
        
        if (request.Mentionable.HasValue) {
            role.Mentionable = request.Mentionable.Value;
        }
        
        if (request.Permissions != null) {
            role.Permissions = request.Permissions;
        }
        
        await roles.UpdateRole(role);
        
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }

    [HttpPost("{guildId:int}/members/{userId}/roles/{roleId:int}")]
    public async Task<ActionResult> AddRoleToUser(int guildId, int roleId, string userId) {
        string? requesterId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (requesterId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        Role? role = await roles.GetRole(roleId);
        if (role == null || role.GuildId != guildId) {
            return NotFound("Role not found in this guild");
        }
        
        GuildPermissions perms = await guilds.GetUserPermissions(requesterId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        await roles.AddUserRole(roleId, userId);
        await updates.Clients.User(userId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        await updates.Clients.Group("guild-" + guildId).SendAsync("UserUpdated", new {
            Id = userId
        });
        return Ok();
    }

    [HttpGet("{guildId:int}/members/{userId}/roles")]
    public async Task<ActionResult<Role[]>> GetUserRoles(int guildId, string userId) {
        string? requesterId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (requesterId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        return Ok(await roles.GetUserRolesInGuild(userId, guildId));
    }

    [HttpDelete("{guildId:int}/members/{userId}/roles/{roleId:int}")]
    public async Task<ActionResult> RemoveRoleFromUser(int guildId, int roleId, string userId) {
        string? requesterId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (requesterId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        Role? role = await roles.GetRole(roleId);
        if (role == null || role.GuildId != guildId) {
            return NotFound("Role not found in this guild");
        }

        GuildPermissions perms = await guilds.GetUserPermissions(requesterId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        await roles.RemoveUserRole(roleId, userId);
        await updates.Clients.User(userId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        await updates.Clients.Group("guild-" + guildId).SendAsync("UserUpdated", new {
            Id = userId
        });
        return Ok();
    }
    
    // NOTIFICATION PREFERENCES
    
    [HttpGet("{guildId:int}/notification-preferences")]
    public async Task<ActionResult<UserGuildNotificationPreferences>> GetGuildNotificationPreferences(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        return Ok(await users.GetUserGuildNotificationPreferences(userId, guildId));
    }

    [HttpPut("{guildId:int}/notification-preferences")]
    public async Task<ActionResult> SetGuildNotificationPreferences(int guildId, [FromBody] NotificationPreferences preferences) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        UserGuildNotificationPreferences notifPrefs = new() {
            GuildId = guildId,
            UserId = userId,
            Preferences = preferences
        };
        await users.SetUserGuildNotificationPreferences(userId, guildId, notifPrefs);
        return Ok();
    }
}
