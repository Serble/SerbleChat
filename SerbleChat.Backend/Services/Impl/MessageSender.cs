using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Services.Impl;

public partial class MessageSender(IMessageRepo msgs, IUnreadsRepo unreads, IHubContext<ChatHub> updates,
    INotificationService notifications) : IMessageSender {

    public async Task Send(Channel channel, Message message) {
        await msgs.CreateMessage(message);
        await Deliver(channel, message);
    }

    public async Task Deliver(Channel channel, Message message, bool parseMentions = true) {
        await updates.Clients.Group($"channel-{channel.Id}").SendAsync("NewMessage", message);

        List<string> mentionedUserIds = [];
        if (parseMentions) {
            foreach (Match match in UserMentionsMatcher().Matches(message.Content)) {
                mentionedUserIds.Add(match.Groups[1].Value);
            }
        }

        if (mentionedUserIds.Count != 0) {
            await updates.Clients.Users(mentionedUserIds).SendAsync("MentionedInMessage", new {
                MessageId = message.Id,
                ChannelId = channel.Id
            });
            await unreads.AddUserMentions(channel.Id, message.Id, mentionedUserIds);
        }

        await notifications.EnqueueMessageProcessing(channel, message, mentionedUserIds);
    }

    [GeneratedRegex("<@user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>")]
    private static partial Regex UserMentionsMatcher();
}
