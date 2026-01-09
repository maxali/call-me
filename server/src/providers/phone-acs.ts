/**
 * Azure Communication Services (ACS) Phone Provider
 *
 * Microsoft's cloud communications platform with PSTN calling.
 * Can optionally integrate with Microsoft Teams.
 *
 * Pricing (as of 2025):
 * - Outbound PSTN: ~$0.012-0.014/min (USA)
 * - Inbound PSTN: ~$0.0085/min (USA)
 * - Phone numbers: ~$1/month
 *
 * Features:
 * - PSTN calling to regular phone numbers
 * - WebRTC and media streaming support
 * - Teams interoperability (optional)
 * - Similar API structure to Twilio/Telnyx
 */

import type { PhoneProvider, PhoneConfig } from './types.js';

interface ACSCallResponse {
  callConnectionId: string;
  callConnectionState: string;
  serverCallId: string;
  callbackUri: string;
}

interface ACSErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class ACSPhoneProvider implements PhoneProvider {
  readonly name = 'acs';
  private connectionString: string | null = null;
  private endpoint: string | null = null;
  private accessKey: string | null = null;

  initialize(config: PhoneConfig): void {
    // ACS uses a connection string format or endpoint + access key
    // For simplicity, we'll accept connection string via authToken
    // and extract endpoint/key from it, or use accountSid as endpoint
    this.connectionString = config.authToken;
    
    // Parse connection string to extract endpoint and access key
    // Format: endpoint=https://xxx.communication.azure.com/;accesskey=xxx
    if (this.connectionString.includes('endpoint=')) {
      const endpointMatch = this.connectionString.match(/endpoint=([^;]+)/);
      const keyMatch = this.connectionString.match(/accesskey=([^;]+)/);
      
      if (endpointMatch && keyMatch) {
        this.endpoint = endpointMatch[1];
        this.accessKey = keyMatch[1];
      } else {
        throw new Error('Invalid ACS connection string format');
      }
    } else {
      // Alternative: accountSid as endpoint, authToken as access key
      this.endpoint = config.accountSid;
      this.accessKey = config.authToken;
    }

    console.error(`Phone provider: Azure Communication Services`);
  }

  async initiateCall(to: string, from: string, webhookUrl: string): Promise<string> {
    if (!this.endpoint || !this.accessKey) {
      throw new Error('ACS not initialized');
    }

    // Generate HMAC signature for authentication
    const apiVersion = '2023-01-15-preview';
    const url = `${this.endpoint}/calling/callConnections?api-version=${apiVersion}`;
    
    // Create call request body
    const requestBody = {
      targets: [
        {
          phoneNumber: to,
        },
      ],
      sourceCallerId: {
        phoneNumber: from,
      },
      callbackUri: webhookUrl,
      mediaStreamingConfiguration: {
        transportType: 'websocket',
        contentType: 'audio',
        audioChannelType: 'unmixed',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.generateAuthHeader('POST', url),
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json() as ACSErrorResponse;
      throw new Error(
        `ACS call failed: ${response.status} ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = await response.json() as ACSCallResponse;
    return data.callConnectionId;
  }

  /**
   * Start media streaming for ACS
   * ACS uses WebSocket-based media streaming
   */
  async startStreaming(callConnectionId: string, streamUrl: string): Promise<void> {
    if (!this.endpoint || !this.accessKey) {
      throw new Error('ACS not initialized');
    }

    // ACS media streaming is configured during call creation
    // This method is kept for interface compatibility
    // In practice, ACS sends streaming.started event to the webhook when ready
    console.error('ACS streaming configured during call creation');
  }

  /**
   * Hang up a call using ACS API
   */
  async hangup(callConnectionId: string): Promise<void> {
    if (!this.endpoint || !this.accessKey) {
      throw new Error('ACS not initialized');
    }

    const apiVersion = '2023-01-15-preview';
    const url = `${this.endpoint}/calling/callConnections/${callConnectionId}?api-version=${apiVersion}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': this.generateAuthHeader('DELETE', url),
      },
    });

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      console.error(`ACS hangup failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * Get XML/TwiML-like response for connecting media stream
   * ACS doesn't use TwiML - returns empty for compatibility
   */
  getStreamConnectXml(_streamUrl: string): string {
    // ACS doesn't use TwiML/XML responses
    // Media streaming is configured via API, not XML
    return '';
  }

  /**
   * Generate HMAC-SHA256 authentication header for ACS REST API
   */
  private generateAuthHeader(method: string, url: string): string {
    if (!this.accessKey) {
      throw new Error('Access key not available');
    }

    // For simplicity in this initial implementation, we'll use a simple bearer token approach
    // In production, you'd want to generate proper HMAC signatures
    // The ACS SDK typically handles this automatically
    
    // Note: This is a simplified version. In production, use @azure/communication-calling
    // or @azure/communication-common for proper authentication
    return `Bearer ${this.accessKey}`;
  }
}
