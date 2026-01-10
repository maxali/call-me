# Azure Communication Services (ACS) Implementation Guide

This document provides technical details about the Azure Communication Services integration for Microsoft Teams calling support.

## Overview

Azure Communication Services (ACS) is Microsoft's cloud communications platform that enables PSTN calling and optional Teams interoperability. This implementation adds ACS as a third phone provider option alongside Telnyx and Twilio.

## Why Azure Communication Services?

### Advantages
1. **Microsoft Teams Integration**: Native integration with Microsoft 365 and Teams
2. **Enterprise Features**: Enterprise-grade security, compliance, and scalability
3. **Competitive Pricing**: ~$0.012/min for PSTN calls (between Telnyx and Twilio)
4. **Teams Interoperability**: Can call both PSTN numbers and Teams users
5. **Global Reach**: Available in 200+ countries and regions

### Use Cases
- Organizations already using Microsoft 365/Teams
- Need for Teams user calling (beyond PSTN)
- Compliance requirements (HIPAA, SOC 2, ISO 27001)
- Integration with Azure ecosystem

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                     CallMe MCP Server                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Telnyx     │  │   Twilio     │  │     ACS      │      │
│  │   Provider   │  │   Provider   │  │   Provider   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                            │                  │
└────────────────────────────────────────────┼─────────────────┘
                                             │
                                             ▼
                          ┌──────────────────────────────────┐
                          │  Azure Communication Services    │
                          │  - Call Control API              │
                          │  - Media Streaming (WebSocket)   │
                          │  - Teams Interoperability        │
                          └──────────────────────────────────┘
                                             │
                                             ▼
                          ┌──────────────────────────────────┐
                          │    PSTN / Microsoft Teams        │
                          └──────────────────────────────────┘
```

### Provider Implementation

The ACS provider (`phone-acs.ts`) implements the `PhoneProvider` interface:

- `initialize()`: Sets up ACS credentials (endpoint + connection string)
- `initiateCall()`: Creates outbound call via ACS Call Automation API
- `startStreaming()`: Configures WebSocket-based media streaming
- `hangup()`: Terminates active call
- `getStreamConnectXml()`: Returns empty (ACS uses API-based configuration)

## API Integration

### Call Automation API

ACS uses REST API for call control (not TwiML/XML like Twilio):

**Endpoint**: `https://{resource}.communication.azure.com/calling/callConnections`

**Authentication**: HMAC-SHA256 signature with access key

**Key Methods**:
- `POST /calling/callConnections` - Initiate call
- `DELETE /calling/callConnections/{id}` - Hang up call
- Media streaming configuration is included in the initial call request

### Webhook Events

ACS sends JSON webhooks for call events:

| Event Type | Description | Handler Action |
|------------|-------------|----------------|
| `Microsoft.Communication.CallConnected` | Call answered | Start media streaming |
| `Microsoft.Communication.CallDisconnected` | Call ended | Clean up call state |
| `Microsoft.Communication.MediaStreamingStarted` | Streaming ready | Mark streaming as active |
| `Microsoft.Communication.MediaStreamingStopped` | Streaming stopped | Handle cleanup |

### Webhook Security

ACS webhooks are secured using HMAC-SHA256:

```typescript
// Signature is sent in x-ms-content-sha256 header
const signature = HMAC-SHA256(requestBody, accessKey).toBase64()
```

The `validateACSSignature()` function verifies webhook authenticity.

## Configuration

### Required Environment Variables

```bash
CALLME_PHONE_PROVIDER=acs
CALLME_PHONE_ACCOUNT_SID=https://your-resource.communication.azure.com/
CALLME_PHONE_AUTH_TOKEN=endpoint=https://your-resource.communication.azure.com/;accesskey=your_key
CALLME_PHONE_NUMBER=+15551234567
```

### Connection String Format

The connection string contains both endpoint and access key:

```
endpoint=https://{resource}.communication.azure.com/;accesskey={base64_key}
```

