using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.SocketHubs;

[Authorize]
public class ChatHub(IChannelRepo channels) : Hub {
    
    public async Task SayHello(string name) {
        await Clients.All.SendAsync("ReceiveMessage", $"Hello, {name}!");
    }

    public override async Task OnConnectedAsync() {
        // we need to add them to channels they're in
        await Clients.Caller.SendAsync("Hello", "Welcome to the chat hub!");
        string userId = Context.UserIdentifier ?? throw new Exception("User identifier is null");

        List<Channel> visible = await channels.GetChannelsVisibleToUser(userId);
        foreach (Channel channel in visible) {
            await Groups.AddToGroupAsync(Context.ConnectionId, $"channel-{channel.Id}");
        }
        
        await Clients.Caller.SendAsync("GroupsUpdated", visible.Select(c => new {
            c.Id,
            c.Name,
            c.Type
        }));
    }
}
