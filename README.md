# Serble Chat
This is the source code for the Serble Chat platform, a chat app
that supports creating 'guilds' where you can invite users and give them
role, have multiple channels, and chat with friends.

## Running

### Backend
First configure it. Copy and paste `appsettings.json` into `appsettings.Development.json` (or the config
for your environment).  
You'll need to following running and configured:
- MySQL/MariaDB
- Redis
- [LiveKit](https://livekit.io/)

**LiveKit Config**  
Use `--config livekit.conf` to pick what config to use.
You might run the server like this: 
```
livekit-server --dev --keys "devkey: somekeythatisverysecureandaverygoodlength" --config livekit.conf
```
Config file:
```yaml
# Serble Chat needs a webhook to deliver events to clients
webhook:
  # The API key to use in order to sign the message
  # This must match one of the keys LiveKit is configured with
  api_key: 'devkey'
  urls:
    - 'http://localhost:5210/livekit/webhook'
```

**Configuring Push Notifications**  
You need to generate a public private key pair to use for signing notifications,
if you have `npx` you can run `npx web-push generate-vapid-keys` and it'll give you
ready to use keys.

### Frontend
To run the frontend, you'll need to configure the URLs it'll use to communicate
with the server. Duplicate the `.env.example` file, call it `.env` and change the URLs
to point somewhere that users' devices will be able to access.

Because of CORS, notifications and voice chat won't work properly unless
the site is served over https (which means the backend must be too),
so keep that in mind. For testing I use tailscale to provision a certificate
and then I use a local nginx instance to forward requests.

## Contributing
Bug reports as issues and pull requests are appreciated.