The provider can accept either:
1. Full connection string in `CALLME_PHONE_AUTH_TOKEN`
2. Endpoint in `CALLME_PHONE_ACCOUNT_SID` + access key in `CALLME_PHONE_AUTH_TOKEN`

## Media Streaming

### WebSocket Protocol

ACS uses WebSocket-based media streaming (similar to Telnyx):

**Stream Configuration**:
```json
{
  "transportType": "websocket",
  "contentType": "audio",
  "audioChannelType": "unmixed"
}
```

**Audio Format**:
- Codec: PCMU (μ-law)
- Sample Rate: 8 kHz
- Channels: Mono
- Encoding: Base64

### Audio Flow

```
User's Voice
    │
    ▼
[ACS WebSocket] ──► [STT Provider (OpenAI)] ──► Transcript
    │
    ▼
[CallMe Server] ──► [TTS Provider (OpenAI)] ──► Audio
    │
    ▼
[ACS WebSocket] ──► User hears response
```

## Setup Instructions

### 1. Create Azure Resources

1. **Create Azure account**: Visit [portal.azure.com](https://portal.azure.com)

2. **Create Communication Services resource**:
   ```bash
   # Via Azure Portal:
   # Search "Communication Services" → Create
   
   # Via Azure CLI:
   az communication create \
     --name "callme-acs" \
     --resource-group "my-resource-group" \
     --location "global"
   ```

3. **Get credentials**:
   - Navigate to: Resource → Keys
   - Copy: Endpoint + Connection String

4. **Purchase phone number**:
   ```bash
   # Via Azure Portal:
   # Resource → Phone Numbers → Get
   
   # Select country, number type, and capabilities
   ```

### 2. Configure CallMe

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "CALLME_PHONE_PROVIDER": "acs",
    "CALLME_PHONE_ACCOUNT_SID": "https://your-resource.communication.azure.com/",
    "CALLME_PHONE_AUTH_TOKEN": "endpoint=https://your-resource.communication.azure.com/;accesskey=YOUR_KEY",
    "CALLME_PHONE_NUMBER": "+15551234567",
    "CALLME_USER_PHONE_NUMBER": "+15559876543",
    "CALLME_OPENAI_API_KEY": "sk-...",
    "CALLME_NGROK_AUTHTOKEN": "your-ngrok-token"
  }
}
```

### 3. Configure Webhooks

After starting the CallMe server:

1. Note your ngrok URL (shown in server logs)
2. Configure callback URI in Azure Portal:
   - Resource → Events → Configure webhook
   - Set URL to: `https://your-ngrok-url/twiml`
   - Subscribe to: CallConnected, CallDisconnected, MediaStreaming events

## Teams Interoperability (Optional)

### Enable Teams Calling

To call Teams users (not just PSTN):

1. **Enable Teams interoperability**:
   ```bash
   # Via Azure Portal:
   # Resource → Teams Interoperability → Enable
   ```

2. **Modify call target**:
   ```typescript
   // In phone-acs.ts, change target format:
   {
     targets: [
       {
         microsoftTeamsUserId: "user@tenant.com"  // Teams user
       }
     ]
   }
   ```

3. **Configure Teams tenant**:
   - Requires Teams admin permissions
   - Enable external access for ACS resource

## Pricing

### Azure Communication Services Costs

| Service | Cost (USA) |
|---------|------------|
| Outbound PSTN | ~$0.012/min |
| Inbound PSTN | ~$0.0085/min |
| Phone Number | ~$1/month |
| Media Streaming | Included |
| Teams Calling | Included |

### Total Cost Comparison

For a typical 1-minute call:

| Provider | PSTN | OpenAI | Total |
|----------|------|--------|-------|
| Telnyx | $0.007 | $0.026 | $0.033 |
| ACS | $0.012 | $0.026 | $0.038 |
| Twilio | $0.014 | $0.026 | $0.040 |

