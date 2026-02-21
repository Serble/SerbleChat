using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Controllers;

[ApiController]
[Route("/friends")]
[Authorize]
public class FriendsController(IFriendshipRepo friendships, IHubContext<ChatHub> updates) : ControllerBase {
    
    [HttpGet]
    public async Task<ActionResult<Friendship[]>> Get() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        return Ok(await friendships.GetFriendships(userId));
    }
    
    [HttpPost("{friendId}")]
    public async Task<ActionResult> AddFriend(string friendId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        if (userId == friendId) {
            return BadRequest("Cannot add yourself as a friend");
        }
        
        Friendship? existing = await friendships.GetFriendship(userId, friendId);
        if (existing != null) {
            // are they trying to accept?
            if (!existing.Pending) {
                return BadRequest("Already friends");
            }

            if (existing.User1Id == friendId) {  // they are accepting the friend request
                existing.Pending = false;
                existing.CreatedAt = DateTime.UtcNow;
                await friendships.ModifyFriendship(existing);
                return Ok();
            }
            
            // they are trying to send a friend request, but one is already pending
            return BadRequest("Friend request already sent");
        }
        
        // no existing friendship, create a new one
        await friendships.AddFriendship(new Friendship {
            User1Id = userId,
            User2Id = friendId
        });
        
        // let the other user know
        await updates.Clients.User(friendId).SendAsync("FriendRequestReceived", new {
            FromUserId = userId
        });
        
        return Ok();
    }
}
