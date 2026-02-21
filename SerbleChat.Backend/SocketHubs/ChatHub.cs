using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace SerbleChat.Backend.SocketHubs;

[Authorize]
public class ChatHub : Hub {
    
    public async Task SayHello(string name) {
        await Clients.All.SendAsync("ReceiveMessage", $"Hello, {name}!");
    }
}