*OpenAI costs: STT ($0.006/min) + TTS ($0.020/min)*

## Troubleshooting

### Common Issues

1. **Invalid Connection String**
   - Error: "Invalid ACS connection string format"
   - Solution: Ensure format is `endpoint=...;accesskey=...`

2. **Webhook Signature Failure**
   - Error: "Rejecting ACS webhook: invalid signature"
   - Solution: Verify connection string contains correct access key

3. **Call Not Connecting**
   - Check: Phone number is purchased and active
   - Check: Webhook URL is correctly configured in Azure Portal
   - Check: ngrok tunnel is active

4. **No Audio Received**
   - Check: Media streaming is enabled in call configuration
   - Check: WebSocket connection is established
   - Check: Audio format matches (PCMU, 8kHz)

### Debug Mode

Enable detailed logging:

```bash
export CALLME_DEBUG=true
```

Logs will show:
- Webhook events and payloads
- WebSocket connection status
- Audio stream details
- API request/response

## Security Considerations

### Webhook Authentication

All ACS webhooks are validated using HMAC-SHA256:

```typescript
validateACSSignature(connectionString, signature, body)
```

### WebSocket Security

WebSocket connections use token-based authentication:

```typescript
const token = generateWebSocketToken();
streamUrl += `?token=${encodeURIComponent(token)}`;
```

### Best Practices

1. **Rotate Access Keys**: Regularly rotate ACS access keys
2. **Restrict Network**: Use Azure networking features to restrict access
3. **Monitor Usage**: Set up Azure Monitor alerts for unusual activity
4. **Enable Logging**: Enable diagnostic logs in Azure Portal

## Testing

### Manual Testing Steps

1. **Start Server**:
   ```bash
   cd server
   bun run dev
   ```

2. **Initiate Test Call**:
   Use the MCP tool in Claude Code:
   ```
   "Call me to test the Azure Communication Services integration"
   ```

3. **Verify**:
   - Phone rings
   - Can hear Claude speaking
   - Claude can hear your responses
   - Call ends cleanly

### Integration Testing

To test without Azure credentials:

```bash
# Mock ACS responses for testing
export CALLME_ACS_MOCK=true
bun test
```

## Migration Guide

### From Twilio/Telnyx to ACS

1. **Set up ACS resource** (as described above)
2. **Update environment variables**:
   ```bash
   # Change from:
   CALLME_PHONE_PROVIDER=telnyx
   # To:
   CALLME_PHONE_PROVIDER=acs
   ```
3. **Update credentials** (endpoint + connection string)
4. **Test thoroughly** before production use
5. **Keep old provider** as backup during transition

### Rollback Plan

To revert to previous provider:

```bash
# Simply change environment variable back
CALLME_PHONE_PROVIDER=telnyx  # or twilio
```

No code changes required - all providers use the same interface.

## Future Enhancements

### Potential Improvements

1. **Video Support**: Add video calling capabilities
2. **Recording**: Implement call recording via ACS
3. **SMS Integration**: Add SMS fallback option
4. **Teams Direct**: Direct Teams-to-Teams calling
5. **Advanced Routing**: Smart routing based on user availability

### Contributing

To contribute ACS improvements:

1. Test changes with real ACS credentials
2. Ensure backward compatibility with Twilio/Telnyx
3. Add tests for new functionality
4. Update documentation

## Support

### Resources

- [ACS Documentation](https://learn.microsoft.com/en-us/azure/communication-services/)
- [Call Automation API Reference](https://learn.microsoft.com/en-us/rest/api/communication/)
- [Teams Interoperability Guide](https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/teams-interop)
- [Pricing Calculator](https://azure.microsoft.com/en-us/pricing/calculator/)

### Getting Help

- **Issues**: Open GitHub issue with `[ACS]` prefix
- **Questions**: Discussions tab on GitHub
- **Security**: Email security issues (do not open public issues)

## License

This ACS integration follows the same MIT license as the main CallMe project.
